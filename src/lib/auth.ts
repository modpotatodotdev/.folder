type D1Database = import("@cloudflare/workers-types").D1Database;

export function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const SESSION_COOKIE = "folder_session";
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days
const OAUTH_STATE_COOKIE = "folder_oauth_state";
const OAUTH_STATE_MAX_AGE = 10 * 60 * 1000; // 10 minutes

export async function createSession(
  db: D1Database,
  userId: string,
): Promise<string> {
  const id = generateId();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE).toISOString();
  await db
    .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(id, userId, expiresAt)
    .run();
  return id;
}

export async function validateSession(
  db: D1Database,
  sessionId: string,
): Promise<{
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
} | null> {
  const row = await db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, s.expires_at
       FROM sessions s JOIN users u ON s.user_id = u.id
       WHERE s.id = ?`,
    )
    .bind(sessionId)
    .first<{
      id: string;
      username: string;
      display_name: string | null;
      avatar_url: string | null;
      expires_at: string;
    }>();

  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
    return null;
  }

  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
  };
}

export async function deleteSession(
  db: D1Database,
  sessionId: string,
): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}

function getCookie(request: Request, name: string): string | undefined {
  const cookies = request.headers.get("cookie") || "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : undefined;
}

export function getSessionCookie(
  request: Request,
): string | undefined {
  return getCookie(request, SESSION_COOKIE);
}

export function setSessionCookieHeader(sessionId: string): string {
  const maxAge = SESSION_MAX_AGE / 1000;
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

export function getOAuthStateCookie(request: Request): string | undefined {
  return getCookie(request, OAUTH_STATE_COOKIE);
}

export function setOAuthStateCookieHeader(state: string): string {
  const maxAge = OAUTH_STATE_MAX_AGE / 1000;
  return `${OAUTH_STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`;
}

export function clearOAuthStateCookieHeader(): string {
  return `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

export async function findOrCreateUser(
  db: D1Database,
  provider: string,
  providerUserId: string,
  username: string,
  displayName: string | null,
  avatarUrl: string | null,
): Promise<string> {
  // Check if OAuth account already exists
  const existing = await db
    .prepare(
      "SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?",
    )
    .bind(provider, providerUserId)
    .first<{ user_id: string }>();

  if (existing) {
    // Update user info
    await db
      .prepare(
        "UPDATE users SET username = ?, display_name = ?, avatar_url = ? WHERE id = ?",
      )
      .bind(username, displayName, avatarUrl, existing.user_id)
      .run();
    return existing.user_id;
  }

  // Create new user + oauth account
  const userId = generateId();
  await db.batch([
    db
      .prepare(
        "INSERT INTO users (id, username, display_name, avatar_url) VALUES (?, ?, ?, ?)",
      )
      .bind(userId, username, displayName, avatarUrl),
    db
      .prepare(
        "INSERT INTO oauth_accounts (provider, provider_user_id, user_id, access_token) VALUES (?, ?, ?, ?)",
      )
      .bind(provider, providerUserId, userId, null),
  ]);
  return userId;
}
