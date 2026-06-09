const express = require('express');
const router = express.Router();
const { getGlobalStats } = require('../db');

router.get('/', async (req, res) => {
  try {
    const stats = await getGlobalStats();

    if (stats.totals && stats.totals.avg_score !== null) {
      stats.totals.avg_score = Math.round(stats.totals.avg_score);
    }

    res.json(stats);
  } catch (err) {
    console.error('Failed to compute stats:', err);
    res.status(500).json({ error: 'Failed to compute statistics' });
  }
});

module.exports = router;