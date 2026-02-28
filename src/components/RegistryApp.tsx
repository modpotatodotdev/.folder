import { useState, useCallback, useRef, useEffect } from "react";

interface NamespaceData {
  slug: string;
  project_name: string;
  project_type: string;
  description: string | null;
  owner_username?: string;
  created_at: string;
  urls: { url: string; submitted_by: string; github_stars: number }[];
}

interface SearchResult {
  slug: string;
  project_name: string;
  project_type: string;
  description: string | null;
  owner_username?: string;
  created_at: string;
  urls: { url: string; submitted_by: string; github_stars: number }[];
}

interface LookupResult {
  available: boolean;
  slug: string;
  namespace?: NamespaceData;
}

interface Props {
  isLoggedIn: boolean;
}

function cleanSlug(v: string): string {
  return v.trim().replace(/[^a-zA-Z0-9_\-.]/g, "");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

export default function RegistryApp({ isLoggedIn }: Props) {
  const [query, setQuery] = useState("");
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [view, setView] = useState<"result" | "form" | "success">("result");
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [namespaceCount, setNamespaceCount] = useState<number | null>(null);

  // Form state
  const [formType, setFormType] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Search results state
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Add URL to existing namespace
  const [addUrlMode, setAddUrlMode] = useState(false);
  const [addUrlValue, setAddUrlValue] = useState("");
  const [addUrlError, setAddUrlError] = useState<string | null>(null);
  const [addUrlSubmitting, setAddUrlSubmitting] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/namespaces")
      .then((r) => r.json())
      .then((d: { total?: number }) => {
        if (typeof d.total === "number") setNamespaceCount(d.total);
      })
      .catch((err) => console.error("Failed to fetch namespace count", err));
  }, []);

  const slug = cleanSlug(query);

  const doSearch = useCallback(async () => {
    const s = cleanSlug(query);
    if (!s) return;
    setLoading(true);
    setSearchLoading(true);
    setHasSearched(true);
    try {
      const [lookupRes, searchRes] = await Promise.all([
        fetch(`/api/namespaces/${encodeURIComponent(s)}`),
        fetch(`/api/search?q=${encodeURIComponent(s)}`),
      ]);
      const lookupData: LookupResult = await lookupRes.json();
      const searchData: { results: SearchResult[] } = await searchRes.json();
      setLookupResult(lookupData);
      // Filter out the exact match from search results
      setSearchResults(searchData.results.filter((r) => r.slug !== s));
      setView("result");
      setOverlayOpen(true);
    } catch {
      showToast("Failed to look up namespace");
    } finally {
      setLoading(false);
      setSearchLoading(false);
    }
  }, [query]);

  const openClaim = useCallback(() => {
    if (!isLoggedIn) {
      window.location.href = "/api/auth/github";
      return;
    }
    setFormType(null);
    setFormName("");
    setFormUrl("");
    setFormDesc("");
    setFormError(null);
    setView("form");
  }, [isLoggedIn]);

  const openAddUrl = useCallback(() => {
    if (!isLoggedIn) {
      window.location.href = "/api/auth/github";
      return;
    }
    setAddUrlMode(true);
    setAddUrlValue("");
    setAddUrlError(null);
  }, [isLoggedIn]);

  const submitAddUrl = useCallback(async () => {
    if (!addUrlValue.trim()) {
      setAddUrlError("URL is required");
      return;
    }
    if (!lookupResult?.slug) return;

    setAddUrlSubmitting(true);
    setAddUrlError(null);

    try {
      const res = await fetch(`/api/namespaces/${encodeURIComponent(lookupResult.slug)}/urls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: addUrlValue.trim() }),
      });

      if (res.status === 401) {
        window.location.href = "/api/auth/github";
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        setAddUrlError((data as { error: string }).error || "Failed to add URL");
        return;
      }

      // Refresh the namespace data
      const refreshRes = await fetch(`/api/namespaces/${encodeURIComponent(lookupResult.slug)}`);
      const refreshData: LookupResult = await refreshRes.json();
      setLookupResult(refreshData);
      setAddUrlMode(false);
      setAddUrlValue("");
      showToast("Project added successfully");
    } catch {
      setAddUrlError("Network error. Please try again.");
    } finally {
      setAddUrlSubmitting(false);
    }
  }, [addUrlValue, lookupResult]);

  const submitClaim = useCallback(async () => {
    if (!formName.trim()) {
      setFormError("Project name is required");
      return;
    }
    if (!formUrl.trim()) {
      setFormError("Project URL is required");
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      const res = await fetch("/api/namespaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: lookupResult?.slug,
          project_name: formName.trim(),
          project_type: formType || "Other",
          description: formDesc.trim() || null,
          url: formUrl.trim(),
        }),
      });

      if (res.status === 401) {
        window.location.href = "/api/auth/github";
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        setFormError((data as { error: string }).error || "Failed to claim namespace");
        return;
      }

      setView("success");
    } catch {
      setFormError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [formName, formUrl, formDesc, formType, lookupResult]);

  const closeModal = useCallback(() => {
    setOverlayOpen(false);
    setAddUrlMode(false);
  }, []);

  const chipClick = useCallback(
    (ns: string) => {
      setQuery(ns);
      setLoading(true);
      setSearchLoading(true);
      setHasSearched(true);
      Promise.all([
        fetch(`/api/namespaces/${encodeURIComponent(ns)}`),
        fetch(`/api/search?q=${encodeURIComponent(ns)}`),
      ])
        .then(async ([lookupRes, searchRes]) => {
          const lookupData: LookupResult = await lookupRes.json();
          const searchData: { results: SearchResult[] } = await searchRes.json();
          setLookupResult(lookupData);
          setSearchResults(searchData.results.filter((r) => r.slug !== ns));
          setView("result");
          setOverlayOpen(true);
        })
        .catch(() => showToast("Failed to look up namespace"))
        .finally(() => {
          setLoading(false);
          setSearchLoading(false);
        });
    },
    [],
  );

  return (
    <>
      <div className="page">
        <div className="hero">


          <h1>
            one folder.
            <br />
            <em>every tool&rsquo;s home.</em>
          </h1>

          <p className="hero-sub">
            Namespace registry for <code>.folder/</code> — look up and
            claim a directory name before your tool ships.
          </p>

          <div className="search-area">
            <div className="search-box">
              <div className="search-top">
                <span className="prefix">.folder/</span>
                <input
                  ref={inputRef}
                  className="search-input"
                  type="text"
                  placeholder="YourNamespace"
                  autoComplete="off"
                  spellCheck={false}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") doSearch();
                  }}
                />
                <span className="suffix">/</span>
                <button
                  className="search-go"
                  onClick={doSearch}
                  disabled={loading}
                >
                  {loading ? "…" : "look up ↵"}
                </button>
              </div>

            </div>
          </div>

          {hasSearched && searchResults.length > 0 ? (
            <div className="chips-area">
              <div className="chips-label">related namespaces</div>
              <div className="chips">
                {searchResults.map((r) => (
                  <div
                    key={r.slug}
                    className="chip"
                    onClick={() => chipClick(r.slug)}
                  >
                    <span className="chip-status" style={{ color: "var(--red)" }}>●</span>
                    .folder/{r.slug}/
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="chips-area">
              <div className="chips-label">try searching</div>
              <div className="chips">
                {["cursor", "nx", "biome", "claude", "turborepo", "mise", "warp", "Linear"].map(
                  (ns) => (
                    <div
                      key={ns}
                      className="chip"
                      onClick={() => chipClick(ns)}
                    >
                      <span className="chip-status">○</span>.folder/{ns}/
                    </div>
                  ),
                )}
              </div>
            </div>
          )}

          <div className="stats">
            {namespaceCount !== null && (
              <div className="stat">
                <b>{namespaceCount.toLocaleString()}</b> registered
              </div>
            )}
          </div>
        </div>
      </div>

      {/* OVERLAY / BOTTOM SHEET */}
      <div
        className={`overlay${overlayOpen ? " open" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeModal();
        }}
      >
        <div className="sheet">
          <div className="handle"></div>
          <div className="sheet-body">
            {/* RESULT VIEW */}
            {view === "result" && lookupResult && (
              <ResultView
                result={lookupResult}
                onClaim={openClaim}
                onAddUrl={openAddUrl}
                isLoggedIn={isLoggedIn}
                addUrlMode={addUrlMode}
                addUrlValue={addUrlValue}
                setAddUrlValue={setAddUrlValue}
                addUrlError={addUrlError}
                addUrlSubmitting={addUrlSubmitting}
                onSubmitAddUrl={submitAddUrl}
                onCancelAddUrl={() => setAddUrlMode(false)}
              />
            )}

            {/* FORM VIEW */}
            {view === "form" && lookupResult && (
              <FormView
                slug={lookupResult.slug}
                formType={formType}
                setFormType={setFormType}
                formName={formName}
                setFormName={setFormName}
                formUrl={formUrl}
                setFormUrl={setFormUrl}
                formDesc={formDesc}
                setFormDesc={setFormDesc}
                formError={formError}
                submitting={submitting}
                onSubmit={submitClaim}
                onBack={() => setView("result")}
              />
            )}

            {/* SUCCESS VIEW */}
            {view === "success" && lookupResult && (
              <SuccessView slug={lookupResult.slug} onDone={closeModal} />
            )}

            <button className="x-btn" onClick={closeModal}>
              ✕
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Sub-components ── */

function ResultView({
  result,
  onClaim,
  onAddUrl,
  isLoggedIn,
  addUrlMode,
  addUrlValue,
  setAddUrlValue,
  addUrlError,
  addUrlSubmitting,
  onSubmitAddUrl,
  onCancelAddUrl,
}: {
  result: LookupResult;
  onClaim: () => void;
  onAddUrl: () => void;
  isLoggedIn: boolean;
  addUrlMode: boolean;
  addUrlValue: string;
  setAddUrlValue: (v: string) => void;
  addUrlError: string | null;
  addUrlSubmitting: boolean;
  onSubmitAddUrl: () => void;
  onCancelAddUrl: () => void;
}) {
  const ns = result.namespace;
  const taken = !result.available;

  return (
    <>
      <div className="breadcrumb">
        <span className="bc-seg">~</span>
        <span className="bc-slash">/</span>
        <span className="bc-seg">.folder</span>
        <span className="bc-slash">/</span>
        <span className="bc-ns">{result.slug}</span>
        <span className="bc-slash">/</span>
        <span style={{ color: "var(--muted2)", opacity: 0.5 }}>…</span>
      </div>

      <div className={`status-banner ${taken ? "taken" : "free"}`}>
        <div className="s-left">
          <span className="s-dot"></span>
          <span className="s-label">{taken ? "claimed" : "available"}</span>
        </div>
        <span className="s-path">.folder/{result.slug}/</span>
      </div>

      {taken && ns ? (
        <>
          <div className="project-card">
            <div className="pc-header">
              <div className="pc-left">
                <div className="pc-name">{ns.project_name}</div>
                <span className="pc-badge">{ns.project_type}</span>
              </div>
            </div>
            <div className="pc-body">
              <p className="pc-desc">
                {ns.description || "No description provided."}
              </p>
              <div className="pc-meta">
                <div className="pc-meta-item">
                  claimed <b>{formatDate(ns.created_at)}</b>
                </div>
                <div className="pc-meta-item">
                  by <b>@{ns.owner_username || "unknown"}</b>
                </div>
              </div>
            </div>
          </div>

          {ns.urls && ns.urls.length > 0 && (
            <div className="url-list">
              <div className="url-list-label">
                {ns.urls.length} {ns.urls.length === 1 ? "project" : "projects"} registered
              </div>
              {ns.urls.map((u) => (
                <a
                  key={u.url}
                  href={u.url}
                  className="url-item"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="url-text">{u.url}</span>
                  <span className="url-meta">
                    {u.github_stars > 0 && (
                      <span className="url-stars">★ {u.github_stars.toLocaleString()}</span>
                    )}
                    <span className="url-arrow">↗</span>
                  </span>
                </a>
              ))}
            </div>
          )}

          {addUrlMode ? (
            <div className="add-url-form">
              <div className="field">
                <div className="field-label">
                  your project url <span className="req">required</span>
                </div>
                <input
                  type="url"
                  placeholder="https://github.com/you/yourproject"
                  value={addUrlValue}
                  onChange={(e) => setAddUrlValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSubmitAddUrl();
                  }}
                />
              </div>
              {addUrlError && (
                <div
                  style={{
                    fontSize: "0.68rem",
                    color: "var(--red)",
                    marginBottom: "0.75rem",
                  }}
                >
                  {addUrlError}
                </div>
              )}
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  className="btn btn-primary"
                  onClick={onSubmitAddUrl}
                  disabled={addUrlSubmitting}
                  style={{ flex: 1 }}
                >
                  {addUrlSubmitting ? "adding…" : "add project"}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={onCancelAddUrl}
                  style={{ flex: 0, minWidth: "80px" }}
                >
                  cancel
                </button>
              </div>
            </div>
          ) : (
            <button className="btn btn-ghost" onClick={onAddUrl} style={{ marginTop: "0.5rem" }}>
              {isLoggedIn
                ? "＋ add your project"
                : "sign in to add your project"}
            </button>
          )}
        </>
      ) : (
        <>
          <div className="free-block">
            <div className="free-italic">unclaimed</div>
            <p>
              Nothing is registered under{" "}
              <strong>.folder/{result.slug}/</strong> yet.
            </p>
          </div>
          <button className="btn btn-primary" onClick={onClaim}>
            {isLoggedIn
              ? `✦ claim .folder/${result.slug}/`
              : `sign in to claim .folder/${result.slug}/`}
          </button>
        </>
      )}
    </>
  );
}

const TYPE_OPTIONS = [
  { value: "CLI", icon: "⌨", label: "CLI tool" },
  { value: "MCP", icon: "⬡", label: "MCP server" },
  { value: "App", icon: "◻", label: "App / GUI" },
  { value: "SDK", icon: "⌗", label: "SDK / lib" },
  { value: "Plugin", icon: "⊕", label: "Plugin" },
  { value: "Other", icon: "···", label: "Other" },
];

function FormView({
  slug,
  formType,
  setFormType,
  formName,
  setFormName,
  formUrl,
  setFormUrl,
  formDesc,
  setFormDesc,
  formError,
  submitting,
  onSubmit,
  onBack,
}: {
  slug: string;
  formType: string | null;
  setFormType: (t: string) => void;
  formName: string;
  setFormName: (v: string) => void;
  formUrl: string;
  setFormUrl: (v: string) => void;
  formDesc: string;
  setFormDesc: (v: string) => void;
  formError: string | null;
  submitting: boolean;
  onSubmit: () => void;
  onBack: () => void;
}) {
  return (
    <>
      <button className="back-btn" onClick={onBack}>
        ← back
      </button>

      <div
        style={{
          fontFamily: "var(--serif)",
          fontSize: "1.35rem",
          marginBottom: "0.3rem",
        }}
      >
        Claim {slug}
      </div>
      <div
        style={{
          fontSize: "0.71rem",
          color: "var(--muted)",
          lineHeight: 1.7,
          marginBottom: "1.6rem",
        }}
      >
        Claiming <code>.folder/{slug}/</code> — fill in your project details.
      </div>

      <div className="field">
        <div className="field-label">namespace path</div>
        <input
          type="text"
          className="field-locked"
          readOnly
          value={`.folder/${slug}/`}
        />
      </div>

      <div className="field">
        <div className="field-label">project type</div>
        <div className="type-grid">
          {TYPE_OPTIONS.map((opt) => (
            <div
              key={opt.value}
              className={`type-opt${formType === opt.value ? " on" : ""}`}
              onClick={() => setFormType(opt.value)}
            >
              <div className="ti">{opt.icon}</div>
              {opt.label}
            </div>
          ))}
        </div>
      </div>

      <div className="field">
        <div className="field-label">
          project name <span className="req">required</span>
        </div>
        <input
          type="text"
          placeholder="My Tool"
          value={formName}
          onChange={(e) => setFormName(e.target.value)}
        />
      </div>

      <div className="field">
        <div className="field-label">
          project url <span className="req">required</span>
        </div>
        <input
          type="url"
          placeholder="https://github.com/you/mytool"
          value={formUrl}
          onChange={(e) => setFormUrl(e.target.value)}
        />
      </div>

      <div className="field">
        <div className="field-label">what does it store here?</div>
        <textarea
          rows={2}
          placeholder="e.g. caches session graphs and runtime logs per-repo"
          value={formDesc}
          onChange={(e) => setFormDesc(e.target.value)}
        />
      </div>

      {formError && (
        <div
          style={{
            fontSize: "0.68rem",
            color: "var(--red)",
            marginBottom: "0.75rem",
          }}
        >
          {formError}
        </div>
      )}

      <div className="form-note">
        Sign in with GitHub to claim namespaces. Your account is linked automatically.
      </div>
      <br />

      <button
        className="btn btn-primary"
        onClick={onSubmit}
        disabled={submitting}
      >
        {submitting
          ? "registering…"
          : `register .folder/${slug}/ →`}
      </button>
    </>
  );
}

function SuccessView({
  slug,
  onDone,
}: {
  slug: string;
  onDone: () => void;
}) {
  return (
    <div className="success-view">
      <div className="s-check">✓</div>
      <h3>namespace registered</h3>
      <p>
        Your project now owns <strong>.folder/{slug}/</strong>. Anyone
        searching this namespace will see your project.
      </p>
      <div className="s-path-pill">.folder/{slug}/</div>
      <br />
      <button
        className="btn btn-ghost"
        onClick={onDone}
        style={{ maxWidth: "180px", margin: "0 auto" }}
      >
        done
      </button>
    </div>
  );
}

function showToast(msg: string) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2500);
}
