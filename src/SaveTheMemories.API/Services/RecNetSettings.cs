namespace RecNetImageApi.Services;

public sealed class RecNetSettings
{
    public string OutputRoot { get; init; } = "output";
    public int PageSize { get; init; } = 250;
    public string CdnBase { get; init; } = "https://img.rec.net/";
    public int GlobalMaxConcurrentDownloads { get; init; } = 4;
    public int DefaultPerJobParallelism { get; init; } = 4;
    public int InterPageDelayMs { get; init; } = 200;
}
