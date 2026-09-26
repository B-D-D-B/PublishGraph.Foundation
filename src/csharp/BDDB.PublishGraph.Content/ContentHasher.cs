using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BDDB.PublishGraph.Content;

public static class ContentHasher
{
    public static string Sha256(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    public static string PageHash(PageFrontMatter page, string markdown)
    {
        return Sha256(JsonSerializer.Serialize(page, BundleJson.Options) + "\n" + Normalize(markdown));
    }

    public static string Normalize(string value) => value.Replace("\r\n", "\n", StringComparison.Ordinal).Trim() + "\n";
}

public static class BundleJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        // Preserve the frozen Windows wire/hash representation on every supported OS.
        NewLine = "\r\n",
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };
}
