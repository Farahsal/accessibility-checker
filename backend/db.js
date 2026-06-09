// ─────────────────────────────────────────────
// db.js — SQLite via sql.js (pure JS, no native build)
// ─────────────────────────────────────────────
const initSqlJs = require('sql.js');
const path      = require('path');
const fs        = require('fs');

const DB_PATH = path.join(__dirname, 'audits.db');

let _db   = null;
let _ready = false;

async function getDb() {
    if (_db) return _db;
    const SQL = await initSqlJs();
    _db = fs.existsSync(DB_PATH)
        ? new SQL.Database(fs.readFileSync(DB_PATH))
        : new SQL.Database();
    return _db;
}

function persist(db) {
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

async function ensureSchema() {
    if (_ready) return;
    const db = await getDb();
    db.run(`
        CREATE TABLE IF NOT EXISTS audits (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            url           TEXT,
            url_normalized TEXT,
            label         TEXT,
            scanned_at    TEXT NOT NULL,
            score         INTEGER NOT NULL,
            critical      INTEGER NOT NULL DEFAULT 0,
            serious       INTEGER NOT NULL DEFAULT 0,
            moderate      INTEGER NOT NULL DEFAULT 0,
            passed        INTEGER NOT NULL DEFAULT 0,
            issues_json   TEXT NOT NULL,
            source        TEXT DEFAULT 'manual'
        );
        CREATE INDEX IF NOT EXISTS idx_url ON audits(url_normalized);
        CREATE INDEX IF NOT EXISTS idx_scanned_at ON audits(scanned_at);
    `);
    persist(db);
    _ready = true;
}

function normalizeUrl(url) {
    if (!url) return null;
    try {
        const u = new URL(url.trim().toLowerCase());
        return u.hostname + u.pathname.replace(/\/$/, '');
    } catch {
        return url.trim().toLowerCase();
    }
}

// ── Helpers ──────────────────────────────────

async function saveAudit({ url, label, score, critical, serious, moderate, passed, issues, source }) {
    await ensureSchema();
    const db = await getDb();
    db.run(
        `INSERT INTO audits
           (url, url_normalized, label, scanned_at, score, critical, serious, moderate, passed, issues_json, source)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
            url || null,
            normalizeUrl(url),
            label || null,
            new Date().toISOString(),
            score, critical || 0, serious || 0, moderate || 0, passed || 0,
            JSON.stringify(issues || {}),
            source || 'manual'
        ]
    );
    persist(db);
    // Get last insert id
    const res = db.exec('SELECT last_insert_rowid() as id');
    return res[0]?.values[0]?.[0];
}

function rowsFromExec(result) {
    if (!result || result.length === 0) return [];
    const cols = result[0].columns;
    return result[0].values.map(row => {
        const obj = {};
        cols.forEach((c, i) => obj[c] = row[i]);
        return obj;
    });
}

async function getAuditHistory(url) {
    await ensureSchema();
    const db = await getDb();
    const norm = normalizeUrl(url);
    const res = db.exec(
        `SELECT id, url, label, scanned_at, score, critical, serious, moderate, passed, source
         FROM audits WHERE url_normalized = ? ORDER BY scanned_at DESC`,
        [norm]
    );
    return rowsFromExec(res);
}

async function getLatestAudit(url) {
    await ensureSchema();
    const db = await getDb();
    const norm = normalizeUrl(url);
    const res = db.exec(
        `SELECT * FROM audits WHERE url_normalized = ? ORDER BY scanned_at DESC LIMIT 1`,
        [norm]
    );
    return rowsFromExec(res)[0] || null;
}

async function getAuditById(id) {
    await ensureSchema();
    const db = await getDb();
    const res = db.exec(`SELECT * FROM audits WHERE id = ?`, [id]);
    return rowsFromExec(res)[0] || null;
}

async function getGlobalStats() {
    await ensureSchema();
    const db = await getDb();

    const totalsRes = db.exec(`
        SELECT
            COUNT(*)                       AS total_scans,
            COUNT(DISTINCT url_normalized) AS unique_urls,
            AVG(score)                     AS avg_score,
            SUM(critical)                  AS total_critical,
            SUM(serious)                   AS total_serious,
            SUM(moderate)                  AS total_moderate,
            MIN(score)                     AS min_score,
            MAX(score)                     AS max_score
        FROM audits WHERE url IS NOT NULL
    `);
    const totals = rowsFromExec(totalsRes)[0] || {};
    if (totals.avg_score) totals.avg_score = Math.round(totals.avg_score);

    const distRes = db.exec(`
        SELECT
            CASE
                WHEN score >= 90 THEN 'Excellent (90-100)'
                WHEN score >= 70 THEN 'Good (70-89)'
                WHEN score >= 50 THEN 'Fair (50-69)'
                WHEN score >= 30 THEN 'Poor (30-49)'
                ELSE 'Critical (0-29)'
            END AS bucket,
            COUNT(*) AS count
        FROM audits WHERE url IS NOT NULL
        GROUP BY bucket ORDER BY MIN(score) DESC
    `);
    const distribution = rowsFromExec(distRes);

    const topSitesRes = db.exec(`
        SELECT url_normalized, url, MAX(label) as label,
               COUNT(*) AS scan_count, ROUND(AVG(score)) AS avg_score, MAX(scanned_at) AS last_scanned
        FROM audits WHERE url IS NOT NULL
        GROUP BY url_normalized ORDER BY scan_count DESC LIMIT 10
    `);
    const topSites = rowsFromExec(topSitesRes);

    // Issue type frequency (JS-side since sql.js lacks JSON functions)
    const issRes = db.exec(`SELECT issues_json FROM audits ORDER BY scanned_at DESC LIMIT 200`);
    const issueTypeCounts = {};
    for (const row of rowsFromExec(issRes)) {
        try {
            const issues = JSON.parse(row.issues_json);
            for (const sev of ['critical', 'serious', 'moderate']) {
                for (const issue of (issues[sev] || [])) {
                    issueTypeCounts[issue.type] = (issueTypeCounts[issue.type] || 0) + 1;
                }
            }
        } catch {}
    }
    const topIssueTypes = Object.entries(issueTypeCounts)
        .sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([type, count]) => ({ type, count }));

    const recentRes = db.exec(`
        SELECT id, url, label, scanned_at, score, critical, serious, moderate, source
        FROM audits ORDER BY scanned_at DESC LIMIT 20
    `);
    const recentScans = rowsFromExec(recentRes);

    return { totals, distribution, topSites, topIssueTypes, recentScans };
}

module.exports = { saveAudit, getAuditHistory, getLatestAudit, getAuditById, getGlobalStats, normalizeUrl };
