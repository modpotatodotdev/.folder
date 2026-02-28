# Deployment

This project is an Astro app deployed to **Cloudflare Workers** with a **D1** database.

## Prerequisites

- Node.js 20+
- npm
- Cloudflare account
- Wrangler CLI (`npx wrangler ...` is supported)
- GitHub OAuth app credentials

## 1) Install dependencies

```bash
npm ci
```

## 2) Configure Cloudflare D1

Create a D1 database (if you do not already have one):

```bash
npx wrangler d1 create folder-db
```

Update `wrangler.toml`:

- Set `database_id` to the value returned by Cloudflare
- Keep `binding = "DB"` and `database_name = "folder-db"`

Run the schema migration:

```bash
npm run db:migrate:remote
```

## 3) Configure secrets

Set required secrets in Cloudflare Worker environment:

```bash
npx wrangler secret put GITHUB_CLIENT_ID --env ""
npx wrangler secret put GITHUB_CLIENT_SECRET --env ""
npx wrangler secret put SESSION_SECRET --env ""
```

## 4) Configure GitHub OAuth callback

In your GitHub OAuth app settings, set Authorization callback URL to:

```
https://<your-domain>/api/auth/github/callback
```

## 5) Build and deploy

```bash
npm run build
npx wrangler deploy
```

## 6) Post-deploy checks

- Visit `/` and verify the app loads
- Confirm footer links `/terms` and `/privacy` render
- Test GitHub sign-in flow end-to-end
- Verify namespace claim rejects invalid URLs
