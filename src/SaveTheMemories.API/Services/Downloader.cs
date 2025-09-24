using System.Text;
using RecNetImageApi.Models;

namespace RecNetImageApi.Services;

public sealed class Downloader
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly GlobalDownloadGate _globalGate;

    public Downloader(IHttpClientFactory httpFactory, GlobalDownloadGate globalGate)
    {
        _httpFactory = httpFactory;
        _globalGate = globalGate;
    }

    public async Task<(int downloaded, int failed)> DownloadAllAsync(
        IEnumerable<ImageToDownload> images,
        string outputDir,
        int parallelism,
        CancellationToken ct)
    {
        Directory.CreateDirectory(outputDir);

        var success = 0;
        var failed = 0;
        using var jobSemaphore = new SemaphoreSlim(Math.Max(1, parallelism));
        var tasks = images.Select(async image =>
        {
            await jobSemaphore.WaitAsync(ct);
            try
            {
                var saved = await _globalGate.LimitAsync(async () =>
                    await DownloadWithRetryAsync(image.Url, Path.Combine(outputDir, image.FileName), ct));

                if (saved) Interlocked.Increment(ref success);
                else Interlocked.Increment(ref failed);
            }
            finally
            {
                jobSemaphore.Release();
            }
        });

        await Task.WhenAll(tasks);
        return (success, failed);
    }

    private async Task<bool> DownloadWithRetryAsync(string url, string path, CancellationToken ct)
    {
        if (File.Exists(path)) return true;

        var http = _httpFactory.CreateClient("recnet");
        const int maxAttempts = 5;
        var delayMs = 300;

        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            try
            {
                using var resp = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
                if ((int)resp.StatusCode == 429 || (int)resp.StatusCode >= 500)
                {
                    if (attempt == maxAttempts) return false;
                    await Task.Delay(delayMs, ct);
                    delayMs = (int)(delayMs * 1.8);
                    continue;
                }

                if (!resp.IsSuccessStatusCode) return false;

                await using var stream = await resp.Content.ReadAsStreamAsync(ct);
                await using var fs = File.Create(path);
                await stream.CopyToAsync(fs, ct);
                return true;
            }
            catch when (attempt < maxAttempts)
            {
                await Task.Delay(delayMs, ct);
                delayMs = (int)(delayMs * 1.8);
            }
            catch
            {
                return false;
            }
        }

        return false;
    }
}
