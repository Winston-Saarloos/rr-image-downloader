using System.Collections.Concurrent;

namespace RecNetImageApi.Models;

public enum JobStatus { Queued, Running, Succeeded, Failed }

public sealed class JobInfo
{
    public Guid JobId { get; init; } = Guid.NewGuid();
    public string AccountId { get; init; } = "";
    public DateTime StartedAtUtc { get; set; }
    public DateTime? FinishedAtUtc { get; set; }
    public JobStatus Status { get; set; } = JobStatus.Queued;

    public string OutputJsonPath { get; set; } = "";
    public string ImagesDir { get; set; } = "";
    public string ZipPath { get; set; } = "";

    public int Parallelism { get; init; } = 4;
    public bool Overwrite { get; init; }
    public string? Token { get; init; }

    public int RecordsFetched { get; set; }
    public int ImagesFound { get; set; }
    public int Downloaded { get; set; }
    public int Failed { get; set; }

    public ConcurrentQueue<string> Errors { get; } = new();
}

public sealed record JobRequest(Guid JobId);

public sealed record ImageToDownload(string Url, string FileName);
