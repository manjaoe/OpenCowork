using System.Text;
using System.Text.Json;

internal sealed class AgentRuntimeOpenAIPromptCacheState
{
    public AgentRuntimeOpenAIPromptCacheState(
        bool enabled,
        bool supportsPromptCacheOptions,
        bool supportsPromptCacheRetention,
        int explicitBreakpointBudget)
    {
        Enabled = enabled;
        SupportsPromptCacheOptions = supportsPromptCacheOptions;
        SupportsPromptCacheRetention = supportsPromptCacheRetention;
        RemainingExplicitBreakpoints = explicitBreakpointBudget;
    }

    public bool Enabled { get; }
    public bool SupportsPromptCacheOptions { get; }
    public bool SupportsPromptCacheRetention { get; }
    public int RemainingExplicitBreakpoints { get; private set; }

    public bool TryUseExplicitBreakpoint()
    {
        if (!Enabled || !SupportsPromptCacheOptions || RemainingExplicitBreakpoints <= 0)
        {
            return false;
        }

        RemainingExplicitBreakpoints--;
        return true;
    }
}

internal static class AgentRuntimeOpenAIPromptCache
{
    private const int PromptCacheKeyMaxLength = 64;

    public static AgentRuntimeOpenAIPromptCacheState CreateState(
        JsonElement provider,
        bool enabledByDefault)
    {
        var enabled = JsonHelpers.GetBool(provider, "enablePromptCache", enabledByDefault);
        var model = JsonHelpers.GetString(provider, "model") ?? string.Empty;
        var supportsPromptCacheOptions =
            enabled &&
            SupportsPromptCacheOptions(model);
        var supportsPromptCacheRetention =
            enabled &&
            !supportsPromptCacheOptions &&
            SupportsPromptCacheRetention(model);

        var mode = ResolvePromptCacheOptionsMode(provider);
        var explicitBreakpointBudget = supportsPromptCacheOptions
            ? (string.Equals(mode, "explicit", StringComparison.OrdinalIgnoreCase) ? 4 : 3)
            : 0;
        return new AgentRuntimeOpenAIPromptCacheState(
            enabled,
            supportsPromptCacheOptions,
            supportsPromptCacheRetention,
            explicitBreakpointBudget);
    }

    public static void WriteRequestControls(
        Utf8JsonWriter writer,
        JsonElement provider,
        HashSet<string> omitted,
        AgentRuntimeOpenAIPromptCacheState state)
    {
        if (!state.Enabled)
        {
            return;
        }

        if (state.SupportsPromptCacheOptions)
        {
            if (!omitted.Contains("prompt_cache_options") &&
                !HasBodyOverride(provider, "prompt_cache_options"))
            {
                writer.WritePropertyName("prompt_cache_options");
                writer.WriteStartObject();
                writer.WriteString("mode", "implicit");
                writer.WriteString("ttl", "30m");
                writer.WriteEndObject();
                omitted.Add("prompt_cache_options");
            }
            return;
        }

        if (state.SupportsPromptCacheRetention &&
            !omitted.Contains("prompt_cache_retention") &&
            !HasBodyOverride(provider, "prompt_cache_retention"))
        {
            writer.WriteString("prompt_cache_retention", "24h");
            omitted.Add("prompt_cache_retention");
        }
    }

    public static void WriteExplicitBreakpoint(Utf8JsonWriter writer)
    {
        writer.WritePropertyName("prompt_cache_breakpoint");
        writer.WriteStartObject();
        writer.WriteString("mode", "explicit");
        writer.WriteEndObject();
    }

    public static bool HasBodyOverride(JsonElement provider, string propertyName)
    {
        return provider.TryGetProperty("requestOverrides", out var overrides) &&
            overrides.ValueKind == JsonValueKind.Object &&
            overrides.TryGetProperty("body", out var body) &&
            body.ValueKind == JsonValueKind.Object &&
            body.TryGetProperty(propertyName, out _);
    }

    public static string? ResolveBodyOverrideString(JsonElement provider, string propertyName)
    {
        if (!provider.TryGetProperty("requestOverrides", out var overrides) ||
            overrides.ValueKind != JsonValueKind.Object ||
            !overrides.TryGetProperty("body", out var body) ||
            body.ValueKind != JsonValueKind.Object ||
            !body.TryGetProperty(propertyName, out var property) ||
            property.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return property.GetString();
    }

    public static string? ClampPromptCacheKey(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var trimmed = value.Trim();
        var builder = new StringBuilder();
        var count = 0;
        foreach (var rune in trimmed.EnumerateRunes())
        {
            if (count >= PromptCacheKeyMaxLength)
            {
                break;
            }
            builder.Append(rune.ToString());
            count++;
        }
        return builder.ToString();
    }

    private static string ResolvePromptCacheOptionsMode(JsonElement provider)
    {
        if (!provider.TryGetProperty("requestOverrides", out var overrides) ||
            overrides.ValueKind != JsonValueKind.Object ||
            !overrides.TryGetProperty("body", out var body) ||
            body.ValueKind != JsonValueKind.Object ||
            !body.TryGetProperty("prompt_cache_options", out var options) ||
            options.ValueKind != JsonValueKind.Object ||
            !options.TryGetProperty("mode", out var mode) ||
            mode.ValueKind != JsonValueKind.String ||
            mode.GetString() is not { Length: > 0 } modeValue)
        {
            return "implicit";
        }

        return modeValue;
    }

    private static bool SupportsPromptCacheOptions(string model)
    {
        return TryReadGptVersion(model, out var major, out var minor) &&
            (major > 5 || (major == 5 && minor >= 6));
    }

    private static bool SupportsPromptCacheRetention(string model)
    {
        var normalized = NormalizeModel(model);
        return StartsWithModel(normalized, "gpt-4.1") ||
            StartsWithModel(normalized, "gpt-5.1") ||
            StartsWithModel(normalized, "gpt-5.2") ||
            StartsWithModel(normalized, "gpt-5.4") ||
            StartsWithModel(normalized, "gpt-5.5") ||
            normalized == "gpt-5" ||
            StartsWithModel(normalized, "gpt-5-codex");
    }

    private static bool StartsWithModel(string normalizedModel, string prefix)
    {
        return normalizedModel == prefix ||
            normalizedModel.StartsWith($"{prefix}-", StringComparison.Ordinal);
    }

    private static bool TryReadGptVersion(string model, out int major, out int minor)
    {
        major = 0;
        minor = 0;
        var normalized = NormalizeModel(model);
        var marker = "gpt-";
        var index = normalized.IndexOf(marker, StringComparison.Ordinal);
        if (index < 0)
        {
            return false;
        }

        var position = index + marker.Length;
        if (!ReadNumber(normalized, ref position, out major))
        {
            return false;
        }

        if (position < normalized.Length && normalized[position] == '.')
        {
            position++;
            _ = ReadNumber(normalized, ref position, out minor);
        }

        return true;
    }

    private static bool ReadNumber(string value, ref int position, out int number)
    {
        number = 0;
        var start = position;
        while (position < value.Length && char.IsAsciiDigit(value[position]))
        {
            number = (number * 10) + (value[position] - '0');
            position++;
        }
        return position > start;
    }

    private static string NormalizeModel(string model)
    {
        var normalized = model.Trim().ToLowerInvariant();
        const string openAIPrefix = "openai.";
        return normalized.StartsWith(openAIPrefix, StringComparison.Ordinal)
            ? normalized[openAIPrefix.Length..]
            : normalized;
    }
}
