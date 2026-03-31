# StremiRow

A self-hosted Stremio addon that lets you build custom home-screen rows and multi-source TV channels via a web admin panel.

---

## Features

- **My Rows** — curate movie, series, or TV channel rows that appear on your Stremio home screen
- **Custom Channels** — build virtual TV channels that aggregate streams from multiple IPTV addons, with per-source label/title overrides
- **Auto-Detect** — automatically finds channels that appear across 2+ of your addons and offers to create them
- **MIPTV** — bundled live TV addon mounted at `/miptv/`
- **Cloud Persistence** — config stored in a private GitHub Gist (or local file for dev)
- **Stremio Account Sync** — log in once to browse your installed addons' catalogs

---

## Setup

### Environment Variables

Set these in `.env` (local) or your Vercel dashboard (production):

| Variable | Description |
|----------|-------------|
| `GIST_ID` | ID of your private GitHub Gist |
| `GH_TOKEN` | GitHub Personal Access Token with `gist` scope |

Without these, config falls back to `ui-config.json` on disk.

### Local Development

```bash
npm install
node index.js
```

Admin panel: `http://127.0.0.1:7000/admin`
Manifest URL: `http://127.0.0.1:7000/manifest.json`
MIPTV manifest: `http://127.0.0.1:7000/miptv/manifest.json`

### Vercel Deployment

Deploy from the `stremiRow/` directory. Set `GIST_ID` and `GH_TOKEN` in the Vercel dashboard.

---

## Project Structure

```
stremiRow/
├── index.js              # Express app entry point
├── api/index.js          # Vercel serverless entry (re-exports index.js)
├── vercel.json           # Vercel routing config
├── ui-config.json        # Local config fallback
├── logos/                # Channel logo PNGs (served at /logos/)
└── src/
    ├── admin.html        # Admin panel HTML shell
    ├── admin.css         # Admin panel styles
    ├── admin-ui.js       # Admin panel client-side JS
    ├── admin.js          # Admin API routes + static file serving
    ├── miptv.js          # MIPTV addon router
    ├── handlers.js       # Stremio catalog/meta/stream handlers
    ├── loader.js         # Config loader + validation
    ├── manifest.js       # Stremio manifest builder
    └── storage.js        # Config/auth persistence (Gist or local)
```

---

## Endpoints

| URL | Description |
|-----|-------------|
| `/admin` | Admin panel |
| `/manifest.json` | StremiRow addon manifest |
| `/miptv/manifest.json` | MIPTV addon manifest |
| `/logos/:id.png` | Channel logo assets |
| `/api/config` | GET/PUT addon config |
| `/api/stremio/addons` | Fetch user's Stremio addon collection |
| `/api/stremio/proxy-catalog` | Server-side proxy for addon catalog requests |
