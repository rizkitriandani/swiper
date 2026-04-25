/* ─── Swiper Content Script ───────────────────────────────────────────────── */

(function () {
  'use strict';

  // Prevent double-injection
  if (window.__swiperInitialised) return;
  window.__swiperInitialised = true;

  // ─── UI constants ─────────────────────────────────────────────────────────
  /** Vertical offset (px) so the tooltip appears above the cursor. */
  const TOOLTIP_VERTICAL_OFFSET = 44;
  /** Half the tooltip width (px) used to horizontally centre it on selection. */
  const TOOLTIP_HALF_WIDTH = 70;

  // ─── XPath helpers ────────────────────────────────────────────────────────

  function getXPath(node) {
    if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    if (node === document.body) return '/html/body';

    const parts = [];
    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.documentElement) {
      let index = 1;
      let sibling = node.previousSibling;
      while (sibling) {
        if (sibling.nodeType === Node.ELEMENT_NODE && sibling.tagName === node.tagName) {
          index++;
        }
        sibling = sibling.previousSibling;
      }
      parts.unshift(`${node.tagName.toLowerCase()}[${index}]`);
      node = node.parentNode;
    }
    return '/' + parts.join('/');
  }

  function resolveXPath(xpath) {
    try {
      return document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      ).singleNodeValue;
    } catch {
      return null;
    }
  }

  // ─── Highlight persistence helpers ────────────────────────────────────────

  function serializeRange(range) {
    const startNode = range.startContainer;
    const endNode = range.endContainer;
    return {
      startXPath: getXPath(startNode),
      startOffset: range.startOffset,
      endXPath: getXPath(endNode),
      endOffset: range.endOffset,
      text: range.toString()
    };
  }

  function deserializeRange(serialized) {
    const startNode = resolveXPath(serialized.startXPath);
    const endNode = resolveXPath(serialized.endXPath);
    if (!startNode || !endNode) return null;

    try {
      const range = document.createRange();

      // If the resolved node is an element, use its first text child when
      // the stored offset refers to a text position.
      const startTarget =
        startNode.nodeType === Node.TEXT_NODE ? startNode : startNode.childNodes[serialized.startOffset] || startNode;
      const endTarget =
        endNode.nodeType === Node.TEXT_NODE ? endNode : endNode.childNodes[serialized.endOffset] || endNode;

      if (startNode.nodeType === Node.TEXT_NODE) {
        range.setStart(startNode, Math.min(serialized.startOffset, startNode.textContent.length));
      } else {
        range.setStart(startTarget, 0);
      }

      if (endNode.nodeType === Node.TEXT_NODE) {
        range.setEnd(endNode, Math.min(serialized.endOffset, endNode.textContent.length));
      } else {
        range.setEnd(endTarget, 0);
      }

      return range;
    } catch {
      return null;
    }
  }

  // ─── Apply highlight to DOM ────────────────────────────────────────────────

  const COLOR_MAP = {
    yellow: '#fff176',
    green: '#c8e6c9',
    blue: '#bbdefb',
    pink: '#f8bbd0'
  };

  function applyHighlightToRange(range, color, highlightId) {
    if (!range || range.collapsed) return;

    const mark = document.createElement('mark');
    mark.className = 'swiper-highlight';
    mark.dataset.highlightId = highlightId;
    mark.dataset.color = color;
    mark.style.backgroundColor = COLOR_MAP[color] || COLOR_MAP.yellow;
    mark.style.cursor = 'pointer';

    try {
      range.surroundContents(mark);
    } catch {
      // Range spans multiple nodes — wrap with extractContents
      try {
        const fragment = range.extractContents();
        mark.appendChild(fragment);
        range.insertNode(mark);
      } catch {
        // Bail out silently for complex DOM structures
      }
    }

    mark.addEventListener('click', e => {
      e.stopPropagation();
      showHighlightPanel(mark, highlightId);
    });
  }

  // ─── Tooltip (shown on text selection) ────────────────────────────────────

  let tooltip = null;
  let pendingRange = null;

  function createTooltip() {
    const el = document.createElement('div');
    el.id = 'swiper-tooltip';
    el.innerHTML = `
      <button data-action="highlight" title="Highlight">🖊 Highlight</button>
      <button data-action="copy" title="Copy text">📋 Copy</button>
    `;
    document.body.appendChild(el);

    el.addEventListener('mousedown', e => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'highlight') {
        e.preventDefault();
        hideTooltip();
        openNotePanel(pendingRange);
      } else if (action === 'copy') {
        e.preventDefault();
        navigator.clipboard.writeText(pendingRange?.toString() || '').catch(() => {});
        hideTooltip();
      }
    });

    return el;
  }

  function showTooltip(x, y) {
    if (!tooltip) tooltip = createTooltip();
    tooltip.style.left = `${x + window.scrollX}px`;
    tooltip.style.top = `${y + window.scrollY - TOOLTIP_VERTICAL_OFFSET}px`;
    tooltip.classList.add('swiper-visible');
  }

  function hideTooltip() {
    tooltip?.classList.remove('swiper-visible');
    pendingRange = null;
  }

  document.addEventListener('mouseup', e => {
    // Small delay so the selection is finalized
    setTimeout(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();

      if (!text || text.length === 0) {
        hideTooltip();
        return;
      }

      // Ignore selections inside our own UI
      const target = e.target;
      if (
        target.closest('#swiper-tooltip') ||
        target.closest('#swiper-note-panel') ||
        target.closest('.swiper-highlight-panel')
      ) {
        return;
      }

      pendingRange = selection.getRangeAt(0).cloneRange();
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      showTooltip(rect.left + rect.width / 2 - TOOLTIP_HALF_WIDTH, rect.top);
    }, 10);
  });

  document.addEventListener('mousedown', e => {
    if (
      !e.target.closest('#swiper-tooltip') &&
      !e.target.closest('#swiper-note-panel')
    ) {
      hideTooltip();
    }
  });

  // ─── Note panel (shadow DOM) ───────────────────────────────────────────────

  let notePanelHost = null;
  let notePanelRoot = null;

  function createNotePanel() {
    notePanelHost = document.createElement('div');
    notePanelHost.id = 'swiper-note-panel';
    document.body.appendChild(notePanelHost);

    notePanelRoot = notePanelHost.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .panel {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 340px;
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.18);
        padding: 20px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 14px;
        color: #1a1a2e;
        z-index: 2147483647;
        display: none;
        box-sizing: border-box;
      }
      .panel.open { display: block; }
      .preview {
        background: #fffde7;
        border-left: 3px solid #f9a825;
        padding: 8px 10px;
        border-radius: 4px;
        font-style: italic;
        color: #555;
        margin-bottom: 14px;
        max-height: 80px;
        overflow: hidden;
        text-overflow: ellipsis;
        word-break: break-word;
      }
      .color-row {
        display: flex;
        gap: 8px;
        margin-bottom: 14px;
        align-items: center;
      }
      .color-row span { font-size: 12px; color: #888; margin-right: 4px; }
      .color-swatch {
        width: 22px; height: 22px;
        border-radius: 50%;
        border: 2px solid transparent;
        cursor: pointer;
        transition: transform 0.15s;
      }
      .color-swatch:hover, .color-swatch.active { border-color: #333; transform: scale(1.2); }
      textarea {
        width: 100%;
        min-height: 80px;
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 10px;
        font-size: 13px;
        resize: vertical;
        outline: none;
        box-sizing: border-box;
        font-family: inherit;
        color: #1a1a2e;
        transition: border-color 0.2s;
      }
      textarea:focus { border-color: #4f46e5; }
      .btn-row {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 14px;
      }
      button.cancel {
        background: none;
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 7px 16px;
        cursor: pointer;
        font-size: 13px;
        color: #555;
        transition: background 0.15s;
      }
      button.cancel:hover { background: #f5f5f5; }
      button.save {
        background: #4f46e5;
        color: #fff;
        border: none;
        border-radius: 8px;
        padding: 7px 16px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        transition: background 0.15s;
      }
      button.save:hover { background: #4338ca; }
      button.save:disabled { background: #a5b4fc; cursor: not-allowed; }
      .status {
        font-size: 12px;
        color: #4f46e5;
        margin-top: 8px;
        min-height: 18px;
        text-align: right;
      }
      .status.error { color: #dc2626; }
      .overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.25);
        z-index: 2147483646;
        display: none;
      }
      .overlay.open { display: block; }
    `;
    notePanelRoot.appendChild(style);

    const overlay = document.createElement('div');
    overlay.className = 'overlay';

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <div class="preview" id="sp-preview"></div>
      <div class="color-row">
        <span>Color:</span>
        <div class="color-swatch active" data-color="yellow" style="background:#fff176" title="Yellow"></div>
        <div class="color-swatch" data-color="green"  style="background:#c8e6c9" title="Green"></div>
        <div class="color-swatch" data-color="blue"   style="background:#bbdefb" title="Blue"></div>
        <div class="color-swatch" data-color="pink"   style="background:#f8bbd0" title="Pink"></div>
      </div>
      <textarea id="sp-note" placeholder="📝 Add a note… (optional)"></textarea>
      <div class="btn-row">
        <button class="cancel" id="sp-cancel">Cancel</button>
        <button class="save" id="sp-save">Save to Notion</button>
      </div>
      <div class="status" id="sp-status"></div>
    `;

    notePanelRoot.appendChild(overlay);
    notePanelRoot.appendChild(panel);

    // Color picker
    panel.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        panel.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
      });
    });

    overlay.addEventListener('click', closeNotePanel);
    panel.querySelector('#sp-cancel').addEventListener('click', closeNotePanel);
    panel.querySelector('#sp-save').addEventListener('click', saveHighlight);

    return { panel, overlay };
  }

  let currentRange = null;
  let notePanelElements = null;

  function openNotePanel(range) {
    if (!range || range.collapsed) return;
    currentRange = range;

    if (!notePanelElements) notePanelElements = createNotePanel();
    const { panel, overlay } = notePanelElements;

    panel.querySelector('#sp-preview').textContent = range.toString().slice(0, 200);
    panel.querySelector('#sp-note').value = '';
    panel.querySelector('#sp-status').textContent = '';
    panel.querySelector('#sp-save').disabled = false;

    // Reset color selection
    panel.querySelectorAll('.color-swatch').forEach((s, i) => {
      s.classList.toggle('active', i === 0);
    });

    panel.classList.add('open');
    overlay.classList.add('open');
    setTimeout(() => panel.querySelector('#sp-note').focus(), 50);
  }

  function closeNotePanel() {
    if (!notePanelElements) return;
    notePanelElements.panel.classList.remove('open');
    notePanelElements.overlay.classList.remove('open');
    currentRange = null;
  }

  async function saveHighlight() {
    if (!currentRange) return;

    const { panel } = notePanelElements;
    const note = panel.querySelector('#sp-note').value.trim();
    const color =
      panel.querySelector('.color-swatch.active')?.dataset.color || 'yellow';
    const saveBtn = panel.querySelector('#sp-save');
    const status = panel.querySelector('#sp-status');

    const text = currentRange.toString();
    const serialized = serializeRange(currentRange);
    const highlightId = crypto.randomUUID();

    saveBtn.disabled = true;
    status.textContent = 'Saving…';
    status.className = 'status';

    try {
      // Apply visual highlight first
      applyHighlightToRange(currentRange, color, highlightId);

      const response = await chrome.runtime.sendMessage({
        type: 'SAVE_HIGHLIGHT',
        payload: {
          highlightedText: text,
          note,
          pageUrl: window.location.href,
          pageTitle: document.title,
          color,
          id: highlightId,
          serializedRange: serialized
        }
      });

      if (!response.ok) throw new Error(response.error);

      // Persist locally for re-apply on reload
      await chrome.runtime.sendMessage({
        type: 'GET_HIGHLIGHTS',
        pageUrl: window.location.href
      });

      status.textContent = '✓ Saved to Notion!';
      setTimeout(closeNotePanel, 1200);
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      status.className = 'status error';
      saveBtn.disabled = false;
    }
  }

  // ─── Highlight detail panel ────────────────────────────────────────────────

  function showHighlightPanel(markEl, highlightId) {
    const existing = document.querySelector('.swiper-highlight-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.className = 'swiper-highlight-panel';

    const textP = document.createElement('p');
    textP.className = 'shp-text';
    textP.textContent = `"${markEl.textContent.slice(0, 120)}"`;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'shp-delete';
    deleteBtn.dataset.id = highlightId;
    deleteBtn.textContent = '🗑 Remove highlight';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'shp-close';
    closeBtn.textContent = '✕';

    panel.appendChild(textP);
    panel.appendChild(deleteBtn);
    panel.appendChild(closeBtn);

    const rect = markEl.getBoundingClientRect();
    panel.style.top = `${rect.bottom + window.scrollY + 4}px`;
    panel.style.left = `${rect.left + window.scrollX}px`;
    document.body.appendChild(panel);

    panel.querySelector('.shp-close').addEventListener('click', () => panel.remove());
    panel.querySelector('.shp-delete').addEventListener('click', async () => {
      try {
        markEl.replaceWith(...markEl.childNodes);
        panel.remove();

        const highlights = await chrome.runtime.sendMessage({
          type: 'GET_HIGHLIGHTS',
          pageUrl: window.location.href
        });
        const match = highlights?.data?.find(h => h.id === highlightId);
        if (match?.notionPageId) {
          await chrome.runtime.sendMessage({
            type: 'DELETE_HIGHLIGHT',
            notionPageId: match.notionPageId,
            pageUrl: window.location.href
          });
        }
      } catch (err) {
        console.warn('[Swiper] delete error:', err);
      }
    });

    // Close on outside click
    const onOutside = e => {
      if (!panel.contains(e.target) && e.target !== markEl) {
        panel.remove();
        document.removeEventListener('mousedown', onOutside);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', onOutside), 10);
  }

  // ─── Re-apply highlights on load ──────────────────────────────────────────

  async function reApplyHighlights() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_HIGHLIGHTS',
        pageUrl: window.location.href
      });
      if (!response?.ok || !Array.isArray(response.data)) return;

      response.data.forEach(h => {
        if (!h.serializedRange) return;
        const range = deserializeRange(h.serializedRange);
        if (range) {
          applyHighlightToRange(range, h.color, h.id);
        }
      });
    } catch (err) {
      // Extension context may not be ready yet; silently ignore
    }
  }

  // Wait for DOM to be interactive
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reApplyHighlights);
  } else {
    reApplyHighlights();
  }

  // ─── Context menu message ─────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'CONTEXT_MENU_HIGHLIGHT') {
      const selection = window.getSelection();
      if (selection && selection.toString().trim() === message.text.trim()) {
        const range = selection.getRangeAt(0).cloneRange();
        openNotePanel(range);
      }
      sendResponse({ ok: true });
    }
  });
})();
