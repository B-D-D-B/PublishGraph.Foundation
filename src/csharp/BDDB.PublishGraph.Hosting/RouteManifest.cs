using System.Text.RegularExpressions;
using BDDB.PublishGraph.Content;

namespace BDDB.PublishGraph.Hosting;

public enum RouteDisposition { Equivalent, Deferred, ArchiveOnly, Retired }
public sealed record RouteEntry(string Path, string? Destination, RouteDisposition Disposition, string Evidence);
public sealed record RouteResolution(int Status, string? Destination = null);

// This manifest describes outcomes, never grants eligibility to a destination.
public sealed class RouteManifest
{
    public IReadOnlyList<RouteEntry> Entries { get; }
    private readonly IReadOnlyDictionary<string, CompiledPage> _public;
    private readonly IReadOnlyDictionary<string, CompiledPage> _canonical;
    private readonly IReadOnlyDictionary<string, RouteEntry> _aliases;
    private static readonly HashSet<string> CampaignKeys = new(["utm_source", "utm_medium", "utm_campaign"], StringComparer.Ordinal);

    public RouteManifest(ContentBundle bundle, IEnumerable<RouteEntry>? entries = null)
    {
        var canonical = new Dictionary<string, CompiledPage>(StringComparer.Ordinal);
        foreach (var page in bundle.Pages)
            if (!SafePath(page.Route) || Reserved(page.Route) || !canonical.TryAdd(Identity(page.Route), page))
                throw new InvalidDataException("Ambiguous canonical route identity.");
        _public = canonical.Values.Where(p => !p.IsPrivatePreview).ToDictionary(p => p.Route, StringComparer.Ordinal);
        _canonical = _public.Values.ToDictionary(p => Identity(p.Route), StringComparer.Ordinal);
        Entries = (entries ?? []).ToArray();
        var paths = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entry in Entries)
        {
            if (!SafePath(entry.Path) || !paths.Add(Identity(entry.Path)) || canonical.ContainsKey(Identity(entry.Path)) || Reserved(entry.Path))
                throw new InvalidDataException("Route manifest collision or unsafe path.");
            if (entry.Disposition == RouteDisposition.Retired && string.IsNullOrWhiteSpace(entry.Evidence))
                throw new InvalidDataException("Retirement needs an explicit decision.");
            if (entry.Destination is not null && (!SafePath(entry.Destination) || Identity(entry.Destination) == Identity(entry.Path) || Reserved(entry.Destination)))
                throw new InvalidDataException("Invalid redirect destination.");
        }
        if (Entries.Any(e => e.Destination is not null && paths.Contains(Identity(e.Destination))))
            throw new InvalidDataException("Redirect chains and loops are forbidden.");
        _aliases = Entries.ToDictionary(e => Identity(e.Path), StringComparer.Ordinal);
    }

    private static string Identity(string path) => path.TrimEnd('/').ToLowerInvariant();
    private static bool Reserved(string path)
    {
        var identity = Identity(path);
        return identity.StartsWith("/__", StringComparison.Ordinal) || identity is "/assets" or "/_content" or "/sitemap.xml" or "/health/ready" ||
            identity.StartsWith("/assets/", StringComparison.Ordinal) || identity.StartsWith("/_content/", StringComparison.Ordinal);
    }

    public static bool SafePath(string path) => path == "/" || Regex.IsMatch(path, "^/[a-zA-Z0-9][a-zA-Z0-9/_.-]*$") &&
        !path.Contains("..", StringComparison.Ordinal) && !path.Contains("//", StringComparison.Ordinal);

    public RouteResolution Resolve(string path, IQueryCollection query)
    {
        if (!SafePath(path)) return new(404);
        // Unknown selectors, duplicate values and overlong campaigns cannot select a page.
        if (query.Any(p => !CampaignKeys.Contains(p.Key) || p.Value.Count != 1 || p.Value[0]?.Length > 128)) return new(404);
        var exact = _public.GetValueOrDefault(path);
        if (exact is not null) return query.Count == 0 ? new(200) : new(308, exact.Route);
        var variant = _canonical.GetValueOrDefault(Identity(path));
        if (variant is not null) return new(308, variant.Route);
        var entry = _aliases.GetValueOrDefault(Identity(path));
        if (entry is null) return new(404);
        if (entry.Disposition == RouteDisposition.Retired) return new(410);
        return entry.Disposition == RouteDisposition.Equivalent && entry.Destination is not null && _canonical.TryGetValue(Identity(entry.Destination), out var destination)
            ? new(308, destination.Route) : new(404);
    }

    public IReadOnlyList<CompiledPage> EligiblePages => _public.Values.OrderBy(p => p.Route, StringComparer.Ordinal).ToArray();
}
