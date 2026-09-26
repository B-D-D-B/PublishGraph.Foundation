namespace BDDB.PublishGraph.Content;

public static class ContentRegistries
{
    public sealed record TemplateContract(IReadOnlySet<string> Slots);

    public static readonly IReadOnlyDictionary<string, TemplateContract> TemplateContracts =
        new Dictionary<string, TemplateContract>(StringComparer.Ordinal)
    {
        ["full-width"] = new(new HashSet<string>(["beforeBody", "afterBody"], StringComparer.Ordinal)),
        ["hero-left"] = new(new HashSet<string>(["afterHero", "afterBody"], StringComparer.Ordinal)),
        ["sidebar"] = new(new HashSet<string>(["sidebar", "afterBody"], StringComparer.Ordinal)),
        ["card-grid"] = new(new HashSet<string>(["beforeGrid", "afterBody"], StringComparer.Ordinal)),
        ["article"] = new(new HashSet<string>(["afterBody"], StringComparer.Ordinal)),
        ["product-detail"] = new(new HashSet<string>(["afterHero", "afterBody"], StringComparer.Ordinal))
    };
    public static IReadOnlySet<string> Templates { get; } = TemplateContracts.Keys.ToHashSet(StringComparer.Ordinal);

    public static readonly IReadOnlySet<string> Components = new HashSet<string>(StringComparer.Ordinal)
    {
        "notice", "media", "feed-fallback", "callout", "status"
    };

    public static IReadOnlySet<string> Palettes { get; private set; } = new HashSet<string>(["paper", "navy", "ember"], StringComparer.Ordinal);
    // Configure once at process composition, before compiling or loading any content.
    public static void ConfigurePalettes(IEnumerable<string> sitePalettes)
    {
        var values = sitePalettes.ToArray();
        if (values.Any(x => !System.Text.RegularExpressions.Regex.IsMatch(x, "^[a-z][a-z0-9-]{0,63}$")))
            throw new ArgumentException("Invalid palette registration.");
        Palettes = new HashSet<string>(new[] { "paper", "navy", "ember" }.Concat(values), StringComparer.Ordinal);
    }

    public static IReadOnlyDictionary<string, string> LocalReviewOrigins { get; private set; } = new Dictionary<string, string>();
    public static void ConfigureLocalReviewOrigins(IReadOnlyDictionary<string, string> origins)
    {
        if (origins.Any(x => string.IsNullOrWhiteSpace(x.Key) || !System.Text.RegularExpressions.Regex.IsMatch(x.Value, "^[a-z0-9-]+(?:[.][a-z0-9-]+)*[.]invalid$")))
            throw new ArgumentException("Local review canonical hosts must use reserved .invalid names.");
        LocalReviewOrigins = new Dictionary<string, string>(origins, StringComparer.Ordinal);
    }

    public static readonly IReadOnlySet<string> Slots = new HashSet<string>(StringComparer.Ordinal)
    {
        "beforeBody", "afterHero", "sidebar", "beforeGrid", "afterBody"
    };

    public static readonly IReadOnlySet<string> HeaderStyles = new HashSet<string>(StringComparer.Ordinal)
    {
        "standard", "compact", "minimal"
    };

    public static readonly IReadOnlySet<string> FooterStyles = new HashSet<string>(StringComparer.Ordinal)
    {
        "standard", "minimal"
    };
}
