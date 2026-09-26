using System.Text.Json;
using System.Text.RegularExpressions;
using System.Globalization;
using Ganss.Xss;
using Markdig;
using Markdig.Syntax;
using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

namespace BDDB.PublishGraph.Content;

public sealed partial class ContentCompiler
{
    private readonly IDeserializer _yaml = new DeserializerBuilder()
        .WithNamingConvention(UnderscoredNamingConvention.Instance)
        .WithDuplicateKeyChecking()
        .Build();

    private readonly MarkdownPipeline _markdown = new MarkdownPipelineBuilder()
        .DisableHtml()
        .UseAdvancedExtensions()
        .Build();

    public CompilationResult Compile(SiteDefinition site, IEnumerable<string> contentFiles, ApprovalLedger? approvalLedger = null)
        => CompileCore(site, contentFiles, approvalLedger, false);

    public CompilationResult CompilePrivateReview(SiteDefinition site, IEnumerable<string> contentFiles)
        => CompileCore(site, contentFiles, new ApprovalLedger(ContentContract.SchemaVersion, [], []), true);

    private CompilationResult CompileCore(SiteDefinition site, IEnumerable<string> contentFiles, ApprovalLedger? approvalLedger, bool privateReview)
    {
        var errors = new List<string>();
        var exclusions = new List<string>();
        var candidates = new List<(string File, PageFrontMatter Meta, string Body, MarkdownDocument Document, string Hash)>();

        ValidateSite(site, errors);
        foreach (var file in contentFiles.Order(StringComparer.Ordinal))
        {
            try
            {
                var text = File.ReadAllText(file);
                var (yaml, body) = SplitFrontMatter(text);
                var meta = _yaml.Deserialize<PageFrontMatter>(yaml)
                    ?? throw new InvalidDataException("Front matter is empty.");
                var document = Markdown.Parse(body, _markdown);
                var hash = ContentHasher.PageHash(meta, body);
                ValidatePage(meta, body, document, site, errors, file);
                candidates.Add((file, meta, body, document, hash));
            }
            catch (Exception exception) when (exception is not ContentCompilationException)
            {
                errors.Add($"{file}: malformed front matter: {exception.Message}");
            }
        }

        AddDuplicates(candidates, errors, x => x.Meta.Id, "page id");
        AddDuplicates(candidates.Where(x => !string.IsNullOrWhiteSpace(x.Meta.Route)), errors, x => x.Meta.Route, "route");
        ValidateDependencies(candidates, errors);
        ValidateReferences(candidates, site, errors);
        var approvalsByPage = ValidateApprovals(approvalLedger, candidates, errors);
        if (errors.Count > 0)
        {
            return new(null, errors.Order(StringComparer.Ordinal).ToArray(), exclusions);
        }
        var approvalSourceHashes = ComputeApprovalSourceHashes(candidates);

        var eligible = new Dictionary<string, (string File, PageFrontMatter Meta, string Body, MarkdownDocument Document, string Hash, IReadOnlyList<ApprovalRecord> Approvals)>(StringComparer.Ordinal);
        foreach (var candidate in candidates.OrderBy(x => x.Meta.Id, StringComparer.Ordinal))
        {
            var page = candidate.Meta;
            if (privateReview && (page.Published || page.Status != "draft" || page.Visibility is not ("private" or "private-preview")))
            {
                errors.Add($"{candidate.File}: private review requires an unpublished private draft.");
                continue;
            }
            if (!privateReview && !IsPublicationCandidate(page))
            {
                exclusions.Add($"{page.Id}: ineligible ({page.Status}/{page.Visibility}/published={page.Published})");
                continue;
            }

            var sourceHash = approvalSourceHashes[page.Id];
            var pageApprovals = approvalsByPage.GetValueOrDefault(page.Id) ?? [];
            var requiredPurposes = page.Status == "archived"
                ? new[] { "content-publication", "archive-publication" }
                : new[] { "content-publication" };
            if (page.Status == "archived" && string.IsNullOrWhiteSpace(page.PublicArchiveLabel))
                errors.Add($"{candidate.File}: archived public content requires a public archive label.");
            foreach (var purpose in privateReview ? Array.Empty<string>() : requiredPurposes)
            {
                var matching = pageApprovals.Where(x => x.Purpose == purpose).ToArray();
                if (matching.Length != 1)
                    errors.Add($"{candidate.File}: exactly one valid '{purpose}' approval is required.");
                else if (!StringComparer.OrdinalIgnoreCase.Equals(matching[0].ContentHash, candidate.Hash) ||
                    !StringComparer.OrdinalIgnoreCase.Equals(matching[0].SourceHash, sourceHash))
                    errors.Add($"{candidate.File}: '{purpose}' approval hash is stale or invalid (expected contentHash={candidate.Hash}, sourceHash={sourceHash}).");
            }
            if (!errors.Any(x => x.StartsWith(candidate.File + ":", StringComparison.Ordinal)))
                eligible.Add(page.Id, (candidate.File, page, candidate.Body, candidate.Document, candidate.Hash, pageApprovals));
        }

        foreach (var candidate in eligible.Values)
            foreach (var dependency in candidate.Meta.Dependencies)
                if (!eligible.ContainsKey(dependency))
                    errors.Add($"{candidate.File}: public page '{candidate.Meta.Id}' depends on ineligible content '{dependency}'.");
                else if (candidate.Meta.Visibility == "public" && eligible[dependency].Meta.Visibility != "public")
                    errors.Add($"{candidate.File}: public page '{candidate.Meta.Id}' depends on private preview content '{dependency}'.");

        if (errors.Count > 0)
            return new(null, errors.Order(StringComparer.Ordinal).ToArray(), exclusions.Order(StringComparer.Ordinal).ToArray());

        var pages = new List<CompiledPage>();
        foreach (var candidate in eligible.Values.OrderBy(x => x.Meta.Id, StringComparer.Ordinal))
        {
            var page = candidate.Meta;
            var sanitizer = CreateSanitizer();
            var html = sanitizer.Sanitize(Markdown.ToHtml(candidate.Document, _markdown), site.BaseUrl);
            var templateData = ResolveTemplateData(page, eligible, site);
            var blocks = ResolveBlocks(page, site);
            pages.Add(new CompiledPage(
                page.Id, page.Kind, page.Title, page.Description, page.Route, page.Template,
                page.ColorPalette, new Uri(new Uri(site.BaseUrl), page.Route).AbsoluteUri,
                html, page.Components, page.Sources.OrderBy(x => x.Id, StringComparer.Ordinal).ToArray(),
                candidate.Hash, privateReview ? new string('0', 64) : ContentHasher.Sha256(JsonSerializer.Serialize(candidate.Approvals.OrderBy(x => x.Purpose, StringComparer.Ordinal), BundleJson.Options)),
                page.Eyebrow, templateData, blocks, privateReview || page.Visibility == "private-preview"));
        }

        var eligiblePages = eligible.Values.Select(x => x.Meta).ToArray();
        var usedProductIds = eligiblePages.Where(x => x.ProductId is not null).Select(x => x.ProductId!).ToHashSet(StringComparer.Ordinal);
        var products = (site.Products ?? []).Where(x => usedProductIds.Contains(x.Id)).OrderBy(x => x.Id, StringComparer.Ordinal).ToArray();
        var usedCapabilityIds = products.SelectMany(x => x.CapabilityIds ?? []).ToHashSet(StringComparer.Ordinal);
        var capabilities = (site.Capabilities ?? []).Where(x => usedCapabilityIds.Contains(x.Id)).OrderBy(x => x.Id, StringComparer.Ordinal).ToArray();
        var usedAssetIds = eligiblePages.Select(x => x.HeroImage)
            .Concat(eligiblePages.SelectMany(x => x.Components.Where(c => c.Id == "media")
                .Select(c => c.Data.GetValueOrDefault("assetId"))))
            .Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x!).ToHashSet(StringComparer.Ordinal);
        var assets = site.Assets.Where(x => usedAssetIds.Contains(x.Id)).OrderBy(x => x.Id, StringComparer.Ordinal).ToArray();

        var unsignedBundle = new ContentBundle(privateReview ? ContentContract.PrivateReviewBundleFormat : ContentContract.BundleFormat, ContentContract.SchemaVersion,
            site.SiteId, site.Name, site.BaseUrl, site.DefaultPalette, site.AssetNamespace,
            site.Hostnames.Order(StringComparer.Ordinal).ToArray(), assets,
            pages, "", capabilities, products, privateReview ? approvalSourceHashes : null);
        var bundle = unsignedBundle with { ManifestHash = ComputeManifestHash(unsignedBundle) };
        return new(bundle, [], exclusions.Order(StringComparer.Ordinal).ToArray());
    }

    public (string ContentHash, string SourceHash) GetRequiredApproval(string contentFile) =>
        GetRequiredApproval(contentFile, [contentFile]);

    public (string ContentHash, string SourceHash) GetRequiredApproval(string contentFile, IEnumerable<string> contentFiles)
    {
        var errors = new List<string>();
        var candidates = new List<(string File, PageFrontMatter Meta, string Body, MarkdownDocument Document, string Hash)>();
        foreach (var file in contentFiles.Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal))
        {
            try
            {
                var text = File.ReadAllText(file);
                var (yaml, body) = SplitFrontMatter(text);
                var meta = _yaml.Deserialize<PageFrontMatter>(yaml) ?? throw new InvalidDataException("Front matter is empty.");
                candidates.Add((file, meta, body, Markdown.Parse(body, _markdown), ContentHasher.PageHash(meta, body)));
            }
            catch (Exception exception)
            {
                errors.Add($"{file}: cannot calculate approval identity: {exception.Message}");
            }
        }
        AddDuplicates(candidates, errors, x => x.Meta.Id, "page id");
        ValidateDependencies(candidates, errors);
        var target = candidates.SingleOrDefault(x => StringComparer.OrdinalIgnoreCase.Equals(Path.GetFullPath(x.File), Path.GetFullPath(contentFile)));
        if (target == default) errors.Add($"Approval target is not part of the supplied content set: {contentFile}");
        if (errors.Count > 0) throw new ContentCompilationException(errors.Order(StringComparer.Ordinal).ToArray());
        var sourceHashes = ComputeApprovalSourceHashes(candidates);
        return (target.Hash, sourceHashes[target.Meta.Id]);
    }

    public static void WriteBundle(ContentBundle bundle, string outputPath)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outputPath))!);
        File.WriteAllText(outputPath, JsonSerializer.Serialize(bundle, BundleJson.Options).Replace("\r\n", "\n", StringComparison.Ordinal));
    }

    public static ContentBundle LoadBundle(string path)
        => LoadBundleCore(path, false);

    public static ContentBundle LoadPrivateReviewBundle(string path)
        => LoadBundleCore(path, true);

    private static ContentBundle LoadBundleCore(string path, bool privateReview)
    {
        if (!File.Exists(path)) throw new ContentCompilationException([$"Required content bundle is missing: {path}"]);
        var info = new FileInfo(path);
        if (info.Length > 25_000_000) throw new ContentCompilationException([$"Content bundle exceeds the 25 MB limit: {path}"]);
        ContentBundle bundle;
        try
        {
            bundle = JsonSerializer.Deserialize<ContentBundle>(File.ReadAllText(path), BundleJson.Options)
            ?? throw new ContentCompilationException([$"Content bundle is unreadable: {path}"]);
        }
        catch (JsonException exception)
        {
            throw new ContentCompilationException([$"Content bundle is unreadable: {path}: {exception.Message}"]);
        }
        var errors = ValidateBundle(bundle, privateReview);
        if (errors.Count > 0) throw new ContentCompilationException(errors);
        return bundle;
    }

    public static string ComputeManifestHash(ContentBundle bundle) =>
        ContentHasher.Sha256(JsonSerializer.Serialize(bundle with { ManifestHash = "" }, BundleJson.Options));

    public static string HashSources(IEnumerable<SourceReference> sources) =>
        ContentHasher.Sha256(string.Join("\n", sources.OrderBy(x => x.Id, StringComparer.Ordinal)
            .Select(x => $"{x.Id}|{x.Revision}|{x.Sha256}")));

    private static IReadOnlyDictionary<string, string> ComputeApprovalSourceHashes(
        IReadOnlyList<(string File, PageFrontMatter Meta, string Body, MarkdownDocument Document, string Hash)> pages)
    {
        var byId = pages.ToDictionary(x => x.Meta.Id, StringComparer.Ordinal);
        var hashes = new Dictionary<string, string>(StringComparer.Ordinal);
        string Compute(string id)
        {
            if (hashes.TryGetValue(id, out var existing)) return existing;
            var page = byId[id];
            var directSourceHash = HashSources(page.Meta.Sources);
            if (page.Meta.Dependencies.Count == 0) return hashes[id] = directSourceHash;
            var dependencyIdentity = string.Join("\n", page.Meta.Dependencies.Order(StringComparer.Ordinal).Select(dependency =>
            {
                var target = byId[dependency];
                return $"{dependency}|{target.Hash}|{Compute(dependency)}";
            }));
            return hashes[id] = ContentHasher.Sha256($"sources|{directSourceHash}\ndependencies\n{dependencyIdentity}");
        }
        foreach (var id in byId.Keys.Order(StringComparer.Ordinal)) Compute(id);
        return hashes;
    }

    private static (string Yaml, string Body) SplitFrontMatter(string text)
    {
        var normalized = text.Replace("\r\n", "\n", StringComparison.Ordinal);
        if (!normalized.StartsWith("---\n", StringComparison.Ordinal))
            throw new InvalidDataException("Opening '---' delimiter is required.");
        var end = normalized.IndexOf("\n---\n", 4, StringComparison.Ordinal);
        if (end < 0) throw new InvalidDataException("Closing '---' delimiter is required.");
        return (normalized[4..end], normalized[(end + 5)..]);
    }

    private static void ValidateSite(SiteDefinition site, List<string> errors)
    {
        if (site.SchemaVersion != ContentContract.SchemaVersion) errors.Add("Site schemaVersion is incompatible.");
        if (string.IsNullOrWhiteSpace(site.SiteId) || !IdPattern().IsMatch(site.SiteId)) errors.Add("Site ID is invalid.");
        if (string.IsNullOrWhiteSpace(site.Name)) errors.Add("Site name is required.");
        if (string.IsNullOrWhiteSpace(site.AssetNamespace)) errors.Add("Site asset namespace is required.");
        if (string.IsNullOrWhiteSpace(site.BaseUrl) || !Uri.TryCreate(site.BaseUrl, UriKind.Absolute, out var baseUri) ||
            baseUri.Scheme != Uri.UriSchemeHttps || baseUri.UserInfo.Length != 0 || baseUri.AbsolutePath != "/" ||
            baseUri.Query.Length != 0 || baseUri.Fragment.Length != 0 || !baseUri.IsDefaultPort ||
            !string.Equals(site.BaseUrl.TrimEnd('/'), baseUri.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase))
            errors.Add("Site baseUrl must be a canonical HTTPS origin without credentials, non-root path, query, fragment or custom port.");
        else
        {
            // Explicit site-owned compatibility registration; admitted request hosts remain loopback only.
            ContentRegistries.LocalReviewOrigins.TryGetValue(site.SiteId, out var reviewHost);
            var localReview = reviewHost is not null && baseUri.Host == reviewHost &&
                site.Hostnames is { Count: > 0 } && site.Hostnames.All(h => h is "localhost" or "127.0.0.1");
            if (!localReview && (site.Hostnames is null || !site.Hostnames.Contains(baseUri.Host, StringComparer.OrdinalIgnoreCase)))
                errors.Add("Site baseUrl hostname must belong to its registered hostnames or the explicit local review origin.");
        }
        if (string.IsNullOrWhiteSpace(site.DefaultPalette) || !ContentRegistries.Palettes.Contains(site.DefaultPalette)) errors.Add($"Unknown site palette '{site.DefaultPalette}'.");
        if (site.Hostnames is null || site.Hostnames.Count == 0 || site.Hostnames.Any(x => string.IsNullOrWhiteSpace(x) || x.Contains('/') || x.Contains(':')))
            errors.Add("Hostnames must be an explicit host-only allowlist.");
        if (site.Assets is null) { errors.Add("Site assets collection is required."); return; }
        AddDuplicateValues(site.Assets.Where(x => x is not null && !string.IsNullOrWhiteSpace(x.Id)).Select(x => x.Id), errors, "asset id");
        foreach (var asset in site.Assets)
        {
            if (asset is null) { errors.Add("Site assets collection contains a null asset."); continue; }
            if (string.IsNullOrWhiteSpace(asset.Id) || !IdPattern().IsMatch(asset.Id) ||
                string.IsNullOrWhiteSpace(asset.Path) || !SafeAssetPath().IsMatch(asset.Path) || asset.Path.Contains("..", StringComparison.Ordinal) ||
                string.IsNullOrWhiteSpace(asset.Sha256) || !Sha256Pattern().IsMatch(asset.Sha256) || string.IsNullOrWhiteSpace(asset.MediaType))
                errors.Add($"Invalid asset '{asset.Id}'.");
        }
        var capabilities = site.Capabilities ?? [];
        var products = site.Products ?? [];
        AddDuplicateValues(capabilities.Where(x => x is not null).Select(x => x.Id), errors, "capability id");
        AddDuplicateValues(products.Where(x => x is not null).Select(x => x.Id), errors, "product id");
        foreach (var capability in capabilities)
        {
            if (capability is null) { errors.Add("Site capabilities contains a null capability."); continue; }
            if (string.IsNullOrWhiteSpace(capability.Id) || !IdPattern().IsMatch(capability.Id) || string.IsNullOrWhiteSpace(capability.Name) ||
                string.IsNullOrWhiteSpace(capability.Description) || capability.Status is not ("available" or "limited" or "planned" or "unverified"))
                errors.Add($"Invalid capability '{capability.Id}'.");
        }
        var capabilityIds = capabilities.Where(x => x is not null).Select(x => x.Id).ToHashSet(StringComparer.Ordinal);
        foreach (var product in products)
        {
            if (product is null) { errors.Add("Site products contains a null product."); continue; }
            if (string.IsNullOrWhiteSpace(product.Id) || !IdPattern().IsMatch(product.Id) || string.IsNullOrWhiteSpace(product.Name) || string.IsNullOrWhiteSpace(product.Summary) ||
                product.Status is not ("available" or "limited" or "planned" or "unverified") || product.CapabilityIds is null)
                errors.Add($"Invalid product '{product.Id}'.");
            foreach (var capabilityId in product.CapabilityIds ?? [])
                if (!capabilityIds.Contains(capabilityId)) errors.Add($"Product '{product.Id}' references missing capability '{capabilityId}'.");
        }
    }

    private static void ValidatePage(PageFrontMatter page, string body, MarkdownDocument document, SiteDefinition site, List<string> errors, string file)
    {
        void Error(string value) => errors.Add($"{file}: {value}");
        if (page.SchemaVersion != ContentContract.SchemaVersion) Error("schemaVersion is incompatible.");
        if (!IdPattern().IsMatch(page.Id)) Error("ID is invalid.");
        if (string.IsNullOrWhiteSpace(page.Title)) Error("Title is required.");
        if (!RoutePattern().IsMatch(page.Route) || page.Route.Contains("..", StringComparison.Ordinal)) Error("Route must be '/', or lowercase kebab-case with leading and trailing slash.");
        if (!ContentRegistries.Templates.Contains(page.Template) || page.Template.Contains(".cshtml", StringComparison.OrdinalIgnoreCase)) Error($"Unknown template '{page.Template}'.");
        if (!ContentRegistries.Palettes.Contains(page.ColorPalette)) Error($"Unknown palette '{page.ColorPalette}'.");
        if (!ContentRegistries.HeaderStyles.Contains(page.HeaderStyle)) Error($"Unknown header style '{page.HeaderStyle}'.");
        if (!ContentRegistries.FooterStyles.Contains(page.FooterStyle)) Error($"Unknown footer style '{page.FooterStyle}'.");
        if (page.Visibility is not ("public" or "private-preview" or "private")) Error($"Unknown visibility '{page.Visibility}'.");
        ValidateHeadings(document, Error);
        if (string.IsNullOrWhiteSpace(body)) Error("Markdown body is required.");
        foreach (var component in page.Components)
        {
            if (!ContentRegistries.Components.Contains(component.Id)) Error($"Unknown component '{component.Id}'.");
            if (!ContentRegistries.Slots.Contains(component.Slot)) Error($"Unknown slot '{component.Slot}'.");
            else if (ContentRegistries.TemplateContracts.TryGetValue(page.Template, out var contract) && !contract.Slots.Contains(component.Slot))
                Error($"Slot '{component.Slot}' is not allowed by template '{page.Template}'.");
            ValidateComponent(component, Error);
        }
        if (page.HeroImage is not null && site.Assets.All(x => x.Id != page.HeroImage)) Error($"Missing asset '{page.HeroImage}'.");
        foreach (var action in page.HeroActions)
        {
            if (string.IsNullOrWhiteSpace(action.Text)) Error("Hero action text is required.");
            if (action.Variant is not ("primary" or "secondary" or "quiet")) Error($"Unknown hero action variant '{action.Variant}'.");
        }
        if (UnsafeUrl().IsMatch(body) || ProtocolRelativeUrl().IsMatch(body) || Traversal().IsMatch(body)) Error("Unsafe URL or traversal was rejected.");
        foreach (var source in page.Sources)
            if (!IdPattern().IsMatch(source.Id) || !Sha256Pattern().IsMatch(source.Sha256)) Error($"Invalid source reference '{source.Id}'.");
        if (body.Length > 1_000_000) Error("Markdown exceeds the 1 MB limit.");
        switch (page.Template)
        {
            case "hero-left" when string.IsNullOrWhiteSpace(page.HeroSummary): Error("Template 'hero-left' requires hero_summary."); break;
            case "sidebar" when page.RelatedPages.Count == 0: Error("Template 'sidebar' requires related_pages."); break;
            case "card-grid" when page.CollectionPages.Count == 0: Error("Template 'card-grid' requires collection_pages."); break;
            case "article" when string.IsNullOrWhiteSpace(page.Attribution): Error("Template 'article' requires attribution."); break;
            case "article" when string.IsNullOrWhiteSpace(page.SourceDate) && !page.SourceDateUnknown: Error("Template 'article' requires source_date or source_date_unknown: true."); break;
            case "article" when !string.IsNullOrWhiteSpace(page.SourceDate) && page.SourceDateUnknown: Error("Template 'article' cannot set both source_date and source_date_unknown."); break;
            case "article" when !string.IsNullOrWhiteSpace(page.SourceDate) && !DateOnly.TryParseExact(page.SourceDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _): Error("Template 'article' source_date must use YYYY-MM-DD."); break;
            case "product-detail" when string.IsNullOrWhiteSpace(page.ProductId): Error("Template 'product-detail' requires product_id."); break;
        }
        if (page.Template is not ("hero-left" or "product-detail") && page.HeroImage is not null) Error($"Template '{page.Template}' does not consume hero_image.");
        if (page.Template != "hero-left" && (!string.IsNullOrWhiteSpace(page.HeroSummary) || page.HeroActions.Count > 0)) Error($"Template '{page.Template}' does not consume hero fields.");
        if (page.Template != "sidebar" && page.RelatedPages.Count > 0) Error($"Template '{page.Template}' does not consume related_pages.");
        if (page.Template != "card-grid" && page.CollectionPages.Count > 0) Error($"Template '{page.Template}' does not consume collection_pages.");
        if (page.Template != "article" && (!string.IsNullOrWhiteSpace(page.Attribution) || !string.IsNullOrWhiteSpace(page.SourceDate) || page.SourceDateUnknown)) Error($"Template '{page.Template}' does not consume article fields.");
        if (page.Template != "product-detail" && !string.IsNullOrWhiteSpace(page.ProductId)) Error($"Template '{page.Template}' does not consume product_id.");
    }

    private static void ValidateHeadings(MarkdownDocument document, Action<string> error)
    {
        var previousLevel = 1;
        foreach (var heading in EnumerateHeadings(document))
        {
            var line = heading.Line >= 0 ? $" at line {heading.Line + 1}" : "";
            if (heading.Level == 1)
                error($"Markdown heading{line} is H1; the template owns the only H1.");
            else if (heading.Level > previousLevel + 1)
                error($"Markdown heading{line} skips from H{previousLevel} to H{heading.Level}; headings must begin at H2 and increase by at most one level.");
            previousLevel = heading.Level;
        }
    }

    private static IEnumerable<HeadingBlock> EnumerateHeadings(ContainerBlock container)
    {
        foreach (var block in container)
        {
            if (block is HeadingBlock heading) yield return heading;
            if (block is ContainerBlock nested)
                foreach (var descendant in EnumerateHeadings(nested)) yield return descendant;
        }
    }

    private static void ValidateComponent(ComponentRecord component, Action<string> error)
    {
        var data = component.Data ?? [];
        bool Missing(string key) => !data.TryGetValue(key, out var value) || string.IsNullOrWhiteSpace(value);
        if (component.Id == "notice" && Missing("text")) error("Component 'notice' requires data.text.");
        if (component.Id == "media" && Missing("alt")) error("Component 'media' requires data.alt.");
        if (component.Id == "callout" && (Missing("heading") || Missing("body"))) error("Component 'callout' requires data.heading and data.body.");
        if (component.Id == "status" && Missing("text")) error("Component 'status' requires data.text.");
        if (component.Id == "media" && data.TryGetValue("state", out var mediaState) && mediaState is not ("available" or "missing")) error($"Unknown media state '{mediaState}'.");
        if (component.Id == "feed-fallback" && data.TryGetValue("status", out var feedState) && feedState is not ("available" or "loading" or "failed")) error($"Unknown feed state '{feedState}'.");
        if (component.Id == "callout" && data.TryGetValue("tone", out var calloutTone) && calloutTone is not ("info" or "success" or "warning" or "error")) error($"Unknown callout tone '{calloutTone}'.");
        if (component.Id == "status" && data.TryGetValue("tone", out var statusTone) && statusTone is not ("neutral" or "available" or "limited" or "planned" or "unverified" or "success" or "warning" or "error")) error($"Unknown status tone '{statusTone}'.");
        var known = component.Id switch
        {
            "notice" => new[] { "text" },
            "media" => new[] { "assetId", "alt", "caption", "credit", "state" },
            "feed-fallback" => new[] { "heading", "message", "status" },
            "callout" => new[] { "heading", "body", "tone" },
            "status" => new[] { "text", "tone" },
            _ => []
        };
        foreach (var key in data.Keys.Where(x => !known.Contains(x, StringComparer.Ordinal)).Order(StringComparer.Ordinal))
            error($"Component '{component.Id}' has unknown data field '{key}'.");
    }

    private static void ValidateReferences(List<(string File, PageFrontMatter Meta, string Body, MarkdownDocument Document, string Hash)> pages, SiteDefinition site, List<string> errors)
    {
        var ids = pages.Select(x => x.Meta.Id).ToHashSet(StringComparer.Ordinal);
        var products = (site.Products ?? []).Select(x => x.Id).ToHashSet(StringComparer.Ordinal);
        var assets = site.Assets.Select(x => x.Id).ToHashSet(StringComparer.Ordinal);
        foreach (var candidate in pages)
        {
            var references = candidate.Meta.RelatedPages.Concat(candidate.Meta.CollectionPages).Concat(candidate.Meta.HeroActions.Select(x => x.PageId));
            foreach (var id in references.Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal))
            {
                if (!ids.Contains(id)) errors.Add($"{candidate.File}: unresolved page reference '{id}'.");
                else if (!candidate.Meta.Dependencies.Contains(id, StringComparer.Ordinal)) errors.Add($"{candidate.File}: referenced page '{id}' must be declared as a dependency.");
            }
            if (candidate.Meta.ProductId is not null && !products.Contains(candidate.Meta.ProductId)) errors.Add($"{candidate.File}: unresolved product reference '{candidate.Meta.ProductId}'.");
            foreach (var component in candidate.Meta.Components.Where(x => x.Id == "media" && x.Data.TryGetValue("assetId", out var id) && !string.IsNullOrWhiteSpace(id)))
                if (!assets.Contains(component.Data["assetId"])) errors.Add($"{candidate.File}: unresolved component asset '{component.Data["assetId"]}'.");
        }
    }

    private static void ValidateDependencies(List<(string File, PageFrontMatter Meta, string Body, MarkdownDocument Document, string Hash)> pages, List<string> errors)
    {
        var byId = pages.GroupBy(x => x.Meta.Id, StringComparer.Ordinal).Where(x => x.Count() == 1)
            .ToDictionary(x => x.Key, x => x.Single().Meta, StringComparer.Ordinal);
        foreach (var page in pages)
            foreach (var dependency in page.Meta.Dependencies)
                if (!byId.ContainsKey(dependency)) errors.Add($"{page.File}: missing dependency '{dependency}'.");

        var visiting = new HashSet<string>(StringComparer.Ordinal);
        var visited = new HashSet<string>(StringComparer.Ordinal);
        bool Visit(string id)
        {
            if (!visiting.Add(id)) return true;
            if (visited.Contains(id)) { visiting.Remove(id); return false; }
            if (byId.TryGetValue(id, out var page))
                foreach (var dependency in page.Dependencies)
                    if (byId.ContainsKey(dependency) && Visit(dependency)) return true;
            visiting.Remove(id); visited.Add(id); return false;
        }
        foreach (var id in byId.Keys.Order(StringComparer.Ordinal))
            if (Visit(id)) { errors.Add($"Dependency cycle includes '{id}'."); break; }
    }

    private static Dictionary<string, IReadOnlyList<ApprovalRecord>> ValidateApprovals(
        ApprovalLedger? ledger,
        List<(string File, PageFrontMatter Meta, string Body, MarkdownDocument Document, string Hash)> pages,
        List<string> errors)
    {
        if (ledger is null) return [];
        if (ledger.SchemaVersion != ContentContract.SchemaVersion) errors.Add("Approval ledger schemaVersion is incompatible.");
        AddDuplicateValues(ledger.AuthorizedReviewers, errors, "authorized reviewer");
        AddDuplicateValues(ledger.Approvals.Select(x => x.Id), errors, "approval id");
        foreach (var duplicate in ledger.Approvals.GroupBy(x => (x.PageId, x.Purpose)).Where(x => x.Count() > 1))
            errors.Add($"Duplicate approval purpose '{duplicate.Key.Purpose}' for page '{duplicate.Key.PageId}'.");

        var pageIds = pages.Select(x => x.Meta.Id).ToHashSet(StringComparer.Ordinal);
        foreach (var approval in ledger.Approvals)
        {
            if (!IdPattern().IsMatch(approval.Id)) errors.Add($"Approval ID '{approval.Id}' is invalid.");
            if (!pageIds.Contains(approval.PageId)) errors.Add($"Approval '{approval.Id}' references unknown page '{approval.PageId}'.");
            if (approval.Purpose is not ("content-publication" or "archive-publication")) errors.Add($"Approval '{approval.Id}' has unknown purpose '{approval.Purpose}'.");
            if (string.IsNullOrWhiteSpace(approval.Reviewer) || !ledger.AuthorizedReviewers.Contains(approval.Reviewer, StringComparer.Ordinal))
                errors.Add($"Approval '{approval.Id}' has an unauthorized reviewer.");
            if (!DateTimeOffset.TryParseExact(approval.ReviewedAt, "O", CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
                errors.Add($"Approval '{approval.Id}' reviewedAt must be an ISO-8601 round-trip timestamp.");
            if (string.IsNullOrWhiteSpace(approval.DecisionEvidence)) errors.Add($"Approval '{approval.Id}' requires decision evidence.");
            if (!Sha256Pattern().IsMatch(approval.ContentHash) || !Sha256Pattern().IsMatch(approval.SourceHash))
                errors.Add($"Approval '{approval.Id}' contains an invalid hash.");
        }
        return ledger.Approvals.GroupBy(x => x.PageId, StringComparer.Ordinal)
            .ToDictionary(x => x.Key, x => (IReadOnlyList<ApprovalRecord>)x.OrderBy(a => a.Purpose, StringComparer.Ordinal).ToArray(), StringComparer.Ordinal);
    }

    private static bool IsPublicationCandidate(PageFrontMatter page) =>
        page.Published && page.Visibility is "public" or "private-preview" && page.Status is "approved" or "archived";

    private static ResolvedTemplateData ResolveTemplateData(
        PageFrontMatter page,
        IReadOnlyDictionary<string, (string File, PageFrontMatter Meta, string Body, MarkdownDocument Document, string Hash, IReadOnlyList<ApprovalRecord> Approvals)> eligible,
        SiteDefinition site)
    {
        ResolvedLink Link(string id, string? text = null, string variant = "quiet")
        {
            var target = eligible[id].Meta;
            return new(id, text ?? target.Title, target.Route, variant);
        }
        ResolvedMedia? Hero() => page.HeroImage is null ? null : ResolveMedia(site, page.HeroImage,
            $"Synthetic visual for {page.Title}", "Private deterministic fixture", $"{site.Name} synthetic fixture", "available");
        return page.Template switch
        {
            "full-width" => new FullWidthTemplateData(),
            "hero-left" => new HeroLeftTemplateData(page.HeroSummary!, Hero(), page.HeroActions.Select(x => Link(x.PageId, x.Text, x.Variant)).ToArray()),
            "sidebar" => new SidebarTemplateData(page.RelatedPages.Select(x => Link(x)).ToArray()),
            "card-grid" => new CardGridTemplateData(page.CollectionPages.Select(x => eligible[x].Meta)
                .Select(x => new ResolvedCard(x.Id, x.Title, x.Description, x.Route)).ToArray()),
            "article" => new ArticleTemplateData(page.Attribution!, page.SourceDate, page.SourceDateUnknown, page.PublicArchiveLabel),
            "product-detail" => ResolveProduct(page, site, Hero()),
            _ => throw new InvalidOperationException($"Template registry did not resolve '{page.Template}'.")
        };
    }

    private static ProductDetailTemplateData ResolveProduct(PageFrontMatter page, SiteDefinition site, ResolvedMedia? media)
    {
        var product = (site.Products ?? []).Single(x => x.Id == page.ProductId);
        var capabilities = (site.Capabilities ?? []).ToDictionary(x => x.Id, StringComparer.Ordinal);
        return new(new(product.Id, product.Name, product.Summary, product.Status),
            product.CapabilityIds.Select(x => capabilities[x]).Select(x => new ResolvedCapability(x.Id, x.Name, x.Description, x.Status)).ToArray(), media);
    }

    private static IReadOnlyList<ResolvedBlock> ResolveBlocks(PageFrontMatter page, SiteDefinition site) =>
        page.Components.Select(component => component.Id switch
        {
            "notice" => (ResolvedBlock)new NoticeBlock(component.Slot, component.Data["text"]),
            "media" => new MediaBlock(component.Slot, ResolveMedia(site,
                component.Data.GetValueOrDefault("assetId"), component.Data["alt"], component.Data.GetValueOrDefault("caption"),
                component.Data.GetValueOrDefault("credit"), component.Data.GetValueOrDefault("state", "missing"))),
            "feed-fallback" => new FeedFallbackBlock(component.Slot, component.Data.GetValueOrDefault("heading", "Latest work"),
                component.Data.GetValueOrDefault("message", "Live updates are unavailable. The core page remains usable."), component.Data.GetValueOrDefault("status", "failed")),
            "callout" => new CalloutBlock(component.Slot, component.Data["heading"], component.Data["body"], component.Data.GetValueOrDefault("tone", "info")),
            "status" => new StatusBlock(component.Slot, component.Data["text"], component.Data.GetValueOrDefault("tone", "neutral")),
            _ => throw new InvalidOperationException($"Component registry did not resolve '{component.Id}'.")
        }).ToArray();

    private static ResolvedMedia ResolveMedia(SiteDefinition site, string? assetId, string alt, string? caption, string? credit, string state)
    {
        var asset = assetId is null ? null : site.Assets.SingleOrDefault(x => x.Id == assetId);
        return new(assetId ?? "missing", asset?.Path ?? "", alt, caption, credit, asset is null ? "missing" : state);
    }

    public static IReadOnlyList<string> ValidateBundle(ContentBundle bundle, bool privateReview = false)
    {
        var errors = new List<string>();
        AddMissingBundleScalar(bundle.Format, "format", errors);
        AddMissingBundleScalar(bundle.SiteId, "siteId", errors);
        AddMissingBundleScalar(bundle.SiteName, "siteName", errors);
        AddMissingBundleScalar(bundle.BaseUrl, "baseUrl", errors);
        AddMissingBundleScalar(bundle.DefaultPalette, "defaultPalette", errors);
        AddMissingBundleScalar(bundle.AssetNamespace, "assetNamespace", errors);
        AddMissingBundleScalar(bundle.ManifestHash, "manifestHash", errors);
        if (bundle.Format != (privateReview ? ContentContract.PrivateReviewBundleFormat : ContentContract.BundleFormat) || bundle.SchemaVersion != ContentContract.SchemaVersion)
            errors.Add("Content bundle format or schemaVersion is incompatible.");
        if (!string.IsNullOrWhiteSpace(bundle.ManifestHash) && (!Sha256Pattern().IsMatch(bundle.ManifestHash) ||
            !StringComparer.OrdinalIgnoreCase.Equals(bundle.ManifestHash, ComputeManifestHash(bundle))))
            errors.Add("Content bundle manifest hash is invalid.");
        if (bundle.Hostnames is null || bundle.Assets is null || bundle.Pages is null)
        {
            errors.Add("Content bundle is missing required collections.");
            return errors.Order(StringComparer.Ordinal).ToArray();
        }

        if (errors.Any(x => x.StartsWith("Content bundle is missing required scalar", StringComparison.Ordinal)))
            return errors.Order(StringComparer.Ordinal).ToArray();

        var siteErrorCount = errors.Count;
        ValidateSite(new SiteDefinition(bundle.SchemaVersion, bundle.SiteId, bundle.SiteName, bundle.BaseUrl,
            bundle.DefaultPalette, bundle.AssetNamespace, bundle.Hostnames, bundle.Assets, bundle.Capabilities, bundle.Products), errors);
        // Deserialized JSON can violate nullable annotations. Never traverse invalid
        // registry entries or nested rendering data during closure checks or requests.
        if (errors.Count != siteErrorCount) return errors.Order(StringComparer.Ordinal).ToArray();
        AddDuplicateValues(bundle.Pages.Where(x => x is not null && !string.IsNullOrWhiteSpace(x.Id)).Select(x => x.Id), errors, "bundle page id");
        AddDuplicateValues(bundle.Pages.Where(x => x is not null && !string.IsNullOrWhiteSpace(x.Route)).Select(x => x.Route), errors, "bundle route");
        foreach (var page in bundle.Pages)
        {
            if (page is null) { errors.Add("Content bundle contains a null page."); continue; }
            var pageScalarErrors = errors.Count;
            AddMissingPageScalar(page.Id, "id", errors);
            AddMissingPageScalar(page.Kind, "kind", errors);
            AddMissingPageScalar(page.Title, "title", errors);
            AddMissingPageScalar(page.Description, "description", errors);
            AddMissingPageScalar(page.Route, "route", errors);
            AddMissingPageScalar(page.Template, "template", errors);
            AddMissingPageScalar(page.Palette, "palette", errors);
            AddMissingPageScalar(page.CanonicalUrl, "canonicalUrl", errors);
            AddMissingPageScalar(page.Html, "html", errors);
            AddMissingPageScalar(page.ContentHash, "contentHash", errors);
            AddMissingPageScalar(page.ApprovalHash, "approvalHash", errors);
            if (page.TemplateData is null || page.Blocks is null)
            {
                if (page.TemplateData is null) errors.Add($"Bundle page '{page.Id}' is missing resolved template data.");
                if (page.Blocks is null) errors.Add($"Bundle page '{page.Id}' is missing resolved blocks.");
                continue;
            }
            if (errors.Count != pageScalarErrors) continue;
            if (!IdPattern().IsMatch(page.Id)) errors.Add($"Bundle page ID '{page.Id}' is invalid.");
            if (!RoutePattern().IsMatch(page.Route) || page.Route.Contains("..", StringComparison.Ordinal)) errors.Add($"Bundle page '{page.Id}' has an invalid route.");
            if (!ContentRegistries.TemplateContracts.TryGetValue(page.Template, out var templateContract)) errors.Add($"Bundle page '{page.Id}' has an unknown template.");
            else if (!TemplateDataMatches(page.Template, page.TemplateData)) errors.Add($"Bundle page '{page.Id}' template data does not match template '{page.Template}'.");
            if (!ContentRegistries.Palettes.Contains(page.Palette)) errors.Add($"Bundle page '{page.Id}' has an unknown palette.");
            if (!Sha256Pattern().IsMatch(page.ContentHash) || !Sha256Pattern().IsMatch(page.ApprovalHash)) errors.Add($"Bundle page '{page.Id}' has an invalid content or approval hash.");
            if (page.Components is null || page.Sources is null) { errors.Add($"Bundle page '{page.Id}' is missing required collections."); continue; }
            foreach (var component in page.Components)
            {
                if (component is null) { errors.Add($"Bundle page '{page.Id}' contains a null component."); continue; }
                if (!ContentRegistries.Components.Contains(component.Id)) errors.Add($"Bundle page '{page.Id}' has an unknown component.");
                if (!ContentRegistries.Slots.Contains(component.Slot)) errors.Add($"Bundle page '{page.Id}' has an unknown slot.");
            }
            ValidateResolvedShape(page, errors);
            foreach (var block in page.Blocks.Where(x => x is not null))
                if (templateContract is null || !templateContract.Slots.Contains(block.Slot))
                    errors.Add($"Bundle page '{page.Id}' contains block in invalid slot '{block.Slot}'.");
            foreach (var source in page.Sources)
                if (source is null || string.IsNullOrWhiteSpace(source.Id) || !IdPattern().IsMatch(source.Id) ||
                    string.IsNullOrWhiteSpace(source.Sha256) || !Sha256Pattern().IsMatch(source.Sha256))
                    errors.Add($"Bundle page '{page.Id}' has an invalid source reference.");
            if (!Uri.TryCreate(bundle.BaseUrl, UriKind.Absolute, out var baseUri) ||
                !StringComparer.Ordinal.Equals(page.CanonicalUrl, new Uri(baseUri, page.Route).AbsoluteUri))
                errors.Add($"Bundle page '{page.Id}' has an invalid canonical URL.");
            var sanitized = CreateSanitizer().Sanitize(page.Html ?? "", bundle.BaseUrl);
            if (!StringComparer.Ordinal.Equals(page.Html, sanitized)) errors.Add($"Bundle page '{page.Id}' contains HTML outside the sanitizer policy.");
        }
        if (errors.Count > 0) return errors.Order(StringComparer.Ordinal).ToArray();
        if (!privateReview && bundle.ReviewSourceHashes is not null) errors.Add("Public bundle cannot contain private review identities.");
        if (privateReview)
        {
            if (bundle.ReviewSourceHashes is null || bundle.ReviewSourceHashes.Count != bundle.Pages.Count)
                errors.Add("Private review bundle requires one source identity per page.");
            foreach (var page in bundle.Pages.Where(x => x is not null))
            {
                if (!page.IsPrivatePreview || page.ApprovalHash != new string('0', 64))
                    errors.Add($"Private review page '{page.Id}' must remain private and carry no publication approval.");
                if (bundle.ReviewSourceHashes?.TryGetValue(page.Id, out var sourceHash) != true || !Sha256Pattern().IsMatch(sourceHash ?? ""))
                    errors.Add($"Private review page '{page.Id}' is missing its exact source identity.");
            }
        }
        var referencedProducts = new HashSet<string>(StringComparer.Ordinal);
        var referencedCapabilities = new HashSet<string>(StringComparer.Ordinal);
        var referencedAssets = new HashSet<string>(StringComparer.Ordinal);
        void AddMedia(ResolvedMedia? media)
        {
            if (media is not null && media.AssetId != "missing" && !string.IsNullOrWhiteSpace(media.Path))
                referencedAssets.Add(media.AssetId);
        }
        foreach (var page in bundle.Pages.Where(x => x is not null))
        {
            switch (page.TemplateData)
            {
                case HeroLeftTemplateData hero:
                    AddMedia(hero.Media);
                    break;
                case ProductDetailTemplateData product:
                    referencedProducts.Add(product.Product.Id);
                    foreach (var capability in product.Capabilities) referencedCapabilities.Add(capability.Id);
                    AddMedia(product.Media);
                    break;
            }
            foreach (var media in page.Blocks.OfType<MediaBlock>()) AddMedia(media.Media);
        }
        ValidateExactRegistryClosure("asset", bundle.Assets.Select(x => x.Id), referencedAssets, errors);
        ValidateExactRegistryClosure("capability", (bundle.Capabilities ?? []).Select(x => x.Id), referencedCapabilities, errors);
        ValidateExactRegistryClosure("product", (bundle.Products ?? []).Select(x => x.Id), referencedProducts, errors);
        return errors.Order(StringComparer.Ordinal).ToArray();
    }

    private static void ValidateResolvedShape(CompiledPage page, List<string> errors)
    {
        void Required(object? value, string path)
        {
            if (value is null) errors.Add($"Bundle page '{page.Id}' contains null {path}.");
        }
        void Items<T>(IReadOnlyList<T>? values, string path, Action<T> inspect) where T : class
        {
            Required(values, path);
            if (values is null) return;
            for (var i = 0; i < values.Count; i++)
            {
                Required(values[i], $"{path}[{i}]");
                if (values[i] is not null) inspect(values[i]);
            }
        }
        void Media(ResolvedMedia? media)
        {
            if (media is null) return; // Optional for hero/product; required for a media block below.
            Required(media.AssetId, "media.assetId"); Required(media.Path, "media.path");
            Required(media.Alt, "media.alt"); Required(media.State, "media.state");
        }
        void Link(ResolvedLink link)
        {
            Required(link.PageId, "link.pageId"); Required(link.Text, "link.text");
            Required(link.Route, "link.route"); Required(link.Variant, "link.variant");
        }
        switch (page.TemplateData)
        {
            case HeroLeftTemplateData hero:
                Required(hero.Summary, "hero.summary"); Media(hero.Media); Items(hero.Actions, "hero.actions", Link); break;
            case SidebarTemplateData sidebar: Items(sidebar.Related, "sidebar.related", Link); break;
            case CardGridTemplateData grid:
                Items(grid.Cards, "grid.cards", card => {
                    Required(card.PageId, "card.pageId"); Required(card.Heading, "card.heading");
                    Required(card.Summary, "card.summary"); Required(card.Route, "card.route");
                }); break;
            case ArticleTemplateData article: Required(article.Attribution, "article.attribution"); break;
            case ProductDetailTemplateData product:
                Required(product.Product, "product.product");
                if (product.Product is { } record)
                {
                    Required(record.Id, "product.id"); Required(record.Name, "product.name");
                    Required(record.Summary, "product.summary"); Required(record.Status, "product.status");
                }
                Items(product.Capabilities, "product.capabilities", capability => {
                    Required(capability.Id, "capability.id"); Required(capability.Name, "capability.name");
                    Required(capability.Description, "capability.description"); Required(capability.Status, "capability.status");
                }); Media(product.Media); break;
        }
        Items(page.Blocks, "blocks", block => {
            Required(block.Slot, "block.slot");
            switch (block)
            {
                case MediaBlock media: Required(media.Media, "block.media"); Media(media.Media); break;
                case NoticeBlock notice: Required(notice.Text, "notice.text"); break;
                case FeedFallbackBlock feed:
                    Required(feed.Heading, "feed.heading"); Required(feed.Message, "feed.message"); Required(feed.Status, "feed.status"); break;
                case CalloutBlock callout:
                    Required(callout.Heading, "callout.heading"); Required(callout.Body, "callout.body"); Required(callout.Tone, "callout.tone"); break;
                case StatusBlock status: Required(status.Text, "status.text"); Required(status.Tone, "status.tone"); break;
            }
        });
    }

    private static void ValidateExactRegistryClosure(string kind, IEnumerable<string> actualIds, IReadOnlySet<string> referencedIds, List<string> errors)
    {
        var actual = actualIds.ToHashSet(StringComparer.Ordinal);
        foreach (var id in actual.Except(referencedIds, StringComparer.Ordinal).Order(StringComparer.Ordinal))
            errors.Add($"Content bundle contains unreferenced {kind} metadata '{id}'.");
        foreach (var id in referencedIds.Except(actual, StringComparer.Ordinal).Order(StringComparer.Ordinal))
            errors.Add($"Content bundle is missing referenced {kind} metadata '{id}'.");
    }

    private static bool TemplateDataMatches(string template, ResolvedTemplateData data) => (template, data) switch
    {
        ("full-width", FullWidthTemplateData) => true,
        ("hero-left", HeroLeftTemplateData) => true,
        ("sidebar", SidebarTemplateData) => true,
        ("card-grid", CardGridTemplateData) => true,
        ("article", ArticleTemplateData) => true,
        ("product-detail", ProductDetailTemplateData) => true,
        _ => false
    };

    private static void AddMissingBundleScalar(string? value, string name, List<string> errors)
    {
        if (string.IsNullOrWhiteSpace(value)) errors.Add($"Content bundle is missing required scalar '{name}'.");
    }

    private static void AddMissingPageScalar(string? value, string name, List<string> errors)
    {
        if (string.IsNullOrWhiteSpace(value)) errors.Add($"Content bundle page is missing required scalar '{name}'.");
    }

    private static HtmlSanitizer CreateSanitizer()
    {
        var sanitizer = new HtmlSanitizer();
        sanitizer.AllowedSchemes.Clear();
        sanitizer.AllowedSchemes.Add("https");
        sanitizer.AllowedSchemes.Add("mailto");
        sanitizer.AllowedSchemes.Add("tel");
        sanitizer.AllowedAttributes.Remove("style");
        sanitizer.AllowedAttributes.Remove("id");
        sanitizer.KeepChildNodes = true;
        return sanitizer;
    }

    private static void AddDuplicates<T>(IEnumerable<T> items, List<string> errors, Func<T, string> selector, string kind) =>
        AddDuplicateValues(items.Select(selector), errors, kind);

    private static void AddDuplicateValues(IEnumerable<string> values, List<string> errors, string kind)
    {
        foreach (var value in values.GroupBy(x => x, StringComparer.Ordinal).Where(x => x.Count() > 1).Select(x => x.Key).Order(StringComparer.Ordinal))
            errors.Add($"Duplicate {kind} '{value}'.");
    }

    public static IReadOnlyList<string> ValidateSiteSet(IEnumerable<SiteDefinition> sites)
    {
        var list = sites.ToArray();
        var errors = new List<string>();
        AddDuplicateValues(list.Select(x => x.SiteId), errors, "site id");
        AddDuplicateValues(list.SelectMany(x => x.Hostnames), errors, "hostname");
        return errors;
    }

    [GeneratedRegex("^[a-z][a-z0-9-]{1,63}$", RegexOptions.CultureInvariant)] private static partial Regex IdPattern();
    [GeneratedRegex("^/$|^/(?:[a-z0-9]+(?:-[a-z0-9]+)*/)+$", RegexOptions.CultureInvariant)] private static partial Regex RoutePattern();
    [GeneratedRegex("^(?:[a-zA-Z0-9_-]+/)*[a-zA-Z0-9_.-]+$", RegexOptions.CultureInvariant)] private static partial Regex SafeAssetPath();
    [GeneratedRegex("^[a-fA-F0-9]{64}$", RegexOptions.CultureInvariant)] private static partial Regex Sha256Pattern();
    [GeneratedRegex(@"(?i)(?:http|javascript|data|vbscript|file)\s*:")] private static partial Regex UnsafeUrl();
    [GeneratedRegex(@"\]\(\s*//", RegexOptions.CultureInvariant)] private static partial Regex ProtocolRelativeUrl();
    [GeneratedRegex(@"(?:\.\.[/\\]|[/\\]\.\.)")] private static partial Regex Traversal();
}
