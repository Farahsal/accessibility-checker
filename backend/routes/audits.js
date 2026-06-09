// ─────────────────────────────────────────────
// routes/audits.js — Audit storage & retrieval
// ─────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const { saveAudit, getAuditHistory, getLatestAudit, getAuditById } = require('../db');

/**
 * POST /api/audits
 * Save a completed audit result to the database.
 *
 * Body: { url, label, score, critical, serious, moderate, passed, issues, source }
 */
router.post('/', async (req, res) => {
  const id = await saveAudit({ url, label, score, critical, serious, moderate, passed, issues, source } = req.body);
  res.status(201).json({ id, saved: true });
});

/**
 * GET /api/audits/history?url=https://example.com
 * Returns all past scans for a given URL, newest first.
 * Used to show improvement trends in the UI.
 */
router.get('/history', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing ?url= parameter' });

  try {
    const history = await getAuditHistory(url);
    res.json({ url, history, count: history.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve history' });
  }
});

/**
 * GET /api/audits/latest?url=https://example.com
 * Returns only the most recent scan for a URL.
 */
router.get('/latest', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing ?url= parameter' });

  try {
    const audit = await getLatestAudit(url);
    if (!audit) return res.status(404).json({ error: 'No audits found for this URL' });
    res.json(audit);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve audit' });
  }
});

/**
 * GET /api/audits/:id
 * Returns a single audit with full issues detail.
 */
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const audit = await getAuditById(id);
    if (!audit) return res.status(404).json({ error: 'Audit not found' });

    // Parse issues_json back to object for the response
    try { audit.issues = JSON.parse(audit.issues_json); } catch {}
    delete audit.issues_json;

    res.json(audit);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve audit' });
  }
});

module.exports = router;
