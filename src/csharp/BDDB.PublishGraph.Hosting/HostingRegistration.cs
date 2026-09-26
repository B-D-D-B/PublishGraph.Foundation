using System.Reflection;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.Extensions.DependencyInjection;
using BDDB.PublishGraph.DesignSystem;
namespace BDDB.PublishGraph.Hosting;
public static class HostingRegistration
{
    public static SiteRegistry AddPublishGraph(this IServiceCollection services, IConfiguration configuration,
        IWebHostEnvironment environment, ISitePresentation presentation, Assembly hostAssembly)
    {
        services.AddControllersWithViews().AddApplicationPart(typeof(PageViewModel).Assembly);
        var registry = new SiteRegistry(configuration, environment, presentation, hostAssembly);
        services.AddSingleton(registry);
        services.AddScoped<SiteContext>();
        services.AddScoped(provider => provider.GetRequiredService<SiteContext>().Site);
        services.AddScoped(provider => provider.GetRequiredService<SiteRuntime>().Bundle!);
        services.AddScoped(provider => provider.GetRequiredService<SiteRuntime>().Routes!);
        services.AddScoped<IInquirySink>(provider => provider.GetRequiredService<SiteRuntime>().Sink);
        services.AddSingleton<IAntiforgeryAdditionalDataProvider, SiteAntiforgeryData>();
        return registry;
    }
}
