namespace RecNetImageApi.Services;

public sealed class JobProcessor : BackgroundService
{
    private readonly ILogger<JobProcessor> _logger;

    public JobProcessor(ILogger<JobProcessor> logger)
    {
        _logger = logger;
    }

    protected override Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("JobProcessor started (placeholder).");
        return Task.CompletedTask;
    }
}
