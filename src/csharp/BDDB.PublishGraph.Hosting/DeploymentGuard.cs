using System.Reflection;
using BDDB.PublishGraph.Content;
using BDDB.PublishGraph.DesignSystem;
namespace BDDB.PublishGraph.Hosting;
public static class DeploymentGuard
{
    public static void Verify(SiteRegistration settings, IWebHostEnvironment environment, Assembly hostAssembly)
    {
        DeploymentVerifier.VerifyArtifact(settings.DeploymentRoot, settings.DeploymentReceiptPath, settings.DeploymentReceiptHash);
        var root = Path.GetFullPath(settings.DeploymentRoot);
        if (!string.Equals(Path.GetFullPath(environment.WebRootPath), Path.Combine(root, "wwwroot"), StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Verified artifact is not the serving webroot.");
        foreach (var assembly in new[] { hostAssembly, typeof(DeploymentGuard).Assembly, typeof(RegionCompiler).Assembly, typeof(PageViewModel).Assembly, typeof(Markdig.Markdown).Assembly })
        {
            var deployed = Path.Combine(root, Path.GetFileName(assembly.Location));
            if (!File.Exists(deployed) || DeploymentVerifier.FileHash(assembly.Location) != DeploymentVerifier.FileHash(deployed))
                throw new InvalidDataException("Loaded assembly differs from verified deployment: " + assembly.GetName().Name);
        }
    }
}
