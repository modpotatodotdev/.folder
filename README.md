# .folder

**One shared directory for all dev-tool configs. No more dotfolder collisions.**

`.folder/` is a namespace registry for the `.folder/` convention — a single dotfolder at your repo root where every developer tool stores its per-repo state in a named subdirectory (`.folder/cursor/`, `.folder/biome/`, `.folder/yourTool/`). The registry prevents name collisions by letting tool authors look up, claim, and publish their namespace before shipping.

🌐 **Live at [dotfolder.xyz](https://dotfolder.xyz)**

---

## How It Works

1. **Look up** a namespace to check availability.
2. **Sign in** with GitHub to verify your identity.
3. **Claim** your namespace with a project name, type, and URL.
4. **Ship** your tool — anyone can search the registry to see what lives under `.folder/yourName/`.

## Tech Stack

| Layer        | Technology                              |
| ------------ | --------------------------------------- |
| Framework    | [Astro](https://astro.build) + React    |
| Runtime      | Cloudflare Workers                      |
| Database     | Cloudflare D1 (SQLite)                  |
| API          | [Hono](https://hono.dev) (catch-all)    |
| Auth         | GitHub OAuth → session cookies          |
| Typography   | Instrument Serif · DM Mono              |

## Pages

| Route        | Description                                            |
| ------------ | ------------------------------------------------------ |
| `/`          | Registry search — look up & claim namespaces           |
| `/dashboard` | Authenticated user dashboard — view claimed namespaces |
| `/mission`   | Why `.folder/` exists and how the registry works       |
| `/presskit`  | Brand assets, colors, typography, and usage guidelines |
| `/privacy`   | Privacy Policy                                         |
| `/terms`     | Terms of Service                                       |

## Project Structure

```
.folder/
├── public/             # Static assets (logo.svg, og.png)
├── src/
│   ├── components/
│   │   └── RegistryApp.tsx   # Main registry UI (React, client-side)
│   ├── layouts/
│   │   └── Layout.astro      # Shared HTML shell
│   ├── lib/
│   │   ├── api.ts            # Hono API routes (namespace CRUD, search)
│   │   ├── auth.ts           # GitHub OAuth + session management
│   │   └── db.ts             # D1 database helpers
│   ├── pages/
│   │   ├── api/[...route].ts # Catch-all → Hono
│   │   ├── index.astro       # Registry home
│   │   ├── dashboard.astro   # User dashboard
│   │   ├── mission.astro     # Mission / about
│   │   ├── presskit.astro    # Brand kit
│   │   ├── privacy.astro     # Privacy Policy
│   │   └── terms.astro       # Terms of Service
│   ├── styles/               # Global CSS
│   └── middleware.ts         # Session resolution
├── schema.sql          # D1 schema (users, oauth, sessions, namespaces)
├── wrangler.toml       # Cloudflare Workers config
├── astro.config.mjs    # Astro config (Cloudflare adapter)
├── DEPLOYMENT.md       # Step-by-step deploy guide
├── LOCAL_STAGING.md    # Local staging instructions
└── LICENSE             # MIT
```

## Quick Start

```bash
# Install dependencies
npm ci

# Create a .env from the example
cp .env.example .env
# → fill in GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, SESSION_SECRET

# Run the D1 schema locally
npm run db:migrate:local

# Start dev server
npm run dev
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for full production deploy instructions.

## Database Schema

The D1 database contains four tables:

- **`users`** — account records (id, username, display name, avatar)
- **`oauth_accounts`** — linked OAuth providers (GitHub now, extensible)
- **`sessions`** — cookie-based session tokens
- **`namespaces`** — registered namespace claims (slug, project name, type, owner)
- **`namespace_urls`** — URLs associated with each namespace (with GitHub star counts)

## Scripts

| Script                | Description                              |
| --------------------- | ---------------------------------------- |
| `npm run dev`         | Start Astro dev server                   |
| `npm run build`       | Production build                         |
| `npm run preview`     | Preview production build                 |
| `npm run db:migrate`  | Run schema on D1 (default env)           |
| `npm run db:migrate:remote` | Run schema on remote D1             |
| `npm run db:migrate:local`  | Run schema on local D1              |
| `npm run staging`     | Build + run local staging via Wrangler   |

## License

[MIT](LICENSE) © 2026 modpotato.dev LLC
