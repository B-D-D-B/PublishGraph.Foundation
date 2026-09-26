using System.Text.Json;
using BDDB.PublishGraph.Content;

if (args.Length >= 2 && args[0] == "--palette-registry")
{
    ContentRegistries.ConfigurePalettes(JsonSerializer.Deserialize<string[]>(File.ReadAllText(args[1])) ?? throw new InvalidDataException("Palette registry is empty."));
    args = args.Skip(2).ToArray();
}

if (args.Length >= 2 && args[0] == "--review-origins")
{
    ContentRegistries.ConfigureLocalReviewOrigins(JsonSerializer.Deserialize<Dictionary<string,string>>(File.ReadAllText(args[1])) ?? throw new InvalidDataException("Review-origin registry is empty."));
    args = args.Skip(2).ToArray();
}

if (args.Length == 7 && args[0] == "regions-private")
{
    var content = ContentCompiler.LoadPrivateReviewBundle(args[1]);
    var catalog = JsonSerializer.Deserialize<LayoutCatalog>(File.ReadAllText(args[2]), BundleJson.Options)!;
    var documents = JsonSerializer.Deserialize<RegionDocument[]>(File.ReadAllText(args[3]), BundleJson.Options)!;
    var regions = RegionCompiler.Compile(content, catalog, documents, File.ReadAllText(args[4]).Trim(), true);
    File.WriteAllText(args[5], JsonSerializer.Serialize(regions, BundleJson.Options));
    File.WriteAllText(args[5] + ".envelope.json", JsonSerializer.Serialize(new LayoutEnvelope("sda-private-layout-content-v2", content, regions), BundleJson.Options));
    File.WriteAllText(args[6], JsonSerializer.Serialize(regions.Pages.Select(x => new { x.PageId, x.Route, x.Identity }), BundleJson.Options));
    Console.WriteLine($"PRIVATE regions {regions.ManifestHash}; pages={regions.Pages.Length}");
    return 0;
}

// Explicit file sets allow cross-directory review without copying accepted content.
if (args.Length is 5 or 6 && args[0] == "compile-set" && (args.Length == 5 || args[5] == "--private-review"))
{
    try
    {
        var site = JsonSerializer.Deserialize<SiteDefinition>(File.ReadAllText(args[1]), BundleJson.Options)!;
        var files = JsonSerializer.Deserialize<string[]>(File.ReadAllText(args[2]))!;
        var ledger = JsonSerializer.Deserialize<ApprovalLedger>(File.ReadAllText(args[3]), BundleJson.Options)!;
        var compiler = new ContentCompiler();
        var result = args.Length == 6 ? compiler.CompilePrivateReview(site, files) : compiler.Compile(site, files, ledger);
        if (!result.Success) throw new ContentCompilationException(result.Errors);
        ContentCompiler.WriteBundle(result.Bundle!, args[4]);
        if (args.Length == 6)
        {
            var pairs = files.Select(file =>
            {
                var pair = compiler.GetRequiredApproval(file, files);
                return new { path = file.Replace('\\', '/'), pair.ContentHash, pair.SourceHash,
                    fileSha256 = Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(file))) };
            });
            File.WriteAllText(args[4] + ".pairs.json", JsonSerializer.Serialize(pairs, BundleJson.Options));
        }
        Console.WriteLine($"WROTE {args[4]} ({result.Bundle!.ManifestHash}); pages={result.Bundle.Pages.Count}");
        return 0;
    }
    catch (Exception exception) { Console.Error.WriteLine(exception.Message); return 1; }
}

if (args.Length == 7 && args[0] == "private-review" && args[1] == "--site" && args[3] == "--content" && args[5] == "--output")
{
    try
    {
        var site = JsonSerializer.Deserialize<SiteDefinition>(File.ReadAllText(args[2]), BundleJson.Options)
            ?? throw new InvalidDataException("Site configuration is empty.");
        var result = new ContentCompiler().CompilePrivateReview(site, Directory.EnumerateFiles(args[4], "*.md", SearchOption.AllDirectories));
        if (!result.Success) throw new ContentCompilationException(result.Errors);
        ContentCompiler.WriteBundle(result.Bundle!, args[6]);
        Console.WriteLine($"PRIVATE REVIEW ONLY {args[6]} ({result.Bundle!.ManifestHash}); no publication approvals created.");
        return 0;
    }
    catch (Exception exception) { Console.Error.WriteLine(exception.Message); return 1; }
}

if ((args.Length == 3 || args.Length == 5) && args[0] == "hash" && args[1] == "--content" &&
    (args.Length == 3 || args[3] == "--content-root"))
{
    try
    {
        var files = args.Length == 5
            ? Directory.EnumerateFiles(args[4], "*.md", SearchOption.AllDirectories)
            : new[] { args[2] };
        var hashes = new ContentCompiler().GetRequiredApproval(args[2], files);
        Console.WriteLine(JsonSerializer.Serialize(new { contentHash = hashes.ContentHash, sourceHash = hashes.SourceHash }, BundleJson.Options));
        return 0;
    }
    catch (Exception exception)
    {
        Console.Error.WriteLine(exception.Message);
        return 1;
    }
}

if (args.Length != 8 || args[0] != "--site" || args[2] != "--content" || args[4] != "--approvals" || args[6] != "--output")
{
    Console.Error.WriteLine("Usage: BDDB.PublishGraph.ContentCompiler --site <site.json> --content <directory> --approvals <approvals.json> --output <bundle.json>\n       BDDB.PublishGraph.ContentCompiler hash --content <page.md> [--content-root <directory>]");
    return 2;
}

try
{
    var site = JsonSerializer.Deserialize<SiteDefinition>(File.ReadAllText(args[1]), BundleJson.Options)
        ?? throw new InvalidDataException("Site configuration is empty.");
    var approvals = JsonSerializer.Deserialize<ApprovalLedger>(File.ReadAllText(args[5]), BundleJson.Options)
        ?? throw new InvalidDataException("Approval ledger is empty.");
    var files = Directory.EnumerateFiles(args[3], "*.md", SearchOption.AllDirectories);
    var result = new ContentCompiler().Compile(site, files, approvals);
    foreach (var exclusion in result.Exclusions) Console.WriteLine($"EXCLUDED {exclusion}");
    if (!result.Success)
    {
        foreach (var error in result.Errors) Console.Error.WriteLine($"ERROR {error}");
        return 1;
    }
    ContentCompiler.WriteBundle(result.Bundle!, args[7]);
    Console.WriteLine($"WROTE {args[7]} ({result.Bundle!.ManifestHash})");
    return 0;
}
catch (Exception exception)
{
    Console.Error.WriteLine(exception.Message);
    return 1;
}
