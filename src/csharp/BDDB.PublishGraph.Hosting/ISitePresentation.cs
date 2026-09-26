using BDDB.PublishGraph.Content;
namespace BDDB.PublishGraph.Hosting;
public interface ISitePresentation
{
    RegionBundle? Load(SiteRegistration settings, ContentBundle bundle, IWebHostEnvironment environment);
    IEnumerable<RouteEntry> Routes(ContentBundle bundle);
}
public sealed class DefaultSitePresentation : ISitePresentation
{
    public RegionBundle? Load(SiteRegistration settings, ContentBundle bundle, IWebHostEnvironment environment)
    {
        if (settings.LayoutEnvelope is not null) throw new InvalidDataException("A site presentation adapter is required for typed layouts.");
        return null;
    }
    public IEnumerable<RouteEntry> Routes(ContentBundle bundle) => [];
}
