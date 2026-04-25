/* ─── Popup Script ─────────────────────────────────────────────────────────── */

const COLOR_HEX = {
  yellow: '#fff176',
  green: '#c8e6c9',
  blue: '#bbdefb',
  pink: '#f8bbd0'
};

// ─── Elements ─────────────────────────────────────────────────────────────────
const tokenInput     = document.getElementById('token-input');
const dbInput        = document.getElementById('db-input');
const toggleTokenBtn = document.getElementById('toggle-token');
const connectBtn     = document.getElementById('connect-btn');
const disconnectBtn  = document.getElementById('disconnect-btn');
const connectStatus  = document.getElementById('connect-status');
const statusDot      = document.getElementById('status-dot');
const sectionSettings  = document.getElementById('section-settings');
const sectionHighlights = document.getElementById('section-highlights');
const highlightsList   = document.getElementById('highlights-list');
const filterPageBtn   = document.getElementById('filter-page');
const filterAllBtn    = document.getElementById('filter-all');

// ─── State ────────────────────────────────────────────────────────────────────
let currentTabUrl = '';
let filterMode = 'page'; // 'page' | 'all'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setStatus(msg, type = '') {
  connectStatus.textContent = msg;
  connectStatus.className = 'status-msg' + (type ? ` ${type}` : '');
}

function setConnected(connected) {
  statusDot.className = `dot ${connected ? 'connected' : 'disconnected'}`;
  statusDot.title = connected ? 'Connected to Notion' : 'Disconnected';
  connectBtn.classList.toggle('hidden', connected);
  disconnectBtn.classList.toggle('hidden', !connected);
  sectionHighlights.classList.toggle('hidden', !connected);
  tokenInput.disabled = connected;
  dbInput.disabled = connected;
}

async function sendMsg(msg) {
  return chrome.runtime.sendMessage(msg);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const [{ notionToken, databaseId, isConnected }] = await Promise.all([
    chrome.storage.sync.get(['notionToken', 'databaseId', 'isConnected'])
  ]);

  if (notionToken) tokenInput.value = notionToken;
  if (databaseId)  dbInput.value = databaseId;

  if (isConnected) {
    setConnected(true);
    loadHighlights();
  }

  // Get current tab URL
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) currentTabUrl = tab.url;
}

// ─── Connect / Disconnect ──────────────────────────────────────────────────────

toggleTokenBtn.addEventListener('click', () => {
  tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password';
});

connectBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  const dbId  = dbInput.value.trim();

  if (!token) { setStatus('Please enter your Notion token.', 'error'); return; }
  if (!dbId)  { setStatus('Please enter your Database ID.', 'error'); return; }

  connectBtn.disabled = true;
  setStatus('Connecting…');

  await chrome.storage.sync.set({ notionToken: token, databaseId: dbId });

  const res = await sendMsg({ type: 'VALIDATE_TOKEN' });

  if (res?.ok) {
    await chrome.storage.sync.set({ isConnected: true });
    setStatus('✓ Connected!', 'success');
    setConnected(true);
    loadHighlights();
  } else {
    setStatus(`Error: ${res?.error || 'Invalid token'}`, 'error');
    await chrome.storage.sync.remove('isConnected');
  }

  connectBtn.disabled = false;
});

disconnectBtn.addEventListener('click', async () => {
  await chrome.storage.sync.remove(['notionToken', 'databaseId', 'isConnected']);
  tokenInput.value = '';
  dbInput.value = '';
  setConnected(false);
  setStatus('Disconnected.');
  tokenInput.disabled = false;
  dbInput.disabled = false;
});

// ─── Filter ───────────────────────────────────────────────────────────────────

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

// ─── Load & render highlights ──────────────────────────────────────────────────

async function loadHighlights() {
  highlightsList.innerHTML = '';

  try {
    const pageUrl = filterMode === 'page' ? currentTabUrl : undefined;
    const res = await sendMsg({ type: 'QUERY_NOTION_HIGHLIGHTS', pageUrl });

    if (!res?.ok) {
      highlightsList.innerHTML = `<li class="empty-state">Error loading highlights.</li>`;
      return;
    }

    const results = res.data?.results || [];
    if (results.length === 0) {
      highlightsList.innerHTML = `<li class="empty-state">No highlights yet.</li>`;
      return;
    }

    results.forEach(page => renderHighlightItem(page));
  } catch (err) {
    highlightsList.innerHTML = `<li class="empty-state">Could not load highlights.</li>`;
  }
}

function renderHighlightItem(page) {
  const props = page.properties || {};
  const text  = props.Name?.title?.[0]?.text?.content || '(no text)';
  const note  = props.Note?.rich_text?.[0]?.text?.content || '';
  const color = props.Color?.select?.name || 'yellow';
  const url   = props.URL?.url || '';
  const created = page.created_time
    ? new Date(page.created_time).toLocaleDateString()
    : '';

  const li = document.createElement('li');
  li.className = 'highlight-item';
  li.innerHTML = `
    <div class="hi-color-bar" style="background:${COLOR_HEX[color] || '#fff176'}"></div>
    <div class="hi-text" title="${escapeHtml(text)}">${escapeHtml(text)}</div>
    ${note ? `<div class="hi-note">${escapeHtml(note)}</div>` : ''}
    <div class="hi-meta">
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

    const res = await sendMsg({
      type: 'DELETE_HIGHLIGHT',
      notionPageId: page.id,
      pageUrl: url
    });

    if (res?.ok) {
      li.remove();
      if (!highlightsList.querySelector('.highlight-item')) {
        highlightsList.innerHTML = `<li class="empty-state">No highlights yet.</li>`;
      }
    }
  });

  highlightsList.appendChild(li);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
