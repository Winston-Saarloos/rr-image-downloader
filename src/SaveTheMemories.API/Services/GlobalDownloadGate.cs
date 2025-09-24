namespace RecNetImageApi.Services;

public sealed class GlobalDownloadGate
{
    private readonly SemaphoreSlim _semaphore;

    public GlobalDownloadGate(int maxConcurrent)
    {
        _semaphore = new SemaphoreSlim(Math.Max(1, maxConcurrent));
    }

    public async Task<T> LimitAsync<T>(Func<Task<T>> work)
    {
        await _semaphore.WaitAsync();
        try { return await work(); }
        finally { _semaphore.Release(); }
    }
}
