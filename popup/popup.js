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

function setListEmpty(message) {
  highlightsList.innerHTML = '';
  const li = document.createElement('li');
  li.className = 'empty-state';
  li.textContent = message;
  highlightsList.appendChild(li);
}

async function loadHighlights() {
  highlightsList.innerHTML = '';

  try {
    const pageUrl = filterMode === 'page' ? currentTabUrl : undefined;
    const res = await sendMsg({ type: 'QUERY_NOTION_HIGHLIGHTS', pageUrl });

    if (!res?.ok) {
      setListEmpty('Error loading highlights.');
      return;
    }

    const results = res.data?.results || [];
    if (results.length === 0) {
      setListEmpty('No highlights yet.');
      return;
    }

    results.forEach(page => renderHighlightItem(page));
  } catch (err) {
    setListEmpty('Could not load highlights.');
  }
}

function renderHighlightItem(page) {
  const props = page.properties || {};
  const text    = props.Name?.title?.[0]?.text?.content || '(no text)';
  const note    = props.Note?.rich_text?.[0]?.text?.content || '';
  const color   = props.Color?.select?.name || 'yellow';
  const url     = props.URL?.url || '';
  const created = page.created_time
    ? new Date(page.created_time).toLocaleDateString()
    : '';

  // Validate color strictly against the known palette to prevent style injection
  const safeColor = COLOR_HEX[color] || COLOR_HEX.yellow;

  const li = document.createElement('li');
  li.className = 'highlight-item';

  const colorBar = document.createElement('div');
  colorBar.className = 'hi-color-bar';
  colorBar.style.background = safeColor;

  const textDiv = document.createElement('div');
  textDiv.className = 'hi-text';
  textDiv.title = text;
  textDiv.textContent = text;

  const metaDiv = document.createElement('div');
  metaDiv.className = 'hi-meta';

  const createdSpan = document.createElement('span');
  createdSpan.textContent = created;

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'hi-delete';
  deleteBtn.title = 'Delete';
  deleteBtn.dataset.id = page.id;
  deleteBtn.textContent = '🗑';

  metaDiv.appendChild(createdSpan);
  metaDiv.appendChild(deleteBtn);

  li.appendChild(colorBar);
  li.appendChild(textDiv);

  if (note) {
    const noteDiv = document.createElement('div');
    noteDiv.className = 'hi-note';
    noteDiv.textContent = note;
    li.appendChild(noteDiv);
  }

  li.appendChild(metaDiv);

  if (url) {
    li.addEventListener('click', e => {
      if (e.target.classList.contains('hi-delete')) return;
      chrome.tabs.create({ url });
    });
  }

  deleteBtn.addEventListener('click', async e => {
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
        setListEmpty('No highlights yet.');
      }
    }
  });

  highlightsList.appendChild(li);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
