using BDDB.PublishGraph.Content;

namespace BDDB.PublishGraph.Hosting;

public sealed class SiteHostValidationMiddleware(RequestDelegate next, ContentBundle bundle)
{
    private readonly HashSet<string> _allowedHosts = bundle.Hostnames.ToHashSet(StringComparer.OrdinalIgnoreCase);

    public async Task InvokeAsync(HttpContext context)
    {
        if (!_allowedHosts.Contains(context.Request.Host.Host))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        await next(context);
    }
}
