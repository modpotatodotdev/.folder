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
    .bind(slug)
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
): Promise<{ id: string }> {
  const id = crypto.randomUUID().replace(/-/g, "");
  const urlId = crypto.randomUUID().replace(/-/g, "");

  await db.batch([
    db
      .prepare(
        `INSERT INTO namespaces (id, slug, project_name, project_type, description, owner_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, slug, projectName, projectType, description, ownerId),
    db
      .prepare(
        `INSERT INTO namespace_urls (id, namespace_id, url, submitted_by)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(urlId, id, url, ownerId),
  ]);

  return { id };
}

export async function addNamespaceUrl(
  db: D1Database,
  namespaceId: string,
  url: string,
  submittedBy: string,
): Promise<void> {
  const id = crypto.randomUUID().replace(/-/g, "");
  await db
    .prepare(
      "INSERT INTO namespace_urls (id, namespace_id, url, submitted_by) VALUES (?, ?, ?, ?)",
    )
    .bind(id, namespaceId, url, submittedBy)
    .run();
}

export async function getRecentNamespaces(
  db: D1Database,
  limit = 12,
): Promise<Namespace[]> {
  const result = await db
    .prepare(
      `SELECT n.*, u.username as owner_username
       FROM namespaces n JOIN users u ON n.owner_id = u.id
       ORDER BY n.created_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all<Namespace>();

  return result.results;
}

export async function getNamespaceCount(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as count FROM namespaces")
    .first<{ count: number }>();
  return row?.count ?? 0;
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

  const namespaces: (Namespace & { urls: NamespaceUrl[] })[] = [];
  for (const ns of result.results) {
    const urls = await db
      .prepare("SELECT * FROM namespace_urls WHERE namespace_id = ? ORDER BY github_stars DESC, created_at ASC")
      .bind(ns.id)
      .all<NamespaceUrl>();
    namespaces.push({ ...ns, urls: urls.results });
  }

  return namespaces;
}

export function isValidSlug(slug: string): boolean {
  return /^[a-zA-Z0-9_\-.]{1,64}$/.test(slug);
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
