const PAGES: Record<string, string> = {
  "/": "/index.html",
  "/install": "/install.html",
  "/install/": "/install.html",
  "/scene": "/scene/index.html",
  "/scene/": "/scene/index.html",
};

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.hostname === "www.yakupov.xyz") {
      url.hostname = "yakupov.xyz";
      return Response.redirect(url.toString(), 301);
    }

    const mapped = PAGES[url.pathname];
    if (mapped) url.pathname = mapped;

    const assetResponse = await env.ASSETS.fetch(mapped ? new Request(url, request) : request);
    const headers = new Headers(assetResponse.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("X-Frame-Options", "SAMEORIGIN");

    if (url.pathname.endsWith(".ps1")) {
      headers.set("Content-Type", "text/plain; charset=utf-8");
      headers.set("Cache-Control", "no-store");
    } else if (url.pathname.endsWith(".zip")) {
      headers.set("Content-Type", "application/zip");
      headers.set("Content-Disposition", 'attachment; filename="3jsxwin-win-x64.zip"');
    } else if (url.pathname.includes("/vendor/")) {
      headers.set("Cache-Control", "public, max-age=86400");
    } else if (url.pathname.endsWith(".js") || url.pathname.endsWith(".html") || url.pathname.endsWith(".json")) {
      headers.set("Cache-Control", "no-cache");
    }

    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;
