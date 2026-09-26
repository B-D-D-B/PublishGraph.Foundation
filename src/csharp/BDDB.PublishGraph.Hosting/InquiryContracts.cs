using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace BDDB.PublishGraph.Hosting;

public sealed record Inquiry
{
    [Required, StringLength(100, MinimumLength = 1)] public string Name { get; init; } = "";
    [Required, EmailAddress, StringLength(254)] public string Email { get; init; } = "";
    [Required, StringLength(4000, MinimumLength = 10)] public string Message { get; init; } = "";
    [StringLength(0)] public string? Website { get; init; }
}
public enum DeliveryState { Disabled, Success, Failed }
public interface IInquirySink { Task<DeliveryState> SendAsync(Inquiry inquiry, CancellationToken cancellationToken); }
// Deliberately does not retain, log, or transmit personal data. There is no production transport.
public sealed class TestInquirySink(bool fail = false) : IInquirySink
{
    public Task<DeliveryState> SendAsync(Inquiry inquiry, CancellationToken cancellationToken) =>
        Task.FromResult(fail ? DeliveryState.Failed : DeliveryState.Success);
}
public sealed class DisabledInquirySink : IInquirySink
{
    public Task<DeliveryState> SendAsync(Inquiry inquiry, CancellationToken cancellationToken) => Task.FromResult(DeliveryState.Disabled);
}
