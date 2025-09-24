using Microsoft.AspNetCore.Mvc;
using RecNetImageApi.Services;

namespace RecNetImageApi.Controllers;

[ApiController]
[Route("api/jobs")]
public class JobsController : ControllerBase
{
    private readonly JobStore _jobs;

    public JobsController(JobStore jobs) => _jobs = jobs;

    /// GET /api/jobs/{jobId}
    [HttpGet("{jobId:guid}")]
    public IActionResult Get(Guid jobId)
    {
        if (!_jobs.TryGet(jobId, out var job))
            return NotFound(new { error = "job not found" });

        return Ok(new
        {
            job.JobId,
            job.AccountId,
            job.Status,
            job.StartedAtUtc,
            job.FinishedAtUtc,
            job.RecordsFetched,
            job.ImagesFound,
            job.Downloaded,
            job.Failed,
            job.OutputJsonPath,
            job.ImagesDir,
            job.ZipPath,
            Errors = job.Errors.TakeLast(10).ToArray()
        });
    }
}
