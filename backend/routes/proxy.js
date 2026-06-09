// ─────────────────────────────────────────────
// routes/proxy.js — Server-side URL fetcher (solves CORS)
// ─────────────────────────────────────────────
const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

// Common browser-like headers to avoid bot blocks
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1'
};

/**
 * GET /api/proxy?url=https://example.com
 *
 * Fetches a remote URL server-side and returns the HTML.
 * This completely bypasses CORS since the request originates from the server.
 */
router.get('/', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing ?url= parameter' });
  }

  // Basic URL validation
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  // Only allow HTTP/HTTPS
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return res.status(400).json({ error: 'Only http and https URLs are supported' });
  }

  // Block local/internal addresses to prevent SSRF
  const hostname = parsedUrl.hostname.toLowerCase();
  const blocked = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '169.254', '10.', '192.168.', '172.'];
  if (blocked.some(b => hostname.startsWith(b) || hostname === b)) {
    return res.status(403).json({ error: 'Local/internal URLs are not allowed' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

    const response = await fetch(url, {
      headers: HEADERS,
      signal: controller.signal,
      redirect: 'follow'
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(502).json({
        error: `Remote server returned ${response.status} ${response.statusText}`,
        status: response.status
      });
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/xhtml')) {
      return res.status(415).json({ error: `URL does not return HTML (got: ${contentType})` });
    }

    const html = await response.text();

    if (html.length < 200) {
      return res.status(502).json({ error: 'Response too short — site may have returned an error page' });
    }

    // Return the HTML with metadata
    res.json({
      url: response.url, // final URL after redirects
      html,
      status: response.status,
      contentLength: html.length,
      fetchedAt: new Date().toISOString()
    });

  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Request timed out after 15 seconds' });
    }
    return res.status(502).json({ error: `Failed to fetch: ${err.message}` });
  }
});

module.exports = router;
