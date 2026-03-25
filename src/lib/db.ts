type D1Database = import("@cloudflare/workers-types").D1Database;

export interface Namespace {
  id: string;
  slug: string;
  project_name: string;
  project_type: string;
  description: string | null;
  owner_id: string;
  created_at: string;
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
