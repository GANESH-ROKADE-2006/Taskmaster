/**
 * TaskMaster - Midnight Command Center
 * Main Application Logic (API-backed version)
 */
import { api } from './api.js';

// ── STATE ──────────────────────────────────────────────────────────────────
let tasks = [];
let categories = [];
let activeFilter = 'all';
let activeCat = null;
let editingId = null;
let notifTimers = {};
let isOnline = false;

const CAT_COLORS = [
  '#5b9cf6','#9b8afb','#3ecfb2','#f5a623','#e05c5c',
  '#ff7a7a','#ffc35a','#4ade80','#f472b6','#38bdf8'
];

// ── HELPERS ────────────────────────────────────────────────────────────────
const el = id => document.getElementById(id);
const uuid = () => crypto.randomUUID();
const escHtml = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function fmtDate(d){ return d.toISOString().slice(0,10); }
function isToday(d){ if(!d)return false; const t=new Date(d),n=new Date(); return t.toDateString()===n.toDateString(); }
function isOverdue(task){ if(task.completed||!task.dueDate)return false; return new Date(task.dueDate)<new Date(); }
function isDueSoon(task){ if(task.completed||!task.dueDate)return false; const diff=new Date(task.dueDate)-new Date(); return diff>0&&diff<2*60*60*1000; }
function isDueWithin24h(task){ if(task.completed||!task.dueDate)return false; const diff=new Date(task.dueDate)-new Date(); return diff>0&&diff<24*60*60*1000; }
function fmtCountdown(task){
  const diff=new Date(task.dueDate)-new Date();
  if(diff<=0)return null;
  const h=Math.floor(diff/3600000),m=Math.floor((diff%3600000)/60000);
  return h>0?`${h}h ${m}m left`:`${m}m left`;
}
function fmtDue(task){
  if(!task.dueDate)return null;
  const d=new Date(task.dueDate);
  const dateStr=isToday(task.dueDate)?'Today':d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  const timeStr=d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
  return `${dateStr} · ${timeStr}${isOverdue(task)?' ⚠':''}`;
}
function catColor(name){ const c=categories.find(c=>c.name===name); return c?c.color:'#9a97a0'; }

// ── API STATUS ─────────────────────────────────────────────────────────────
async function checkApiStatus() {
  try {
    await api.health();
    isOnline = true;
    el('api-status').className = 'online';
    el('api-status-text').textContent = 'API Connected';
  } catch {
    isOnline = false;
    el('api-status').className = 'offline';
    el('api-status-text').textContent = 'API Offline';
  }
}

// ── DATA LOADING ───────────────────────────────────────────────────────────
async function loadData() {
  showLoadingState();
  try {
    [tasks, categories] = await Promise.all([api.getTasks(), api.getCategories()]);
    // Ensure dueDate field is consistent (backend returns dueDate)
    tasks = tasks.map(t => ({ ...t, dueDate: t.dueDate || t.due_date || null }));
    isOnline = true;
  } catch (err) {
    showToast('⚠ Could not reach API. Running offline.', 'error');
    tasks = [];
    categories = [];
    isOnline = false;
  }
  render();
}

function showLoadingState() {
  el('task-list').innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <span>Loading tasks…</span>
    </div>`;
}

// ── TASK OPERATIONS ────────────────────────────────────────────────────────
async function addTask(data) {
  try {
    const task = await api.createTask(data);
    task.dueDate = task.dueDate || task.due_date || null;
    tasks.unshift(task);
    tasks.forEach((t, i) => t.sort_order = i);
    scheduleNotif(task);
    render();
    showToast('✦ Task added', 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function toggleTask(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  const newCompleted = !t.completed;
  try {
    const updated = await api.updateTask(id, { completed: newCompleted });
    Object.assign(t, updated, { dueDate: updated.dueDate || updated.due_date || t.dueDate });
    t.completed = newCompleted;
    if (t.completed) cancelNotif(id); else scheduleNotif(t);
    render();
    showToast(t.completed ? '✓ Completed' : '↩ Restored', 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function deleteTask(id, card) {
  card.style.transition = 'transform .3s ease,opacity .3s ease';
  card.style.transform = 'translateX(60px)';
  card.style.opacity = '0';
  try {
    await api.deleteTask(id);
    setTimeout(() => {
      tasks = tasks.filter(t => t.id !== id);
      cancelNotif(id);
      render();
    }, 300);
    showToast('Task deleted', 'info');
  } catch (err) {
    card.style.transform = '';
    card.style.opacity = '';
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function updateTask(id, data) {
  try {
    const updated = await api.updateTask(id, data);
    const t = tasks.find(t => t.id === id);
    if (t) Object.assign(t, updated, { dueDate: updated.dueDate || updated.due_date || t.dueDate });
    cancelNotif(id);
    scheduleNotif(t);
    render();
    showToast('✦ Task updated', 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function reorderTasks(srcId, dstId) {
  const si = tasks.findIndex(t => t.id === srcId);
  const di = tasks.findIndex(t => t.id === dstId);
  if (si < 0 || di < 0) return;
  const [moved] = tasks.splice(si, 1);
  tasks.splice(di, 0, moved);
  tasks.forEach((t, i) => t.sort_order = i);
  render();
  try {
    await api.reorderTasks(tasks.map(t => t.id));
  } catch (err) {
    console.warn('Reorder sync failed:', err.message);
  }
}

// ── MODAL ──────────────────────────────────────────────────────────────────
let isEditMode = false;
function openModal(prefill = {}) {
  isEditMode = false; editingId = null;
  el('modal-title-text').textContent = 'New Task';
  el('task-title-input').value = prefill.title || '';
  el('task-desc-input').value = prefill.description || '';
  el('task-date-input').value = prefill.date || '';
  el('task-time-input').value = prefill.time || '';
  el('task-priority-input').value = prefill.priority || 'medium';
  el('task-cat-input').value = prefill.category || '';
  el('nlp-input').value = '';
  populateCatSelect();
  el('task-modal').classList.add('open');
  setTimeout(() => el('task-title-input').focus(), 100);
}

function openEditModal(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  isEditMode = true; editingId = id;
  el('modal-title-text').textContent = 'Edit Task';
  el('task-title-input').value = t.title;
  el('task-desc-input').value = t.description || '';
  if (t.dueDate) {
    const d = new Date(t.dueDate);
    el('task-date-input').value = fmtDate(d);
    el('task-time-input').value = d.toTimeString().slice(0, 5);
  } else {
    el('task-date-input').value = '';
    el('task-time-input').value = '';
  }
  el('task-priority-input').value = t.priority;
  el('task-cat-input').value = t.category || '';
  el('nlp-input').value = '';
  populateCatSelect(t.category);
  el('task-modal').classList.add('open');
  setTimeout(() => el('task-title-input').focus(), 100);
}

function closeModal() { el('task-modal').classList.remove('open'); isEditMode = false; editingId = null; }

async function saveModal() {
  const title = el('task-title-input').value.trim();
  if (!title) { showToast('Title is required', 'error'); el('task-title-input').focus(); return; }
  const date = el('task-date-input').value, time = el('task-time-input').value;
  let dueDate = null;
  if (date) { const d = new Date(date + (time ? `T${time}` : 'T00:00')); dueDate = d.toISOString(); }
  const data = {
    title,
    description: el('task-desc-input').value.trim(),
    dueDate,
    priority: el('task-priority-input').value,
    category: el('task-cat-input').value,
  };
  if (isEditMode && editingId) await updateTask(editingId, data);
  else await addTask(data);
  closeModal();
}

function populateCatSelect(cur) {
  const sel = el('task-cat-input');
  sel.innerHTML = '<option value="">No Category</option>';
  categories.forEach(c => {
    const o = document.createElement('option');
    o.value = c.name; o.textContent = c.name; sel.appendChild(o);
  });
  if (cur) sel.value = cur;
}

// ── CATEGORY MODAL ─────────────────────────────────────────────────────────
let selectedColor = CAT_COLORS[0];
function openCatModal() {
  el('cat-name-input').value = '';
  selectedColor = CAT_COLORS[0];
  renderSwatches();
  el('cat-modal').classList.add('open');
  setTimeout(() => el('cat-name-input').focus(), 100);
}
function closeCatModal() { el('cat-modal').classList.remove('open'); }
function renderSwatches() {
  const c = el('color-swatches'); c.innerHTML = '';
  CAT_COLORS.forEach(col => {
    const s = document.createElement('div');
    s.className = 'swatch' + (col === selectedColor ? ' selected' : '');
    s.style.background = col; s.title = col;
    s.addEventListener('click', () => { selectedColor = col; renderSwatches(); });
    c.appendChild(s);
  });
}
async function saveCat() {
  const name = el('cat-name-input').value.trim();
  if (!name) { showToast('Category name required', 'error'); return; }
  try {
    const cat = await api.createCategory({ name, color: selectedColor });
    categories.push(cat);
    renderCategories();
    closeCatModal();
    showToast(`✦ Category "${name}" created`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ── NOTIFICATIONS ──────────────────────────────────────────────────────────
function requestNotifPerm() {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}
function scheduleNotif(task) {
  if (!task.dueDate || task.completed) return;
  if ('Notification' in window && Notification.permission !== 'granted') return;
  const delay = new Date(task.dueDate) - Date.now();
  if (delay <= 0) return;
  if (notifTimers[task.id]) clearTimeout(notifTimers[task.id]);
  notifTimers[task.id] = setTimeout(() => {
    new Notification('TaskMaster 🌙', { body: `Due now: ${task.title}`, icon: '' });
    showToast(`⏰ Due: ${task.title}`, 'info');
  }, delay);
}
function scheduleAllNotifs() { tasks.forEach(scheduleNotif); }
function cancelNotif(id) { if (notifTimers[id]) { clearTimeout(notifTimers[id]); delete notifTimers[id]; } }

// ── FILTER & COUNTS ────────────────────────────────────────────────────────
function getFiltered() {
  let list = [...tasks];
  if (activeCat) { list = list.filter(t => t.category === activeCat); }
  else {
    switch (activeFilter) {
      case 'today': list = list.filter(t => isToday(t.dueDate) && !t.completed); break;
      case 'due-soon': list = list.filter(t => isDueSoon(t)); break;
      case 'overdue': list = list.filter(t => isOverdue(t)); break;
      case 'completed': list = list.filter(t => t.completed); break;
      case 'priority-high': list = list.filter(t => t.priority === 'high' && !t.completed); break;
      case 'priority-medium': list = list.filter(t => t.priority === 'medium' && !t.completed); break;
      case 'priority-low': list = list.filter(t => t.priority === 'low' && !t.completed); break;
    }
  }
  list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return list;
}
function getDueSoon() { return tasks.filter(t => isDueSoon(t)); }
function updateCounts() {
  const active = tasks.filter(t => !t.completed);
  el('cnt-all').textContent = active.length;
  el('cnt-today').textContent = tasks.filter(t => isToday(t.dueDate) && !t.completed).length;
  el('cnt-due-soon').textContent = tasks.filter(t => isDueSoon(t)).length;
  el('cnt-overdue').textContent = tasks.filter(t => isOverdue(t)).length;
  el('cnt-completed').textContent = tasks.filter(t => t.completed).length;
  el('cnt-high').textContent = tasks.filter(t => t.priority === 'high' && !t.completed).length;
  el('cnt-medium').textContent = tasks.filter(t => t.priority === 'medium' && !t.completed).length;
  el('cnt-low').textContent = tasks.filter(t => t.priority === 'low' && !t.completed).length;
}

// ── NLP PARSER ─────────────────────────────────────────────────────────────
function parseNLP(text) {
  let result = { title: '', date: null, time: null, priority: 'medium' };
  let str = text;
  const now = new Date();
  if (/\bhigh\b/i.test(str)) { result.priority = 'high'; str = str.replace(/\bhigh\b/i, ''); }
  else if (/\blow\b/i.test(str)) { result.priority = 'low'; str = str.replace(/\blow\b/i, ''); }
  else if (/\bmedium\b/i.test(str)) { str = str.replace(/\bmedium\b/i, ''); }
  const timeM = str.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (timeM) {
    let h = parseInt(timeM[1]), m = timeM[2] ? parseInt(timeM[2]) : 0;
    if (timeM[3].toLowerCase() === 'pm' && h !== 12) h += 12;
    if (timeM[3].toLowerCase() === 'am' && h === 12) h = 0;
    result.time = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    str = str.replace(timeM[0], '');
  }
  if (/\btoday\b/i.test(str)) { result.date = fmtDate(now); str = str.replace(/\btoday\b/i, ''); }
  else if (/\btomorrow\b/i.test(str)) { const d = new Date(now); d.setDate(d.getDate()+1); result.date = fmtDate(d); str = str.replace(/\btomorrow\b/i, ''); }
  else if (/\bnext week\b/i.test(str)) { const d = new Date(now); d.setDate(d.getDate()+7); result.date = fmtDate(d); str = str.replace(/\bnext week\b/i, ''); }
  else {
    const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const dayM = str.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
    if (dayM) {
      const target = days.indexOf(dayM[1].toLowerCase()); const cur = now.getDay();
      let diff = target - cur; if (diff <= 0) diff += 7;
      const d = new Date(now); d.setDate(d.getDate()+diff); result.date = fmtDate(d);
      str = str.replace(dayM[0], '');
    }
  }
  result.title = str.replace(/\s+/g, ' ').trim();
  return result;
}

// ── RENDER ─────────────────────────────────────────────────────────────────
function createTaskCard(task, delay = 0) {
  const card = document.createElement('div');
  card.className = 'task-card' + (task.completed ? ' completed' : '') + (isOverdue(task) ? ' overdue' : '');
  card.dataset.id = task.id;
  card.style.animationDelay = `${delay}ms`;
  card.draggable = true;
  const within24 = isDueWithin24h(task);
  const countdown = (within24 && !task.completed) ? `<span class="task-countdown">⚡ ${fmtCountdown(task)}</span>` : '';
  const dueHtml = task.dueDate ? `<span class="task-due${isOverdue(task) ? ' overdue' : ''}">${fmtDue(task)}</span>` : '';
  const catHtml = task.category ? `<span class="cat-badge" style="background:${catColor(task.category)}22;color:${catColor(task.category)}">${task.category}</span>` : '';
  const ovdDot = isOverdue(task) ? '<div class="overdue-dot" aria-label="Overdue"></div>' : '';
  card.innerHTML = `
    <div class="drag-handle" aria-hidden="true">⠿</div>
    <div class="task-cb${task.completed ? ' checked' : ''}" role="checkbox" aria-checked="${task.completed}" aria-label="Toggle complete" tabindex="0"></div>
    <div class="task-body">
      <div class="task-title">${escHtml(task.title)}</div>
      ${task.description ? `<div class="task-desc">${escHtml(task.description)}</div>` : ''}
      <div class="task-meta">${dueHtml}${countdown}${catHtml}<span class="priority-badge priority-${task.priority}">${task.priority}</span></div>
    </div>
    ${ovdDot}
    <div class="task-actions">
      <button class="task-action-btn edit-btn" aria-label="Edit task" data-id="${task.id}">✎</button>
      <button class="task-action-btn delete delete-btn" aria-label="Delete task" data-id="${task.id}">✕</button>
    </div>`;

  // Checkbox toggle
  card.querySelector('.task-cb').addEventListener('click', () => toggleTask(task.id));
  card.querySelector('.task-cb').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') toggleTask(task.id); });

  // Edit / Delete
  card.querySelector('.edit-btn').addEventListener('click', () => openEditModal(task.id));
  card.querySelector('.delete-btn').addEventListener('click', () => deleteTask(task.id, card));

  // Drag-and-drop
  card.addEventListener('dragstart', () => { card.classList.add('dragging'); });
  card.addEventListener('dragend', () => { card.classList.remove('dragging'); document.querySelectorAll('.task-card').forEach(c => c.classList.remove('drag-over')); });
  card.addEventListener('dragover', e => { e.preventDefault(); card.classList.add('drag-over'); });
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
  card.addEventListener('drop', e => {
    e.preventDefault(); card.classList.remove('drag-over');
    const srcId = document.querySelector('.task-card.dragging')?.dataset.id;
    if (srcId && srcId !== task.id) reorderTasks(srcId, task.id);
  });
  return card;
}

function renderCategories() {
  const list = el('cat-list'); list.innerHTML = '';
  categories.forEach(cat => {
    const item = document.createElement('div');
    item.className = 'cat-item' + (activeCat === cat.name ? ' active' : '');
    item.innerHTML = `<div class="cat-dot" style="background:${cat.color}"></div><span class="cat-name">${escHtml(cat.name)}</span><span class="cat-count">${tasks.filter(t => t.category === cat.name && !t.completed).length}</span>`;
    item.addEventListener('click', () => {
      activeCat = cat.name; activeFilter = null;
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.cat-item').forEach(c => c.classList.remove('active'));
      item.classList.add('active');
      render();
    });
    list.appendChild(item);
  });
}

const VIEW_LABELS = {
  all: { title: 'All Tasks', icon: '📋' },
  today: { title: 'Today', icon: '☀️' },
  'due-soon': { title: 'Due Soon', icon: '⚡' },
  overdue: { title: 'Overdue', icon: '🔴' },
  completed: { title: 'Completed', icon: '✓' },
  'priority-high': { title: 'High Priority', icon: '🔥' },
  'priority-medium': { title: 'Medium Priority', icon: '📌' },
  'priority-low': { title: 'Low Priority', icon: '🌿' },
};

function render() {
  updateCounts();
  renderCategories();

  const filtered = getFiltered();
  const dueSoon = (activeFilter === 'all' && !activeCat) ? getDueSoon() : [];

  const label = activeCat ? { title: activeCat, icon: '🏷' } : (VIEW_LABELS[activeFilter] || { title: 'Tasks', icon: '📋' });
  el('view-title').textContent = label.title;
  el('view-meta').textContent = `${filtered.length} task${filtered.length !== 1 ? 's' : ''}`;

  // Due soon section
  const dueSoonSec = el('due-soon-section');
  const dueSoonList = el('due-soon-list');
  if (dueSoon.length > 0) {
    dueSoonSec.style.display = '';
    dueSoonList.innerHTML = '';
    dueSoon.forEach((t, i) => dueSoonList.appendChild(createTaskCard(t, i * 40)));
  } else {
    dueSoonSec.style.display = 'none';
  }

  const mainList = el('task-list');
  const mainLabel = el('main-section-label');
  if (dueSoon.length > 0) {
    mainLabel.style.display = '';
    mainLabel.textContent = 'All Tasks';
  } else {
    mainLabel.style.display = 'none';
  }

  mainList.innerHTML = '';
  if (filtered.length === 0) {
    mainList.innerHTML = `<div class="empty-state"><div class="empty-icon">🌙</div><div class="empty-title">Nothing here</div><div class="empty-sub">Press <kbd style="font-family:var(--font-mono);background:var(--bg4);padding:1px 5px;border-radius:3px">/</kbd> to add a new task</div></div>`;
    return;
  }
  filtered.forEach((t, i) => mainList.appendChild(createTaskCard(t, i * 40)));
}

// ── CLOCK ──────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  el('sidebar-clock').textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) + ' · ' + now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ── TOAST ──────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const icons = { success: '✓', error: '✕', info: '·' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="toast-icon">${icons[type] || '·'}</span><span>${msg}</span>`;
  el('toast-container').appendChild(t);
  setTimeout(() => { t.classList.add('removing'); setTimeout(() => t.remove(), 300); }, 3000);
}

// ── EVENT WIRING ───────────────────────────────────────────────────────────
el('nlp-input').addEventListener('input', function () {
  const parsed = parseNLP(this.value);
  if (parsed.title) el('task-title-input').value = parsed.title;
  if (parsed.date) el('task-date-input').value = parsed.date;
  if (parsed.time) el('task-time-input').value = parsed.time;
  el('task-priority-input').value = parsed.priority;
});

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    activeFilter = item.dataset.filter; activeCat = null;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    document.querySelectorAll('.cat-item').forEach(c => c.classList.remove('active'));
    render();
  });
  item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); item.click(); } });
});

el('quick-add').addEventListener('click', () => openModal());
el('modal-close').addEventListener('click', closeModal);
el('modal-cancel').addEventListener('click', closeModal);
el('modal-save').addEventListener('click', saveModal);
el('task-modal').addEventListener('click', e => { if (e.target === el('task-modal')) closeModal(); });
el('cat-modal-close').addEventListener('click', closeCatModal);
el('cat-cancel').addEventListener('click', closeCatModal);
el('cat-save').addEventListener('click', saveCat);
el('cat-modal').addEventListener('click', e => { if (e.target === el('cat-modal')) closeCatModal(); });
el('add-cat-btn').addEventListener('click', openCatModal);
el('add-cat-btn').addEventListener('keydown', e => { if (e.key === 'Enter') openCatModal(); });
el('task-modal').addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
el('cat-modal').addEventListener('keydown', e => { if (e.key === 'Escape') closeCatModal(); });
el('task-title-input').addEventListener('keydown', e => { if (e.key === 'Enter') saveModal(); });

document.addEventListener('keydown', e => {
  if ((e.key === '/' || e.key === 'n') && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
    e.preventDefault(); openModal();
  }
  if (e.key === 'Escape') { closeModal(); closeCatModal(); }
});

el('menu-toggle').addEventListener('click', () => {
  el('sidebar').classList.toggle('open'); el('sidebar-overlay').classList.toggle('show');
});
el('sidebar-overlay').addEventListener('click', () => {
  el('sidebar').classList.remove('open'); el('sidebar-overlay').classList.remove('show');
});

// ── INIT ───────────────────────────────────────────────────────────────────
(async function init() {
  await checkApiStatus();
  await loadData();
  requestNotifPerm();
  scheduleAllNotifs();
  updateClock();
  setInterval(updateClock, 30000);
  setInterval(async () => {
    await checkApiStatus();
    if (isOnline) {
      await loadData();
    } else {
      updateCounts();
      if (tasks.some(t => !t.completed && t.dueDate)) render();
    }
  }, 60000);
})();
