using BDDB.PublishGraph.Content;
using Xunit;

namespace BDDB.PublishGraph.Content.Tests;

public sealed class P3TemplateContractTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "sda-p3-tests-" + Guid.NewGuid().ToString("N"));
    private readonly ContentCompiler _compiler = new();

    public P3TemplateContractTests() => Directory.CreateDirectory(_root);
    public void Dispose() => Directory.Delete(_root, true);

    public static IEnumerable<object[]> TemplateStateCases =>
        new[] { "full-width", "hero-left", "sidebar", "card-grid", "article", "product-detail" }
            .SelectMany(template => new[] { "normal", "minimal", "long", "missing" }.Select(state => new object[] { template, state }));

    [Fact]
    public void All_six_templates_resolve_to_typed_models_deterministically()
    {
        var files = ValidTemplateSet();
        var first = Compile(files);
        var second = Compile(files);
        Assert.True(first.Success, string.Join("\n", first.Errors));
        Assert.Equal(6, first.Bundle!.Pages.Select(x => x.Template).Distinct(StringComparer.Ordinal).Count());
        Assert.IsType<FullWidthTemplateData>(Page(first, "full").TemplateData);
        Assert.IsType<HeroLeftTemplateData>(Page(first, "hero").TemplateData);
        Assert.IsType<SidebarTemplateData>(Page(first, "side").TemplateData);
        Assert.IsType<CardGridTemplateData>(Page(first, "grid").TemplateData);
        Assert.IsType<ArticleTemplateData>(Page(first, "article").TemplateData);
        Assert.IsType<ProductDetailTemplateData>(Page(first, "product").TemplateData);
        Assert.Equal(first.Bundle.ManifestHash, second.Bundle!.ManifestHash);
    }

    [Theory]
    [MemberData(nameof(TemplateStateCases))]
    public void Every_template_accepts_normal_minimal_long_and_missing_optional_models(string template, string state)
    {
        var target = Write("target.md", PageText("target", "/target/", "full-width", "", ""));
        var optionalMedia = state is "normal" or "long" ? "\nhero_image: mark" : "";
        var extra = template switch
        {
            "hero-left" => $"hero_summary: {(state == "minimal" ? "Brief." : "Synthetic hero state.")}\nhero_actions: []{optionalMedia}",
            "sidebar" => "related_pages: [target]\ndependencies: [target]",
            "card-grid" => "collection_pages: [target]\ndependencies: [target]",
            "article" => state is "minimal" or "missing" ? "attribution: Desk\nsource_date_unknown: true" : "attribution: Synthetic Desk\nsource_date: 2026-09-14",
            "product-detail" => $"product_id: device{optionalMedia}",
            _ => ""
        };
        var body = state == "long" ? "## Long heading\n\nLong synthetic body.\n\n### Detail\n\nMore detail." : state == "minimal" ? "Minimal." : "## State heading\n\nSynthetic body.";
        var page = Write("state.md", PageText("state", "/state/", template, extra, "", body));
        var result = Compile([target, page]);
        Assert.True(result.Success, string.Join("\n", result.Errors));
        Assert.Equal(template, Page(result, "state").TemplateData switch
        {
            FullWidthTemplateData => "full-width",
            HeroLeftTemplateData => "hero-left",
            SidebarTemplateData => "sidebar",
            CardGridTemplateData => "card-grid",
            ArticleTemplateData => "article",
            ProductDetailTemplateData => "product-detail",
            _ => "unknown"
        });
    }

    [Fact]
    public void Required_fields_and_slots_fail_with_ordered_domain_errors()
    {
        var invalid = Write("invalid.md", PageText("bad", "/bad/", "hero-left", "", ""));
        var result = Compile([invalid]);
        Assert.False(result.Success);
        Assert.Equal(result.Errors.Order(StringComparer.Ordinal), result.Errors);
        Assert.Contains(result.Errors, x => x.Contains("requires hero_summary", StringComparison.Ordinal));

        var slot = Write("slot.md", PageText("slot", "/slot/", "article", "attribution: Test\nsource_date_unknown: true", "  - id: notice\n    slot: beforeBody\n    data:\n      text: invalid slot"));
        var slotResult = Compile([slot]);
        Assert.Contains(slotResult.Errors, x => x.Contains("not allowed by template 'article'", StringComparison.Ordinal));

        var discarded = Write("discarded.md", PageText("discarded", "/discarded/", "full-width", "hero_summary: Must not be ignored", ""));
        Assert.Contains(Compile([discarded]).Errors, x => x.Contains("does not consume hero fields", StringComparison.Ordinal));

        var badTone = Write("bad-tone.md", PageText("bad-tone", "/bad-tone/", "full-width", "", "  - id: status\n    slot: afterBody\n    data:\n      text: State\n      tone: arbitrary"));
        Assert.Contains(Compile([badTone]).Errors, x => x.Contains("Unknown status tone 'arbitrary'", StringComparison.Ordinal));
    }

    [Fact]
    public void References_assets_products_and_capabilities_are_resolved_or_rejected()
    {
        var missingPage = Write("missing-page.md", PageText("grid", "/grid/", "card-grid", "collection_pages: [absent]\ndependencies: [absent]", ""));
        Assert.Contains(Compile([missingPage]).Errors, x => x.Contains("unresolved page reference 'absent'", StringComparison.Ordinal));

        var missingAsset = Write("missing-asset.md", PageText("asset", "/asset/", "full-width", "", "  - id: media\n    slot: afterBody\n    data:\n      assetId: absent\n      alt: Missing"));
        Assert.Contains(Compile([missingAsset]).Errors, x => x.Contains("unresolved component asset 'absent'", StringComparison.Ordinal));

        var badSite = Site() with { Products = [new("device", "Device", "Synthetic", "planned", ["absent"])] };
        Assert.Contains(Compile([], badSite).Errors, x => x.Contains("missing capability 'absent'", StringComparison.Ordinal));
    }

    [Fact]
    public void Markdown_h1_and_arbitrary_template_paths_are_rejected_before_rendering()
    {
        var h1 = Write("h1.md", PageText("h1-page", "/h1/", "full-width", "", "", "# Authored H1"));
        var path = Write("path.md", PageText("path-page", "/path/", "../Shared/Unsafe.cshtml", "", ""));
        var result = Compile([h1, path]);
        Assert.Contains(result.Errors, x => x.Contains("template owns the only H1", StringComparison.Ordinal));
        Assert.Contains(result.Errors, x => x.Contains("Unknown template", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("# Authored H1")]
    [InlineData(" # Indented H1")]
    [InlineData("  # Indented H1")]
    [InlineData("   # Indented H1")]
    [InlineData("Setext H1\n=========")]
    public void Every_markdig_h1_form_is_rejected(string body)
    {
        var page = Write("heading-h1.md", PageText("heading-h1", "/heading-h1/", "full-width", "", "", body));
        Assert.Contains(Compile([page]).Errors, x => x.Contains("template owns the only H1", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("### Starts too deep")]
    [InlineData("## Valid start\n\n#### Skipped level")]
    public void Markdown_heading_level_skips_are_rejected(string body)
    {
        var page = Write("heading-skip.md", PageText("heading-skip", "/heading-skip/", "full-width", "", "", body));
        Assert.Contains(Compile([page]).Errors, x => x.Contains("increase by at most one level", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("## H2\n\n### H3\n\n## H2 again")]
    [InlineData("Setext H2\n---------\n\n### H3")]
    [InlineData("    # Code, not a heading")]
    public void Valid_markdown_heading_structures_compile(string body)
    {
        var page = Write("heading-valid.md", PageText("heading-valid", "/heading-valid/", "full-width", "", "", body));
        var result = Compile([page]);
        Assert.True(result.Success, string.Join("\n", result.Errors));
    }

    [Fact]
    public void Template_swap_requires_the_new_contract_and_preserves_authored_markdown()
    {
        var original = Write("original.md", PageText("swap", "/swap/", "full-width", "", "", "## Unchanged body\n\nSame authored content."));
        var originalResult = Compile([original]);
        Assert.True(originalResult.Success);

        var rejected = Write("rejected.md", PageText("swap", "/swap/", "hero-left", "", "", "## Unchanged body\n\nSame authored content."));
        Assert.Contains(Compile([rejected]).Errors, x => x.Contains("requires hero_summary", StringComparison.Ordinal));

        var valid = Write("valid.md", PageText("swap", "/swap/", "hero-left", "hero_summary: Complete contract", "", "## Unchanged body\n\nSame authored content."));
        var validResult = Compile([valid]);
        Assert.True(validResult.Success, string.Join("\n", validResult.Errors));
        Assert.Equal(originalResult.Bundle!.Pages.Single().Html, validResult.Bundle!.Pages.Single().Html);
    }

    [Fact]
    public void Block_reordering_changes_order_without_changing_markdown()
    {
        const string first = "  - id: notice\n    slot: afterBody\n    data:\n      text: First\n  - id: status\n    slot: afterBody\n    data:\n      text: Second";
        const string second = "  - id: status\n    slot: afterBody\n    data:\n      text: Second\n  - id: notice\n    slot: afterBody\n    data:\n      text: First";
        var a = Write("a.md", PageText("blocks", "/blocks/", "full-width", "", first));
        var firstResult = Compile([a]);
        var b = Write("b.md", PageText("blocks", "/blocks/", "full-width", "", second));
        var secondResult = Compile([b]);
        Assert.True(firstResult.Success && secondResult.Success);
        Assert.Equal(firstResult.Bundle!.Pages.Single().Html, secondResult.Bundle!.Pages.Single().Html);
        Assert.IsType<NoticeBlock>(firstResult.Bundle.Pages.Single().Blocks[0]);
        Assert.IsType<StatusBlock>(secondResult.Bundle.Pages.Single().Blocks[0]);
    }

    [Fact]
    public void Public_pages_cannot_depend_on_private_preview_records()
    {
        var preview = Write("preview.md", PageText("preview", "/preview/", "full-width", "visibility: private-preview", ""));
        var publicPage = Write("public.md", PageText("public", "/public/", "full-width", "dependencies: [preview]", ""));
        var result = Compile([preview, publicPage]);
        Assert.Contains(result.Errors, x => x.Contains("depends on private preview content", StringComparison.Ordinal));
    }

    private IReadOnlyList<string> ValidTemplateSet()
    {
        var full = Write("full.md", PageText("full", "/full/", "full-width", "", ""));
        var hero = Write("hero.md", PageText("hero", "/hero/", "hero-left", "hero_summary: Synthetic hero\nhero_actions:\n  - page_id: full\n    text: Continue\ndependencies: [full]", ""));
        var side = Write("side.md", PageText("side", "/side/", "sidebar", "related_pages: [full]\ndependencies: [full]", ""));
        var grid = Write("grid.md", PageText("grid", "/grid/", "card-grid", "collection_pages: [full]\ndependencies: [full]", ""));
        var article = Write("article.md", PageText("article", "/article/", "article", "attribution: Test Desk\nsource_date: 2026-09-14", ""));
        var product = Write("product.md", PageText("product", "/product/", "product-detail", "product_id: device", ""));
        return [full, hero, side, grid, article, product];
    }

    private CompilationResult Compile(IEnumerable<string> files, SiteDefinition? site = null)
    {
        var paths = files.ToArray();
        var approvals = paths.SelectMany(path =>
        {
            var id = File.ReadLines(path).First(x => x.StartsWith("id: ", StringComparison.Ordinal))[4..];
            try
            {
                var hashes = _compiler.GetRequiredApproval(path, paths);
                return new[] { new ApprovalRecord(id + "-approval", id, "content-publication", "reviewer", "2026-09-14T12:00:00.0000000+00:00", "test://approval", hashes.ContentHash, hashes.SourceHash) };
            }
            catch (ContentCompilationException)
            {
                return [];
            }
        }).ToArray();
        return _compiler.Compile(site ?? Site(), paths, new ApprovalLedger(1, ["reviewer"], approvals));
    }

    private static CompiledPage Page(CompilationResult result, string id) => result.Bundle!.Pages.Single(x => x.Id == id);
    private string Write(string name, string body) { var path = Path.Combine(_root, name); File.WriteAllText(path, body); return path; }
    private static SiteDefinition Site() => new(1, "test-site", "Test", "https://test.example/", "navy", "test-assets", ["localhost", "test.example"],
        [new("mark", "test/mark.svg", "image/svg+xml", new string('a', 64))],
        [new("offline", "Offline", "Synthetic capability", "limited")],
        [new("device", "Device", "Synthetic product", "planned", ["offline"])]);

    private static string PageText(string id, string route, string template, string extra, string components, string body = "## Safe heading\n\nSynthetic body.") => $$"""
        ---
        schema_version: 1
        id: {{id}}
        kind: page
        title: Test {{id}}
        description: Synthetic template contract.
        route: {{route}}
        template: {{template}}
        color_palette: navy
        header_style: standard
        footer_style: standard
        {{(string.IsNullOrWhiteSpace(components) ? "components: []" : "components:\n" + components)}}
        published: true
        {{(extra.Contains("visibility:", StringComparison.Ordinal) ? "" : "visibility: public")}}
        status: approved
        order: 1
        {{(extra.Contains("dependencies:", StringComparison.Ordinal) ? "" : "dependencies: []")}}
        sources:
          - id: synthetic-source
            revision: "1"
            sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
        {{extra}}
        ---
        {{body}}
        """;
}
