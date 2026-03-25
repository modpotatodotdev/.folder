type D1Database = import("@cloudflare/workers-types").D1Database;

export interface Namespace {
  id: string;
  slug: string;
  project_name: string;
  project_type: string;
  description: string | null;
  owner_id: string;
  created_at: string;
  last_modified_at: number | null;
  owner_username?: string;
}

export interface NamespaceUrl {
  id: string;
  namespace_id: string;
  url: string;
  submitted_by: string;
  github_stars: number;
  created_at: string;
}

export async function lookupNamespace(
  db: D1Database,
  slug: string,
): Promise<(Namespace & { urls: NamespaceUrl[] }) | null> {
  const ns = await db
    .prepare(
      `SELECT n.*, u.username as owner_username
       FROM namespaces n JOIN users u ON n.owner_id = u.id
       WHERE n.slug = ?`,
    )
    .bind(slug.toLowerCase())
    .first<Namespace>();

  if (!ns) return null;

  const urls = await db
    .prepare("SELECT * FROM namespace_urls WHERE namespace_id = ? ORDER BY github_stars DESC, created_at ASC")
    .bind(ns.id)
    .all<NamespaceUrl>();

  return { ...ns, urls: urls.results };
}

export async function claimNamespace(
  db: D1Database,
  slug: string,
  projectName: string,
  projectType: string,
  description: string | null,
  ownerId: string,
  url: string,
  githubStars = 0,
): Promise<{ id: string }> {
  const id = crypto.randomUUID().replace(/-/g, "");
  const urlId = crypto.randomUUID().replace(/-/g, "");
  const normalizedSlug = slug.toLowerCase();

  await db.batch([
    db
      .prepare(
        `INSERT INTO namespaces (id, slug, project_name, project_type, description, owner_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, normalizedSlug, projectName, projectType, description, ownerId),
    db
      .prepare(
        `INSERT INTO namespace_urls (id, namespace_id, url, submitted_by, github_stars)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(urlId, id, url, ownerId, githubStars),
  ]);

  return { id };
}

export async function urlExistsForNamespace(
  db: D1Database,
  namespaceId: string,
  url: string,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 FROM namespace_urls WHERE namespace_id = ? AND url = ?")
    .bind(namespaceId, url)
    .first();
  return row !== null;
}

export async function addNamespaceUrl(
  db: D1Database,
  namespaceId: string,
  url: string,
  submittedBy: string,
  githubStars = 0,
): Promise<void> {
  const id = crypto.randomUUID().replace(/-/g, "");
  await db
    .prepare(
      "INSERT INTO namespace_urls (id, namespace_id, url, submitted_by, github_stars) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id, namespaceId, url, submittedBy, githubStars)
    .run();
}

export async function getRecentNamespacesWithCount(
  db: D1Database,
  limit = 12,
): Promise<{ namespaces: Namespace[]; count: number }> {
  const [namespacesResult, countResult] = await db.batch([
    db
      .prepare(
        `SELECT n.*, u.username as owner_username
         FROM namespaces n JOIN users u ON n.owner_id = u.id
         ORDER BY n.created_at DESC LIMIT ?`,
      )
      .bind(limit),
    db.prepare("SELECT COUNT(*) as count FROM namespaces"),
  ]);

  return {
    namespaces: namespacesResult.results as unknown as Namespace[],
    count:
      ((countResult.results as unknown as { count: number }[])[0])?.count ?? 0,
  };
}

export async function getUserNamespaces(
  db: D1Database,
  userId: string,
): Promise<Namespace[]> {
  const result = await db
    .prepare(
      `SELECT n.*, u.username as owner_username
       FROM namespaces n JOIN users u ON n.owner_id = u.id
       WHERE n.owner_id = ?
       ORDER BY n.created_at DESC`,
    )
    .bind(userId)
    .all<Namespace>();

  return result.results;
}

export async function searchNamespaces(
  db: D1Database,
  query: string,
  limit = 20,
): Promise<(Namespace & { urls: NamespaceUrl[] })[]> {
  const escaped = query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
  const pattern = `%${escaped}%`;
  const result = await db
    .prepare(
      `SELECT n.*, u.username as owner_username
       FROM namespaces n JOIN users u ON n.owner_id = u.id
       WHERE n.slug LIKE ? ESCAPE '\\' OR n.project_name LIKE ? ESCAPE '\\' OR n.description LIKE ? ESCAPE '\\'
       ORDER BY n.created_at DESC LIMIT ?`,
    )
    .bind(pattern, pattern, pattern, limit)
    .all<Namespace>();

  if (result.results.length === 0) return [];

  const ids = result.results.map((ns) => ns.id);
  const placeholders = ids.map(() => "?").join(",");
  const urlResult = await db
    .prepare(
      `SELECT * FROM namespace_urls WHERE namespace_id IN (${placeholders}) ORDER BY github_stars DESC, created_at ASC`,
    )
    .bind(...ids)
    .all<NamespaceUrl>();

  const urlMap = new Map<string, NamespaceUrl[]>();
  for (const url of urlResult.results) {
    const list = urlMap.get(url.namespace_id) || [];
    list.push(url);
    urlMap.set(url.namespace_id, list);
  }

  return result.results.map((ns) => ({
    ...ns,
    urls: urlMap.get(ns.id) || [],
  }));
}

const TWO_WEEKS_SECONDS = 14 * 24 * 60 * 60;

export async function updateNamespace(
  db: D1Database,
  slug: string,
  userId: string,
  updates: { project_name?: string; project_type?: string; description?: string | null },
): Promise<{ success: false; error: string } | { success: true; last_modified_at: number }> {
  const ns = await db
    .prepare("SELECT id, owner_id, last_modified_at FROM namespaces WHERE slug = ?")
    .bind(slug)
    .first<{ id: string; owner_id: string; last_modified_at: number | null }>();

  if (!ns) return { success: false, error: "Namespace not found" };
  if (ns.owner_id !== userId) return { success: false, error: "Not the namespace owner" };

  const now = Math.floor(Date.now() / 1000);
  if (ns.last_modified_at !== null && now - ns.last_modified_at < TWO_WEEKS_SECONDS) {
    const remaining = TWO_WEEKS_SECONDS - (now - ns.last_modified_at);
    const daysLeft = Math.ceil(remaining / (24 * 60 * 60));
    return { success: false, error: `Can edit again in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}` };
  }

  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  if (updates.project_name !== undefined) {
    sets.push("project_name = ?");
    values.push(updates.project_name);
  }
  if (updates.project_type !== undefined) {
    sets.push("project_type = ?");
    values.push(updates.project_type);
  }
  if (updates.description !== undefined) {
    sets.push("description = ?");
    values.push(updates.description);
  }

  if (sets.length === 0) return { success: false, error: "No fields to update" };

  sets.push("last_modified_at = ?");
  values.push(now);
  values.push(ns.id);

  await db
    .prepare(`UPDATE namespaces SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  return { success: true, last_modified_at: now };
}

export function isValidSlug(slug: string): boolean {
  if (!slug || slug === "." || slug === "..") return false;
  return /^[a-z0-9][a-z0-9_\-.]{0,63}$/.test(slug);
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    if (url.protocol === "http:") {
      return (
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "::1" ||
        url.hostname === "[::1]"
      );
    }
    return false;
  } catch {
    return false;
  }
}
