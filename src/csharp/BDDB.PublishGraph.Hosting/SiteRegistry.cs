using System.Globalization;
using System.Net;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.Extensions.Caching.Memory;
using BDDB.PublishGraph.Content;

namespace BDDB.PublishGraph.Hosting;

public sealed class SiteRegistration
{
    public string Id { get; set; } = "";
    public string CanonicalOrigin { get; set; } = "";
    public string BundlePath { get; set; } = "";
    public string AssetRoot { get; set; } = "";
    public LayoutEnvelope? LayoutEnvelope { get; set; }
    public string LayoutReleasePath { get; set; } = "";
    public string LayoutReleaseHash { get; set; } = "";
    public string DeploymentRoot { get; set; } = "";
    public string DeploymentReceiptPath { get; set; } = "";
    public string DeploymentReceiptHash { get; set; } = "";
    public string[] Aliases { get; set; } = [];
    public bool PrivateReview { get; set; }
    public bool PublicPresentationReview { get; set; }
    public bool IntegrationReview { get; set; }
    public bool FailSink { get; set; }
    public bool ReuseReview { get; set; }
}

// Immutable per-site state. Only pure public route decisions enter this bounded cache.
public sealed class SiteRuntime
{
    private readonly MemoryCache _routes = new(new MemoryCacheOptions { SizeLimit = 256 });
    public SiteRegistration Registration { get; }
    public ContentBundle? Bundle { get; }
    public RegionBundle? Regions { get; }
    public RouteManifest? Routes { get; }
    public IInquirySink Sink { get; }
    public bool Available => Bundle is not null;
    public int CachedRoutes => _routes.Count;
    public SiteRuntime(SiteRegistration registration, ContentBundle? bundle, RegionBundle? regions = null, IEnumerable<RouteEntry>? routes = null)
    {
        Registration = registration;
        Bundle = bundle;
        Regions = regions;
        Routes = bundle is null ? null : new RouteManifest(bundle, routes);
        Sink = registration.IntegrationReview ? new TestInquirySink(registration.FailSink) : new DisabledInquirySink();
    }
    public RouteResolution Resolve(string path, IQueryCollection query)
    {
        // Queries and invalid paths cannot consume cache space or carry a private selector.
        if (query.Count != 0 || path.Length > 1024 || !RouteManifest.SafePath(path)) return Routes!.Resolve(path, query);
        return _routes.GetOrCreate(path, entry =>
        {
            entry.Size = 1;
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5);
            return Routes!.Resolve(path, query);
        })!;
    }
    internal void ReleaseCache() => _routes.Dispose();
}

public sealed record SiteBinding(SiteRuntime Site, bool Alias);
public sealed class SiteContext { public SiteRuntime Site { get; set; } = null!; }

public sealed class SiteRegistry : IDisposable
{
    private readonly Dictionary<string, SiteBinding> _hosts = new(StringComparer.Ordinal);
    private readonly List<SiteRuntime> _sites = [];
    private readonly HashSet<IPAddress> _proxies;
    public bool Shared { get; }
    public bool DeploymentAvailable { get; } = true;
    public IReadOnlyList<SiteRuntime> Sites => _sites.AsReadOnly();
    public SiteRegistry(IConfiguration configuration, IWebHostEnvironment environment, ISitePresentation presentation, System.Reflection.Assembly hostAssembly)
    {
        _proxies = (configuration.GetSection("Hosting:TrustedProxies").Get<string[]>() ?? [])
            .Select(IPAddress.Parse).Select(NormalizeAddress).ToHashSet();
        var registrations = configuration.GetSection("Sites").Get<SiteRegistration[]>();
        Shared = registrations is { Length: > 0 };
        if (!Shared)
        {
            var registration = new SiteRegistration
            {
                BundlePath = configuration["Content:BundlePath"] ?? Path.Combine(environment.ContentRootPath, "App_Data", "site.bundle.json"),
                AssetRoot = configuration["Content:AssetRoot"] ?? Path.Combine(environment.ContentRootPath, "App_Data", "assets"),
                LayoutReleasePath = configuration["Content:LayoutReleasePath"] ?? "",
                LayoutReleaseHash = configuration["Content:LayoutReleaseHash"] ?? "",
                DeploymentRoot = configuration["Content:DeploymentRoot"] ?? "",
                DeploymentReceiptPath = configuration["Content:DeploymentReceiptPath"] ?? "",
                DeploymentReceiptHash = configuration["Content:DeploymentReceiptHash"] ?? "",
                PrivateReview = configuration.GetValue<bool>("PrivateReview:Enabled"),
                PublicPresentationReview = configuration.GetValue<bool>("PrivateReview:PublicPresentation"),
                IntegrationReview = configuration.GetValue<bool>("P5Review:Enabled"),
                FailSink = configuration.GetValue<bool>("P5Review:FailSink")
            };
            ValidateReview(registration, environment);
            if (HasDeployment(registration)) DeploymentGuard.Verify(registration, environment, hostAssembly);
            var bundle = Load(registration);
            registration.Id = bundle.SiteId;
            registration.CanonicalOrigin = bundle.BaseUrl;
            var site = new SiteRuntime(registration, bundle, presentation.Load(registration, bundle, environment), presentation.Routes(bundle));
            _sites.Add(site);
            foreach (var host in bundle.Hostnames) Add(host, new(site, false));
            return;
        }
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var namespaces = new HashSet<string>(StringComparer.Ordinal);
        // A configured artifact is shared by every site in this process, including v1 sites.
        // Preflight every receipt before loading any content, regardless of registration order.
        foreach (var registration in registrations!.Where(HasDeployment))
        {
            try { DeploymentGuard.Verify(registration, environment, hostAssembly); }
            catch (Exception error) when (error is InvalidDataException or IOException or System.Text.Json.JsonException or InvalidOperationException or ArgumentException or UnauthorizedAccessException)
            { DeploymentAvailable = false; }
        }
        foreach (var registration in registrations!)
        {
            if (string.IsNullOrWhiteSpace(registration.Id) || !ids.Add(registration.Id)) throw new InvalidDataException("Duplicate or empty site identity.");
            ValidateReview(registration, environment);
            var origin = CanonicalOrigin(registration.CanonicalOrigin);
            ContentBundle? bundle = null;
            RegionBundle? regions = null;
            // Shared failure must remain authoritative. Keep structural registration
            // validation and host bindings, but do not enter any content/site adapter.
            if (DeploymentAvailable)
            {
                try
                {
                    bundle = Load(registration);
                    if (bundle.SiteId != registration.Id || CanonicalOrigin(bundle.BaseUrl) != origin ||
                        !bundle.Hostnames.Any(h => NormalizeHost(h) == origin.IdnHost))
                        throw new InvalidDataException("Bundle identity does not match the registered site.");
                    // Invalid route manifests also fail only their owning site closed.
                    _ = new RouteManifest(bundle, presentation.Routes(bundle));
                    regions = presentation.Load(registration, bundle, environment);
                }
                catch (Exception error) when (error is ContentCompilationException or InvalidDataException or IOException or System.Text.Json.JsonException or InvalidOperationException or ArgumentException)
                {
                    bundle = null;
                }
            }
            if (bundle is not null && !namespaces.Add(bundle.AssetNamespace)) throw new InvalidDataException("Site asset namespaces overlap.");
            var site = new SiteRuntime(registration, bundle, regions, bundle is null ? null : presentation.Routes(bundle));
            _sites.Add(site);
            Add(origin.IdnHost, new(site, false));
            foreach (var alias in registration.Aliases) Add(alias, new(site, true));
        }
    }
    private static ContentBundle Load(SiteRegistration registration) => LayoutContentLoader.Load(registration);
    private static bool HasDeployment(SiteRegistration registration) =>
        !string.IsNullOrEmpty(registration.DeploymentRoot) || !string.IsNullOrEmpty(registration.DeploymentReceiptPath) || !string.IsNullOrEmpty(registration.DeploymentReceiptHash);
    private static void ValidateReview(SiteRegistration registration, IWebHostEnvironment environment)
    {
        if (registration.PublicPresentationReview && (!registration.PrivateReview || registration.IntegrationReview || registration.ReuseReview))
            throw new InvalidOperationException("Public presentation review requires private review with integrations and reuse review disabled.");
        if ((registration.PrivateReview || registration.IntegrationReview || registration.ReuseReview) && !environment.IsDevelopment())
            throw new InvalidOperationException("Review modes require Development and explicit opt-in.");
    }
    public static Uri CanonicalOrigin(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != "https" || !uri.IsDefaultPort ||
            uri.UserInfo.Length != 0 || uri.AbsolutePath != "/" || uri.Query.Length != 0 || uri.Fragment.Length != 0 ||
            value.TrimEnd('/') != "https://" + uri.IdnHost || NormalizeHost(uri.IdnHost) != uri.IdnHost)
            throw new InvalidDataException("A canonical HTTPS origin is required.");
        return uri;
    }
    public static string NormalizeHost(string value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > 253 || value.Any(c => char.IsWhiteSpace(c) || c is '/' or '\\' or '@' or ':' or ',' or '?' or '#' or '%'))
            throw new InvalidDataException("Invalid hostname.");
        var host = new IdnMapping().GetAscii(value.TrimEnd('.')).ToLowerInvariant();
        if (Uri.CheckHostName(host) is not (UriHostNameType.Dns or UriHostNameType.IPv4)) throw new InvalidDataException("Invalid hostname.");
        return host;
    }
    public static string RequestHost(string value)
    {
        var pieces = value.Split(':');
        if (pieces.Length > 2 || pieces.Length == 2 && (!int.TryParse(pieces[1], out var port) || port is < 1 or > 65535))
            throw new InvalidDataException("Invalid host port.");
        return NormalizeHost(pieces[0]);
    }
    private void Add(string host, SiteBinding binding)
    {
        if (!_hosts.TryAdd(NormalizeHost(host), binding)) throw new InvalidDataException("Overlapping hostname registration.");
    }
    public SiteBinding? Find(string host) => _hosts.GetValueOrDefault(RequestHost(host));
    private static IPAddress NormalizeAddress(IPAddress address) => address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address;
    public bool Trusts(IPAddress? address) => address is not null && _proxies.Contains(NormalizeAddress(address));
    public void Dispose() { foreach (var site in _sites) site.ReleaseCache(); }
}

public sealed class SiteSelectionMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, SiteRegistry registry, SiteContext selected)
    {
        var host = context.Request.Host.Value ?? "";
        if (registry.Trusts(context.Connection.RemoteIpAddress) && context.Request.Headers.TryGetValue("X-Forwarded-Host", out var forwarded))
        {
            if (forwarded.Count != 1) { context.Response.StatusCode = 400; return; }
            host = forwarded[0] ?? "";
        }
        // No downstream component may reinterpret an untrusted forwarded host/proto/chain.
        foreach (var header in new[] { "Forwarded", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Forwarded-For" }) context.Request.Headers.Remove(header);
        SiteBinding? binding;
        try { binding = registry.Find(host); }
        catch (ArgumentException) { context.Response.StatusCode = 400; return; }
        catch (InvalidDataException) { context.Response.StatusCode = 400; return; }
        if (binding is null) { context.Response.StatusCode = 404; return; }
        selected.Site = binding.Site;
        context.Request.Host = new HostString(host);
        if (!registry.DeploymentAvailable || !binding.Site.Available) { context.Response.StatusCode = 503; context.Response.Headers.CacheControl = "no-store"; return; }
        var settings = binding.Site.Registration;
        if (binding.Alias)
        {
            if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method)) { context.Response.StatusCode = 404; return; }
            var resolution = binding.Site.Resolve(context.Request.Path.Value ?? "/", context.Request.Query);
            if (resolution.Status is not (200 or 308)) { context.Response.StatusCode = resolution.Status; return; }
            context.Response.StatusCode = 308;
            context.Response.Headers.Location = settings.CanonicalOrigin.TrimEnd('/') + (resolution.Destination ?? context.Request.Path.Value);
            return;
        }
        var reviewEndpoint = context.Request.Path.StartsWithSegments("/__p5") || context.Request.Path.StartsWithSegments("/__reuse");
        var permitted = context.Request.Path.StartsWithSegments("/__reuse") ? settings.ReuseReview : settings.IntegrationReview;
        if (reviewEndpoint && !permitted || (reviewEndpoint || settings.PrivateReview) && context.Connection.RemoteIpAddress is { } ip && !IPAddress.IsLoopback(ip))
        { context.Response.StatusCode = 404; return; }
        if (reviewEndpoint || settings.PrivateReview)
        {
            context.Response.Headers.CacheControl = "no-store";
            context.Response.Headers["X-Robots-Tag"] = "noindex, nofollow, noarchive";
        }
        await next(context);
    }
}

// Even when two hostnames share a cookie jar in a local harness, tokens cannot cross sites.
public sealed class SiteAntiforgeryData : IAntiforgeryAdditionalDataProvider
{
    public string GetAdditionalData(HttpContext context) => context.RequestServices.GetRequiredService<SiteContext>().Site.Registration.Id;
    public bool ValidateAdditionalData(HttpContext context, string additionalData) => additionalData == GetAdditionalData(context);
}
