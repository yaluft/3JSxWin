// LlmClient.cs — the "Comms" uplink. All HTTP to the LLM backend (ai.yakupov.xyz,
// an Open WebUI / LiteLLM box) lives here, in the WPF host process. The Comms panel
// in the WebView calls in through host.js; the host does the network so the page
// never has to deal with CORS, bearer tokens, or auth'd image URLs.

using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Backdrop.Startup;

namespace Backdrop;

// One normalized answer from any of the endpoints below: the assistant text plus
// any images. Images end up as data: URIs by the time the page sees them (see
// ResolveRelativeImages) so the WebView can render them with no extra fetch/auth.
internal sealed class LlmReply
{
    public string Text { get; init; } = "";
    public List<string> Images { get; init; } = new();
}

/// <summary>OpenAI-compatible chat, file upload, and image gen against Open WebUI / LiteLLM.
/// Runs in the host so the WebView does not have to fight CORS or auth on file URLs.</summary>
internal static class LlmClient
{
    // One shared HttpClient for the whole app — creating one per call leaks sockets.
    // ConnectTimeout is short (8s) so an unreachable box fails fast and we can show
    // "UPLINK FAILED"; the overall Timeout is long (3min) because image generation
    // and big chat completions genuinely take that long.
    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        ConnectTimeout = TimeSpan.FromSeconds(8),
    })
    { Timeout = TimeSpan.FromMinutes(3) };

    // The main chat call. webRoot points at the published web folder (where config.json
    // lives); messages/files come straight from the page as raw JSON; imagine flips on
    // the Open WebUI image-generation feature flag. Returns a normalized LlmReply — the
    // caller never sees an exception, only a Fail() reply with a human-readable message.
    internal static async Task<LlmReply> CompleteAsync(string webRoot, JsonElement messages, JsonElement files, bool imagine, CancellationToken cancel, string? model = null)
    {
        var cfg = ReadComms(webRoot);
        if (string.IsNullOrWhiteSpace(cfg.Url) && string.IsNullOrWhiteSpace(cfg.BaseUrl))
            return Fail("NO UPLINK — set comms.url in config.json.");

        // Endpoint resolution: an explicit comms.url wins; otherwise glue baseUrl + path
        // ("chat/completions"). Per-call model override beats the config default.
        string url = string.IsNullOrWhiteSpace(cfg.Url) ? Join(cfg.BaseUrl, cfg.Path) : cfg.Url.Trim();
        string useModel = string.IsNullOrWhiteSpace(model) ? cfg.Model : model.Trim();

        // OpenAI chat shape: a "messages" array, our system prompt pinned first, then
        // the page's turns appended verbatim (we re-serialize each element as-is).
        var chat = new List<object> { new { role = "system", content = cfg.System } };
        if (messages.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in messages.EnumerateArray())
                chat.Add(JsonSerializer.Deserialize<object>(item.GetRawText())!);
        }

        // The request body. stream=false: we want the whole answer in one response so
        // ParseChat can pull text + images out of it — the page has no SSE reader, and
        // host.js round-trips a single JSON blob, not a token stream.
        var payload = new Dictionary<string, object?>
        {
            ["model"] = useModel,
            ["messages"] = chat,
            ["temperature"] = cfg.Temperature,
            ["stream"] = false,
        };
        // "files" is Open WebUI's RAG attachment array (ids from UploadAsync). Only sent
        // when non-empty so a plain OpenAI backend doesn't choke on an unknown field.
        if (files.ValueKind == JsonValueKind.Array && files.GetArrayLength() > 0)
            payload["files"] = JsonSerializer.Deserialize<object>(files.GetRawText());
        // Open WebUI extension: ask the chat model to also emit an image inline.
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

            // Parse the completion, then walk its images: any that came back as a
            // relative/absolute site URL gets fetched here and inlined as a data: URI
            // so the sandboxed WebView can show it without an authenticated request.
            var reply = ParseChat(body);
            await ResolveRelativeImages(webRoot, reply, cancel).ConfigureAwait(false);
            return reply;
        }
    }

    // Push a file to Open WebUI's file store and get back an id the next CompleteAsync
    // call can reference in its "files" array (that's how RAG / "chat with this doc"
    // works). multipart/form-data, one "file" part. Returns null on any failure —
    // the caller just tells the user the upload didn't take.
    internal static async Task<(string Id, string Name)?> UploadAsync(string webRoot, string name, string mime, byte[] bytes, CancellationToken cancel)
    {
        var cfg = ReadComms(webRoot);
        // Uploads always go to the site root's REST API, not the chat/completions URL,
        // so derive the bare scheme://host from whatever endpoint config we have.
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
        // Response carries the stored id (what we need) and the server-side filename
        // (which may differ from what we sent — fall back to our name if it's missing).
        using var doc = JsonDocument.Parse(body);
        string id = doc.RootElement.TryGetProperty("id", out var idEl) ? idEl.GetString() ?? "" : "";
        string fn = doc.RootElement.TryGetProperty("filename", out var nEl) ? nEl.GetString() ?? name : name;
        if (id.Length == 0) return null;
        return (id, fn);
    }

    // --- Prompt constants -----------------------------------------------------
    // These are the built-in fallbacks used when config.json's "comms" block does
    // not override them. The persona is a terse "uplink computer" that briefs an
    // image model in camera terms; the quality/negative strings are standard
    // Stable-Diffusion-style steering (push photoreal, forbid the usual artifacts).
    // Documented here as-is; they are plain string literals with no behavior.

    private const string DefaultSystem =
        "You are COMMS, the quiet uplink computer on a long-range probe. Short answers. No corporate tone. You can see nothing of the user's desktop. " +
        "When a visual is requested, specify an adult subject, body and clothing (or none), pose, setting, lens (85mm/50mm), and light as if briefing a camera — never minors. " +
        "Push photoreal quality: natural skin texture, coherent anatomy, cinematic rim light, shallow depth of field, film grain, highly detailed. " +
        "Never describe extra fingers or limbs, mutated hands, fused/missing fingers, watermarks, text, logos, blur, cartoons, plastic skin, 3d render, mosaics, or anyone under 18.";

    private const string ImageQuality =
        "Photorealistic, sharp focus, natural skin texture, coherent anatomy, cinematic rim light, 85mm lens, shallow depth of field, highly detailed, film grain.";

    private const string ImageNegative =
        "child, teen, underage, loli, baby, extra fingers, extra limbs, mutated hands, deformed, bad anatomy, fused fingers, missing fingers, extra heads, watermark, text, logo, blurry, lowres, jpeg artifacts, oversaturated, plastic skin, 3d render, cartoon, worst quality, cropped, out of frame, duplicate, censored, mosaic";

    // Direct text-to-image call, separate from chat. Hits the OpenAI-style
    // /images/generations endpoint. Prompt gets the quality tail appended and a
    // negative prompt attached; result images are inlined as data: URIs like everywhere.
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
        // Not every backend accepts "negative_prompt" as a top-level field — some
        // return 400. On a 400, retry once without it and fold the key negatives into
        // the prompt text as an "Avoid:" clause so we still get a usable image.
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

            // The response is either a bare array of image objects or {"data":[...]}.
            // Accept both. Parse failures are logged, not thrown — we still return a
            // reply, just with no images.
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

    // One-line status string for the Comms panel header: which chat model, which
    // image model, and whether a token is in play. Does no network — just reads
    // config — so the panel can show it instantly without a round-trip.
    internal static string CarrierStatus(string webRoot, string? model = null)
    {
        var cfg = ReadComms(webRoot);
        string target = string.IsNullOrWhiteSpace(cfg.Url) ? Join(cfg.BaseUrl, cfg.Path) : cfg.Url;
        if (string.IsNullOrWhiteSpace(target)) return "NO CARRIER";
        string auth = string.IsNullOrWhiteSpace(cfg.ApiKey) ? "AUTH OFF" : "AUTH ON";
        string use = string.IsNullOrWhiteSpace(model) ? cfg.Model : model.Trim();
        return $"CARRIER {use} · img {cfg.ImageModel} · {auth}";
    }

    // Populate the model dropdown in the Comms panel. Tries both the Open WebUI and
    // the plain OpenAI models paths, dedupes, drops models we can't chat/draw with
    // (embeddings, whisper, rerankers), and always folds in the configured defaults
    // so the current pick is selectable even if the list endpoint is down.
    internal static async Task<(string Current, string ImageModel, List<(string Id, string Kind)> Models)> ListModelsAsync(string webRoot, CancellationToken cancel)
    {
        var cfg = ReadComms(webRoot);
        var models = new List<(string Id, string Kind)>();
        // Local add-with-dedupe: skips blanks and case-insensitive repeats, tags each
        // id as chat/image/skip so the panel can group them.
        void Add(string? id)
        {
            if (string.IsNullOrWhiteSpace(id)) return;
            id = id.Trim();
            if (models.Any(m => string.Equals(m.Id, id, StringComparison.OrdinalIgnoreCase))) return;
            models.Add((id, ModelKind(id)));
        }

        // Open WebUI serves /api/models; a raw OpenAI/LiteLLM box serves /api/v1/models.
        // Try both, take the first that yields anything.
        string origin = SiteOrigin(cfg.Url, cfg.BaseUrl);
        foreach (string path in new[] { "/api/models", "/api/v1/models" })
        {
            using var res = await GetJson(origin + path, cfg.ApiKey, cancel).ConfigureAwait(false);
            if (res is null || !res.IsSuccessStatusCode) continue;
            string body = await res.Content.ReadAsStringAsync(cancel).ConfigureAwait(false);
            try
            {
                // Shape varies: {"data":[...]} or a bare array; entries are either
                // strings or objects with "id" (preferred) or "name".
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

        // Always make sure the configured chat + image models are in the list, then
        // drop the un-pickable kinds. If everything got filtered out, put the chat
        // default back so the dropdown is never empty.
        Add(cfg.Model);
        Add(cfg.ImageModel);
        models.RemoveAll(m => m.Kind == "skip");
        if (models.Count == 0) Add(cfg.Model);
        return (cfg.Model, cfg.ImageModel, models);
    }

    // Rough classifier by name substring — the API rarely tells us a model's type.
    // "skip" = can't use it in this UI (embeddings, speech, rerank, CLIP);
    // "image" = a diffusion model for ImagineAsync; everything else is "chat".
    private static string ModelKind(string id)
    {
        string s = id.ToLowerInvariant();
        if (s.Contains("embed") || s.Contains("whisper") || s.Contains("tts") || s.Contains("rerank") || s.Contains("clip"))
            return "skip";
        if (s.Contains("sdxl") || s.Contains("flux") || s.Contains("dall") || s.Contains("image") || s.Contains("sd3") || s.Contains("stable-diffusion"))
            return "image";
        return "chat";
    }

    // Yields the URL to try, then — if it was https — the same URL as http. Lets a
    // self-hosted box with a bad/self-signed cert or plain-HTTP-only setup still
    // connect after the TLS attempt fails, without the user editing config.
    private static IEnumerable<string> UrlCandidates(string url)
    {
        if (string.IsNullOrWhiteSpace(url)) yield break;
        url = url.Trim();
        yield return url;
        if (url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            yield return "http://" + url["https://".Length..];
    }

    // GET with optional bearer auth, walking the http fallback candidates. Returns
    // null (not throws) when every candidate is unreachable — network errors are
    // logged and turned into a null so callers can show "UPLINK FAILED".
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

    // POST a JSON body with optional bearer auth, same http fallback and same
    // null-on-unreachable contract as GetJson. The caller reads the status code off
    // the returned response (e.g. ImagineAsync retries on 400).
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

    // Pull text + images out of a chat completion body. Handles both the OpenAI shape
    // ({"choices":[{"message":{...}}]}) and Open WebUI's flatter {"message":{...}}.
    // If the JSON is unparseable we degrade gracefully to the first 400 chars as text.
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

            // Images can arrive two ways: a structured "images" array on the message
            // (Open WebUI), or Markdown image syntax embedded in the reply text. Grab
            // both — ResolveRelativeImages later turns whatever we collected into data URIs.
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

    // "content" is a plain string on most backends but an array of typed parts on
    // vision-style responses ([{type:"text",text:"..."}, ...]). Flatten to one string.
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

    // Normalize one image entry from an API response into a URL or data: URI.
    // A bare string is taken as-is; an object may carry "b64_json" (wrap as a PNG
    // data URI) or "url" (an http link we'll fetch and inline later).
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

    // Turn every http(s) image reference in the reply into a self-contained data: URI.
    // Why: the WebView runs from a virtual host with a strict CSP and no credentials,
    // so it can't fetch an authenticated image off the LLM box. We fetch it here (we
    // have the token) and hand the page bytes it can render directly. data: URIs and
    // non-http schemes are left alone; a leading "/" is resolved against the site origin.
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

    // GET the bytes at url (with bearer auth) and encode them as a data: URI, keeping
    // whatever MIME type the server reported. Returns null on any failure so the
    // caller keeps the original URL rather than blanking the image.
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

    // Reduce any configured endpoint to just "scheme://host[:port]" — the base the
    // REST/upload/models paths hang off. Falls back to the known production host if
    // nothing parses, so the panel still works with a half-filled config.
    private static string SiteOrigin(string url, string baseUrl)
    {
        string raw = string.IsNullOrWhiteSpace(url) ? baseUrl : url;
        if (Uri.TryCreate(raw, UriKind.Absolute, out var u))
            return u.GetLeftPart(UriPartial.Authority);
        return "https://ai.yakupov.xyz";
    }

    // --- Error-message helpers: all produce the terse "UPLINK ..." strings the
    // Comms panel prints verbatim, and log the real detail to backdrop.log. ---

    private static string Unreachable(string url) =>
        "UPLINK FAILED — cannot reach " + url;

    private static string HttpError(System.Net.HttpStatusCode code, string url, string body)
    {
        Log.Write($"LLM HTTP {(int)code} from {url}");
        // 401 gets a specific hint because it's the common setup mistake — the
        // Open WebUI JWT in comms.apiKey / comms.secret is wrong or expired.
        if (code == System.Net.HttpStatusCode.Unauthorized)
            return "UPLINK 401 — token rejected. Check comms.apiKey (Open WebUI JWT).";
        return $"UPLINK {(int)code} — {Trim(body, 280)}";
    }

    private static LlmReply Fail(string text) => new() { Text = text };

    // Append the standard photoreal "quality tail" to a user prompt, unless the
    // prompt already looks like it carries its own steering (so we don't double up).
    private static string EnhanceImagePrompt(string prompt)
    {
        string p = (prompt ?? "").Trim().TrimEnd('.');
        if (p.Length == 0) p = "cinematic still";
        if (p.Contains("coherent anatomy", StringComparison.OrdinalIgnoreCase)
            && p.Contains("photorealistic", StringComparison.OrdinalIgnoreCase))
            return p;
        return p + ". " + ImageQuality;
    }

    // Load the "comms" block from the published config.json into a tuple of settings.
    // config.json is overwritten from the repo on every publish, so anything that
    // shouldn't be committed (the API token) is resolved separately — see ResolveApiKey.
    // Any read/parse error is logged and we return the built-in defaults rather than throw.
    private static (string Url, string BaseUrl, string Path, string Model, string ImageModel, string Negative, string ApiKey, double Temperature, string System) ReadComms(string webRoot)
    {
        // Defaults, used when config.json is missing or the "comms" block is absent.
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
            // Each key overrides its default only when present and non-empty, so a
            // partial "comms" block still gets sensible values for the rest.
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
        // The token from config is only the first choice — env vars and the local
        // secret file take over when it's blank. Trim trailing "/" off baseUrl so
        // Join doesn't produce a double slash.
        key = ResolveApiKey(key);
        return (url.Trim(), baseUrl.TrimEnd('/'), path, model, imageModel, negative, key, temp, system);
    }

    /// <summary>
    /// config.json is copied from the repo on every publish, so the JWT lives in
    /// %LOCALAPPDATA%\Backdrop\comms.secret (or COMMS_API_KEY) instead.
    /// </summary>
    // Secret resolution order, first hit wins:
    //   1. comms.apiKey from config.json (dev convenience — don't commit a real one)
    //   2. env var: COMMS_API_KEY, then OPENWEBUI_API_KEY, then XAI_API_KEY
    //   3. %LOCALAPPDATA%\Backdrop\comms.secret  (Log.Folder + "comms.secret")
    // The file lives next to the log so it survives a republish and never enters the repo.
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

    // Glue baseUrl + path into a completions URL. Guards: if baseUrl already ends in
    // "/chat/completions" use it as-is (config gave a full URL via baseUrl), and skip
    // the separator when one side is empty.
    private static string Join(string baseUrl, string path)
    {
        string b = baseUrl.TrimEnd('/');
        string p = path.TrimStart('/');
        if (b.EndsWith("/chat/completions", StringComparison.OrdinalIgnoreCase)) return b;
        if (string.IsNullOrEmpty(b)) return p;
        return b + "/" + p;
    }

    // Truncate long server error bodies for display, with an ellipsis so it's clear
    // the message was cut.
    private static string Trim(string s, int n) => s.Length <= n ? s : s[..n] + "…";
}
