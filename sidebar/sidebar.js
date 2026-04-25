/* ─── Sidebar Script ───────────────────────────────────────────────────────── */

const COLOR_HEX = {
  yellow: '#fff176',
  green: '#c8e6c9',
  blue: '#bbdefb',
  pink: '#f8bbd0'
};

// ─── Elements ─────────────────────────────────────────────────────────────────
const statusDot       = document.getElementById('status-dot');
const notConnected    = document.getElementById('not-connected');
const connectedView   = document.getElementById('connected-view');
const highlightsList  = document.getElementById('highlights-list');
const filterPageBtn   = document.getElementById('filter-page');
const filterAllBtn    = document.getElementById('filter-all');
const refreshBtn      = document.getElementById('refresh-btn');

// ─── State ────────────────────────────────────────────────────────────────────
let currentTabUrl = '';
let filterMode = 'page';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setConnected(connected) {
  statusDot.className = `dot ${connected ? 'connected' : 'disconnected'}`;
  statusDot.title = connected ? 'Connected to Notion' : 'Disconnected';
  notConnected.classList.toggle('hidden', connected);
  connectedView.classList.toggle('hidden', !connected);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const { isConnected } = await chrome.storage.sync.get('isConnected');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) currentTabUrl = tab.url;

  if (isConnected) {
    setConnected(true);
    loadHighlights();
  } else {
    setConnected(false);
  }
}

// ─── Filter buttons ───────────────────────────────────────────────────────────

filterPageBtn.addEventListener('click', () => {
  filterMode = 'page';
  filterPageBtn.classList.add('active');
  filterAllBtn.classList.remove('active');
  loadHighlights();
});

filterAllBtn.addEventListener('click', () => {
  filterMode = 'all';
  filterAllBtn.classList.add('active');
  filterPageBtn.classList.remove('active');
  loadHighlights();
});

refreshBtn.addEventListener('click', loadHighlights);

// ─── Load & render ─────────────────────────────────────────────────────────────

async function loadHighlights() {
  highlightsList.innerHTML = `<li class="loading">Loading…</li>`;

  try {
    const pageUrl = filterMode === 'page' ? currentTabUrl : undefined;
    const res = await chrome.runtime.sendMessage({
      type: 'QUERY_NOTION_HIGHLIGHTS',
      pageUrl
    });

    if (!res?.ok) {
      highlightsList.innerHTML = `<li class="empty-state">Error: ${escapeHtml(res?.error || 'unknown')}</li>`;
      return;
    }

    const results = res.data?.results || [];
    if (results.length === 0) {
      highlightsList.innerHTML = `<li class="empty-state">No highlights found.</li>`;
      return;
    }

    highlightsList.innerHTML = '';
    results.forEach(page => renderItem(page));
  } catch (err) {
    highlightsList.innerHTML = `<li class="empty-state">Could not reach background worker.</li>`;
  }
}

function renderItem(page) {
  const props   = page.properties || {};
  const text    = props.Name?.title?.[0]?.text?.content || '(no text)';
  const note    = props.Note?.rich_text?.[0]?.text?.content || '';
  const color   = props.Color?.select?.name || 'yellow';
  const url     = props.URL?.url || '';
  const created = page.created_time
    ? new Date(page.created_time).toLocaleDateString()
    : '';

  let hostname = '';
  try { hostname = new URL(url).hostname; } catch { hostname = url; }

  const li = document.createElement('li');
  li.className = 'highlight-item';
  li.innerHTML = `
    <div class="hi-color-bar" style="background:${COLOR_HEX[color] || '#fff176'}"></div>
    <div class="hi-text">${escapeHtml(text)}</div>
    ${note ? `<div class="hi-note">📝 ${escapeHtml(note)}</div>` : ''}
    <div class="hi-meta">
      <span class="hi-url" title="${escapeHtml(url)}">${escapeHtml(hostname)}</span>
      <span>${created}</span>
      <button class="hi-delete" title="Delete" data-id="${page.id}">🗑</button>
    </div>
  `;

  if (url) {
    li.addEventListener('click', e => {
      if (e.target.classList.contains('hi-delete')) return;
      chrome.tabs.create({ url });
    });
  }

  li.querySelector('.hi-delete').addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm('Delete this highlight from Notion?')) return;

    const res = await chrome.runtime.sendMessage({
      type: 'DELETE_HIGHLIGHT',
      notionPageId: page.id,
      pageUrl: url
    });

    if (res?.ok) {
      li.remove();
      if (!highlightsList.querySelector('.highlight-item')) {
        highlightsList.innerHTML = `<li class="empty-state">No highlights found.</li>`;
      }
    }
  });

  highlightsList.appendChild(li);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
