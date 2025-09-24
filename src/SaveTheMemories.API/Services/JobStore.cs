using System.Collections.Concurrent;
using System.IO.Compression;
using RecNetImageApi.Models;

namespace RecNetImageApi.Services;

public sealed class JobStore
{
    private readonly ConcurrentDictionary<Guid, JobInfo> _jobs = new();
    private readonly RecNetSettings _settings;
    private readonly RecNetClient _client;
    private readonly Downloader _downloader;
    private readonly ILogger<JobStore> _logger;

    public JobStore(
        RecNetSettings settings,
        RecNetClient client,
        Downloader downloader,
        ILogger<JobStore> logger)
    {
        _settings = settings;
        _client = client;
        _downloader = downloader;
        _logger = logger;
    }

    public JobInfo Create(string accountId, int? parallel, bool? overwrite, string? token)
    {
        var job = new JobInfo
        {
            AccountId = accountId,
            Parallelism = (parallel is > 0 ? parallel.Value : _settings.DefaultPerJobParallelism),
            Overwrite = overwrite ?? false,
            Token = token,
            OutputJsonPath = Path.Combine(_settings.OutputRoot, $"{accountId}_photos.json"),
            ImagesDir = Path.Combine(_settings.OutputRoot, accountId),
            ZipPath = Path.Combine(_settings.OutputRoot, $"{accountId}.zip")
        };
        _jobs[job.JobId] = job;

        // Fire the work on a background thread (JobProcessor also runs health loop)
        _ = Task.Run(() => RunJob(job, CancellationToken.None));

        return job;
    }

    public bool TryGet(Guid id, out JobInfo job) => _jobs.TryGetValue(id, out job!);

    private async Task RunJob(JobInfo job, CancellationToken ct)
    {
        job.Status = JobStatus.Running;
        job.StartedAtUtc = DateTime.UtcNow;

        try
        {
            // Fetch all pages
            var records = await _client.FetchAllAsync(job.AccountId, job.Token, c => job.RecordsFetched += c, ct);

            // Save JSON
            if (job.Overwrite || !File.Exists(job.OutputJsonPath))
                await RecNetClient.SaveJsonAsync(job.OutputJsonPath, records, ct);

            // Prepare images list
            var images = _client.BuildImageList(records);
            job.ImagesFound = images.Count;

            Directory.CreateDirectory(job.ImagesDir);

            if (job.Overwrite && Directory.Exists(job.ImagesDir))
            {
                foreach (var f in Directory.GetFiles(job.ImagesDir))
                    File.Delete(f);
            }

            // Download
            var (downloaded, failed) = await _downloader.DownloadAllAsync(images, job.ImagesDir, job.Parallelism, ct);
            job.Downloaded = downloaded;
            job.Failed = failed;

            // Rebuild zip
            if (File.Exists(job.ZipPath)) File.Delete(job.ZipPath);
            ZipFile.CreateFromDirectory(job.ImagesDir, job.ZipPath);

            job.Status = JobStatus.Succeeded;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Job {JobId} failed for account {AccountId}", job.JobId, job.AccountId);
            job.Errors.Enqueue(ex.Message);
            job.Status = JobStatus.Failed;
        }
        finally
        {
            job.FinishedAtUtc = DateTime.UtcNow;
        }
    }
}
