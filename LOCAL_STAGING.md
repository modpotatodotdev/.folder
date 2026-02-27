# Local Staging Guide

This guide explains how to run the "**jawn**" (this app) locally using "**workersd**" (`workerd`/Wrangler) to simulate a production-like environment.

## 1. Local Database Setup

The app uses Cloudflare D1. To set up your local database:

```bash
npm run db:migrate
```

This will create a local SQLite database in `.wrangler/state/v3/d1` and apply the `schema.sql`.

To reset the database, you can delete the `.wrangler` folder.

## 2. Running the App

There are two ways to run the app locally:

### Fast Development (`npm run dev`)
- Uses Vite/Astro dev server.
- Supported for quick UI changes.
- Uses `platformProxy` to bind local D1 and other Cloudflare features.

### Local Staging / Simulation (`npm r  un staging`)
- Builds the app and runs it via `wrangler dev`.
- Uses `workerd` (the real Workers runtime).
- More accurate for testing Cloudflare-specific logic and headers.
- **Run this to verify before deploying.**

## 3. Environment Variables

Create or update your `.env` file with the following (see `.env.example`):

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `SESSION_SECRET`

When running with `wrangler dev`, these will be pulled from your environment or `.dev.vars`.
