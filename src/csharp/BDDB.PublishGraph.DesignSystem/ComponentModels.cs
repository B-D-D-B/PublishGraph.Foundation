using Microsoft.AspNetCore.Html;
using BDDB.PublishGraph.Content;

namespace BDDB.PublishGraph.DesignSystem;

public sealed record LinkItem(string Text, string Href, bool IsCurrent = false);
public sealed record LinkGroup(string Heading, IReadOnlyList<LinkItem> Links);
public sealed record AnnouncementModel(string Text, LinkItem? Action = null);
public sealed record FeedShowcaseModel(string Heading, string Status, string Message, IReadOnlyList<LinkItem> Items);
public sealed record ShellModel(
    string SiteName,
    string HomeUrl,
    string? Tagline,
    AnnouncementModel? Announcement,
    IReadOnlyList<LinkItem> Navigation,
    IReadOnlyList<LinkItem> Breadcrumbs,
    IReadOnlyList<LinkGroup> FooterGroups,
    IReadOnlyList<LinkItem> SocialLinks,
    string Credits,
    FeedShowcaseModel? Feed);

public enum MediaAspectRatio
{
    Landscape16x9,
    Portrait3x4,
    Panorama3x1,
    Standard4x3,
    Square1x1
}

public sealed record MediaFrameModel(
    string AssetId,
    MediaAspectRatio AspectRatio,
    string Alt,
    string? Caption,
    string? Credit,
    string State = "available",
    string? Source = null);

public static class AssetRoute
{
    public static string For(string assetNamespace, string assetId) =>
        $"/assets/{Uri.EscapeDataString(assetNamespace)}/{Uri.EscapeDataString(assetId)}";
}

public sealed record ActionLinkModel(string Text, string Href, string Variant = "primary", bool Disabled = false);
public sealed record ButtonModel(string Text, string Variant = "primary", bool Disabled = false);
public sealed record CardModel(string Heading, string Summary, string Eyebrow, MediaFrameModel? Media, ActionLinkModel? Action);
public sealed record CardGridModel(string Heading, IReadOnlyList<CardModel> Cards);
public sealed record MediaTextModel(string Heading, string Body, MediaFrameModel Media, ActionLinkModel? Action, bool MediaAfter = false);
public sealed record NarrativeSectionModel(string Eyebrow, string Heading, string Body, string Tone = "default");
public sealed record AudienceCardModel(string Audience, string Heading, string Summary, IReadOnlyList<LinkItem> Links);
public sealed record ArtworkStripModel(string Heading, IReadOnlyList<MediaFrameModel> Items);
public sealed record CalloutModel(string Heading, string Body, string Tone = "info");
public sealed record StatusBadgeModel(string Text, string Tone = "neutral");
public sealed record FormFieldModel(string Id, string Label, string Type, string? Hint = null, string? Error = null, bool Disabled = false, bool Required = false);
public sealed record ContactFormModel(
    string FormId,
    string Heading,
    string Description,
    IReadOnlyList<FormFieldModel> Fields,
    string State = "default",
    string? FocusedFieldId = null);

public sealed record PageHeadingModel(string Eyebrow, string Title, string Description);
public sealed record MarkdownBodyModel(HtmlString Html);
public sealed record HeroModel(string Summary, MediaFrameModel? Media, IReadOnlyList<ActionLinkModel> Actions);
public sealed record RelatedLinksModel(string Heading, IReadOnlyList<ResolvedLink> Links);
public sealed record ArticleHeaderModel(string Attribution, string? SourceDate, bool SourceDateUnknown, string? ArchiveLabel);
public sealed record CapabilitiesModel(ResolvedProduct Product, IReadOnlyList<ResolvedCapability> Capabilities);
public sealed record BlocksModel(IReadOnlyList<ResolvedBlock> Blocks, string Slot, string AssetNamespace);

public sealed record SpecimenViewModel(
    string SiteId,
    string SiteName,
    string AssetNamespace,
    string Palette,
    ShellModel Shell,
    IReadOnlyList<string> Palettes,
    IReadOnlyList<CardModel> Cards,
    IReadOnlyList<MediaFrameModel> Media,
    IReadOnlyList<MediaTextModel> MediaText,
    IReadOnlyList<NarrativeSectionModel> Narratives,
    IReadOnlyList<AudienceCardModel> Audiences,
    IReadOnlyList<FeedShowcaseModel> Feeds,
    IReadOnlyList<ContactFormModel> Forms);
