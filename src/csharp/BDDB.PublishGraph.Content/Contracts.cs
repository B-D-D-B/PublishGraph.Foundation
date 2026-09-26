using System.Text.Json.Serialization;

namespace BDDB.PublishGraph.Content;

public static class ContentContract
{
    public const int SchemaVersion = 1;
    public const string BundleFormat = "sda-content-bundle-v1";
    public const string PrivateReviewBundleFormat = "sda-private-review-bundle-v1";
}

public sealed record SiteDefinition(
    int SchemaVersion,
    string SiteId,
    string Name,
    string BaseUrl,
    string DefaultPalette,
    string AssetNamespace,
    IReadOnlyList<string> Hostnames,
    IReadOnlyList<AssetDefinition> Assets,
    IReadOnlyList<CapabilityDefinition>? Capabilities = null,
    IReadOnlyList<ProductDefinition>? Products = null);

public sealed record AssetDefinition(string Id, string Path, string MediaType, string Sha256);
public sealed record CapabilityDefinition(string Id, string Name, string Description, string Status);
public sealed record ProductDefinition(string Id, string Name, string Summary, string Status, IReadOnlyList<string> CapabilityIds);
public sealed record ActionReference
{
    public string PageId { get; init; } = "";
    public string Text { get; init; } = "";
    public string Variant { get; init; } = "primary";
}

public sealed record SourceReference
{
    public string Id { get; init; } = "";
    public string Revision { get; init; } = "";
    public string Sha256 { get; init; } = "";
    public SourceReference() { }
    public SourceReference(string id, string revision, string sha256) => (Id, Revision, Sha256) = (id, revision, sha256);
}

public sealed record ApprovalRecord(
    string Id,
    string PageId,
    string Purpose,
    string Reviewer,
    string ReviewedAt,
    string DecisionEvidence,
    string ContentHash,
    string SourceHash);

public sealed record ApprovalLedger(
    int SchemaVersion,
    IReadOnlyList<string> AuthorizedReviewers,
    IReadOnlyList<ApprovalRecord> Approvals);

public sealed record ComponentRecord
{
    public string Id { get; init; } = "";
    public string Slot { get; init; } = "";
    public Dictionary<string, string> Data { get; init; } = [];
}

public sealed record PageFrontMatter
{
    public int SchemaVersion { get; init; }
    public string Id { get; init; } = "";
    public string Kind { get; init; } = "";
    public string Title { get; init; } = "";
    public string Description { get; init; } = "";
    public string Route { get; init; } = "";
    public string Template { get; init; } = "";
    public string ColorPalette { get; init; } = "";
    public string HeaderStyle { get; init; } = "";
    public string FooterStyle { get; init; } = "";
    public string? HeroImage { get; init; }
    public string? Eyebrow { get; init; }
    public string? HeroSummary { get; init; }
    public List<ActionReference> HeroActions { get; init; } = [];
    public List<string> RelatedPages { get; init; } = [];
    public List<string> CollectionPages { get; init; } = [];
    public string? Attribution { get; init; }
    public string? SourceDate { get; init; }
    public bool SourceDateUnknown { get; init; }
    public string? ProductId { get; init; }
    public List<ComponentRecord> Components { get; init; } = [];
    public bool Published { get; init; }
    public string Visibility { get; init; } = "";
    public string Status { get; init; } = "";
    public string? PublicArchiveLabel { get; init; }
    public int Order { get; init; }
    public List<string> Dependencies { get; init; } = [];
    public List<SourceReference> Sources { get; init; } = [];
}

public sealed record ResolvedLink(string PageId, string Text, string Route, string Variant = "quiet");
public sealed record ResolvedMedia(string AssetId, string Path, string Alt, string? Caption, string? Credit, string State);
public sealed record ResolvedCard(string PageId, string Heading, string Summary, string Route);
public sealed record ResolvedCapability(string Id, string Name, string Description, string Status);
public sealed record ResolvedProduct(string Id, string Name, string Summary, string Status);

[JsonPolymorphic(TypeDiscriminatorPropertyName = "$template")]
[JsonDerivedType(typeof(FullWidthTemplateData), "full-width")]
[JsonDerivedType(typeof(HeroLeftTemplateData), "hero-left")]
[JsonDerivedType(typeof(SidebarTemplateData), "sidebar")]
[JsonDerivedType(typeof(CardGridTemplateData), "card-grid")]
[JsonDerivedType(typeof(ArticleTemplateData), "article")]
[JsonDerivedType(typeof(ProductDetailTemplateData), "product-detail")]
public abstract record ResolvedTemplateData;
public sealed record FullWidthTemplateData : ResolvedTemplateData;
public sealed record HeroLeftTemplateData(string Summary, ResolvedMedia? Media, IReadOnlyList<ResolvedLink> Actions) : ResolvedTemplateData;
public sealed record SidebarTemplateData(IReadOnlyList<ResolvedLink> Related) : ResolvedTemplateData;
public sealed record CardGridTemplateData(IReadOnlyList<ResolvedCard> Cards) : ResolvedTemplateData;
public sealed record ArticleTemplateData(string Attribution, string? SourceDate, bool SourceDateUnknown, string? ArchiveLabel) : ResolvedTemplateData;
public sealed record ProductDetailTemplateData(ResolvedProduct Product, IReadOnlyList<ResolvedCapability> Capabilities, ResolvedMedia? Media) : ResolvedTemplateData;

[JsonPolymorphic(TypeDiscriminatorPropertyName = "$block")]
[JsonDerivedType(typeof(NoticeBlock), "notice")]
[JsonDerivedType(typeof(MediaBlock), "media")]
[JsonDerivedType(typeof(FeedFallbackBlock), "feed-fallback")]
[JsonDerivedType(typeof(CalloutBlock), "callout")]
[JsonDerivedType(typeof(StatusBlock), "status")]
public abstract record ResolvedBlock(string Slot);
public sealed record NoticeBlock(string Slot, string Text) : ResolvedBlock(Slot);
public sealed record MediaBlock(string Slot, ResolvedMedia Media) : ResolvedBlock(Slot);
public sealed record FeedFallbackBlock(string Slot, string Heading, string Message, string Status) : ResolvedBlock(Slot);
public sealed record CalloutBlock(string Slot, string Heading, string Body, string Tone) : ResolvedBlock(Slot);
public sealed record StatusBlock(string Slot, string Text, string Tone) : ResolvedBlock(Slot);

public sealed record CompiledPage(
    string Id,
    string Kind,
    string Title,
    string Description,
    string Route,
    string Template,
    string Palette,
    string CanonicalUrl,
    string Html,
    IReadOnlyList<ComponentRecord> Components,
    IReadOnlyList<SourceReference> Sources,
    string ContentHash,
    string ApprovalHash,
    string? Eyebrow,
    ResolvedTemplateData TemplateData,
    IReadOnlyList<ResolvedBlock> Blocks,
    bool IsPrivatePreview);

public sealed record ContentBundle(
    string Format,
    int SchemaVersion,
    string SiteId,
    string SiteName,
    string BaseUrl,
    string DefaultPalette,
    string AssetNamespace,
    IReadOnlyList<string> Hostnames,
    IReadOnlyList<AssetDefinition> Assets,
    IReadOnlyList<CompiledPage> Pages,
    string ManifestHash,
    IReadOnlyList<CapabilityDefinition>? Capabilities = null,
    IReadOnlyList<ProductDefinition>? Products = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyDictionary<string, string>? ReviewSourceHashes = null);

public sealed record CompilationResult(ContentBundle? Bundle, IReadOnlyList<string> Errors, IReadOnlyList<string> Exclusions)
{
    [JsonIgnore] public bool Success => Bundle is not null && Errors.Count == 0;
}

public sealed class ContentCompilationException(IReadOnlyList<string> errors)
    : Exception(string.Join(Environment.NewLine, errors))
{
    public IReadOnlyList<string> Errors { get; } = errors;
}
