using System.Text.Json;
using BDDB.PublishGraph.Content;
namespace BDDB.PublishGraph.Hosting;
public static class LayoutContentLoader
{
    public static ContentBundle Load(SiteRegistration settings)
    {
        if (new FileInfo(settings.BundlePath).Length > 25_000_000) throw new InvalidDataException("Bundle exceeds size limit.");
        var json = File.ReadAllText(settings.BundlePath);
        using var parsed = JsonDocument.Parse(json);
        var format = parsed.RootElement.TryGetProperty("format", out var formatValue) && formatValue.ValueKind == JsonValueKind.String ? formatValue.GetString() : null;
        if (format is "sda-layout-content-v2" or "sda-private-layout-content-v2")
        {
            if (format != (settings.PrivateReview ? "sda-private-layout-content-v2" : "sda-layout-content-v2")) throw new InvalidDataException("Layout envelope review boundary mismatch.");
            var envelope = JsonSerializer.Deserialize<LayoutEnvelope>(json, BundleJson.Options)!;
            if (envelope.Content is null || envelope.Regions is null) throw new InvalidDataException("Incomplete v2 envelope.");
            var errors = ContentCompiler.ValidateBundle(envelope.Content, settings.PrivateReview);
            if (errors.Count > 0) throw new ContentCompilationException(errors);
            settings.LayoutEnvelope = envelope;
            return envelope.Content;
        }
        return settings.PrivateReview ? ContentCompiler.LoadPrivateReviewBundle(settings.BundlePath) : ContentCompiler.LoadBundle(settings.BundlePath);
    }
}
