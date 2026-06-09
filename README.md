# Accessibility Checker — Full-Stack Upgrade

## What changed and why

Your professor's feedback was that **comparison without storage has no lasting value**.
This upgrade adds a backend that:

1. **Solves CORS properly** — your own server fetches URLs server-side, no third-party proxy services
2. **Stores every scan** — SQLite database accumulates results over time
3. **Makes comparison meaningful** — re-scan a URL and see before/after history
4. **Powers real statistics** — the Statistics tab now draws from actual accumulated scan data

---

## Quick Start

### 1. Install and start the backend

```bash
cd backend
npm install
node server.js
```

You should see:
```
╔══════════════════════════════════════════════╗
║   Accessibility Checker Backend              ║
║   http://localhost:3001                      ║
╚══════════════════════════════════════════════╝
```

### 2. Open the frontend

Either open `frontend/accessibility-checker.html` directly in a browser,
or visit `http://localhost:3001` (the backend serves the frontend too).

The header will show **"● backend connected"** when everything is working.

---

## Project Structure

```
accessibility-checker/
├── backend/
│   ├── server.js          ← Express app (port 3001)
│   ├── db.js              ← SQLite schema + query helpers
│   ├── audits.db          ← Created automatically on first run
│   ├── package.json
│   └── routes/
│       ├── proxy.js       ← GET /api/proxy?url=...  (CORS-free fetching)
│       ├── audits.js      ← POST /api/audits, GET /api/audits/history
│       └── stats.js       ← GET /api/stats
│
└── frontend/
    ├── accessibility-checker.html
    └── checker.js
```

---

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/health` | Backend status check |
| `GET`  | `/api/proxy?url=<url>` | Fetch a URL server-side (no CORS) |
| `POST` | `/api/audits` | Save an audit result |
| `GET`  | `/api/audits/history?url=<url>` | Get all scans for a URL |
| `GET`  | `/api/audits/latest?url=<url>` | Get most recent scan for a URL |
| `GET`  | `/api/audits/:id` | Get a single audit with full issues |
| `GET`  | `/api/stats` | Aggregate statistics across all scans |

---

## How Each Feature Works Now

### URL Checker
- Fetches via your own backend proxy (not third-party services)
- Auto-saves the result to the database
- After saving, queries the database for previous scans of the same URL
- If 2+ scans exist, shows a **history banner** with a sparkline chart, score delta, and a table of past results

### Compare & Track
- Same as before, but every fetch is saved
- The preview card now shows how many times that URL has been scanned
- If a URL was scanned before, its history timeline appears in the preview
- Re-scan the same site a week later — the improvement (or regression) is visible

### Statistics
- Pulls from `GET /api/stats` which queries the database
- Shows: total scans, unique URLs, average score, score distribution doughnut chart
- Top recurring issue types (horizontal bar chart) — which WCAG violations appear most across all scans
- Most-tracked sites table with average scores
- 20 most recent scans live feed
- This tab becomes more useful the more you scan — it's a real dataset, not a hardcoded list

---

## Database Schema

```sql
CREATE TABLE audits (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  url           TEXT,               -- null for pasted HTML
  url_normalized TEXT,              -- hostname+path, lowercase, for grouping
  label         TEXT,               -- optional name
  scanned_at    TEXT,               -- ISO timestamp
  score         INTEGER,            -- 0–100
  critical      INTEGER,
  serious       INTEGER,
  moderate      INTEGER,
  passed        INTEGER,
  issues_json   TEXT,               -- full issues blob as JSON
  source        TEXT                -- 'url' | 'paste' | 'compare' | 'stats'
);
```

---

## Development Tips

- Use `npm run dev` (nodemon) to auto-restart on file changes
- The database file `audits.db` is created automatically — commit it to keep history, or add it to `.gitignore` to start fresh on each machine
- To change the backend port: `PORT=8080 node server.js`
- To change the backend URL the frontend uses: edit `window.BACKEND_URL` at the top of `accessibility-checker.html`
