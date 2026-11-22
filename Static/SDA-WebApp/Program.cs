using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http.Features;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(options => options.AddServerHeader = false);
var contractPath = Path.Combine(AppContext.BaseDirectory, "content-contract.json");
using var contract = JsonDocument.Parse(File.ReadAllBytes(contractPath));
var contentRoot = Path.GetFullPath(Environment.GetEnvironmentVariable("SDA_CONTENT_ROOT")
    ?? Path.Combine(AppContext.BaseDirectory, "wwwroot"));
var files = contract.RootElement.GetProperty("files").EnumerateArray()
    .ToDictionary(file => file.GetProperty("path").GetString()!, file => file.Clone(), StringComparer.Ordinal);
var routes = contract.RootElement.GetProperty("routes").EnumerateObject()
    .ToDictionary(route => route.Name, route => route.Value.GetString()!, StringComparer.Ordinal);
var errors = contract.RootElement.GetProperty("errors").EnumerateArray()
    .GroupBy(error => error.GetProperty("status").GetInt32())
    .ToDictionary(group => group.Key, group => group.First().Clone());
foreach (var file in files)
{
    var fullPath = Path.Combine(contentRoot, file.Key);
    if (!File.Exists(fullPath) || (File.GetAttributes(fullPath) & FileAttributes.ReparsePoint) != 0
        || !Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(fullPath)))
            .Equals(file.Value.GetProperty("sha256").GetString(), StringComparison.Ordinal))
        throw new InvalidOperationException("Content does not match accepted manifest: " + file.Key);
}

var app = builder.Build();
app.Run(async context =>
{
    // No authentication implementation or forwarding. OAuth disposition gates deployment.
    var raw = context.Features.Get<IHttpRequestFeature>()?.RawTarget ?? context.Request.Path.Value ?? "/";
    raw = raw.Split('?')[0];
    if (Regex.IsMatch(raw, "%($|[^0-9A-Fa-f]|[0-9A-Fa-f]($|[^0-9A-Fa-f]))"))
    {
        context.Response.StatusCode = 400;
        return;
    }
    var requestPath = Uri.UnescapeDataString(raw);
    if (requestPath.Contains('\\') || requestPath.Contains('\0')
        || requestPath.Split('/').Any(segment => segment is "." or ".."))
    {
        context.Response.StatusCode = 403;
        return;
    }
    if (requestPath.Equals("/api", StringComparison.Ordinal)
        || requestPath.StartsWith("/api/", StringComparison.Ordinal))
    {
        // Deliberately disabled: do not read the body, invoke a backend, or send mail.
        await ErrorResponse(context, errors[403]);
        return;
    }
    if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method))
    {
        context.Response.StatusCode = 405;
        context.Response.Headers.Allow = "GET, HEAD";
        return;
    }
    var relative = routes.GetValueOrDefault(requestPath) ?? requestPath.TrimStart('/');
    if (requestPath.StartsWith("/.auth", StringComparison.Ordinal)
        || relative == "staticwebapp.config.json" || !files.TryGetValue(relative, out var entry))
    {
        await ErrorResponse(context, errors[404]);
        return;
    }
    ApplyHeaders(context, entry.GetProperty("headers"));
    context.Response.ContentLength = entry.GetProperty("bytes").GetInt64();
    if (!HttpMethods.IsHead(context.Request.Method))
        await context.Response.SendFileAsync(Path.Combine(contentRoot, relative), context.RequestAborted);
});
app.Run();

static void ApplyHeaders(HttpContext context, JsonElement headers)
{
    foreach (var header in headers.EnumerateObject())
        context.Response.Headers[header.Name] = header.Value.GetString();
}

static async Task ErrorResponse(HttpContext context, JsonElement error)
{
    context.Response.StatusCode = error.GetProperty("status").GetInt32();
    ApplyHeaders(context, error.GetProperty("headers"));
    var body = Convert.FromBase64String(error.GetProperty("bodyBase64").GetString()!);
    context.Response.ContentLength = body.Length;
    if (!HttpMethods.IsHead(context.Request.Method))
        await context.Response.Body.WriteAsync(body, context.RequestAborted);
}
