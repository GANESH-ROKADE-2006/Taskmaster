const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'taskmaster.db');

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#9a97a0',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    due_date TEXT,
    priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('high','medium','low')),
    category TEXT DEFAULT '',
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    sort_order INTEGER NOT NULL DEFAULT 0
  );
`);

// Seed default categories if empty
const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get();
if (catCount.c === 0) {
  const insertCat = db.prepare('INSERT INTO categories (id, name, color) VALUES (?, ?, ?)');
  const uuidFn = () => require('crypto').randomUUID();
  const seedCats = db.transaction(() => {
    insertCat.run(uuidFn(), 'Work', '#5b9cf6');
    insertCat.run(uuidFn(), 'Personal', '#9b8afb');
    insertCat.run(uuidFn(), 'Health', '#3ecfb2');
  });
  seedCats();

  // Seed default tasks
  const insertTask = db.prepare(`
    INSERT INTO tasks (id, title, description, due_date, priority, category, completed, created_at, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'), ?)
  `);
  const now = new Date();
  const today = new Date(now); today.setHours(15, 0, 0, 0);
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(10, 30, 0, 0);
  const nextWeek = new Date(now); nextWeek.setDate(nextWeek.getDate() + 7); nextWeek.setHours(9, 0, 0, 0);

  const seedTasks = db.transaction(() => {
    insertTask.run(uuidFn(), 'Review Q2 project proposal', 'Go through the full document and leave comments on the budget section.', today.toISOString(), 'high', 'Work', 0);
    insertTask.run(uuidFn(), 'Morning yoga session', '30-minute flow before breakfast.', tomorrow.toISOString(), 'medium', 'Health', 1);
    insertTask.run(uuidFn(), 'Plan quarterly OKRs', 'Draft the key results for next quarter and share with the team.', nextWeek.toISOString(), 'low', 'Work', 2);
  });
  seedTasks();
}

module.exports = db;
