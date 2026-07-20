using System.Net;

internal sealed class AgentRuntimeProviderHttpException : InvalidOperationException
{
    public AgentRuntimeProviderHttpException(
        string providerName,
        HttpStatusCode statusCode,
        string responseBody,
        TimeSpan? retryAfter)
        : base($"{providerName} request failed HTTP {(int)statusCode}: {responseBody}")
    {
        StatusCode = (int)statusCode;
        RetryAfter = retryAfter;
    }

    public int StatusCode { get; }

    public TimeSpan? RetryAfter { get; }

    public static async Task<AgentRuntimeProviderHttpException> CreateAsync(
        string providerName,
        HttpResponseMessage response,
        CancellationToken cancellationToken)
    {
        var responseBody = await response.Content.ReadAsStringAsync(cancellationToken);
        return new AgentRuntimeProviderHttpException(
            providerName,
            response.StatusCode,
            responseBody,
            response.Headers.RetryAfter?.Delta);
    }
}

internal static class AgentRuntimeProviderRetryPolicy
{
    private const int MaxRetryAttempts = 10;
    private const int RetryDelayIncrementMs = 1_000;
    private const int MaxRetryAfterMs = 60_000;

    public static async Task<AgentRuntimeProviderTurnResult> ExecuteAsync(
        Func<Task<AgentRuntimeProviderTurnResult>> execute,
        AgentRuntimeTools.AgentRuntimeRunState state,
        WorkerRequestContext context)
    {
        var previousDelayMs = 0;
        for (var retryAttempt = 0; ; retryAttempt++)
        {
            try
            {
                return await execute();
            }
            catch (AgentRuntimeProviderHttpException ex) when (
                IsRetryableStatus(ex.StatusCode) &&
                retryAttempt < MaxRetryAttempts &&
                !state.IsCancellationRequested)
            {
                var delayMs = ComputeDelayMs(retryAttempt + 1, previousDelayMs, ex.RetryAfter);
                previousDelayMs = delayMs;
                var attempt = retryAttempt + 1;
                WorkerLog.Warn(
                    $"provider request HTTP {ex.StatusCode}; retrying in {delayMs}ms " +
                    $"attempt={attempt}/{MaxRetryAttempts}");
                await AgentRuntimeTools.EmitAsync(
                    state,
                    context,
                    new AgentRuntimeStreamEvent(
                        "request_retry",
                        Reason: $"HTTP {ex.StatusCode}",
                        Attempt: attempt,
                        MaxAttempts: MaxRetryAttempts,
                        DelayMs: delayMs,
                        StatusCode: ex.StatusCode));
                await Task.Delay(delayMs, state.CancellationToken);
            }
        }
    }

    private static bool IsRetryableStatus(int statusCode)
    {
        return statusCode == 429 || statusCode >= 500;
    }

    private static int ComputeDelayMs(int attempt, int previousDelayMs, TimeSpan? retryAfter)
    {
        var incrementalDelayMs = checked(attempt * RetryDelayIncrementMs);
        var retryAfterMs = retryAfter.HasValue
            ? (int)Math.Clamp(retryAfter.Value.TotalMilliseconds, 0, MaxRetryAfterMs)
            : 0;
        return Math.Max(
            Math.Max(incrementalDelayMs, retryAfterMs),
            previousDelayMs + RetryDelayIncrementMs);
    }
}
