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

function setListEmpty(message) {
  highlightsList.innerHTML = '';
  const li = document.createElement('li');
  li.className = 'empty-state';
  li.textContent = message;
  highlightsList.appendChild(li);
}

async function loadHighlights() {
  highlightsList.innerHTML = '';
  const loading = document.createElement('li');
  loading.className = 'loading';
  loading.textContent = 'Loading…';
  highlightsList.appendChild(loading);

  try {
    const pageUrl = filterMode === 'page' ? currentTabUrl : undefined;
    const res = await chrome.runtime.sendMessage({
      type: 'QUERY_NOTION_HIGHLIGHTS',
      pageUrl
    });

    if (!res?.ok) {
      setListEmpty(`Error: ${res?.error || 'unknown'}`);
      return;
    }

    const results = res.data?.results || [];
    if (results.length === 0) {
      setListEmpty('No highlights found.');
      return;
    }

    highlightsList.innerHTML = '';
    results.forEach(page => renderItem(page));
  } catch (err) {
    setListEmpty('Could not reach background worker.');
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

  // Validate color strictly against the known palette to prevent style injection
  const safeColor = COLOR_HEX[color] || COLOR_HEX.yellow;

  const li = document.createElement('li');
  li.className = 'highlight-item';

  const colorBar = document.createElement('div');
  colorBar.className = 'hi-color-bar';
  colorBar.style.background = safeColor;

  const textDiv = document.createElement('div');
  textDiv.className = 'hi-text';
  textDiv.textContent = text;

  const metaDiv = document.createElement('div');
  metaDiv.className = 'hi-meta';

  const urlSpan = document.createElement('span');
  urlSpan.className = 'hi-url';
  urlSpan.title = url;
  urlSpan.textContent = hostname;

  const dateSpan = document.createElement('span');
  dateSpan.textContent = created;

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'hi-delete';
  deleteBtn.title = 'Delete';
  deleteBtn.dataset.id = page.id;
  deleteBtn.textContent = '🗑';

  metaDiv.appendChild(urlSpan);
  metaDiv.appendChild(dateSpan);
  metaDiv.appendChild(deleteBtn);

  li.appendChild(colorBar);
  li.appendChild(textDiv);

  if (note) {
    const noteDiv = document.createElement('div');
    noteDiv.className = 'hi-note';
    noteDiv.textContent = `📝 ${note}`;
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

    const res = await chrome.runtime.sendMessage({
      type: 'DELETE_HIGHLIGHT',
      notionPageId: page.id,
      pageUrl: url
    });

    if (res?.ok) {
      li.remove();
      if (!highlightsList.querySelector('.highlight-item')) {
        setListEmpty('No highlights found.');
      }
    }
  });

  highlightsList.appendChild(li);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
