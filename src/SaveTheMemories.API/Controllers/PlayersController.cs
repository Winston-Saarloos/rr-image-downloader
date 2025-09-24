using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using RecNetImageApi.Services; // RecNetSettings

namespace RecNetImageApi.Controllers;

[ApiController]
[Route("api/players")]
public class PlayersController : ControllerBase
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly RecNetSettings _settings;

    public PlayersController(IHttpClientFactory httpClientFactory, RecNetSettings settings)
    {
        _httpClientFactory = httpClientFactory;
        _settings = settings;
        Directory.CreateDirectory(_settings.OutputRoot);
    }

    /// POST /api/players/{accountId}/collect
    /// Uses PageSize and InterPageDelayMs from appsettings.
    /// Optional bearer token via: X-RecNet-Token or Authorization: Bearer ...
    [HttpPost("{accountId}/collect")]
    public async Task<IActionResult> CollectAll([FromRoute] string accountId, CancellationToken ct)
    {
        var pageSize = _settings.PageSize;              // from appsettings
        var pauseMs  = _settings.InterPageDelayMs;      // from appsettings

        var client = _httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(30);
        //client.DefaultRequestHeaders.UserAgent.ParseAdd("RecNetImageApi/Collect/1.0");

        // Optional bearer token from headers
        string? token = null;
        if (Request.Headers.TryGetValue("X-RecNet-Token", out var headerToken))
        {
            token = headerToken.ToString().Trim();
        }
        else if (AuthenticationHeaderValue.TryParse(Request.Headers.Authorization, out var authVal) &&
                 string.Equals(authVal.Scheme, "Bearer", StringComparison.OrdinalIgnoreCase))
        {
            token = authVal.Parameter;
        }
        if (!string.IsNullOrWhiteSpace(token))
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        var all = new List<JsonElement>();
        var skip = 0;
        var totalFetched = 0;
        var maxIterations = 99; // Testing limit
        var iterationDetails = new List<object>();

        // Check for existing photos file to determine starting point for incremental collection
        var jsonPath = Path.Combine(_settings.OutputRoot, $"{accountId}_photos.json");
        string? lastSortValue = null;
        var existingPhotoCount = 0;
        
        if (System.IO.File.Exists(jsonPath))
        {
            try
            {
                var existingJson = await System.IO.File.ReadAllTextAsync(jsonPath, ct);
                var existingPhotos = JsonSerializer.Deserialize<JsonElement[]>(existingJson);
                if (existingPhotos != null && existingPhotos.Length > 0)
                {
                    existingPhotoCount = existingPhotos.Length;
                    
                    // Find the newest photo's sort value from existing collection
                    foreach (var photo in existingPhotos)
                    {
                        if (photo.TryGetProperty("sort", out var sortProp))
                        {
                            var currentSort = sortProp.GetString();
                            if (string.IsNullOrEmpty(lastSortValue) || string.Compare(currentSort, lastSortValue, StringComparison.Ordinal) > 0)
                            {
                                lastSortValue = currentSort;
                            }
                        }
                    }
                    
                    // Load existing photos into our collection
                    all.AddRange(existingPhotos.Select(p => p.Clone()));
                    iterationDetails.Add(new { 
                        note = "resumed_from_existing_file", 
                        existingPhotos = existingPhotoCount,
                        lastSortValue 
                    });
                }
            }
            catch (Exception ex)
            {
                // If existing file is corrupted, we'll start fresh
                iterationDetails.Add(new { note = "existing_file_read_failed", error = ex.Message });
            }
        }

        for (int iteration = 0; iteration < maxIterations; iteration++)
        {
            ct.ThrowIfCancellationRequested();

            // Add sort parameter to get photos in chronological order (oldest first)
            var url = $"https://apim.rec.net/apis/api/images/v4/player/{Uri.EscapeDataString(accountId)}?skip={skip}&take={pageSize}&sort=2";
            
            // If we have a last sort value, only get photos newer than that
            if (!string.IsNullOrEmpty(lastSortValue))
            {
                url += $"&after={Uri.EscapeDataString(lastSortValue)}";
            }
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            using var resp = await client.SendAsync(req, ct);

            if (!resp.IsSuccessStatusCode)
            {
                var body = await resp.Content.ReadAsStringAsync(ct);
                return StatusCode((int)resp.StatusCode, new
                {
                    error = "fetch_failed",
                    status = (int)resp.StatusCode,
                    message = body
                });
            }

            await using var stream = await resp.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);

            if (doc.RootElement.ValueKind != JsonValueKind.Array)
            {
                return BadRequest(new { error = "unexpected_json_shape", note = "Expected an array root." });
            }

            var count = 0;
            var newPhotosAdded = 0;
            string? newestSortValue = null;
            foreach (var el in doc.RootElement.EnumerateArray())
            {
                // Only add if this is a new photo (not already in our collection)
                var shouldAdd = true;
                if (!string.IsNullOrEmpty(lastSortValue) && el.TryGetProperty("sort", out var currentSortProp))
                {
                    var currentSort = currentSortProp.GetString();
                    // If we have a lastSortValue, only add photos newer than it
                    if (string.Compare(currentSort, lastSortValue, StringComparison.Ordinal) <= 0)
                    {
                        shouldAdd = false;
                    }
                }
                
                if (shouldAdd)
            {
                all.Add(el.Clone());
                    newPhotosAdded++;
                }
                count++;
                
                // Track the newest sort value (assuming sort field exists)
                if (el.TryGetProperty("sort", out var sortProp))
                {
                    var currentSort = sortProp.GetString();
                    if (string.IsNullOrEmpty(newestSortValue) || string.Compare(currentSort, newestSortValue, StringComparison.Ordinal) > 0)
                    {
                        newestSortValue = currentSort;
                    }
                }
            }

            totalFetched += count;

            // Log iteration details for testing
            iterationDetails.Add(new
            {
                iteration = iteration + 1,
                url,
                skip,
                take = pageSize,
                itemsReceived = count,
                newPhotosAdded,
                totalSoFar = totalFetched,
                totalInCollection = all.Count,
                newestSortValue,
                incrementalMode = !string.IsNullOrEmpty(lastSortValue)
            });

            // If we received fewer than requested, we're done
            if (count < pageSize) break;

            // Prepare next page
            skip += pageSize;

            // Gentle pacing between requests
            if (pauseMs > 0) await Task.Delay(pauseMs, ct);
        }

        // Save updated collection to <OutputRoot>/<accountId>_photos.json
        var serializerOptions = new JsonSerializerOptions { WriteIndented = true };
        await using (var fs = System.IO.File.Create(jsonPath))
        {
            await JsonSerializer.SerializeAsync(fs, all, serializerOptions, ct);
        }

        // Find the newest sort value from the complete collection
        string? finalNewestSortValue = null;
        if (all.Count > 0)
        {
            foreach (var photo in all)
            {
                if (photo.TryGetProperty("sort", out var sortProp))
                {
                    var currentSort = sortProp.GetString();
                    if (string.IsNullOrEmpty(finalNewestSortValue) || string.Compare(currentSort, finalNewestSortValue, StringComparison.Ordinal) > 0)
                    {
                        finalNewestSortValue = currentSort;
                    }
                }
            }
        }

        var totalNewPhotosAdded = all.Count - existingPhotoCount;

        return Ok(new
        {
            accountId,
            saved = jsonPath,
            existingPhotos = existingPhotoCount,
            totalNewPhotosAdded,
            totalPhotos = all.Count,
            totalFetched,
            pageSize,
            delayMs = pauseMs,
            maxIterations,
            iterationsCompleted = iterationDetails.Count,
            lastSortValue,
            finalNewestSortValue,
            incrementalMode = !string.IsNullOrEmpty(lastSortValue),
            iterationDetails
        });
    }

    /// POST /api/players/{accountId}/collect-feed
    /// Collects feed photos using the since parameter for incremental collection
    [HttpPost("{accountId}/collect-feed")]
    public async Task<IActionResult> CollectFeedPhotos([FromRoute] string accountId, CancellationToken ct, [FromQuery] bool incremental = true, [FromQuery] int maxIterations = 50)
    {
        var pageSize = _settings.PageSize;
        var pauseMs = _settings.InterPageDelayMs;

        var client = _httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(30);

        // Optional bearer token from headers
        string? token = null;
        if (Request.Headers.TryGetValue("X-RecNet-Token", out var headerToken))
        {
            token = headerToken.ToString().Trim();
        }
        else if (AuthenticationHeaderValue.TryParse(Request.Headers.Authorization, out var authVal) &&
                 string.Equals(authVal.Scheme, "Bearer", StringComparison.OrdinalIgnoreCase))
        {
            token = authVal.Parameter;
        }
        if (!string.IsNullOrWhiteSpace(token))
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        // Create account-specific directory
        var accountDir = Path.Combine(_settings.OutputRoot, accountId);
        Directory.CreateDirectory(accountDir);

        var feedJsonPath = Path.Combine(accountDir, $"{accountId}_feed.json");
        var all = new List<JsonElement>();
        var skip = 0;
        var totalFetched = 0;
        // maxIterations is now a parameter with default value of 50
        var iterationDetails = new List<object>();

        // Check for existing feed file to determine starting point
        var existingPhotoCount = 0;
        DateTime? lastSince = null;
        
        if (System.IO.File.Exists(feedJsonPath))
        {
            try
            {
                var existingJson = await System.IO.File.ReadAllTextAsync(feedJsonPath, ct);
                var existingPhotos = JsonSerializer.Deserialize<JsonElement[]>(existingJson);
                if (existingPhotos != null && existingPhotos.Length > 0)
                {
                    existingPhotoCount = existingPhotos.Length;
                    
                    // Find the oldest photo's CreatedAt from existing collection (for incremental collection)
                    foreach (var photo in existingPhotos)
                    {
                        if (photo.TryGetProperty("CreatedAt", out var createdAtProp))
                        {
                            var createdAt = createdAtProp.GetString();
                            if (!string.IsNullOrEmpty(createdAt) && DateTime.TryParse(createdAt, out var date))
                            {
                                if (lastSince == null || date < lastSince)
                                {
                                    lastSince = date;
                                }
                            }
                        }
                    }
                    
                    // Load existing photos into our collection
                    all.AddRange(existingPhotos.Select(p => p.Clone()));
                    iterationDetails.Add(new { 
                        note = "resumed_from_existing_feed_file", 
                        existingPhotos = existingPhotoCount,
                        oldestPhotoDate = lastSince?.ToString("O")
                    });
                }
            }
            catch (Exception ex)
            {
                iterationDetails.Add(new { note = "existing_feed_file_read_failed", error = ex.Message });
            }
        }

        // Determine the since parameter
        DateTime sinceTime;
        if (incremental && lastSince.HasValue)
        {
            // For incremental: start from the oldest photo we have to get older photos
            sinceTime = lastSince.Value;
            iterationDetails.Add(new { 
                note = "incremental_mode_using_oldest_photo_date", 
                sinceTime = sinceTime.ToString("O"),
                incremental = true
            });
        }
        else
        {
            // For full collection: start from current time to get recent photos
            sinceTime = DateTime.UtcNow;
            iterationDetails.Add(new { 
                note = "full_collection_mode_using_current_time", 
                sinceTime = sinceTime.ToString("O"),
                incremental = false
            });
        }

        for (int iteration = 0; iteration < maxIterations; iteration++)
        {
            ct.ThrowIfCancellationRequested();

            // Always use current time for 'since' parameter and paginate with skip/take
            var sinceParam = sinceTime.ToString("O");
            var url = $"https://apim.rec.net/apis/api/images/v3/feed/player/{Uri.EscapeDataString(accountId)}?skip={skip}&take={pageSize}&since={Uri.EscapeDataString(sinceParam)}";
            
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            using var resp = await client.SendAsync(req, ct);

            if (!resp.IsSuccessStatusCode)
            {
                var body = await resp.Content.ReadAsStringAsync(ct);
                return StatusCode((int)resp.StatusCode, new
                {
                    error = "fetch_failed",
                    status = (int)resp.StatusCode,
                    message = body
                });
            }

            await using var stream = await resp.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);

            if (doc.RootElement.ValueKind != JsonValueKind.Array)
            {
                return BadRequest(new { error = "unexpected_json_shape", note = "Expected an array root." });
            }

            var count = 0;
            var newPhotosAdded = 0;
            DateTime? newestCreatedAt = null;
            foreach (var el in doc.RootElement.EnumerateArray())
            {
                // Only add if this is a new photo (not already in our collection)
                var shouldAdd = true;
                if (el.TryGetProperty("Id", out var currentIdProp))
                {
                    var currentId = currentIdProp.GetInt32();
                    // Check if this photo already exists in our collection
                    foreach (var existingPhoto in all)
                    {
                        if (existingPhoto.TryGetProperty("Id", out var existingIdProp) && 
                            existingIdProp.GetInt32() == currentId)
                        {
                            shouldAdd = false;
                            break;
                        }
                    }
                }
                
                if (shouldAdd)
                {
                    all.Add(el.Clone());
                    newPhotosAdded++;
                }
                count++;

                // Track the newest CreatedAt
                if (el.TryGetProperty("CreatedAt", out var createdAtProp))
                {
                    var createdAt = createdAtProp.GetString();
                    if (!string.IsNullOrEmpty(createdAt) && DateTime.TryParse(createdAt, out var date))
                    {
                        if (newestCreatedAt == null || date > newestCreatedAt)
                        {
                            newestCreatedAt = date;
                        }
                    }
                }
            }

            totalFetched += count;

            // Log iteration details for testing
            iterationDetails.Add(new
            {
                iteration = iteration + 1,
                url,
                skip,
                take = pageSize,
                since = sinceParam,
                itemsReceived = count,
                newPhotosAdded,
                totalSoFar = totalFetched,
                totalInCollection = all.Count,
                newestCreatedAt = newestCreatedAt?.ToString("O"),
                incrementalMode = existingPhotoCount > 0
            });

            // If we received fewer than requested, we're done
            if (count < pageSize) break;

            // Prepare next page
            skip += pageSize;

            // Gentle pacing between requests
            if (pauseMs > 0) await Task.Delay(pauseMs, ct);
        }

        // Save updated feed collection
        var serializerOptions = new JsonSerializerOptions { WriteIndented = true };
        await using (var fs = System.IO.File.Create(feedJsonPath))
        {
            await JsonSerializer.SerializeAsync(fs, all, serializerOptions, ct);
        }

        // Find the newest CreatedAt from the complete collection
        DateTime? finalNewestCreatedAt = null;
        if (all.Count > 0)
        {
            foreach (var photo in all)
            {
                if (photo.TryGetProperty("CreatedAt", out var createdAtProp))
                {
                    var createdAt = createdAtProp.GetString();
                    if (!string.IsNullOrEmpty(createdAt) && DateTime.TryParse(createdAt, out var date))
                    {
                        if (finalNewestCreatedAt == null || date > finalNewestCreatedAt)
                        {
                            finalNewestCreatedAt = date;
                        }
                    }
                }
            }
        }

        var totalNewPhotosAdded = all.Count - existingPhotoCount;

        return Ok(new
        {
            accountId,
            saved = feedJsonPath,
            existingPhotos = existingPhotoCount,
            totalNewPhotosAdded,
            totalPhotos = all.Count,
            totalFetched,
            pageSize,
            delayMs = pauseMs,
            maxIterations,
            iterationsCompleted = iterationDetails.Count,
            sinceTime = sinceTime.ToString("O"),
            finalNewestCreatedAt = finalNewestCreatedAt?.ToString("O"),
            incrementalMode = existingPhotoCount > 0,
            incremental,
            iterationDetails
        });
    }

    /// POST /api/players/{accountId}/download
    /// Downloads photos from the collected JSON file, only downloading new photos
    [HttpPost("{accountId}/download")]
    public async Task<IActionResult> DownloadPhotos([FromRoute] string accountId, CancellationToken ct, [FromQuery] int limit = 1)
    {
        // Create account-specific directory structure
        var accountDir = Path.Combine(_settings.OutputRoot, accountId);
        var jsonPath = Path.Combine(accountDir, $"{accountId}_photos.json");
        if (!System.IO.File.Exists(jsonPath))
        {
            return NotFound(new { error = "photos_not_collected", hint = "Run POST /api/players/{accountId}/collect first." });
        }

        // Create photos directory
        var photosDir = Path.Combine(accountDir, "photos");
        var feedDir = Path.Combine(accountDir, "feed");
        Directory.CreateDirectory(photosDir);
        Directory.CreateDirectory(feedDir);

        // Read the photos JSON file
        var photosJson = await System.IO.File.ReadAllTextAsync(jsonPath, ct);
        var photos = JsonSerializer.Deserialize<JsonElement[]>(photosJson);
        if (photos == null || photos.Length == 0)
        {
            return BadRequest(new { error = "no_photos_found", message = "No photos found in the JSON file." });
        }

        var client = _httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(30);

        var totalPhotos = photos.Length;
        var alreadyDownloaded = 0;
        var newDownloads = 0;
        var failedDownloads = 0;
        var skipped = 0;

        var downloadResults = new List<object>();
        var rateLimitMs = 1000; // 1 second between requests
        var processedCount = 0;

        foreach (var photo in photos)
        {
            // Stop after processing the specified limit
            if (processedCount >= limit)
            {
                break;
            }

            ct.ThrowIfCancellationRequested();

            if (!photo.TryGetProperty("Id", out var idProp) || !photo.TryGetProperty("ImageName", out var imageNameProp))
            {
                downloadResults.Add(new { error = "missing_photo_data", photo = photo.ToString() });
                processedCount++;
                continue;
            }

            var photoId = idProp.GetInt32().ToString();
            var imageName = imageNameProp.GetString();
            var photoUrl = $"https://img.rec.net/{imageName}";

            if (string.IsNullOrEmpty(photoId) || string.IsNullOrEmpty(imageName))
            {
                downloadResults.Add(new { error = "invalid_photo_data", photoId, imageName });
                processedCount++;
                continue;
            }

            // Check if photo already exists in photos folder
            var photoPath = Path.Combine(photosDir, $"{photoId}.jpg");
            if (System.IO.File.Exists(photoPath))
            {
                alreadyDownloaded++;
                downloadResults.Add(new { 
                    photoId, 
                    status = "already_exists_in_photos", 
                    path = photoPath 
                });
                processedCount++;
                continue;
            }

            // Check if photo exists in feed folder and copy it over
            var feedPhotoPath = Path.Combine(feedDir, $"{photoId}.jpg");
            if (System.IO.File.Exists(feedPhotoPath))
            {
                System.IO.File.Copy(feedPhotoPath, photoPath, overwrite: true);
                alreadyDownloaded++;
                downloadResults.Add(new { 
                    photoId, 
                    status = "copied_from_feed", 
                    sourcePath = feedPhotoPath,
                    destinationPath = photoPath 
                });
                processedCount++;
                continue;
            }

            try
            {
                // Download the photo
                using var response = await client.GetAsync(photoUrl, ct);
                if (response.IsSuccessStatusCode)
                {
                    var imageBytes = await response.Content.ReadAsByteArrayAsync(ct);
                    await System.IO.File.WriteAllBytesAsync(photoPath, imageBytes, ct);

                    newDownloads++;

                    downloadResults.Add(new { 
                        photoId, 
                        status = "downloaded", 
                        size = imageBytes.Length,
                        path = photoPath,
                        url = photoUrl
                    });
                }
                else
                {
                    failedDownloads++;

                    downloadResults.Add(new { 
                        photoId, 
                        status = "failed", 
                        statusCode = (int)response.StatusCode,
                        reason = response.ReasonPhrase,
                        url = photoUrl
                    });
                }
            }
            catch (Exception ex)
            {
                failedDownloads++;

                downloadResults.Add(new { 
                    photoId, 
                    status = "error", 
                    error = ex.Message,
                    url = photoUrl
                });
            }

            // Rate limiting - wait 1 second between requests
            if (rateLimitMs > 0)
            {
                await Task.Delay(rateLimitMs, ct);
            }

            processedCount++;
        }

        return Ok(new
        {
            accountId,
            photosDirectory = photosDir,
            limit,
            processedCount,
            downloadStats = new
            {
                totalPhotos,
                alreadyDownloaded,
                newDownloads,
                failedDownloads,
                skipped
            },
            downloadResults, // Show all results since we're limiting to 1
            totalResults = downloadResults.Count
        });
    }

    /// POST /api/players/{accountId}/download-feed
    /// Downloads feed photos from the collected feed JSON file, only downloading new photos
    [HttpPost("{accountId}/download-feed")]
    public async Task<IActionResult> DownloadFeedPhotos([FromRoute] string accountId, CancellationToken ct, [FromQuery] int limit = 1)
    {
        // Create account-specific directory structure
        var accountDir = Path.Combine(_settings.OutputRoot, accountId);
        var feedJsonPath = Path.Combine(accountDir, $"{accountId}_feed.json");
        if (!System.IO.File.Exists(feedJsonPath))
        {
            return NotFound(new { error = "feed_photos_not_collected", hint = "Run POST /api/players/{accountId}/collect-feed first." });
        }

        // Create feed photos directory
        var feedPhotosDir = Path.Combine(accountDir, "feed");
        var photosDir = Path.Combine(accountDir, "photos");
        Directory.CreateDirectory(feedPhotosDir);
        Directory.CreateDirectory(photosDir);

        // Read the feed photos JSON file
        var photosJson = await System.IO.File.ReadAllTextAsync(feedJsonPath, ct);
        var photos = JsonSerializer.Deserialize<JsonElement[]>(photosJson);
        if (photos == null || photos.Length == 0)
        {
            return BadRequest(new { error = "no_feed_photos_found", message = "No feed photos found in the JSON file." });
        }

        var client = _httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(30);

        var totalPhotos = photos.Length;
        var alreadyDownloaded = 0;
        var newDownloads = 0;
        var failedDownloads = 0;
        var skipped = 0;

        var downloadResults = new List<object>();
        var rateLimitMs = 1000; // 1 second between requests
        var processedCount = 0;

        foreach (var photo in photos)
        {
            // Stop after processing the specified limit
            if (processedCount >= limit)
            {
                break;
            }

            ct.ThrowIfCancellationRequested();

            if (!photo.TryGetProperty("Id", out var idProp) || !photo.TryGetProperty("ImageName", out var imageNameProp))
            {
                downloadResults.Add(new { error = "missing_photo_data", photo = photo.ToString() });
                processedCount++;
                continue;
            }

            var photoId = idProp.GetInt32().ToString();
            var imageName = imageNameProp.GetString();
            var photoUrl = $"https://img.rec.net/{imageName}";

            if (string.IsNullOrEmpty(photoId) || string.IsNullOrEmpty(imageName))
            {
                downloadResults.Add(new { error = "invalid_photo_data", photoId, imageName });
                processedCount++;
                continue;
            }

            // Check if photo already exists in feed folder
            var photoPath = Path.Combine(feedPhotosDir, $"{photoId}.jpg");
            if (System.IO.File.Exists(photoPath))
            {
                alreadyDownloaded++;
                downloadResults.Add(new { 
                    photoId, 
                    status = "already_exists_in_feed", 
                    path = photoPath 
                });
                processedCount++;
                continue;
            }

            // Check if photo exists in photos folder and copy it over
            var regularPhotoPath = Path.Combine(photosDir, $"{photoId}.jpg");
            if (System.IO.File.Exists(regularPhotoPath))
            {
                System.IO.File.Copy(regularPhotoPath, photoPath, overwrite: true);
                alreadyDownloaded++;
                downloadResults.Add(new { 
                    photoId, 
                    status = "copied_from_photos", 
                    sourcePath = regularPhotoPath,
                    destinationPath = photoPath 
                });
                processedCount++;
                continue;
            }

            try
            {
                // Download the photo
                using var response = await client.GetAsync(photoUrl, ct);
                if (response.IsSuccessStatusCode)
                {
                    var imageBytes = await response.Content.ReadAsByteArrayAsync(ct);
                    await System.IO.File.WriteAllBytesAsync(photoPath, imageBytes, ct);

                    newDownloads++;

                    downloadResults.Add(new { 
                        photoId, 
                        status = "downloaded", 
                        size = imageBytes.Length,
                        path = photoPath,
                        url = photoUrl
                    });
                }
                else
                {
                    failedDownloads++;

                    downloadResults.Add(new { 
                        photoId, 
                        status = "failed", 
                        statusCode = (int)response.StatusCode,
                        reason = response.ReasonPhrase,
                        url = photoUrl
                    });
                }
            }
            catch (Exception ex)
            {
                failedDownloads++;

                downloadResults.Add(new { 
                    photoId, 
                    status = "error", 
                    error = ex.Message,
                    url = photoUrl
                });
            }

            // Rate limiting - wait 1 second between requests
            if (rateLimitMs > 0)
            {
                await Task.Delay(rateLimitMs, ct);
            }

            processedCount++;
        }

        return Ok(new
        {
            accountId,
            feedPhotosDirectory = feedPhotosDir,
            limit,
            processedCount,
            downloadStats = new
            {
                totalPhotos,
                alreadyDownloaded,
                newDownloads,
                failedDownloads,
                skipped
            },
            downloadResults, // Show all results since we're limiting to 1
            totalResults = downloadResults.Count
        });
    }

    /// GET /api/players/{accountId}/photos
    // [HttpGet("{accountId:regex(^[0-9]+$)}/photos")]
    // public IActionResult GetMergedJson([FromRoute] string accountId)
    // {
    //     var jsonPath = Path.Combine(_settings.OutputRoot, $"{accountId}_photos.json");
    //     if (!System.IO.File.Exists(jsonPath))
    //         return NotFound(new { error = "not_synced_yet", hint = "POST /api/players/{accountId}/collect first." });

    //     return PhysicalFile(jsonPath, "application/json", $"{accountId}_photos.json");
    // }

    // /// GET /api/players/{accountId}/archive
    // [HttpGet("{accountId:regex(^[0-9]+$)}/archive")]
    // public IActionResult GetZip([FromRoute] string accountId)
    // {
    //     var zipPath = Path.Combine(_settings.OutputRoot, $"{accountId}.zip");
    //     if (!System.IO.File.Exists(zipPath))
    //         return NotFound(new { error = "archive_not_found", hint = "No archive present." });

    //     return PhysicalFile(zipPath, "application/zip", Path.GetFileName(zipPath));
    // }
}
