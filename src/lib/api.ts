import { Hono } from "hono";
import {
  getSessionCookie,
  validateSession,
  createSession,
  findOrCreateUser,
  setSessionCookieHeader,
  clearSessionCookieHeader,
  deleteSession,
  getOAuthStateCookie,
  setOAuthStateCookieHeader,
  clearOAuthStateCookieHeader,
} from "./auth";
import {
  lookupNamespace,
  claimNamespace,
  addNamespaceUrl,
  urlExistsForNamespace,
  getRecentNamespacesWithCount,
  getUserNamespaces,
  searchNamespaces,
  isValidSlug,
  isValidHttpUrl,
} from "./db";

type Bindings = {
  DB: D1Database;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  GITHUB_TOKEN?: string;
};

type D1Database = import("@cloudflare/workers-types").D1Database;

const app = new Hono<{ Bindings: Bindings }>().basePath("/api");

const MAX_SEARCH_QUERY_LENGTH = 100;
const ALLOWED_PROJECT_TYPES = new Set(["CLI", "MCP", "App", "SDK", "Plugin", "Other"]);

function hasInvalidMutationOrigin(request: Request): boolean {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;

  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") return true;

  const origin = request.headers.get("origin");
  if (!origin) {
    return secFetchSite !== "same-origin" && secFetchSite !== "same-site";
  }

  try {
    return new URL(origin).origin !== new URL(request.url).origin;
  } catch {
    return true;
  }
}

async function fetchGitHubStars(url: string, token?: string): Promise<number> {
  try {
    const match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/?#]+)/);
    if (!match) return 0;
    const [, owner, repo] = match;
    const headers: Record<string, string> = {
      "User-Agent": "folder-app",
      Accept: "application/vnd.github+json",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo.replace(/\.git$/, "")}`, { headers });
    if (!res.ok) return 0;
    const data = (await res.json()) as { stargazers_count?: number };
    return data.stargazers_count ?? 0;
  } catch {
    return 0;
  }
}

app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  c.res.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  c.res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=()");
  c.res.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://avatars.githubusercontent.com; connect-src 'self'; frame-ancestors 'none'",
  );
});

// ── Auth: start GitHub OAuth ──
app.get("/auth/github", (c) => {
  const clientId = c.env.GITHUB_CLIENT_ID;
  const redirectUri = new URL("/api/auth/github/callback", c.req.url).toString();
  const state = crypto.randomUUID();
  const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user%20user:email&state=${state}`;
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      "Set-Cookie": setOAuthStateCookieHeader(state),
    },
  });
});

// ── Auth: GitHub OAuth callback ──
app.get("/auth/github/callback", async (c) => {
  const redirectWithStateCleared = (location: string) =>
    new Response(null, {
      status: 302,
      headers: {
        Location: location,
        "Set-Cookie": clearOAuthStateCookieHeader(),
      },
    });

  const code = c.req.query("code");
  const state = c.req.query("state");
  const stateCookie = getOAuthStateCookie(c.req.raw);
  if (!code) {
    return redirectWithStateCleared("/?error=missing_code");
  }
  if (!state || !stateCookie || state !== stateCookie) {
    return redirectWithStateCleared("/?error=invalid_state");
  }

  // Exchange code for access token
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  if (!tokenRes.ok) {
    return redirectWithStateCleared("/?error=token_request_failed");
  }
  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
  };
  if (tokenData.error || !tokenData.access_token) {
    return redirectWithStateCleared("/?error=token_missing");
  }

  // Fetch GitHub user profile
  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "User-Agent": "folder-app",
    },
  });

  if (!userRes.ok) {
    return redirectWithStateCleared("/?error=user_request_failed");
  }
  const ghUser = (await userRes.json()) as {
    id: number;
    login: string;
    name: string | null;
    avatar_url: string;
  };
  if (!ghUser.id || !ghUser.login) {
    return redirectWithStateCleared("/?error=user_data_incomplete");
  }

  // Find or create user
  const userId = await findOrCreateUser(
    c.env.DB,
    "github",
    String(ghUser.id),
    ghUser.login,
    ghUser.name,
    ghUser.avatar_url,
  );

  // Create session
  const sessionId = await createSession(c.env.DB, userId);

  const headers = new Headers();
  headers.set("Location", "/");
  headers.append("Set-Cookie", setSessionCookieHeader(sessionId));
  headers.append("Set-Cookie", clearOAuthStateCookieHeader());

  return new Response(null, {
    status: 302,
    headers,
  });
});

// ── Auth: logout ──
app.post("/auth/logout", async (c) => {
  if (hasInvalidMutationOrigin(c.req.raw)) {
    return c.text("Forbidden", 403);
  }

  const sessionId = getSessionCookie(c.req.raw);
  if (sessionId) {
    await deleteSession(c.env.DB, sessionId);
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": clearSessionCookieHeader(),
    },
  });
});

// ── Auth: current user info ──
app.get("/auth/me", async (c) => {
  const sessionId = getSessionCookie(c.req.raw);
  if (!sessionId) {
    return c.json({ user: null });
  }
  const user = await validateSession(c.env.DB, sessionId);
  return c.json({ user });
});

// ── Namespace: lookup ──
app.get("/namespaces/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!isValidSlug(slug)) {
    return c.json({ error: "Invalid namespace slug" }, 400);
  }

  const ns = await lookupNamespace(c.env.DB, slug);
  if (!ns) {
    return c.json({ available: true, slug });
  }

  return c.json({
    available: false,
    slug,
    namespace: ns,
  });
});

// ── Namespace: claim ──
app.post("/namespaces", async (c) => {
  if (hasInvalidMutationOrigin(c.req.raw)) {
    return c.json({ error: "Invalid request origin" }, 403);
  }

  const sessionId = getSessionCookie(c.req.raw);
  if (!sessionId) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const user = await validateSession(c.env.DB, sessionId);
  if (!user) {
    return c.json({ error: "Invalid session" }, 401);
  }

  let body: {
    slug: string;
    project_name: string;
    project_type?: string;
    description?: string;
    url: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.slug || !body.project_name || !body.url) {
    return c.json({ error: "Missing required fields: slug, project_name, url" }, 400);
  }

  if (!isValidSlug(body.slug)) {
    return c.json({ error: "Invalid namespace slug" }, 400);
  }
  if (body.project_name.length > 100) {
    return c.json({ error: "Project name must be 100 characters or fewer" }, 400);
  }
  if (body.url.length > 2048) {
    return c.json({ error: "URL must be 2048 characters or fewer" }, 400);
  }
  if (body.description && body.description.length > 500) {
    return c.json({ error: "Description must be 500 characters or fewer" }, 400);
  }
  if (!isValidHttpUrl(body.url)) {
    return c.json({ error: "Invalid URL" }, 400);
  }

  const projectType = body.project_type || "Other";
  if (!ALLOWED_PROJECT_TYPES.has(projectType)) {
    return c.json({ error: "Invalid project type" }, 400);
  }

  try {
    const result = await claimNamespace(
      c.env.DB,
      body.slug,
      body.project_name,
      projectType,
      body.description || null,
      user.id,
      body.url,
      await fetchGitHubStars(body.url, c.env.GITHUB_TOKEN),
    );

    return c.json({ success: true, id: result.id }, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("UNIQUE") || message.includes("unique") || message.includes("constraint")) {
      return c.json({ error: "Namespace already claimed" }, 409);
    }
    throw err;
  }
});

// ── Namespace: add URL to existing namespace ──
app.post("/namespaces/:slug/urls", async (c) => {
  if (hasInvalidMutationOrigin(c.req.raw)) {
    return c.json({ error: "Invalid request origin" }, 403);
  }

  const sessionId = getSessionCookie(c.req.raw);
  if (!sessionId) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const user = await validateSession(c.env.DB, sessionId);
  if (!user) {
    return c.json({ error: "Invalid session" }, 401);
  }

  const slug = c.req.param("slug");
  if (!isValidSlug(slug)) {
    return c.json({ error: "Invalid namespace slug" }, 400);
  }

  const ns = await lookupNamespace(c.env.DB, slug);
  if (!ns) {
    return c.json({ error: "Namespace not found" }, 404);
  }

  let body: { url: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.url) {
    return c.json({ error: "Missing required field: url" }, 400);
  }
  if (body.url.length > 2048) {
    return c.json({ error: "URL must be 2048 characters or fewer" }, 400);
  }
  if (!isValidHttpUrl(body.url)) {
    return c.json({ error: "Invalid URL" }, 400);
  }

  const duplicate = await urlExistsForNamespace(c.env.DB, ns.id, body.url);
  if (duplicate) {
    return c.json({ error: "URL already registered for this namespace" }, 409);
  }

  await addNamespaceUrl(c.env.DB, ns.id, body.url, user.id, await fetchGitHubStars(body.url, c.env.GITHUB_TOKEN));
  return c.json({ success: true }, 201);
});

// ── Namespace: search ──
app.get("/search", async (c) => {
  const q = c.req.query("q");
  if (!q || q.trim().length === 0) {
    return c.json({ results: [] });
  }
  const trimmed = q.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
  const results = await searchNamespaces(c.env.DB, trimmed);
  return c.json({ results });
});

// ── Namespace: list recent ──
app.get("/namespaces", async (c) => {
  const { namespaces, count } = await getRecentNamespacesWithCount(c.env.DB);
  return c.json({ namespaces, total: count });
});

// ── User: my namespaces ──
app.get("/user/namespaces", async (c) => {
  const sessionId = getSessionCookie(c.req.raw);
  if (!sessionId) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const user = await validateSession(c.env.DB, sessionId);
  if (!user) {
    return c.json({ error: "Invalid session" }, 401);
  }

  const namespaces = await getUserNamespaces(c.env.DB, user.id);
  return c.json({ namespaces });
});

export default app;
