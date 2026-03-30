const express = require('express');
const router = express.Router();
const db = require('../db');
const { randomUUID } = require('crypto');

// GET all tasks
router.get('/', (req, res) => {
  try {
    const tasks = db.prepare('SELECT * FROM tasks ORDER BY sort_order ASC, created_at DESC').all();
    // Convert SQLite integers to booleans
    const mapped = tasks.map(t => ({ ...t, completed: !!t.completed, dueDate: t.due_date, sortOrder: t.sort_order }));
    res.json({ success: true, data: mapped });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST create task
router.post('/', (req, res) => {
  try {
    const { title, description = '', dueDate = null, priority = 'medium', category = '' } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ success: false, error: 'Title is required' });

    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM tasks').get();
    const order = (maxOrder.m ?? -1) + 1;
    const id = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO tasks (id, title, description, due_date, priority, category, completed, created_at, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(id, title.trim(), description, dueDate, priority, category, now, order);

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    res.status(201).json({ success: true, data: { ...task, completed: !!task.completed, dueDate: task.due_date } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update task
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ success: false, error: 'Task not found' });

    const { title, description, dueDate, priority, category, completed, sortOrder } = req.body;

    db.prepare(`
      UPDATE tasks SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        due_date = ?,
        priority = COALESCE(?, priority),
        category = COALESCE(?, category),
        completed = COALESCE(?, completed),
        sort_order = COALESCE(?, sort_order)
      WHERE id = ?
    `).run(
      title ?? null,
      description ?? null,
      dueDate !== undefined ? dueDate : existing.due_date,
      priority ?? null,
      category ?? null,
      completed !== undefined ? (completed ? 1 : 0) : null,
      sortOrder ?? null,
      id
    );

    const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    res.json({ success: true, data: { ...updated, completed: !!updated.completed, dueDate: updated.due_date } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE task
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ success: false, error: 'Task not found' });
    res.json({ success: true, message: 'Task deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH reorder tasks
router.patch('/reorder', (req, res) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) return res.status(400).json({ success: false, error: 'orderedIds must be an array' });

    const update = db.prepare('UPDATE tasks SET sort_order = ? WHERE id = ?');
    const reorder = db.transaction((ids) => {
      ids.forEach((id, i) => update.run(i, id));
    });
    reorder(orderedIds);
    res.json({ success: true, message: 'Reordered successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
