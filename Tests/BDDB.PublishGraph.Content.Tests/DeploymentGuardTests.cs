using System.Reflection;
using System.Text.Json;
using BDDB.PublishGraph.Content;
using BDDB.PublishGraph.DesignSystem;
using BDDB.PublishGraph.Hosting;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Xunit;

namespace BDDB.PublishGraph.Content.Tests;

public sealed class DeploymentGuardTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "publishgraph-guard-" + Guid.NewGuid().ToString("N"));
    private readonly SiteRegistration _settings;
    private readonly EnvironmentStub _environment;
    private readonly Assembly _host = typeof(DeploymentGuardTests).Assembly;

    public DeploymentGuardTests()
    {
        var artifact = Path.Combine(_root, "artifact");
        Directory.CreateDirectory(Path.Combine(artifact, "wwwroot"));
        foreach (var assembly in new[] { _host, typeof(DeploymentGuard).Assembly, typeof(RegionCompiler).Assembly, typeof(PageViewModel).Assembly, typeof(Markdig.Markdown).Assembly })
            File.Copy(assembly.Location, Path.Combine(artifact, Path.GetFileName(assembly.Location)));
        _settings = new SiteRegistration { DeploymentRoot = artifact, DeploymentReceiptPath = Path.Combine(_root, "receipt.json") };
        _environment = new EnvironmentStub { WebRootPath = Path.Combine(artifact, "wwwroot") };
        Receipt();
    }
    private void Receipt()
    {
        var files = Directory.EnumerateFiles(_settings.DeploymentRoot, "*", SearchOption.AllDirectories)
            .Select(path => new ArtifactFile(Path.GetRelativePath(_settings.DeploymentRoot, path).Replace('\\', '/'), DeploymentVerifier.FileHash(path))).ToArray();
        File.WriteAllText(_settings.DeploymentReceiptPath, JsonSerializer.Serialize(new DeploymentReceipt("sda-deployment-v2", "synthetic", "regions", "layout", files), BundleJson.Options));
        _settings.DeploymentReceiptHash = DeploymentVerifier.FileHash(_settings.DeploymentReceiptPath);
    }
    [Fact]
    public void Matching_deployed_and_loaded_dependencies_pass() => DeploymentGuard.Verify(_settings, _environment, _host);

    [Theory]
    [InlineData("BDDB.PublishGraph.Hosting.dll")]
    [InlineData("BDDB.PublishGraph.Content.dll")]
    [InlineData("BDDB.PublishGraph.DesignSystem.dll")]
    [InlineData("Markdig.dll")]
    [InlineData("BDDB.PublishGraph.Content.Tests.dll")]
    public void Receipt_valid_but_changed_loaded_dependency_is_rejected(string name)
    {
        File.AppendAllText(Path.Combine(_settings.DeploymentRoot, name), "synthetic tamper");
        Receipt();
        var error = Assert.Throws<InvalidDataException>(() => DeploymentGuard.Verify(_settings, _environment, _host));
        Assert.Contains("Loaded assembly differs", error.Message);
    }
    [Theory]
    [InlineData("changed")]
    [InlineData("missing")]
    [InlineData("extra")]
    [InlineData("untrusted")]
    [InlineData("webroot")]
    public void Invalid_shared_artifact_is_rejected(string failure)
    {
        var file = Path.Combine(_settings.DeploymentRoot, "BDDB.PublishGraph.Hosting.dll");
        switch (failure)
        {
            case "changed": File.AppendAllText(file, "tamper"); break;
            case "missing": File.Delete(file); break;
            case "extra": File.WriteAllText(Path.Combine(_settings.DeploymentRoot, "extra.txt"), "extra"); break;
            case "untrusted": _settings.DeploymentReceiptHash = "untrusted"; break;
            case "webroot": _environment.WebRootPath = _root; break;
        }
        Assert.Throws<InvalidDataException>(() => DeploymentGuard.Verify(_settings, _environment, _host));
    }
    public void Dispose() => Directory.Delete(_root, true);
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
