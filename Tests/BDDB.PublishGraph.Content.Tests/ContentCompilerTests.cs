using System.Text.Json;
using BDDB.PublishGraph.Content;
using Xunit;

namespace BDDB.PublishGraph.Content.Tests;

public sealed class ContentCompilerTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "sda-content-tests-" + Guid.NewGuid().ToString("N"));
    private readonly ContentCompiler _compiler = new();
    private readonly List<ApprovalRecord> _approvals = [];

    public ContentCompilerTests() => Directory.CreateDirectory(_root);
    public void Dispose() => Directory.Delete(_root, true);

    [Fact]
    public void Valid_content_compiles_deterministically_and_raw_html_is_disabled()
    {
        var page = Write("home.md", Page()); Approve(page);
        var first = Compile(Site(), [page]); var second = Compile(Site(), [page]);
        Assert.True(first.Success, string.Join("\n", first.Errors));
        Assert.Equal(JsonSerializer.Serialize(first.Bundle, BundleJson.Options), JsonSerializer.Serialize(second.Bundle, BundleJson.Options));
        Assert.DoesNotContain("<script", first.Bundle!.Pages.Single().Html, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("&lt;script&gt;", first.Bundle.Pages.Single().Html, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Draft_and_private_archived_content_is_excluded()
    {
        var draft = Write("draft.md", Page(id: "draft-page", route: "/draft/", published: false, visibility: "private", status: "draft"));
        var archive = Write("archive.md", Page(id: "archive-page", route: "/archive/", published: false, visibility: "private", status: "archived"));
        var result = Compile(Site(), [draft, archive]);
        Assert.True(result.Success); Assert.Empty(result.Bundle!.Pages); Assert.Equal(2, result.Exclusions.Count);
    }

    [Fact]
    public void Ineligible_product_page_emits_no_private_registry_metadata()
    {
        var page = Write("private-product.md", Page(id: "private-product", route: "/private-product/", published: false, visibility: "private", status: "draft")
            .Replace("template: full-width", "template: product-detail\nproduct_id: device", StringComparison.Ordinal));
        var site = Site() with
        {
            Capabilities = [new("private-capability", "Private", "Must not leak", "unverified")],
            Products = [new("device", "Private device", "Private historical source review", "unverified", ["private-capability"])]
        };
        var result = Compile(site, [page]);
        Assert.True(result.Success, string.Join("\n", result.Errors));
        Assert.Empty(result.Bundle!.Pages);
        Assert.Empty(result.Bundle.Assets);
        Assert.Empty(result.Bundle.Capabilities!);
        Assert.Empty(result.Bundle.Products!);
    }

    [Fact]
    public void Eligible_pages_emit_only_referenced_registry_closure()
    {
        var product = Write("product.md", Page(id: "product-page", route: "/product/")
            .Replace("template: full-width", "template: product-detail\nproduct_id: device", StringComparison.Ordinal));
        var media = Write("media.md", Page(id: "media-page", route: "/media/")
            .Replace("components: []", "components:\n  - id: media\n    slot: afterBody\n    data:\n      assetId: mark\n      alt: Approved fixture", StringComparison.Ordinal));
        var site = Site() with
        {
            Assets = [new("mark", "images/mark.svg", "image/svg+xml", new string('a', 64)), new("unused", "images/unused.svg", "image/svg+xml", new string('b', 64))],
            Capabilities = [new("used-capability", "Used", "Included", "limited"), new("unused-capability", "Unused", "Excluded", "planned")],
            Products = [new("device", "Device", "Included", "limited", ["used-capability"]), new("unused-product", "Unused", "Excluded", "planned", ["unused-capability"])]
        };
        Approve(product, "product-page"); Approve(media, "media-page");
        var result = Compile(site, [product, media]);
        Assert.True(result.Success, string.Join("\n", result.Errors));
        Assert.Equal(["mark"], result.Bundle!.Assets.Select(x => x.Id));
        Assert.Equal(["used-capability"], result.Bundle.Capabilities!.Select(x => x.Id));
        Assert.Equal(["device"], result.Bundle.Products!.Select(x => x.Id));
    }

    [Fact]
    public void Public_page_cannot_depend_on_excluded_content()
    {
        var draft = Write("draft.md", Page(id: "draft-page", route: "/draft/", published: false, visibility: "private", status: "draft"));
        var middle = Write("middle.md", Page(id: "middle-page", route: "/middle/", dependencies: "[draft-page]")); Approve(middle, "middle-page");
        var root = Write("root.md", Page(id: "root-page", route: "/root/", dependencies: "[middle-page]")); Approve(root, "root-page");
        var result = Compile(Site(), [draft, middle, root]);
        Assert.False(result.Success);
        Assert.Contains(result.Errors, x => x.Contains("middle-page", StringComparison.Ordinal) && x.Contains("ineligible content 'draft-page'", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("template", "../../evil.cshtml", "Unknown template")]
    [InlineData("color_palette", "unknown", "Unknown palette")]
    [InlineData("color_palette", "sda-navy", "Unknown palette")]
    [InlineData("color_palette", "unregistered-palette", "Unknown palette")]
    [InlineData("route", "/../secret/", "Route must")]
    public void Unknown_registrations_and_traversal_are_rejected(string key, string value, string expected)
    {
        var page = Write("bad.md", Page().Replace($"{key}: full-width", $"{key}: {value}", StringComparison.Ordinal)
            .Replace($"{key}: navy", $"{key}: {value}", StringComparison.Ordinal).Replace($"{key}: /", $"{key}: {value}", StringComparison.Ordinal));
        Assert.Contains(Compile(Site(), [page]).Errors, x => x.Contains(expected, StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("navy")]
    [InlineData("paper")]
    public void H0_recommended_palettes_are_registered_and_compile(string palette)
    {
        var page = Write($"{palette}.md", Page().Replace("color_palette: navy", $"color_palette: {palette}", StringComparison.Ordinal));
        Approve(page);
        var result = Compile(Site(), [page]);
        Assert.True(result.Success, string.Join("\n", result.Errors));
        Assert.Equal(palette, result.Bundle!.Pages.Single().Palette);
    }

    [Theory]
    [InlineData("[bad](javascript:alert(1))")]
    [InlineData("[insecure](http://example.com)")]
    [InlineData("[host-relative](//example.com/path)")]
    [InlineData("![bad](data:text/html;base64,AA)")]
    [InlineData("[traverse](../secret.txt)")]
    public void Unsafe_links_are_rejected(string body) => Assert.False(Compile(Site(), [Write("unsafe.md", Page(body: body))]).Success);

    [Fact]
    public void Duplicate_ids_and_routes_are_rejected()
    {
        var result = Compile(Site(), [Write("one.md", Page()), Write("two.md", Page())]);
        Assert.Contains(result.Errors, x => x.Contains("Duplicate page id", StringComparison.Ordinal));
        Assert.Contains(result.Errors, x => x.Contains("Duplicate route", StringComparison.Ordinal));
    }

    [Fact]
    public void Missing_and_cyclic_dependencies_are_rejected()
    {
        Assert.Contains(Compile(Site(), [Write("missing.md", Page(dependencies: "[absent]"))]).Errors, x => x.Contains("missing dependency", StringComparison.Ordinal));
        var first = Write("first.md", Page(id: "first-page", route: "/first/", dependencies: "[second-page]"));
        var second = Write("second.md", Page(id: "second-page", route: "/second/", dependencies: "[first-page]"));
        Assert.Contains(Compile(Site(), [first, second]).Errors, x => x.Contains("Dependency cycle", StringComparison.Ordinal));
    }

    [Fact]
    public void Missing_assets_components_slots_and_duplicate_yaml_are_rejected()
    {
        var missingAsset = Write("asset.md", Page().Replace("hero_image: null", "hero_image: missing", StringComparison.Ordinal));
        Assert.Contains(Compile(Site(), [missingAsset]).Errors, x => x.Contains("Missing asset", StringComparison.Ordinal));
        var component = Write("component.md", Page().Replace("components: []", "components:\n  - id: evil\n    slot: arbitrary\n    data: {}", StringComparison.Ordinal));
        var componentResult = Compile(Site(), [component]);
        Assert.Contains(componentResult.Errors, x => x.Contains("Unknown component", StringComparison.Ordinal));
        Assert.Contains(componentResult.Errors, x => x.Contains("Unknown slot", StringComparison.Ordinal));
        var duplicate = Write("duplicate.md", Page().Replace("title: Test", "title: Test\ntitle: Again", StringComparison.Ordinal));
        Assert.Contains(Compile(Site(), [duplicate]).Errors, x => x.Contains("Duplicate", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Approval_requires_authorized_reviewer_timestamp_evidence_and_matching_hashes()
    {
        var page = Write("approval.md", Page()); var hashes = _compiler.GetRequiredApproval(page);
        _approvals.Add(Approval("approval-content", "test-page", "content-publication", hashes, "", "", ""));
        var result = Compile(Site(), [page], [""]);
        Assert.Contains(result.Errors, x => x.Contains("unauthorized reviewer", StringComparison.Ordinal));
        Assert.Contains(result.Errors, x => x.Contains("reviewedAt", StringComparison.Ordinal));
        Assert.Contains(result.Errors, x => x.Contains("decision evidence", StringComparison.Ordinal));
    }

    [Fact]
    public void Archived_publication_requires_distinct_approval_and_public_label()
    {
        var page = Write("archive.md", Page(id: "archive-page", route: "/archive/", status: "archived")); Approve(page, "archive-page");
        var result = Compile(Site(), [page]);
        Assert.Contains(result.Errors, x => x.Contains("archive-publication", StringComparison.Ordinal));
        Assert.Contains(result.Errors, x => x.Contains("public archive label", StringComparison.Ordinal));
        File.WriteAllText(page, Page(id: "archive-page", route: "/archive/", status: "archived", publicArchiveLabel: "Archived â€” historical context"));
        _approvals.Clear(); Approve(page, "archive-page"); Approve(page, "archive-page", "archive-publication");
        Assert.True(Compile(Site(), [page]).Success);
    }

    [Fact]
    public void Changed_content_invalidates_approval_hash()
    {
        var page = Write("stale.md", Page()); Approve(page); File.AppendAllText(page, "changed");
        Assert.Contains(Compile(Site(), [page]).Errors, x => x.Contains("approval hash is stale", StringComparison.Ordinal));
    }

    [Fact]
    public void Changed_dependency_invalidates_direct_and_transitive_dependent_approvals()
    {
        var participate = Write("participate.md", Page(id: "participate", route: "/participate/"));
        var agent = Write("agent.md", Page(id: "agent", route: "/agent/", dependencies: "[participate]"));
        var directory = Write("directory.md", Page(id: "directory", route: "/directory/", dependencies: "[agent]"));
        Approve(participate, "participate"); Approve(agent, "agent"); Approve(directory, "directory");

        File.AppendAllText(participate, "\nDependency changed.");
        var result = Compile(Site(), [participate, agent, directory]);
        Assert.Contains(result.Errors, x => x.StartsWith(agent, StringComparison.Ordinal) && x.Contains("approval hash is stale", StringComparison.Ordinal));
        Assert.Contains(result.Errors, x => x.StartsWith(directory, StringComparison.Ordinal) && x.Contains("approval hash is stale", StringComparison.Ordinal));
    }

    [Fact]
    public void Dependency_approval_identity_is_deterministic_and_requires_dependency_context()
    {
        var dependency = Write("dependency.md", Page(id: "dependency", route: "/dependency/"));
        var dependent = Write("dependent.md", Page(id: "dependent", route: "/dependent/", dependencies: "[dependency]"));
        var first = _compiler.GetRequiredApproval(dependent, [dependent, dependency]);
        var second = _compiler.GetRequiredApproval(dependent, [dependency, dependent]);
        Assert.Equal(first, second);
        Assert.Throws<ContentCompilationException>(() => _compiler.GetRequiredApproval(dependent));
    }

    [Fact]
    public void Malformed_front_matter_and_incompatible_bundles_fail_predictably()
    {
        Assert.Contains(Compile(Site(), [Write("malformed.md", "title: no delimiters")]).Errors, x => x.Contains("malformed front matter", StringComparison.Ordinal));
        Assert.Throws<ContentCompilationException>(() => ContentCompiler.LoadBundle(Path.Combine(_root, "missing.bundle.json")));
        var incompatible = Write("incompatible.bundle.json", "{\"format\":\"wrong\",\"schemaVersion\":999,\"siteId\":\"x\",\"siteName\":\"x\",\"baseUrl\":\"https://x/\",\"defaultPalette\":\"navy\",\"assetNamespace\":\"x\",\"hostnames\":[],\"assets\":[],\"pages\":[],\"manifestHash\":\"x\"}");
        Assert.Throws<ContentCompilationException>(() => ContentCompiler.LoadBundle(incompatible));
    }

    [Fact]
    public void Missing_bundle_and_page_scalars_fail_with_domain_validation_errors()
    {
        var missingBundleScalars = Write("missing-scalars.bundle.json", "{\"schemaVersion\":1,\"hostnames\":[],\"assets\":[],\"pages\":[]}");
        var bundleException = Assert.Throws<ContentCompilationException>(() => ContentCompiler.LoadBundle(missingBundleScalars));
        Assert.Contains(bundleException.Errors, x => x.Contains("missing required scalar 'manifestHash'", StringComparison.Ordinal));

        var page = Write("valid.md", Page()); Approve(page); var bundle = Compile(Site(), [page]).Bundle!;
        var json = JsonSerializer.Serialize(bundle, BundleJson.Options).Replace("\"id\": \"test-page\",", "", StringComparison.Ordinal);
        var pageException = Assert.Throws<ContentCompilationException>(() => ContentCompiler.LoadBundle(Write("missing-page-scalar.bundle.json", json)));
        Assert.Contains(pageException.Errors, x => x.Contains("page is missing required scalar 'id'", StringComparison.Ordinal));
    }

    [Fact]
    public void Missing_nested_bundle_scalars_fail_with_domain_validation_errors()
    {
        var page = Write("nested.md", Page()); Approve(page); var bundle = Compile(Site(), [page]).Bundle!;
        var json = JsonSerializer.Serialize(bundle, BundleJson.Options)
            .Replace($"\"sha256\": \"{new string('a', 64)}\"", "\"sha256\": null", StringComparison.Ordinal);
        var exception = Assert.Throws<ContentCompilationException>(() => ContentCompiler.LoadBundle(Write("missing-nested-scalar.bundle.json", json)));
        Assert.Contains(exception.Errors, x => x.Contains("Invalid asset", StringComparison.Ordinal) || x.Contains("invalid source reference", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("html")]
    [InlineData("route")]
    [InlineData("host")]
    [InlineData("canonical")]
    [InlineData("registry")]
    [InlineData("manifest")]
    public void Runtime_rejects_tampered_bundles(string mutation)
    {
        var page = Write("valid.md", Page()); Approve(page); var bundle = Compile(Site(), [page]).Bundle!;
        bundle = mutation switch
        {
            "html" => bundle with { Pages = [bundle.Pages[0] with { Html = "<script>alert(1)</script>" }] },
            "route" => bundle with { Pages = [bundle.Pages[0] with { Route = "/../bad/" }] },
            "host" => bundle with { Hostnames = ["bad:host"] },
            "canonical" => bundle with { Pages = [bundle.Pages[0] with { CanonicalUrl = "https://evil.example/" }] },
            "registry" => bundle with { Products = [new("private-product", "Private", "Must not leak", "unverified", [])] },
            _ => bundle with { ManifestHash = new string('0', 64) }
        };
        if (mutation != "manifest") bundle = bundle with { ManifestHash = ContentCompiler.ComputeManifestHash(bundle) };
        Assert.Throws<ContentCompilationException>(() => ContentCompiler.LoadBundle(Write("tampered.bundle.json", JsonSerializer.Serialize(bundle, BundleJson.Options))));
    }

    [Fact]
    public void Untampered_bundle_loads_and_duplicate_runtime_routes_are_rejected()
    {
        var page = Write("valid.md", Page()); Approve(page); var bundle = Compile(Site(), [page]).Bundle!;
        var validPath = Path.Combine(_root, "valid.bundle.json"); ContentCompiler.WriteBundle(bundle, validPath);
        Assert.Equal(bundle.ManifestHash, ContentCompiler.LoadBundle(validPath).ManifestHash);
        var duplicate = bundle with { Pages = [bundle.Pages[0], bundle.Pages[0]] };
        duplicate = duplicate with { ManifestHash = ContentCompiler.ComputeManifestHash(duplicate) };
        Assert.Throws<ContentCompilationException>(() => ContentCompiler.LoadBundle(Write("duplicate.bundle.json", JsonSerializer.Serialize(duplicate, BundleJson.Options))));
    }

    [Fact]
    public void Duplicate_site_ids_and_hostnames_are_rejected()
    {
        var duplicate = ContentCompiler.ValidateSiteSet([Site(), Site()]);
        Assert.Contains(duplicate, x => x.Contains("Duplicate site id", StringComparison.Ordinal)); Assert.Contains(duplicate, x => x.Contains("Duplicate hostname", StringComparison.Ordinal));
    }

    [Fact]
    public void Long_minimal_and_optional_content_compile()
    {
        var minimal = Write("minimal.md", Page(body: "## Minimal")); Approve(minimal);
        var longPage = Write("long.md", Page(id: "long-page", route: "/long/", body: "## Long\n\n" + new string('x', 50_000))); Approve(longPage, "long-page");
        var result = Compile(Site(), [minimal, longPage]); Assert.True(result.Success, string.Join("\n", result.Errors)); Assert.Equal(2, result.Bundle!.Pages.Count);
    }

    [Fact]
    public void Two_sites_keep_identity_routes_canonical_urls_and_assets_isolated()
    {
        var a = Write("a.md", Page()); Approve(a); var first = Compile(Site(), [a]).Bundle!;
        _approvals.Clear(); var b = Write("b.md", Page(id: "ember-home")); Approve(b, "ember-home");
        var second = Compile(Site("ember-site", "Ember", "https://ember.example/", "ember-assets"), [b]).Bundle!;
        Assert.Equal("Aurora", first.SiteName); Assert.Equal("Ember", second.SiteName);
        Assert.StartsWith("https://aurora.example/", first.Pages.Single().CanonicalUrl, StringComparison.Ordinal);
        Assert.StartsWith("https://ember.example/", second.Pages.Single().CanonicalUrl, StringComparison.Ordinal);
        Assert.NotEqual(first.AssetNamespace, second.AssetNamespace); Assert.NotEqual(first.ManifestHash, second.ManifestHash);
    }

    [Fact]
    public void Private_review_preserves_draft_identities_without_granting_publication()
    {
        var target = Write("target.md", Page(id: "target", published: false, visibility: "private", status: "draft"));
        var dependent = Write("dependent.md", Page(id: "dependent", route: "/dependent/", published: false, visibility: "private-preview", status: "draft", dependencies: "[target]"));
        var files = new[] { target, dependent };
        var review = _compiler.CompilePrivateReview(Site(), files);
        Assert.True(review.Success, string.Join("\n", review.Errors));
        Assert.Equal(ContentContract.PrivateReviewBundleFormat, review.Bundle!.Format);
        foreach (var file in files)
        {
            var identity = _compiler.GetRequiredApproval(file, files);
            var page = review.Bundle.Pages.Single(x => x.ContentHash == identity.ContentHash);
            Assert.True(page.IsPrivatePreview);
            Assert.Equal(new string('0', 64), page.ApprovalHash);
            Assert.Equal(identity.SourceHash, review.Bundle.ReviewSourceHashes![page.Id]);
        }
        Assert.Empty(Compile(Site(), files).Bundle!.Pages);
        var path = Path.Combine(_root, "review.bundle.json");
        ContentCompiler.WriteBundle(review.Bundle, path);
        Assert.Equal(review.Bundle.ManifestHash, ContentCompiler.LoadPrivateReviewBundle(path).ManifestHash);
        Assert.Throws<ContentCompilationException>(() => ContentCompiler.LoadBundle(path));
    }

    [Theory]
    [InlineData(true, "private", "draft")]
    [InlineData(false, "public", "draft")]
    [InlineData(false, "private-preview", "approved")]
    public void Private_review_rejects_non_draft_or_public_inputs(bool published, string visibility, string status)
    {
        var file = Write("invalid-review.md", Page(published: published, visibility: visibility, status: status));
        Assert.Contains(_compiler.CompilePrivateReview(Site(), [file]).Errors, x => x.Contains("private review requires", StringComparison.Ordinal));
    }

    [Fact]
    public void Private_review_loader_rejects_missing_source_identity()
    {
        var file = Write("private.md", Page(published: false, visibility: "private", status: "draft"));
        var bundle = _compiler.CompilePrivateReview(Site(), [file]).Bundle! with { ReviewSourceHashes = null };
        bundle = bundle with { ManifestHash = ContentCompiler.ComputeManifestHash(bundle) };
        var path = Path.Combine(_root, "tampered-review.bundle.json");
        ContentCompiler.WriteBundle(bundle, path);
        Assert.Throws<ContentCompilationException>(() => ContentCompiler.LoadPrivateReviewBundle(path));
    }

    [Theory]
    [InlineData("https://user:secret@aurora.example/")]
    [InlineData("https://user@aurora.example/")]
    [InlineData("https://ember.example/")]
    [InlineData("https://aurora.example/path/")]
    [InlineData("https://aurora.example/?page=1")]
    [InlineData("https://aurora.example/#section")]
    [InlineData("http://aurora.example/")]
    [InlineData("https://aurora.example:444/")]
    public void Canonical_origin_rejected_in_compilation_and_bundle_loading(string origin)
    {
        var site = Site() with { BaseUrl = origin };
        Assert.Contains(Compile(site, []).Errors, x => x.Contains("baseUrl", StringComparison.Ordinal));
        Assert.Contains(_compiler.CompilePrivateReview(site, []).Errors, x => x.Contains("baseUrl", StringComparison.Ordinal));
        var publicBundle = Compile(Site(), []).Bundle! with { BaseUrl = origin };
        publicBundle = publicBundle with { ManifestHash = ContentCompiler.ComputeManifestHash(publicBundle) };
        var path = Write("bad-origin.json", JsonSerializer.Serialize(publicBundle, BundleJson.Options));
        Assert.Contains(Assert.Throws<ContentCompilationException>(() => ContentCompiler.LoadBundle(path)).Errors, x => x.Contains("baseUrl", StringComparison.Ordinal));
        var privateBundle = _compiler.CompilePrivateReview(Site(), []).Bundle! with { BaseUrl = origin };
        privateBundle = privateBundle with { ManifestHash = ContentCompiler.ComputeManifestHash(privateBundle) };
        path = Write("bad-private-origin.json", JsonSerializer.Serialize(privateBundle, BundleJson.Options));
        Assert.Contains(Assert.Throws<ContentCompilationException>(() => ContentCompiler.LoadPrivateReviewBundle(path)).Errors, x => x.Contains("baseUrl", StringComparison.Ordinal));
    }

    private CompilationResult Compile(SiteDefinition site, IEnumerable<string> paths, IReadOnlyList<string>? reviewers = null) =>
        _compiler.Compile(site, paths, new ApprovalLedger(1, reviewers ?? ["test-reviewer"], _approvals));
    private string Write(string name, string value) { var path = Path.Combine(_root, name); File.WriteAllText(path, value); return path; }
    private void Approve(string path, string pageId = "test-page", string purpose = "content-publication")
    {
        var hashes = _compiler.GetRequiredApproval(path, Directory.EnumerateFiles(_root, "*.md"));
        _approvals.Add(Approval($"{pageId}-{purpose}", pageId, purpose, hashes));
    }
    private static ApprovalRecord Approval(string id, string pageId, string purpose, (string ContentHash, string SourceHash) hashes,
        string reviewer = "test-reviewer", string reviewedAt = "2026-09-12T12:00:00.0000000+00:00", string evidence = "test://review/decision") =>
        new(id, pageId, purpose, reviewer, reviewedAt, evidence, hashes.ContentHash, hashes.SourceHash);
    private static SiteDefinition Site(string id = "aurora-site", string name = "Aurora", string baseUrl = "https://aurora.example/", string assetNamespace = "aurora-assets") =>
        new(1, id, name, baseUrl, "navy", assetNamespace, ["localhost", id == "ember-site" ? "ember.example" : "aurora.example"], [new("mark", "images/mark.svg", "image/svg+xml", new string('a', 64))]);
    private static string Page(string id = "test-page", string route = "/", bool published = true, string visibility = "public", string status = "approved", string? publicArchiveLabel = null, string dependencies = "[]", string body = "## Safe heading\n\n<script>alert(1)</script>") => $$"""
        ---
        schema_version: 1
        id: {{id}}
        kind: page
        title: Test
        description: Synthetic test page.
        route: {{route}}
        template: full-width
        color_palette: navy
        header_style: standard
        footer_style: standard
        hero_image: null
        components: []
        published: {{published.ToString().ToLowerInvariant()}}
        visibility: {{visibility}}
        status: {{status}}
        public_archive_label: {{(publicArchiveLabel is null ? "null" : $"\"{publicArchiveLabel}\"")}}
        order: 1
        dependencies: {{dependencies}}
        sources:
          - id: synthetic-source
            revision: "1"
            sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
        ---
        {{body}}
        """;
}
