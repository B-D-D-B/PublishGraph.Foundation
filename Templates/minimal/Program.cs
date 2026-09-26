using BDDB.PublishGraph.Hosting;
var builder = WebApplication.CreateBuilder(args);
var registry = builder.Services.AddPublishGraph(builder.Configuration, builder.Environment,
    new DefaultSitePresentation(), typeof(Program).Assembly);
var app = builder.Build();
app.Lifetime.ApplicationStopped.Register(registry.Dispose);
app.UseMiddleware<SiteSelectionMiddleware>();
app.UseStaticFiles();
app.MapStaticAssets();
app.MapGet("/health/ready", (SiteRuntime site) => Results.Ok(new { status = "ready", site = site.Registration.Id }));
app.MapControllers();
app.Run();
