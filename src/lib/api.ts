import { Hono } from "hono";
import {
  getSessionCookie,
  validateSession,
  createSession,
  findOrCreateUser,
  setSessionCookieHeader,
  clearSessionCookieHeader,
  deleteSession,
} from "./auth";
import {
  lookupNamespace,
  claimNamespace,
  addNamespaceUrl,
  getRecentNamespaces,
  getNamespaceCount,
  getUserNamespaces,
  isValidSlug,
} from "./db";

type Bindings = {
  DB: D1Database;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
};

type D1Database = import("@cloudflare/workers-types").D1Database;

const app = new Hono<{ Bindings: Bindings }>().basePath("/api");

// ── Auth: start GitHub OAuth ──
app.get("/auth/github", (c) => {
  const clientId = c.env.GITHUB_CLIENT_ID;
  const redirectUri = new URL("/api/auth/github/callback", c.req.url).toString();
  const state = crypto.randomUUID();
  const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user%20user:email&state=${state}`;
  return c.redirect(url);
});

// ── Auth: GitHub OAuth callback ──
app.get("/auth/github/callback", async (c) => {
  const code = c.req.query("code");
  if (!code) {
    return c.redirect("/?error=missing_code");
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

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
  };
  if (!tokenData.access_token) {
    return c.redirect("/?error=token_exchange_failed");
  }

  // Fetch GitHub user profile
  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "User-Agent": "dotfolder-app",
    },
  });

  const ghUser = (await userRes.json()) as {
    id: number;
    login: string;
    name: string | null;
    avatar_url: string;
  };

  // Find or create user
  const userId = await findOrCreateUser(
    c.env.DB,
    "github",
    String(ghUser.id),
    ghUser.login,
    ghUser.name,
    ghUser.avatar_url,
    tokenData.access_token,
  );

  // Create session
  const sessionId = await createSession(c.env.DB, userId);

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": setSessionCookieHeader(sessionId),
    },
  });
});

// ── Auth: logout ──
app.post("/auth/logout", async (c) => {
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
  const sessionId = getSessionCookie(c.req.raw);
  if (!sessionId) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const user = await validateSession(c.env.DB, sessionId);
  if (!user) {
    return c.json({ error: "Invalid session" }, 401);
  }

  const body = await c.req.json<{
    slug: string;
    project_name: string;
    project_type?: string;
    description?: string;
    url: string;
  }>();

  if (!body.slug || !body.project_name || !body.url) {
    return c.json({ error: "Missing required fields: slug, project_name, url" }, 400);
  }

  if (!isValidSlug(body.slug)) {
    return c.json({ error: "Invalid namespace slug" }, 400);
  }

  // Check if already taken
  const existing = await lookupNamespace(c.env.DB, body.slug);
  if (existing) {
    return c.json({ error: "Namespace already claimed" }, 409);
  }

  const result = await claimNamespace(
    c.env.DB,
    body.slug,
    body.project_name,
    body.project_type || "Other",
    body.description || null,
    user.id,
    body.url,
  );

  return c.json({ success: true, id: result.id }, 201);
});

// ── Namespace: add URL to existing namespace ──
app.post("/namespaces/:slug/urls", async (c) => {
  const sessionId = getSessionCookie(c.req.raw);
  if (!sessionId) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const user = await validateSession(c.env.DB, sessionId);
  if (!user) {
    return c.json({ error: "Invalid session" }, 401);
  }

  const slug = c.req.param("slug");
  const ns = await lookupNamespace(c.env.DB, slug);
  if (!ns) {
    return c.json({ error: "Namespace not found" }, 404);
  }

  const body = await c.req.json<{ url: string }>();
  if (!body.url) {
    return c.json({ error: "Missing required field: url" }, 400);
  }

  await addNamespaceUrl(c.env.DB, ns.id, body.url, user.id);
  return c.json({ success: true }, 201);
});

// ── Namespace: list recent ──
app.get("/namespaces", async (c) => {
  const recent = await getRecentNamespaces(c.env.DB);
  const count = await getNamespaceCount(c.env.DB);
  return c.json({ namespaces: recent, total: count });
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
