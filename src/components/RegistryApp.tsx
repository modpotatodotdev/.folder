import { useState, useCallback, useRef, useEffect } from "react";

interface NamespaceData {
  slug: string;
  project_name: string;
  project_type: string;
  description: string | null;
  owner_username?: string;
  created_at: string;
  urls: { url: string; submitted_by: string }[];
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

  // Form state
  const [formType, setFormType] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const slug = cleanSlug(query);

  const doSearch = useCallback(async () => {
    const s = cleanSlug(query);
    if (!s) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/namespaces/${encodeURIComponent(s)}`);
      const data: LookupResult = await res.json();
      setLookupResult(data);
      setView("result");
      setOverlayOpen(true);
    } catch {
      showToast("Failed to look up namespace");
    } finally {
      setLoading(false);
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
  }, []);

  const chipClick = useCallback(
    (ns: string) => {
      setQuery(ns);
      // Trigger search for chip
      setLoading(true);
      fetch(`/api/namespaces/${encodeURIComponent(ns)}`)
        .then((res) => res.json())
        .then((data: LookupResult) => {
          setLookupResult(data);
          setView("result");
          setOverlayOpen(true);
        })
        .catch(() => showToast("Failed to look up namespace"))
        .finally(() => setLoading(false));
    },
    [],
  );

  return (
    <>
      <div className="page">
        <div className="hero">
          <div className="eyebrow">repo-level persistence, without the mess</div>

          <h1>
            one folder.
            <br />
            <em>every tool&rsquo;s home.</em>
          </h1>

          <p className="hero-sub">
            Apps, CLIs, MCPs, plugins, and SDKs claim a subdirectory under{" "}
            <code>.dotfolder/</code> to persist repo-level state without stomping on
            each other. Look up a namespace before you ship.
          </p>

          <div className="search-area">
            <div className="search-box">
              <div className="search-top">
                <span className="prefix">.dotfolder/</span>
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
              <div className="search-footer">
                <div className="path-preview">
                  .dotfolder/
                  <span className="hi">{slug || "…"}</span>/
                </div>
                <div className="search-legend">
                  <span>
                    <span className="ldot ldot-g"></span>free
                  </span>
                  <span>
                    <span className="ldot ldot-r"></span>claimed
                  </span>
                </div>
              </div>
            </div>
          </div>

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
                    <span className="chip-status">○</span>.dotfolder/{ns}/
                  </div>
                ),
              )}
            </div>
          </div>

          <div className="stats">
            <div className="stat">
              <b>∞</b>possible
            </div>
            <div className="stat">
              <b>cli · mcp · app · sdk</b>types
            </div>
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
                isLoggedIn={isLoggedIn}
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
  isLoggedIn,
}: {
  result: LookupResult;
  onClaim: () => void;
  isLoggedIn: boolean;
}) {
  const ns = result.namespace;
  const taken = !result.available;

  return (
    <>
      <div className="breadcrumb">
        <span className="bc-seg">~</span>
        <span className="bc-slash">/</span>
        <span className="bc-seg">.dotfolder</span>
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
        <span className="s-path">.dotfolder/{result.slug}/</span>
      </div>

      {taken && ns ? (
        <>
          <div className="project-card">
            <div className="pc-header">
              <div className="pc-left">
                <div className="pc-name">{ns.project_name}</div>
                <span className="pc-badge">{ns.project_type}</span>
              </div>
              {ns.urls?.[0] && (
                <a
                  href={ns.urls[0].url}
                  className="pc-link"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ↗ visit
                </a>
              )}
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
                <div className="pc-meta-item">
                  namespace <b>{ns.slug}</b>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="free-block">
            <div className="free-italic">unclaimed</div>
            <p>
              Nothing is registered under{" "}
              <strong>.dotfolder/{result.slug}/</strong> yet.
              <br />
              Claim it before someone else does.
            </p>
          </div>
          <button className="btn btn-primary" onClick={onClaim}>
            {isLoggedIn
              ? `✦ claim .dotfolder/${result.slug}/`
              : `sign in to claim .dotfolder/${result.slug}/`}
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
        Claiming <code>.dotfolder/{slug}/</code> — fill in your project details.
      </div>

      <div className="field">
        <div className="field-label">namespace path</div>
        <input
          type="text"
          className="field-locked"
          readOnly
          value={`.dotfolder/${slug}/`}
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
          : `register .dotfolder/${slug}/ →`}
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
        Your project now owns <strong>.dotfolder/{slug}/</strong>. Anyone
        searching this namespace will see your project.
      </p>
      <div className="s-path-pill">.dotfolder/{slug}/</div>
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
