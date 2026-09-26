using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Ganss.Xss;
using Markdig;
using Markdig.Renderers;
using Markdig.Syntax;

namespace BDDB.PublishGraph.Content;

// An explicit, additive v2 presentation envelope. The v1 bundle and its hashes are unchanged.
public sealed record RegionRule(string Name, string Kind, bool Required, int Minimum, int Maximum, string[] PermittedKinds);
public sealed record LayoutContract(string Id, int Version, RegionRule[] Regions);
public sealed record RegionBinding(string Name, string Anchor, int HeadingLevel, string[] BlockIds);
public sealed record PageLayoutBinding(string SiteId, string PageId, string Route, string LayoutId, int ContractVersion,
    string Palette, string SourcePageId, string CompleteSourcePageId, RegionBinding[] Regions);
public sealed record LayoutCatalog(int Version, LayoutContract[] Contracts, PageLayoutBinding[] Bindings);
public sealed record RegionSourceBlock(string Id, string Kind, string Markdown);
public sealed record RegionDocument(string PageId, string SourceContentHash, string[] CompleteSourceIds, RegionSourceBlock[] Blocks);
public sealed record CompiledRegionBlock(string Id, string Kind, string Html, string Text);
public sealed record CompiledRegion(string Name, string Kind, string Anchor, int HeadingLevel, CompiledRegionBlock[] Blocks);
public sealed record LayoutIdentity(string ContentAssetHash, string BindingHash, string ContractHash, string SiteLayoutHash);
public sealed record RegionPage(string PageId, string Route, string LayoutId, LayoutIdentity Identity, CompiledRegion[] Regions);
public sealed record RegionBundle(string Format, string SiteId, string BaseManifestHash, RegionPage[] Pages, string ManifestHash);
public sealed record LayoutEnvelope(string Format, ContentBundle Content, RegionBundle Regions);
public sealed record LayoutApproval(string SiteId, string PageId, string Route, LayoutIdentity Identity, string Purpose, string Evidence);
public sealed record LayoutRelease(string RegionManifestHash, LayoutApproval[] Approvals);

public static class RegionCompiler
{
    public const string PrivateFormat = "sda-private-regions-v2";
    public const string PublicFormat = "sda-regions-v2";
    private static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder().DisableHtml().Build();
    public static string Hash<T>(T value) => ContentHasher.Sha256(JsonSerializer.Serialize(value, BundleJson.Options));
    private static void Require(bool condition, string message) { if (!condition) throw new InvalidDataException(message); }
    private static void Shape<T>(T value)
    {
        void Visit(JsonElement element)
        {
            Require(element.ValueKind != JsonValueKind.Null, "Null layout contract/content member.");
            if (element.ValueKind == JsonValueKind.Object) foreach (var property in element.EnumerateObject()) Visit(property.Value);
            if (element.ValueKind == JsonValueKind.Array) foreach (var item in element.EnumerateArray()) Visit(item);
        }
        Visit(JsonSerializer.SerializeToElement(value, BundleJson.Options));
    }
    public static RegionBundle Compile(ContentBundle content, LayoutCatalog catalog, RegionDocument[] documents,
        string siteLayoutHash, bool privateReview, LayoutRelease? release = null)
    {
        Shape(catalog); Shape(documents);
        Require(ContentCompiler.ValidateBundle(content, privateReview).Count == 0, "Invalid base bundle or review boundary.");
        Require(catalog.Version == 2 && catalog.Contracts.Length > 0, "Unknown layout catalog version.");
        Require(Regex.IsMatch(siteLayoutHash, "^[a-f0-9]{64}$"), "Invalid layout identity.");
        Require(documents.Select(x => x.PageId).Distinct().Count() == documents.Length, "Duplicate region document.");
        Require(catalog.Bindings.Select(x => x.PageId).Distinct().Count() == catalog.Bindings.Length, "Duplicate binding.");
        Require(catalog.Contracts.Select(x => (x.Id, x.Version)).Distinct().Count() == catalog.Contracts.Length, "Duplicate contract.");
        Require(documents.Length == catalog.Bindings.Length, "Missing or unused region document.");
        var pages = new List<RegionPage>();
        foreach (var binding in catalog.Bindings)
        {
            var page = content.Pages.SingleOrDefault(x => x.Id == binding.PageId);
            var source = content.Pages.SingleOrDefault(x => x.Id == binding.SourcePageId);
            var document = documents.SingleOrDefault(x => x.PageId == binding.PageId);
            var contract = catalog.Contracts.SingleOrDefault(x => x.Id == binding.LayoutId && x.Version == binding.ContractVersion);
            Require(page is not null && source is not null && document is not null && contract is not null, "Missing page, source, document or incompatible contract.");
            Require(binding.SiteId == content.SiteId && page!.Route == binding.Route && page.Palette == binding.Palette, "Cross-site, route or palette binding mismatch.");
            Require(document!.SourceContentHash == source!.ContentHash, "Stale source/dependency identity.");
            Require(document.Blocks.Select(x => x.Id).Distinct().Count() == document.Blocks.Length, "Duplicate source block.");
            Require(document.Blocks.All(x => Regex.IsMatch(x.Id, "^[a-z0-9][a-z0-9-]{0,79}$") && !string.IsNullOrWhiteSpace(x.Markdown)), "Invalid or empty source block.");
            Require(document.CompleteSourceIds.Distinct().Count() == document.CompleteSourceIds.Length && document.CompleteSourceIds.Length > 0, "Invalid complete source inventory.");
            Require(binding.Regions.Select(x => x.Name).Distinct().Count() == binding.Regions.Length, "Duplicate region.");
            Require(binding.Regions.Select(x => x.Anchor).Distinct().Count() == binding.Regions.Length, "Duplicate stable anchor.");
            Require(contract!.Regions.Select(x => x.Name).Distinct().Count() == contract.Regions.Length, "Duplicate region rule.");
            foreach (var rule in contract.Regions)
                Require(!rule.Required || binding.Regions.Any(x => x.Name == rule.Name), "Missing required region: " + rule.Name);
            var regions = new List<CompiledRegion>();
            var used = new HashSet<string>();
            foreach (var region in binding.Regions)
            {
                var rule = contract.Regions.SingleOrDefault(x => x.Name == region.Name);
                Require(rule is not null && region.BlockIds.Length >= rule.Minimum && region.BlockIds.Length <= rule.Maximum,
                    "Unsupported region or invalid cardinality: " + region.Name);
                Require(Regex.IsMatch(region.Anchor, "^[a-z][a-z0-9-]{1,99}$") && region.HeadingLevel is >= 2 and <= 6, "Invalid trusted anchor/heading context.");
                Require(region.BlockIds.Distinct().Count() == region.BlockIds.Length, "Repeated block within region.");
                var blocks = new List<CompiledRegionBlock>();
                foreach (var id in region.BlockIds)
                {
                    var block = document.Blocks.SingleOrDefault(x => x.Id == id);
                    Require(block is not null && rule!.PermittedKinds.Contains(block.Kind), "Missing or incompatible block: " + id);
                    Require(!Regex.IsMatch(block!.Markdown, @"(?i)<\s*[/!a-z]|!\[|(?:javascript|data|vbscript)\s*:"), "Unsafe authored HTML or media; explicit adapters required.");
                    foreach (Match link in Regex.Matches(block.Markdown, @"\[([^\]]+)\]\(([^)]+)\)"))
                        Require(content.Pages.Any(x => x.Route == link.Groups[2].Value), "Unsupported or ineligible link destination.");
                    used.Add(id);
                    // Heading role is owned by the trusted region, never inferred as a split boundary.
                    var normalized = Regex.Replace(block.Markdown, @"(?m)^>\s?", "");
                    // R3 displays these existing editorial references as label (route), not active historical actions.
                    normalized = Regex.Replace(normalized, @"\[([^\]]+)\]\(([^)]+)\)", "$1 ($2)");
                    if (block.Kind == "heading") normalized = Regex.Replace(normalized, @"(?m)^(\d+)\.\s", "$1\\. ");
                    var documentBody = Markdown.Parse(normalized, Pipeline);
                    // The parser recognizes ATX, setext and nested headings. Preserve their inline
                    // content as paragraphs; only compiled Razor may introduce heading semantics.
                    foreach (var heading in documentBody.Descendants<HeadingBlock>().ToArray())
                    {
                        var parent = heading.Parent!;
                        var inline = heading.Inline;
                        heading.Inline = null;
                        parent[parent.IndexOf(heading)] = new ParagraphBlock { Inline = inline };
                    }
                    using var writer = new StringWriter();
                    var renderer = new HtmlRenderer(writer);
                    Pipeline.Setup(renderer);
                    renderer.Render(documentBody);
                    var html = Sanitize(writer.ToString());
                    var plain = System.Net.WebUtility.HtmlDecode(Regex.Replace(html, "<[^>]+>", "")).Trim();
                    blocks.Add(new(id, block.Kind, html, plain));
                }
                regions.Add(new(region.Name, rule!.Kind, region.Anchor, region.HeadingLevel, blocks.ToArray()));
            }
            Require(document.Blocks.All(x => used.Contains(x.Id) || document.CompleteSourceIds.Contains(x.Id)), "Unused authored content would be discarded.");
            var completeBinding = catalog.Bindings.SingleOrDefault(x => x.PageId == binding.CompleteSourcePageId);
            var completeDocument = documents.SingleOrDefault(x => x.PageId == binding.CompleteSourcePageId);
            Require(completeBinding is not null && completeDocument is not null && completeBinding.SourcePageId == binding.SourcePageId, "Missing complete-source dependency.");
            var complete = completeBinding!.Regions.SingleOrDefault(x => x.Name == "complete-source");
            Require(complete is not null && complete.BlockIds.SequenceEqual(document.CompleteSourceIds), "Complete source missing, reordered or truncated.");
            Require(document.CompleteSourceIds.All(id => document.Blocks.Any(x => x.Id == id) &&
                completeDocument!.Blocks.Any(x => x.Id == id && x == document.Blocks.Single(y => y.Id == id))), "Complete-source content differs across pages.");
            var identity = new LayoutIdentity(Hash(new { Document = document, Page = page!.ContentHash, Source = source.ContentHash, source.Sources,
                Assets = content.Assets, Dependency = binding.CompleteSourcePageId }), Hash(binding), Hash(contract), siteLayoutHash);
            pages.Add(new(page!.Id, page.Route, binding.LayoutId, identity, regions.ToArray()));
        }
        var unsigned = new RegionBundle(privateReview ? PrivateFormat : PublicFormat, content.SiteId, content.ManifestHash, pages.OrderBy(x => x.PageId, StringComparer.Ordinal).ToArray(), "");
        var bundle = unsigned with { ManifestHash = Hash(unsigned) };
        Validate(bundle, content, catalog, siteLayoutHash, privateReview, release);
        return bundle;
    }

    public static void Validate(RegionBundle bundle, ContentBundle content, LayoutCatalog catalog, string layoutHash, bool privateReview, LayoutRelease? release)
    {
        Shape(bundle); Shape(catalog); if (release is not null) Shape(release);
        Require(ContentCompiler.ValidateBundle(content, privateReview).Count == 0, "Invalid base bundle/review boundary.");
        Require(catalog.Version == 2 && bundle.Format == (privateReview ? PrivateFormat : PublicFormat), "Incompatible region format or review mode.");
        Require(bundle.ManifestHash == Hash(bundle with { ManifestHash = "" }) && bundle.BaseManifestHash == content.ManifestHash && bundle.SiteId == content.SiteId, "Region bundle or base identity mismatch.");
        Require(bundle.Pages.Length == catalog.Bindings.Length && bundle.Pages.Select(x => x.PageId).Distinct().Count() == bundle.Pages.Length, "Region page closure mismatch.");
        foreach (var page in bundle.Pages)
        {
            var binding = catalog.Bindings.SingleOrDefault(x => x.PageId == page.PageId);
            Require(binding is not null && binding.SiteId == content.SiteId && binding.Route == page.Route && binding.LayoutId == page.LayoutId, "Untrusted layout binding.");
            var contract = catalog.Contracts.SingleOrDefault(x => x.Id == binding!.LayoutId && x.Version == binding.ContractVersion);
            Require(contract is not null && page.Identity.BindingHash == Hash(binding) && page.Identity.ContractHash == Hash(contract) && page.Identity.SiteLayoutHash == layoutHash, "Stale binding, contract or presentation identity.");
            Require(content.Pages.Any(x => x.Id == page.PageId && x.Route == page.Route && x.Palette == binding!.Palette), "Ineligible or incompatible bound page.");
            Require(page.Regions.Length == binding!.Regions.Length && page.Regions.Select(x => x.Name).Distinct().Count() == page.Regions.Length, "Region closure mismatch.");
            foreach (var region in page.Regions)
            {
                var expected = binding.Regions.SingleOrDefault(x => x.Name == region.Name);
                var rule = contract!.Regions.SingleOrDefault(x => x.Name == region.Name);
                Require(expected is not null && rule is not null && region.Kind == rule.Kind && region.Anchor == expected.Anchor && region.HeadingLevel == expected.HeadingLevel &&
                    region.Blocks.Select(x => x.Id).SequenceEqual(expected.BlockIds), "Incompatible compiled region.");
                Require(region.Blocks.All(x => rule!.PermittedKinds.Contains(x.Kind) && x.Html == Sanitize(x.Html) &&
                    x.Text == System.Net.WebUtility.HtmlDecode(Regex.Replace(x.Html, "<[^>]+>", "")).Trim()), "Unsafe or inconsistent compiled content.");
            }
        }
        if (!privateReview)
        {
            Require(bundle.Pages.All(p => content.Pages.Any(x => x.Id == p.PageId && !x.IsPrivatePreview)), "Private pages cannot acquire public region eligibility.");
            Require(release is not null && release.RegionManifestHash == bundle.ManifestHash, "Exact public region release approval required.");
            Require(release!.Approvals.Length == bundle.Pages.Length, "Publication approval closure mismatch.");
            foreach (var page in bundle.Pages)
            {
                var approvals = release.Approvals.Where(x => x.SiteId == bundle.SiteId && x.PageId == page.PageId).ToArray();
                Require(approvals.Length == 1 && approvals[0].Route == page.Route && approvals[0].Identity == page.Identity &&
                    approvals[0].Purpose == "content-publication" && !string.IsNullOrWhiteSpace(approvals[0].Evidence), "Missing or stale exact publication approval.");
            }
        }
    }
    private static string Sanitize(string html)
    {
        var sanitizer = new HtmlSanitizer();
        sanitizer.AllowedTags.Remove("a"); sanitizer.AllowedTags.Remove("img");
        // Validation compares with this sanitizer, rejecting forged compiled headings even
        // when an attacker recomputes the enclosing manifest and visible-text fields.
        for (var level = 1; level <= 6; level++) sanitizer.AllowedTags.Remove("h" + level);
        sanitizer.AllowedAttributes.Clear(); sanitizer.KeepChildNodes = true;
        return sanitizer.Sanitize(html);
    }
}

public sealed record ArtifactFile(string Path, string Sha256);
public sealed record DeploymentReceipt(string Format, string SiteId, string RegionManifestHash, string SiteLayoutHash, ArtifactFile[] Files, string ContentEnvelopeHash = "");
public static class DeploymentVerifier
{
    public static string FileHash(string path) { using var file = File.OpenRead(path); return Convert.ToHexStringLower(SHA256.HashData(file)); }
    // The receipt hash is supplied by trusted deployment configuration, outside both content and webroot.
    public static void Verify(string root, string receiptPath, string trustedReceiptHash, RegionBundle regions, string layoutHash, string? contentEnvelopePath = null)
    {
        VerifyArtifact(root, receiptPath, trustedReceiptHash);
        VerifyBinding(receiptPath, trustedReceiptHash, regions, layoutHash, contentEnvelopePath);
    }
    private static DeploymentReceipt ReadReceipt(string receiptPath, string trustedReceiptHash)
    {
        if (FileHash(receiptPath) != trustedReceiptHash) throw new InvalidDataException("Untrusted deployment receipt.");
        var receipt = JsonSerializer.Deserialize<DeploymentReceipt>(File.ReadAllText(receiptPath), BundleJson.Options)!;
        if (receipt is null || receipt.Files is null || receipt.Files.Any(x => x is null || string.IsNullOrWhiteSpace(x.Path) || string.IsNullOrWhiteSpace(x.Sha256)))
            throw new InvalidDataException("Malformed deployment receipt.");
        if (receipt.Format != "sda-deployment-v2") throw new InvalidDataException("Unsupported deployment receipt.");
        return receipt;
    }
    // Per-site content/release identity is separate from the shared deployment inventory.
    public static void VerifyBinding(string receiptPath, string trustedReceiptHash, RegionBundle regions, string layoutHash, string? contentEnvelopePath = null)
    {
        var receipt = ReadReceipt(receiptPath, trustedReceiptHash);
        if (receipt.SiteId != regions.SiteId || receipt.RegionManifestHash != regions.ManifestHash || receipt.SiteLayoutHash != layoutHash)
            throw new InvalidDataException("Deployment identity mismatch.");
        if (contentEnvelopePath is not null && FileHash(contentEnvelopePath) != receipt.ContentEnvelopeHash)
            throw new InvalidDataException("Deployed content envelope bytes differ from receipt.");
    }
    // This check must run before per-site loading: bad content cannot mask bad shared bytes.
    public static void VerifyArtifact(string root, string receiptPath, string trustedReceiptHash)
    {
        var receipt = ReadReceipt(receiptPath, trustedReceiptHash);
        root = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        void NoLinks(string directory)
        {
            if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("Deployment cannot contain directory links.");
            foreach (var child in Directory.EnumerateDirectories(directory)) NoLinks(child);
        }
        NoLinks(root);
        if (receipt.Files.Length == 0 || receipt.Files.Select(x => x.Path).Distinct(StringComparer.OrdinalIgnoreCase).Count() != receipt.Files.Length)
            throw new InvalidDataException("Invalid deployed file inventory.");
        foreach (var file in receipt.Files)
        {
            var path = Path.GetFullPath(Path.Combine(root, file.Path));
            if (Path.IsPathRooted(file.Path) || !path.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(path) ||
                (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0 || FileHash(path) != file.Sha256)
                throw new InvalidDataException("Deployed byte mismatch: " + file.Path);
        }
        var actual = Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories).Select(x => Path.GetRelativePath(root, x).Replace('\\', '/')).Order(StringComparer.Ordinal).ToArray();
        if (!actual.SequenceEqual(receipt.Files.Select(x => x.Path).Order(StringComparer.Ordinal))) throw new InvalidDataException("Deployment file closure mismatch.");
    }
}
