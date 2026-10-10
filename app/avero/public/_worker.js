/**
 * Cloudflare Pages advanced-mode worker (_worker.js).
 * ----------------------------------------------------------------------------
 * Maintenance-mode edge enforcement for Avero.
 *
 * This file is placed in `public/` so Vite copies it verbatim to the root of
 * the build output (`dist/_worker.js`), which activates Cloudflare Pages
 * "advanced mode". Every request to the Pages deployment is handled here,
 * regardless of how the Pages project's root directory is configured — the
 * build output of the Vite app is the deployment, so no dashboard-side
 * function placement is required.
 *
 * Maintenance switch (operator-controlled):
 *   Set the environment variable `MAINTENANCE_MODE=true` (any casing) on the
 *   Cloudflare Pages project (Production and/or Preview environments) and
 *   deploy. Unset or any other value disables maintenance. The switch is
 *   read from the environment on every request — no client-side state,
 *   cookie, query parameter, or localStorage is involved, and ordinary users
 *   cannot influence it.
 *
 * Behavior when maintenance is ENABLED:
 *   - Only the maintenance page, the Learn More page, and the small set of
 *     assets they reference are served (via the ASSETS binding, so the
 *     correct HTML files are returned — never the SPA shell).
 *   - Every other request — all SPA routes, sign-in routes, hashed JS/CSS
 *     bundles, public assets, unknown paths, and non-GET/HEAD methods —
 *     receives `503 Service Unavailable` with `Cache-Control: no-store`.
 *   - All served responses during maintenance carry `Cache-Control: no-store`
 *     so browsers and CDNs do not retain app or maintenance content.
 *
 * Behavior when maintenance is DISABLED:
 *   - Pure pass-through: `env.ASSETS.fetch(request)` serves the normal SPA
 *     exactly as before, including the SPA fallback for client-side routes.
 *     (The maintenance pages remain reachable at /maintenance and
 *     /maintenance/learn-more via normal static asset routing.)
 *
 * Fail-closed: the entire handler is wrapped so that any unexpected error —
 * including a missing ASSETS binding or a failure while reading the
 * maintenance configuration — results in `503 Service Unavailable` rather
 * than accidentally serving the application.
 *
 * Scope note: this blocks access through the Avero website (the Pages
 * deployment). It does not independently disable direct access to backend
 * services (Supabase REST/Auth/Edge Functions or the media proxy).
 * ----------------------------------------------------------------------------
 */

/** Static assets required by the maintenance pages (exact paths). */
const MAINTENANCE_ASSETS = new Set([
  "/avero-logo.png",
  "/favicon.ico",
  "/favicon.svg",
  "/icons.svg",
]);

/** HTML body returned for blocked requests (kept generic and tiny). */
const BLOCKED_BODY =
  "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
  "<meta name=\"robots\" content=\"noindex\">" +
  "<title>Service unavailable</title></head><body>" +
  "<p>Avero is temporarily unavailable.</p></body></html>";

/**
 * Reads the operator-controlled maintenance switch from the environment.
 * Only the exact value `true` (case-insensitive, trimmed) enables maintenance.
 */
function isMaintenanceEnabled(env) {
  return String(env.MAINTENANCE_MODE ?? "").trim().toLowerCase() === "true";
}

/** Builds a 503 response with no-store caching headers. */
function blockedResponse() {
  return new Response(BLOCKED_BODY, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/** Wraps an ASSETS response with no-store caching headers. */
function withNoStore(response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Fetches a specific asset path from the ASSETS binding. */
async function fetchAsset(env, request, assetPath) {
  const assetUrl = new URL(assetPath, request.url);
  const response = await env.ASSETS.fetch(assetUrl);
  return withNoStore(response);
}

/**
 * Resolves an allowed maintenance-mode request to the exact static asset.
 * Returns null for anything not on the allowlist (caller responds 503).
 */
function resolveMaintenanceRequest(pathname) {
  // The two maintenance pages — normalize all URL shapes to the exact HTML
  // files so the correct page is served rather than an SPA fallback.
  switch (pathname) {
    case "/maintenance":
    case "/maintenance/":
    case "/maintenance/index.html":
      return "/maintenance/index.html";
    case "/maintenance/learn-more":
    case "/maintenance/learn-more/":
    case "/maintenance/learn-more/index.html":
      return "/maintenance/learn-more/index.html";
  }

  // Assets the maintenance pages reference.
  if (MAINTENANCE_ASSETS.has(pathname)) {
    return pathname;
  }

  return null;
}

export default {
  async fetch(request, env) {
    // Fail-closed guard: if the environment or ASSETS binding is missing, we
    // cannot safely serve the application — block instead.
    if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== "function") {
      return blockedResponse();
    }

    try {
      // Maintenance disabled — pure pass-through to normal static/SPA serving.
      if (!isMaintenanceEnabled(env)) {
        return env.ASSETS.fetch(request);
      }

      // Maintenance enabled — serve only the allowlisted maintenance content.
      const url = new URL(request.url);

      if (request.method !== "GET" && request.method !== "HEAD") {
        return blockedResponse();
      }

      const assetPath = resolveMaintenanceRequest(url.pathname);
      if (assetPath === null) {
        return blockedResponse();
      }

      return await fetchAsset(env, request, assetPath);
    } catch (error) {
      // Any unexpected error during handling must not reopen access.
      // Logged (without sensitive detail) so an operator can diagnose why
      // the maintenance content failed to serve — e.g. a missing binding.
      console.error("[maintenance] request handling failed:", error);
      return blockedResponse();
    }
  },
};
