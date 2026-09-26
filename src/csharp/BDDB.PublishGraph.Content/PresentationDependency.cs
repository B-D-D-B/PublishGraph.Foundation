namespace BDDB.PublishGraph.Content;
public static class PresentationDependency
{
    public static string Identity
    {
        get
        {
            using var stream = typeof(PresentationDependency).Assembly.GetManifestResourceStream("PublishGraph.Presentation.LayoutContracts.cs")!;
            using var reader = new StreamReader(stream);
            return ContentHasher.Sha256(reader.ReadToEnd());
        }
    }
}
