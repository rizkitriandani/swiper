// ─── Constants ────────────────────────────────────────────────────────────────
const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// ─── Storage helpers ──────────────────────────────────────────────────────────

async function getStoredToken() {
  const { notionToken } = await chrome.storage.sync.get('notionToken');
  return notionToken || null;
}

async function getStoredDatabaseId() {
  const { databaseId } = await chrome.storage.sync.get('databaseId');
  return databaseId || null;
}

// ─── Notion API ───────────────────────────────────────────────────────────────

async function notionRequest(path, options = {}) {
  const token = await getStoredToken();
  if (!token) throw new Error('No Notion token configured.');

  const response = await fetch(`${NOTION_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || `Notion API error ${response.status}`);
  }
  return data;
}

async function validateToken() {
  return notionRequest('/users/me');
}

async function saveToNotion({ highlightedText, note, pageUrl, pageTitle, color }) {
  const databaseId = await getStoredDatabaseId();
  if (!databaseId) throw new Error('No Notion database ID configured.');

  const truncated = (str, max) =>
    str && str.length > max ? str.slice(0, max - 1) + '…' : str || '';

  return notionRequest('/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: {
        Name: {
          title: [{ text: { content: truncated(highlightedText, 2000) } }]
        },
        Note: {
          rich_text: [{ text: { content: truncated(note, 2000) } }]
        },
        URL: { url: pageUrl || null },
        'Page Title': {
          rich_text: [{ text: { content: truncated(pageTitle, 2000) } }]
        },
        Color: { select: { name: color || 'yellow' } }
      }
    })
  });
}

async function queryHighlights(pageUrl) {
  const databaseId = await getStoredDatabaseId();
  if (!databaseId) throw new Error('No Notion database ID configured.');

  const filter = pageUrl
    ? { property: 'URL', url: { equals: pageUrl } }
    : undefined;

  const body = {
    sorts: [{ timestamp: 'created_time', direction: 'descending' }]
  };
  if (filter) body.filter = filter;

  return notionRequest(`/databases/${databaseId}/query`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

async function deleteNotionPage(pageId) {
  return notionRequest(`/pages/${pageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ archived: true })
  });
}

// ─── Local highlight storage ──────────────────────────────────────────────────

async function getLocalHighlights(pageUrl) {
  const { highlights = {} } = await chrome.storage.local.get('highlights');
  return highlights[pageUrl] || [];
}

async function saveLocalHighlight(pageUrl, highlight) {
  const { highlights = {} } = await chrome.storage.local.get('highlights');
  if (!highlights[pageUrl]) highlights[pageUrl] = [];
  highlights[pageUrl].push(highlight);
  await chrome.storage.local.set({ highlights });
}

async function removeLocalHighlight(pageUrl, highlightId) {
  const { highlights = {} } = await chrome.storage.local.get('highlights');
  if (highlights[pageUrl]) {
    highlights[pageUrl] = highlights[pageUrl].filter(h => h.id !== highlightId);
    await chrome.storage.local.set({ highlights });
  }
}

// ─── Context menu ─────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'swiper-highlight',
    title: 'Save highlight to Notion',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'swiper-highlight' && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'CONTEXT_MENU_HIGHLIGHT',
      text: info.selectionText
    });
  }
});

// ─── Side panel ───────────────────────────────────────────────────────────────

chrome.action.onClicked.addListener(tab => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(result => sendResponse({ ok: true, data: result }))
    .catch(err => sendResponse({ ok: false, error: err.message }));
  return true; // keep channel open for async response
});

async function handleMessage(message) {
  switch (message.type) {
    case 'VALIDATE_TOKEN':
      return validateToken();

    case 'SAVE_HIGHLIGHT': {
      const notionPage = await saveToNotion(message.payload);
      // Use notionPage.id as the canonical identifier; the local payload id
      // is replaced so both the highlight list and delete flow use the same key.
      await saveLocalHighlight(message.payload.pageUrl, {
        ...message.payload,
        id: notionPage.id,
        notionPageId: notionPage.id,
        createdAt: Date.now()
      });
      return notionPage;
    }

    case 'GET_HIGHLIGHTS':
      return getLocalHighlights(message.pageUrl);

    case 'QUERY_NOTION_HIGHLIGHTS':
      return queryHighlights(message.pageUrl);

    case 'DELETE_HIGHLIGHT': {
      await deleteNotionPage(message.notionPageId);
      await removeLocalHighlight(message.pageUrl, message.notionPageId);
      return { success: true };
    }

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}
