using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using RecNetImageApi.Models;

namespace RecNetImageApi.Services;

public sealed class RecNetClient
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly RecNetSettings _settings;

    public RecNetClient(IHttpClientFactory httpFactory, RecNetSettings settings)
    {
        _httpFactory = httpFactory;
        _settings = settings;
    }

    public async Task<List<PhotoRecord>> FetchAllAsync(
        string accountId,
        string? token,
        Action<int>? onPage,
        CancellationToken ct)
    {
        var http = _httpFactory.CreateClient("recnet");
        if (!string.IsNullOrWhiteSpace(token))
            http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var allItems = new List<PhotoRecord>();
        var skip = 0;

        while (true)
        {
            var url = $"https://apim.rec.net/apis/api/images/v4/player/{Uri.EscapeDataString(accountId)}?skip={skip}&take={_settings.PageSize}";
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            using var resp = await SendWithRetryAsync(http, req, ct);

            if (!resp.IsSuccessStatusCode)
            {
                var tip = resp.StatusCode switch
                {
                    HttpStatusCode.Unauthorized => "Unauthorized (401): supply X-RecNet-Token.",
                    HttpStatusCode.Forbidden => "Forbidden (403): token may be invalid or insufficient.",
                    (HttpStatusCode)429 => "Rate limited (429): slow down or use token.",
                    _ => $"HTTP {(int)resp.StatusCode}"
                };
                throw new HttpRequestException($"Fetch failed: {tip}");
            }

            await using var stream = await resp.Content.ReadAsStreamAsync(ct);
            var page = await JsonSerializer.DeserializeAsync<List<PhotoRecord>>(stream, cancellationToken: ct)
                       ?? new List<PhotoRecord>();

            onPage?.Invoke(page.Count);
            allItems.AddRange(page);

            if (page.Count < _settings.PageSize) break;
            skip += _settings.PageSize;
            await Task.Delay(_settings.InterPageDelayMs, ct);
        }

        return allItems;
    }

    public List<ImageToDownload> BuildImageList(IEnumerable<PhotoRecord> items)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var list = new List<ImageToDownload>();

        foreach (var item in items)
        {
            if (string.IsNullOrWhiteSpace(item.ImageName)) continue;

            var url = _settings.CdnBase + item.ImageName.Trim();
            if (!seen.Add(url)) continue;

            var ts = item.CreatedAt.ToUniversalTime().ToString("yyyyMMdd'T'HHmmss'Z'");
            var fileName = $"{item.Id}_{ts}_{item.ImageName}";
            list.Add(new ImageToDownload(url, Sanitize(fileName)));
        }

        return list;
    }

    public static async Task SaveJsonAsync(string path, IEnumerable<PhotoRecord> items, CancellationToken ct)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await using var fs = File.Create(path);
        await JsonSerializer.SerializeAsync(fs, items, new JsonSerializerOptions { WriteIndented = true }, ct);
    }

    private static string Sanitize(string name)
    {
        foreach (var c in Path.GetInvalidFileNameChars()) name = name.Replace(c, '_');
        return name;
    }

    private static async Task<HttpResponseMessage> SendWithRetryAsync(HttpClient http, HttpRequestMessage req, CancellationToken ct)
    {
        const int maxAttempts = 5;
        var delayMs = 300;

        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            try
            {
                var resp = await http.SendAsync(req, ct);
                if ((int)resp.StatusCode == 429 || (int)resp.StatusCode >= 500)
                {
                    if (attempt == maxAttempts) return resp;

                    if (resp.Headers.TryGetValues("Retry-After", out var values) &&
                        int.TryParse(values.FirstOrDefault(), out var seconds) && seconds > 0)
                    {
                        await Task.Delay(TimeSpan.FromSeconds(seconds), ct);
                    }
                    else
                    {
                        await Task.Delay(delayMs, ct);
                        delayMs = (int)(delayMs * 1.8);
                    }
                    continue;
                }

                return resp;
            }
            catch when (attempt < maxAttempts)
            {
                await Task.Delay(delayMs, ct);
                delayMs = (int)(delayMs * 1.8);
            }
        }

        // final attempt
        return await http.SendAsync(req, ct);
    }
}
