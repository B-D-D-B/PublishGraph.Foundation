using Microsoft.AspNetCore.Html;
using BDDB.PublishGraph.Content;

namespace BDDB.PublishGraph.DesignSystem;

public sealed record PageViewModel(
    string SiteId,
    string SiteName,
    string AssetNamespace,
    CompiledPage Page,
    HtmlString Html,
    IReadOnlyList<CompiledPage> Navigation,
    ShellModel Shell);
