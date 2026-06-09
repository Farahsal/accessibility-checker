// ─────────────────────────────────────────────
// server.js — Express backend for Accessibility Checker
// ─────────────────────────────────────────────
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const proxyRoute  = require('./routes/proxy');
const auditsRoute = require('./routes/audits');
const statsRoute  = require('./routes/stats');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:8000',
    'http://localhost:8080',
    'http://127.0.0.1:5500',   // VS Code Live Server
    'http://localhost:5500',
    'https://accessibility-checker-un6q.onrender.com'
    // Add your production domain here, e.g. 'https://yourdomain.com'
  ],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '5mb' })); // audits can carry large issues blobs

// ── Serve frontend statically (optional) ─────
// If you put your HTML/JS files in ../frontend, the backend can serve them too.
// This means one process serves everything.
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));

// ── API Routes ────────────────────────────────
app.use('/api/proxy',  proxyRoute);
app.use('/api/audits', auditsRoute);
app.use('/api/stats',  statsRoute);

// ── Health check ──────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Root → serve the checker (if not using a separate dev server) ──
app.get('/', (req, res) => {
  res.sendFile(path.join(frontendPath, 'accessibility-checker.html'));
});

// ── Error handler ─────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
   Accessibility Checker Backend  
      http://localhost:${PORT}
  `);
});

module.exports = app;