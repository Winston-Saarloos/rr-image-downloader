using System.Net;
using RecNetImageApi.Models;
using RecNetImageApi.Services;

var builder = WebApplication.CreateBuilder(args);

// Bind settings
var settings = builder.Configuration.GetSection("RecNet").Get<RecNetSettings>()
               ?? new RecNetSettings();
Directory.CreateDirectory(settings.OutputRoot);

// DI
builder.Services.AddSingleton(settings);
builder.Services.AddHttpClient("recnet", client =>
{
    client.Timeout = TimeSpan.FromSeconds(30);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("RecNetImageApi/1.0");
}).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
{
    AutomaticDecompression = DecompressionMethods.All
});

builder.Services.AddSingleton<JobStore>();
builder.Services.AddSingleton(new GlobalDownloadGate(settings.GlobalMaxConcurrentDownloads));
builder.Services.AddSingleton<RecNetClient>();
builder.Services.AddSingleton<Downloader>();
builder.Services.AddHostedService<JobProcessor>();

builder.Services.AddControllers();

var app = builder.Build();

app.MapControllers();

app.Run();
