using System.Reflection;
using System.Text.Json;
using BDDB.PublishGraph.Content;
using BDDB.PublishGraph.DesignSystem;
using BDDB.PublishGraph.Hosting;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Xunit;

namespace BDDB.PublishGraph.Content.Tests;

public sealed class SiteRegistryInitializationTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "publishgraph-registry-" + Guid.NewGuid().ToString("N"));
    private readonly Dictionary<string, string?> _config = [];
    private readonly EnvironmentStub _environment = new();
    private readonly Assembly _host = typeof(SiteRegistryInitializationTests).Assembly;

    public SiteRegistryInitializationTests()
    {
        var artifact = Path.Combine(_root, "artifact");
        Directory.CreateDirectory(Path.Combine(artifact, "wwwroot"));
        _environment.WebRootPath = Path.Combine(artifact, "wwwroot");
        foreach (var assembly in new[] { _host, typeof(DeploymentGuard).Assembly, typeof(RegionCompiler).Assembly, typeof(PageViewModel).Assembly, typeof(Markdig.Markdown).Assembly })
            File.Copy(assembly.Location, Path.Combine(artifact, Path.GetFileName(assembly.Location)));
        var receipt = Path.Combine(_root, "receipt.json");
        var files = Directory.EnumerateFiles(artifact, "*", SearchOption.AllDirectories)
            .Select(p => new ArtifactFile(Path.GetRelativePath(artifact, p).Replace('\\', '/'), DeploymentVerifier.FileHash(p))).ToArray();
        File.WriteAllText(receipt, JsonSerializer.Serialize(new DeploymentReceipt("sda-deployment-v2", "alpha", "regions", "layout", files), BundleJson.Options));
        for (var i = 0; i < 2; i++)
        {
            var id = i == 0 ? "alpha" : "beta";
            var site = new SiteDefinition(1, id, id, $"https://{id}.example/", "paper", id, [$"{id}.example"], []);
            var compiled = new ContentCompiler().Compile(site, []);
            Assert.True(compiled.Success, string.Join("; ", compiled.Errors));
            var bundlePath = Path.Combine(_root, id + ".json");
            // LayoutContentLoader records this envelope on the registration when it reads it.
            // The spy owns region validation; the loader itself validates the genuine base bundle.
            var regions = new RegionBundle("synthetic", id, compiled.Bundle!.ManifestHash, [], "synthetic");
            File.WriteAllText(bundlePath, JsonSerializer.Serialize(new LayoutEnvelope("sda-layout-content-v2", compiled.Bundle, regions), BundleJson.Options));
            _config[$"Sites:{i}:Id"] = id;
            _config[$"Sites:{i}:CanonicalOrigin"] = site.BaseUrl;
            _config[$"Sites:{i}:Aliases:0"] = $"www.{id}.example";
            _config[$"Sites:{i}:BundlePath"] = bundlePath;
        }
        _config["Sites:0:DeploymentRoot"] = artifact;
        _config["Sites:0:DeploymentReceiptPath"] = receipt;
        _config["Sites:0:DeploymentReceiptHash"] = DeploymentVerifier.FileHash(receipt);
    }

    private SiteRegistry Registry(PresentationSpy spy) => new(new ConfigurationBuilder().AddInMemoryCollection(_config).Build(), _environment, spy, _host);

    [Theory]
    [InlineData("missing")]
    [InlineData("unreadable")]
    [InlineData("untrusted")]
    public void Failed_shared_preflight_skips_bundle_and_presentation_processing(string defect)
    {
        FailReceipt(defect);
        var spy = new PresentationSpy();
        using var registry = Registry(spy);
        Assert.False(registry.DeploymentAvailable);
        Assert.Equal(0, spy.LoadCalls);
        Assert.Equal(0, spy.RouteCalls);
        Assert.All(registry.Sites, site =>
        {
            Assert.False(site.Available);
            Assert.Null(site.Registration.LayoutEnvelope); // Independently observes skipped bundle reading.
            Assert.Null(site.Routes);
        });
        Assert.NotNull(registry.Find("alpha.example"));
        Assert.NotNull(registry.Find("www.beta.example"));
        Assert.Null(registry.Find("unknown.example"));
    }

    [Fact]
    public void Successful_shared_preflight_loads_bundles_and_invokes_presentation()
    {
        var spy = new PresentationSpy();
        using var registry = Registry(spy);
        Assert.True(registry.DeploymentAvailable);
        Assert.Equal(2, spy.LoadCalls);
        Assert.True(spy.RouteCalls >= 2);
        Assert.All(registry.Sites, site => { Assert.True(site.Available); Assert.NotNull(site.Registration.LayoutEnvelope); });
    }

    [Theory]
    [InlineData("identity")]
    [InlineData("origin")]
    [InlineData("alias")]
    [InlineData("review")]
    public void Failed_preflight_does_not_bypass_structural_configuration_validation(string defect)
    {
        FailReceipt("unreadable");
        switch (defect)
        {
            case "identity": _config["Sites:1:Id"] = "alpha"; break;
            case "origin": _config["Sites:1:CanonicalOrigin"] = "http://beta.example/"; break;
            case "alias": _config["Sites:1:Aliases:0"] = "alpha.example"; break;
            case "review": _config["Sites:1:PrivateReview"] = "true"; _environment.EnvironmentName = "Production"; break;
        }
        var spy = new PresentationSpy();
        Assert.ThrowsAny<Exception>(() => { using var registry = Registry(spy); });
        Assert.Equal(0, spy.LoadCalls);
        Assert.Equal(0, spy.RouteCalls);
    }

    private void FailReceipt(string defect)
    {
        var receipt = _config["Sites:0:DeploymentReceiptPath"]!;
        if (defect == "untrusted") _config["Sites:0:DeploymentReceiptHash"] = new string('0', 64);
        else { File.Delete(receipt); if (defect == "unreadable") Directory.CreateDirectory(receipt); }
    }

    public void Dispose() => Directory.Delete(_root, true);
    private sealed class PresentationSpy : ISitePresentation
    {
        public int LoadCalls { get; private set; }
        public int RouteCalls { get; private set; }
        public RegionBundle? Load(SiteRegistration settings, ContentBundle bundle, IWebHostEnvironment environment) { LoadCalls++; return settings.LayoutEnvelope?.Regions; }
        public IEnumerable<RouteEntry> Routes(ContentBundle bundle) { RouteCalls++; return []; }
    }
    private sealed class EnvironmentStub : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "synthetic";
        public string EnvironmentName { get; set; } = "Development";
        public string ContentRootPath { get; set; } = "";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = "";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
    }
}
