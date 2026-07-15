internal sealed class SeedanceVideoModule : IWorkerModule
{
    public string Name => "seedance-video";

    public void Register(WorkerModuleContext context)
    {
        context.Register("seedance-video/generate", SeedanceVideoTools.GenerateAsync);
        context.Register("seedance-video/status", SeedanceVideoTools.StatusAsync);
        context.Register("seedance-video/download", SeedanceVideoTools.DownloadAsync);
    }
}
