const express = require('express');
const router = express.Router();
const db = require('../db');
const { randomUUID } = require('crypto');

// GET all categories
router.get('/', (req, res) => {
  try {
    const cats = db.prepare('SELECT * FROM categories ORDER BY name ASC').all();
    res.json({ success: true, data: cats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST create category
router.post('/', (req, res) => {
  try {
    const { name, color = '#9a97a0' } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Name is required' });

    const existing = db.prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?)').get(name.trim());
    if (existing) return res.status(409).json({ success: false, error: 'Category already exists' });

    const id = randomUUID();
    db.prepare('INSERT INTO categories (id, name, color) VALUES (?, ?, ?)').run(id, name.trim(), color);
    const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    res.status(201).json({ success: true, data: cat });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update category
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ success: false, error: 'Category not found' });

    const { name, color } = req.body;
    db.prepare('UPDATE categories SET name = COALESCE(?, name), color = COALESCE(?, color) WHERE id = ?')
      .run(name ?? null, color ?? null, id);

    const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE category
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!cat) return res.status(404).json({ success: false, error: 'Category not found' });

    // Unset category on related tasks
    db.prepare("UPDATE tasks SET category = '' WHERE category = ?").run(cat.name);
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    res.json({ success: true, message: 'Category deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
