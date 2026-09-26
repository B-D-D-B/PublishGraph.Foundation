using BDDB.PublishGraph.Content;

namespace BDDB.PublishGraph.DesignSystem;

public static class TemplateViewRegistry
{
    private static readonly IReadOnlyDictionary<string, (string View, Type Model)> Entries =
        new Dictionary<string, (string, Type)>(StringComparer.Ordinal)
        {
            ["full-width"] = ("~/Views/Templates/FullWidth.cshtml", typeof(FullWidthTemplateData)),
            ["hero-left"] = ("~/Views/Templates/HeroLeft.cshtml", typeof(HeroLeftTemplateData)),
            ["sidebar"] = ("~/Views/Templates/Sidebar.cshtml", typeof(SidebarTemplateData)),
            ["card-grid"] = ("~/Views/Templates/CardGrid.cshtml", typeof(CardGridTemplateData)),
            ["article"] = ("~/Views/Templates/Article.cshtml", typeof(ArticleTemplateData)),
            ["product-detail"] = ("~/Views/Templates/ProductDetail.cshtml", typeof(ProductDetailTemplateData))
        };

    public static string Resolve(CompiledPage page)
    {
        if (!Entries.TryGetValue(page.Template, out var entry) || page.TemplateData.GetType() != entry.Model)
            throw new InvalidOperationException($"No registered typed view exists for template '{page.Template}'.");
        return entry.View;
    }

    public static IReadOnlyCollection<string> RegisteredIds => Entries.Keys.ToArray();
}
