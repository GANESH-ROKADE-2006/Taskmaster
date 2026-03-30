const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({ origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5500', 'http://127.0.0.1:5500'] }));
app.use(express.json());

// Initialize DB (runs migrations/seed)
require('./db');

// API Routes
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/categories', require('./routes/categories'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 for unknown API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, error: 'API route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log('\x1b[36m%s\x1b[0m', `
  ┌─────────────────────────────────────────┐
  │   🌙 TaskMaster API                     │
  │   Running on http://localhost:${PORT}      │
  │   DB:  ./data/taskmaster.db             │
  └─────────────────────────────────────────┘
  `);
});

module.exports = app;
