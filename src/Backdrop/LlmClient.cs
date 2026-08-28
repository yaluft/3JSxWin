using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Backdrop.Startup;

namespace Backdrop;

internal sealed class LlmReply
{
    public string Text { get; init; } = "";
    public List<string> Images { get; init; } = new();
}

/// <summary>OpenAI-compatible chat, file upload, and image gen against Open WebUI / LiteLLM.
/// Runs in the host so the WebView does not have to fight CORS or auth on file URLs.</summary>
internal static class LlmClient
{
    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        ConnectTimeout = TimeSpan.FromSeconds(8),
    })
    { Timeout = TimeSpan.FromMinutes(3) };

    internal static async Task<LlmReply> CompleteAsync(string webRoot, JsonElement messages, JsonElement files, bool imagine, CancellationToken cancel, string? model = null)
    {
        var cfg = ReadComms(webRoot);
        if (string.IsNullOrWhiteSpace(cfg.Url) && string.IsNullOrWhiteSpace(cfg.BaseUrl))
            return Fail("NO UPLINK — set comms.url in config.json.");

        string url = string.IsNullOrWhiteSpace(cfg.Url) ? Join(cfg.BaseUrl, cfg.Path) : cfg.Url.Trim();
        string useModel = string.IsNullOrWhiteSpace(model) ? cfg.Model : model.Trim();
        var chat = new List<object> { new { role = "system", content = cfg.System } };
        if (messages.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in messages.EnumerateArray())
                chat.Add(JsonSerializer.Deserialize<object>(item.GetRawText())!);
        }

        var payload = new Dictionary<string, object?>
        {
            ["model"] = useModel,
            ["messages"] = chat,
            ["temperature"] = cfg.Temperature,
            ["stream"] = false,
        };
        if (files.ValueKind == JsonValueKind.Array && files.GetArrayLength() > 0)
            payload["files"] = JsonSerializer.Deserialize<object>(files.GetRawText());
        if (imagine)
            payload["features"] = new { image_generation = true };

        var res = await PostJson(url, payload, cfg.ApiKey, cancel).ConfigureAwait(false);
        if (res is null)
            return Fail(Unreachable(url));

        using (res)
        {
            string body = await res.Content.ReadAsStringAsync(cancel).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
                return Fail(HttpError(res.StatusCode, url, body));

            var reply = ParseChat(body);
            await ResolveRelativeImages(webRoot, reply, cancel).ConfigureAwait(false);
            return reply;
        }
    }

    internal static async Task<(string Id, string Name)?> UploadAsync(string webRoot, string name, string mime, byte[] bytes, CancellationToken cancel)
    {
        var cfg = ReadComms(webRoot);
        string endpoint = SiteOrigin(cfg.Url, cfg.BaseUrl) + "/api/v1/files/";
        using var form = new MultipartFormDataContent();
        var part = new ByteArrayContent(bytes);
        part.Headers.ContentType = new MediaTypeHeaderValue(string.IsNullOrWhiteSpace(mime) ? "application/octet-stream" : mime);
        form.Add(part, "file", string.IsNullOrWhiteSpace(name) ? "upload.bin" : name);

        using var req = new HttpRequestMessage(HttpMethod.Post, endpoint) { Content = form };
        if (!string.IsNullOrWhiteSpace(cfg.ApiKey))
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", cfg.ApiKey);

        using var res = await Http.SendAsync(req, cancel).ConfigureAwait(false);
        string body = await res.Content.ReadAsStringAsync(cancel).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode)
        {
            Log.Write($"file upload HTTP {(int)res.StatusCode}");
            return null;
        }
        using var doc = JsonDocument.Parse(body);
        string id = doc.RootElement.TryGetProperty("id", out var idEl) ? idEl.GetString() ?? "" : "";
        string fn = doc.RootElement.TryGetProperty("filename", out var nEl) ? nEl.GetString() ?? name : name;
        if (id.Length == 0) return null;
        return (id, fn);
    }

    private const string DefaultSystem =
        "You are COMMS, the quiet uplink computer on a long-range probe. Short answers. No corporate tone. You can see nothing of the user's desktop. " +
        "When a visual is requested, specify an adult subject, body and clothing (or none), pose, setting, lens (85mm/50mm), and light as if briefing a camera — never minors. " +
        "Push photoreal quality: natural skin texture, coherent anatomy, cinematic rim light, shallow depth of field, film grain, highly detailed. " +
        "Never describe extra fingers or limbs, mutated hands, fused/missing fingers, watermarks, text, logos, blur, cartoons, plastic skin, 3d render, mosaics, or anyone under 18.";

    private const string ImageQuality =
        "Photorealistic, sharp focus, natural skin texture, coherent anatomy, cinematic rim light, 85mm lens, shallow depth of field, highly detailed, film grain.";

    private const string ImageNegative =
        "child, teen, underage, loli, baby, extra fingers, extra limbs, mutated hands, deformed, bad anatomy, fused fingers, missing fingers, extra heads, watermark, text, logo, blurry, lowres, jpeg artifacts, oversaturated, plastic skin, 3d render, cartoon, worst quality, cropped, out of frame, duplicate, censored, mosaic";

    internal static async Task<LlmReply> ImagineAsync(string webRoot, string prompt, CancellationToken cancel)
    {
        var cfg = ReadComms(webRoot);
        string endpoint = SiteOrigin(cfg.Url, cfg.BaseUrl) + "/api/v1/images/generations";
        string model = string.IsNullOrWhiteSpace(cfg.ImageModel) ? "sdxl" : cfg.ImageModel;
        string negative = string.IsNullOrWhiteSpace(cfg.Negative) ? ImageNegative : cfg.Negative;
        string fullPrompt = EnhanceImagePrompt(prompt);

        var payload = new Dictionary<string, object?>
        {
            ["prompt"] = fullPrompt,
            ["model"] = model,
            ["negative_prompt"] = negative,
        };
        var res = await PostJson(endpoint, payload, cfg.ApiKey, cancel).ConfigureAwait(false);
        if (res is { StatusCode: System.Net.HttpStatusCode.BadRequest })
        {
            res.Dispose();
            payload.Remove("negative_prompt");
            payload["prompt"] = fullPrompt + " Avoid: extra fingers, extra limbs, blurry, watermark, text, cartoon.";
            res = await PostJson(endpoint, payload, cfg.ApiKey, cancel).ConfigureAwait(false);
        }
        if (res is null) return Fail(Unreachable(endpoint));

        using (res)
        {
            string body = await res.Content.ReadAsStringAsync(cancel).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
                return Fail(HttpError(res.StatusCode, endpoint, body));

            var images = new List<string>();
            try
            {
                using var doc = JsonDocument.Parse(body);
                var root = doc.RootElement;
                if (root.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in root.EnumerateArray())
                        CollectImage(item, images);
                }
                else if (root.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in data.EnumerateArray())
                        CollectImage(item, images);
                }
            }
            catch (Exception ex)
            {
                Log.Write("image gen parse", ex);
            }

            var reply = new LlmReply { Text = images.Count == 0 ? "No image returned." : $"Generated {images.Count} image(s).", Images = images };
            await ResolveRelativeImages(webRoot, reply, cancel).ConfigureAwait(false);
            return reply;
        }
    }

    internal static string CarrierStatus(string webRoot, string? model = null)
    {
        var cfg = ReadComms(webRoot);
        string target = string.IsNullOrWhiteSpace(cfg.Url) ? Join(cfg.BaseUrl, cfg.Path) : cfg.Url;
        if (string.IsNullOrWhiteSpace(target)) return "NO CARRIER";
        string auth = string.IsNullOrWhiteSpace(cfg.ApiKey) ? "AUTH OFF" : "AUTH ON";
        string use = string.IsNullOrWhiteSpace(model) ? cfg.Model : model.Trim();
        return $"CARRIER {use} · img {cfg.ImageModel} · {auth}";
    }

    internal static async Task<(string Current, string ImageModel, List<(string Id, string Kind)> Models)> ListModelsAsync(string webRoot, CancellationToken cancel)
    {
        var cfg = ReadComms(webRoot);
        var models = new List<(string Id, string Kind)>();
        void Add(string? id)
        {
            if (string.IsNullOrWhiteSpace(id)) return;
            id = id.Trim();
            if (models.Any(m => string.Equals(m.Id, id, StringComparison.OrdinalIgnoreCase))) return;
            models.Add((id, ModelKind(id)));
        }

        string origin = SiteOrigin(cfg.Url, cfg.BaseUrl);
        foreach (string path in new[] { "/api/models", "/api/v1/models" })
        {
            using var res = await GetJson(origin + path, cfg.ApiKey, cancel).ConfigureAwait(false);
            if (res is null || !res.IsSuccessStatusCode) continue;
            string body = await res.Content.ReadAsStringAsync(cancel).ConfigureAwait(false);
            try
            {
                using var doc = JsonDocument.Parse(body);
                var root = doc.RootElement;
                JsonElement list = root;
                if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("data", out var data))
                    list = data;
                if (list.ValueKind != JsonValueKind.Array) continue;
                foreach (var item in list.EnumerateArray())
                {
                    if (item.ValueKind == JsonValueKind.String) Add(item.GetString());
                    else if (item.ValueKind == JsonValueKind.Object)
                    {
                        if (item.TryGetProperty("id", out var idEl)) Add(idEl.GetString());
                        else if (item.TryGetProperty("name", out var nameEl)) Add(nameEl.GetString());
                    }
                }
                if (models.Count > 0) break;
            }
            catch (Exception ex)
            {
                Log.Write("models parse", ex);
            }
        }

        Add(cfg.Model);
        Add(cfg.ImageModel);
        models.RemoveAll(m => m.Kind == "skip");
        if (models.Count == 0) Add(cfg.Model);
        return (cfg.Model, cfg.ImageModel, models);
    }

    private static string ModelKind(string id)
    {
        string s = id.ToLowerInvariant();
        if (s.Contains("embed") || s.Contains("whisper") || s.Contains("tts") || s.Contains("rerank") || s.Contains("clip"))
            return "skip";
        if (s.Contains("sdxl") || s.Contains("flux") || s.Contains("dall") || s.Contains("image") || s.Contains("sd3") || s.Contains("stable-diffusion"))
            return "image";
        return "chat";
    }

    private static IEnumerable<string> UrlCandidates(string url)
    {
        if (string.IsNullOrWhiteSpace(url)) yield break;
        url = url.Trim();
        yield return url;
        if (url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            yield return "http://" + url["https://".Length..];
    }

    private static async Task<HttpResponseMessage?> GetJson(string url, string apiKey, CancellationToken cancel)
    {
        foreach (string candidate in UrlCandidates(url))
        {
            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Get, candidate);
                if (!string.IsNullOrWhiteSpace(apiKey))
                    req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
                return await Http.SendAsync(req, cancel).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or OperationCanceledException)
            {
                Log.Write($"LLM GET unreachable {candidate}: {ex.GetType().Name}: {ex.Message}");
            }
        }
        return null;
    }

    private static async Task<HttpResponseMessage?> PostJson(string url, Dictionary<string, object?> payload, string apiKey, CancellationToken cancel)
    {
        foreach (string candidate in UrlCandidates(url))
        {
            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Post, candidate);
                req.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
                if (!string.IsNullOrWhiteSpace(apiKey))
                    req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
                return await Http.SendAsync(req, cancel).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or OperationCanceledException)
            {
                Log.Write($"LLM unreachable {candidate}: {ex.GetType().Name}: {ex.Message}");
            }
        }
        return null;
    }

    private static LlmReply ParseChat(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            JsonElement msg = default;
            if (root.TryGetProperty("choices", out var choices) && choices.GetArrayLength() > 0)
                msg = choices[0].GetProperty("message");
            else if (root.TryGetProperty("message", out var ow))
                msg = ow;

            string text = "";
            if (msg.ValueKind == JsonValueKind.Object && msg.TryGetProperty("content", out var content))
                text = ContentToString(content);

            var images = new List<string>();
            if (msg.ValueKind == JsonValueKind.Object && msg.TryGetProperty("images", out var imgs) && imgs.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in imgs.EnumerateArray())
                    CollectImage(item, images);
            }
            foreach (Match m in Regex.Matches(text, @"!\[[^\]]*\]\(([^)]+)\)"))
                images.Add(m.Groups[1].Value);

            return new LlmReply { Text = text, Images = images };
        }
        catch
        {
            return new LlmReply { Text = Trim(body, 400) };
        }
    }

    private static string ContentToString(JsonElement content)
    {
        if (content.ValueKind == JsonValueKind.String) return content.GetString() ?? "";
        if (content.ValueKind != JsonValueKind.Array) return content.ToString();
        var sb = new StringBuilder();
        foreach (var part in content.EnumerateArray())
        {
            if (part.ValueKind == JsonValueKind.String) sb.Append(part.GetString());
            else if (part.TryGetProperty("text", out var t)) sb.Append(t.GetString());
        }
        return sb.ToString();
    }

    private static void CollectImage(JsonElement item, List<string> images)
    {
        if (item.ValueKind == JsonValueKind.String)
        {
            images.Add(item.GetString() ?? "");
            return;
        }
        if (item.ValueKind != JsonValueKind.Object) return;
        if (item.TryGetProperty("b64_json", out var b64) && b64.ValueKind == JsonValueKind.String)
            images.Add("data:image/png;base64," + b64.GetString());
        else if (item.TryGetProperty("url", out var url) && url.ValueKind == JsonValueKind.String)
            images.Add(url.GetString() ?? "");
    }

    private static async Task ResolveRelativeImages(string webRoot, LlmReply reply, CancellationToken cancel)
    {
        var cfg = ReadComms(webRoot);
        string origin = SiteOrigin(cfg.Url, cfg.BaseUrl);
        for (int i = 0; i < reply.Images.Count; i++)
        {
            string src = reply.Images[i];
            if (string.IsNullOrWhiteSpace(src) || src.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
                continue;
            if (src.StartsWith("/", StringComparison.Ordinal))
                src = origin + src;
            if (!src.StartsWith("http", StringComparison.OrdinalIgnoreCase))
                continue;
            string? data = await FetchDataUrl(src, cfg.ApiKey, cancel).ConfigureAwait(false);
            if (data is not null) reply.Images[i] = data;
        }
    }

    private static async Task<string?> FetchDataUrl(string url, string apiKey, CancellationToken cancel)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            if (!string.IsNullOrWhiteSpace(apiKey))
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            using var res = await Http.SendAsync(req, cancel).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode) return null;
            byte[] bytes = await res.Content.ReadAsByteArrayAsync(cancel).ConfigureAwait(false);
            string mime = res.Content.Headers.ContentType?.MediaType ?? "image/png";
            return $"data:{mime};base64,{Convert.ToBase64String(bytes)}";
        }
        catch (Exception ex)
        {
            Log.Write($"image fetch failed {url}", ex);
            return null;
        }
    }

    private static string SiteOrigin(string url, string baseUrl)
    {
        string raw = string.IsNullOrWhiteSpace(url) ? baseUrl : url;
        if (Uri.TryCreate(raw, UriKind.Absolute, out var u))
            return u.GetLeftPart(UriPartial.Authority);
        return "https://ai.yakupov.xyz";
    }

    private static string Unreachable(string url) =>
        "UPLINK FAILED — cannot reach " + url;

    private static string HttpError(System.Net.HttpStatusCode code, string url, string body)
    {
        Log.Write($"LLM HTTP {(int)code} from {url}");
        if (code == System.Net.HttpStatusCode.Unauthorized)
            return "UPLINK 401 — token rejected. Check comms.apiKey (Open WebUI JWT).";
        return $"UPLINK {(int)code} — {Trim(body, 280)}";
    }

    private static LlmReply Fail(string text) => new() { Text = text };

    private static string EnhanceImagePrompt(string prompt)
    {
        string p = (prompt ?? "").Trim().TrimEnd('.');
        if (p.Length == 0) p = "cinematic still";
        if (p.Contains("coherent anatomy", StringComparison.OrdinalIgnoreCase)
            && p.Contains("photorealistic", StringComparison.OrdinalIgnoreCase))
            return p;
        return p + ". " + ImageQuality;
    }

    private static (string Url, string BaseUrl, string Path, string Model, string ImageModel, string Negative, string ApiKey, double Temperature, string System) ReadComms(string webRoot)
    {
        string path = "chat/completions";
        string model = "llama-70b";
        string imageModel = "sdxl";
        string negative = ImageNegative;
        string baseUrl = "";
        string url = "";
        string key = "";
        double temp = 0.7;
        string system = DefaultSystem;
        try
        {
            string file = Path.Combine(webRoot, "config.json");
            if (!File.Exists(file)) return (url, baseUrl, path, model, imageModel, negative, key, temp, system);
            using var doc = JsonDocument.Parse(File.ReadAllText(file));
            if (!doc.RootElement.TryGetProperty("comms", out var c)) return (url, baseUrl, path, model, imageModel, negative, key, temp, system);
            if (c.TryGetProperty("url", out var fu)) url = fu.GetString() ?? "";
            if (c.TryGetProperty("baseUrl", out var u)) baseUrl = u.GetString() ?? "";
            if (c.TryGetProperty("path", out var p) && p.GetString() is string ps && ps.Length > 0) path = ps.TrimStart('/');
            if (c.TryGetProperty("model", out var m) && m.GetString() is string ms && ms.Length > 0) model = ms;
            if (c.TryGetProperty("imageModel", out var im) && im.GetString() is string ims && ims.Length > 0) imageModel = ims;
            if (c.TryGetProperty("negativePrompt", out var np) && np.GetString() is string nps && nps.Length > 0) negative = nps;
            if (c.TryGetProperty("apiKey", out var k)) key = k.GetString() ?? "";
            if (c.TryGetProperty("temperature", out var t) && t.TryGetDouble(out double td)) temp = td;
            if (c.TryGetProperty("system", out var s) && s.GetString() is string ss && ss.Length > 0) system = ss;
        }
        catch (Exception ex)
        {
            Log.Write("comms config unreadable", ex);
        }
        key = ResolveApiKey(key);
        return (url.Trim(), baseUrl.TrimEnd('/'), path, model, imageModel, negative, key, temp, system);
    }

    /// <summary>
    /// config.json is copied from the repo on every publish, so the JWT lives in
    /// %LOCALAPPDATA%\Backdrop\comms.secret (or COMMS_API_KEY) instead.
    /// </summary>
    private static string ResolveApiKey(string fromConfig)
    {
        if (!string.IsNullOrWhiteSpace(fromConfig)) return fromConfig.Trim();
        foreach (string name in new[] { "COMMS_API_KEY", "OPENWEBUI_API_KEY", "XAI_API_KEY" })
        {
            string? env = Environment.GetEnvironmentVariable(name);
            if (!string.IsNullOrWhiteSpace(env)) return env.Trim();
        }
        try
        {
            string secret = Path.Combine(Log.Folder, "comms.secret");
            if (File.Exists(secret))
            {
                string text = File.ReadAllText(secret).Trim();
                if (text.Length > 0) return text;
            }
        }
        catch (Exception ex)
        {
            Log.Write("comms.secret unreadable", ex);
        }
        return "";
    }

    private static string Join(string baseUrl, string path)
    {
        string b = baseUrl.TrimEnd('/');
        string p = path.TrimStart('/');
        if (b.EndsWith("/chat/completions", StringComparison.OrdinalIgnoreCase)) return b;
        if (string.IsNullOrEmpty(b)) return p;
        return b + "/" + p;
    }

    private static string Trim(string s, int n) => s.Length <= n ? s : s[..n] + "…";
}
