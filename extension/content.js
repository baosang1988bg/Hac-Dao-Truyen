// content.js — Injected into every page
// Fix: Call Gemini API directly from content script (avoids MV3 service worker sleep issue)

(function () {
  'use strict';

  // Prevent duplicate injection
  if (window.__truyenDichLoaded) return;
  window.__truyenDichLoaded = true;

  // ── State ─────────────────────────────────────────────────────────────────

  let translateBtn  = null;
  let bubble        = null;
  let summaryPanel  = null;
  let currentText   = '';
  let lastRect      = null;
  let hideTimer     = null;
  let isTranslating = false;

  // ── Detect Chinese ────────────────────────────────────────────────────────

  function hasChinese(text) {
    return /[\u4e00-\u9fff\u3400-\u4dbf\uff00-\uffef]/.test(text);
  }

  // ── Gemini API (direct fetch — no background script needed) ───────────────

  async function geminiTranslate(text, mode = 'translate') {
    const { apiKey, model } = await chrome.storage.sync.get(['apiKey', 'model']);
    if (!apiKey) throw new Error('Chưa cài Gemini API Key. Click icon extension → nhập key → Save.');

    const m = model || 'gemini-3-flash-preview';

    let prompt;
    if (mode === 'summarize') {
      prompt = `Đây là nội dung từ một trang web tiểu thuyết Trung Quốc.
Hãy viết tóm tắt bằng tiếng Việt, bao gồm:
• Tên truyện (dịch/phiên âm sang tiếng Việt)
• Thể loại chính
• Tóm tắt nội dung 4-6 câu
• Nhân vật chính
• Lý do nên đọc

Nội dung trang:
${text.substring(0, 4000)}`;
    } else {
      prompt = `Dịch text tiếng Trung sau sang tiếng Việt tự nhiên, văn học.
Quy tắc:
- Tên nhân vật: phiên âm Việt (乔桑→Kiều Tang, 陈明→Trần Minh)
- Địa danh: phiên âm Việt (杭港→Hàng Cảng, 浙江→Chiết Giang)
- Thuật ngữ đặc thù: giữ tên Việt phổ biến (御兽师→Ngự Thú Sư)
- KHÔNG để sót chữ Hán trong bản dịch
- Chỉ trả về bản dịch, không giải thích

Text cần dịch:
${text}`;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 3000 },
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      const msg = err?.error?.message || `HTTP ${resp.status}`;
      if (resp.status === 400) throw new Error('API Key không hợp lệ hoặc model không tồn tại.');
      if (resp.status === 403) throw new Error('API Key bị từ chối. Kiểm tra lại key.');
      if (resp.status === 429) throw new Error('Hết quota API. Vui lòng thử lại sau ít phút.');
      throw new Error(msg);
    }

    const data = await resp.json();
    const result = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!result) throw new Error('Gemini không trả về kết quả. Thử lại.');
    return result;
  }

  // ── Translate Button ──────────────────────────────────────────────────────

  function ensureBtn() {
    if (!document.getElementById('truyen-dich-btn')) {
      translateBtn = document.createElement('button');
      translateBtn.id = 'truyen-dich-btn';
      translateBtn.innerHTML = '📖 Dịch';

      // Use mousedown instead of click to beat document-level handlers
      translateBtn.addEventListener('mousedown', e => {
        e.preventDefault();   // prevent text deselection
        e.stopPropagation();  // prevent document mousedown from firing
      });

      translateBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        if (isTranslating) return;
        const text = currentText;
        const rect = lastRect;
        hideBtn();
        showBubble(text, rect);
      });

      document.body.appendChild(translateBtn);
    } else {
      translateBtn = document.getElementById('truyen-dich-btn');
    }
  }

  function showBtn(text, rect) {
    if (!hasChinese(text) || text.length < 3) return;
    ensureBtn();
    currentText = text;
    lastRect    = rect;

    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    // Position above selection
    let top  = rect.top  + scrollY - 46;
    let left = rect.left + scrollX + (rect.width / 2) - 44;

    // Clamp to viewport
    if (top  < scrollY + 8)                    top  = rect.bottom + scrollY + 8;
    if (left < scrollX + 8)                    left = scrollX + 8;
    if (left + 110 > scrollX + window.innerWidth) left = scrollX + window.innerWidth - 118;

    translateBtn.style.cssText = `top:${top}px;left:${left}px;display:flex;`;
  }

  function hideBtn() {
    if (translateBtn) translateBtn.style.display = 'none';
  }

  // ── Translation Bubble ────────────────────────────────────────────────────

  function showBubble(text, rect) {
    closeBubble();

    bubble = document.createElement('div');
    bubble.id = 'truyen-dich-bubble';

    // Position
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    let top  = rect ? rect.bottom + scrollY + 10 : scrollY + 60;
    let left = rect ? rect.left   + scrollX      : scrollX + 20;

    if (left + 380 > scrollX + window.innerWidth) left = scrollX + window.innerWidth - 388;
    if (left < scrollX + 8) left = scrollX + 8;

    bubble.style.cssText = `top:${top}px;left:${left}px;`;

    bubble.innerHTML = `
      <div class="td-bubble-header">
        <div class="td-bubble-title">📖 Đang dịch…</div>
        <div class="td-bubble-actions">
          <button class="td-action-btn" id="td-retry" style="display:none">🔄 Thử lại</button>
          <button class="td-close-btn" id="td-close">✕</button>
        </div>
      </div>
      <div class="td-bubble-body">
        <div class="td-original">${escHtml(text.substring(0, 200))}${text.length > 200 ? '…' : ''}</div>
        <div class="td-translation" id="td-translation-content">
          <div class="td-loading">
            <div class="td-spinner"></div>
            <span>Đang gửi tới Gemini AI…</span>
          </div>
        </div>
      </div>
      <div class="td-bubble-footer">
        <span class="td-footer-label" id="td-model-label">Powered by Gemini AI</span>
        <button class="td-copy-btn" id="td-copy" style="display:none">📋 Sao chép</button>
      </div>
    `;

    document.body.appendChild(bubble);

    bubble.querySelector('#td-close').addEventListener('click', closeBubble);
    bubble.addEventListener('mousedown', e => e.stopPropagation());

    // Label with model name
    chrome.storage.sync.get(['model'], ({ model }) => {
      const lbl = bubble?.querySelector('#td-model-label');
      if (lbl) lbl.textContent = model || 'gemini-3-flash-preview';
    });

    runTranslation(text, 'translate');
  }

  async function runTranslation(text, mode) {
    if (!bubble) return;
    isTranslating = true;

    const content  = bubble.querySelector('#td-translation-content');
    const retryBtn = bubble.querySelector('#td-retry');
    const copyBtn  = bubble.querySelector('#td-copy');
    const title    = bubble.querySelector('.td-bubble-title');

    try {
      const result = await geminiTranslate(text, mode);
      if (!bubble) return;

      const html = result
        .split('\n')
        .filter(l => l.trim())
        .map(l => `<p>${escHtml(l)}</p>`)
        .join('');

      content.innerHTML = html;
      if (title) title.textContent = '📖 Bản dịch';

      if (copyBtn) {
        copyBtn.style.display = 'block';
        copyBtn.onclick = () => {
          navigator.clipboard.writeText(result).then(() => {
            copyBtn.textContent = '✓ Đã copy!';
            setTimeout(() => { copyBtn.textContent = '📋 Sao chép'; }, 1500);
          });
        };
      }
    } catch (e) {
      if (!bubble) return;
      content.innerHTML = `<div class="td-error">❌ ${escHtml(e.message)}</div>`;
      if (title) title.textContent = '📖 Lỗi';
      if (retryBtn) {
        retryBtn.style.display = 'block';
        retryBtn.onclick = () => {
          content.innerHTML = `<div class="td-loading"><div class="td-spinner"></div><span>Đang thử lại…</span></div>`;
          retryBtn.style.display = 'none';
          if (copyBtn) copyBtn.style.display = 'none';
          runTranslation(text, mode);
        };
      }
    } finally {
      isTranslating = false;
    }
  }

  function closeBubble() {
    if (bubble) { bubble.remove(); bubble = null; }
  }

  // ── Page Summary Panel ────────────────────────────────────────────────────

  async function showSummaryPanel() {
    // Toggle
    if (summaryPanel) { summaryPanel.remove(); summaryPanel = null; return; }

    summaryPanel = document.createElement('div');
    summaryPanel.id = 'truyen-dich-summary';
    summaryPanel.innerHTML = `
      <div class="td-summary-header">
        <div class="td-summary-title">📄 Tóm tắt trang</div>
        <button class="td-close-btn" id="td-summary-close"
          style="background:rgba(255,255,255,0.2);color:white;border-color:rgba(255,255,255,0.3)">✕</button>
      </div>
      <div class="td-summary-body">
        <div class="td-loading">
          <div class="td-spinner"></div>
          <span>Đang đọc nội dung trang…</span>
        </div>
      </div>
    `;
    document.body.appendChild(summaryPanel);
    summaryPanel.querySelector('#td-summary-close').addEventListener('click', () => {
      summaryPanel.remove(); summaryPanel = null;
    });

    const bodyText = document.body.innerText.trim().substring(0, 5000);
    const body = summaryPanel.querySelector('.td-summary-body');

    try {
      const result = await geminiTranslate(bodyText, 'summarize');
      const html = result.split('\n').filter(l => l.trim()).map(l => `<p>${escHtml(l)}</p>`).join('');
      body.innerHTML = html;
    } catch (e) {
      body.innerHTML = `<div class="td-error">❌ ${escHtml(e.message)}</div>`;
    }
  }

  // ── Selection listener ────────────────────────────────────────────────────

  document.addEventListener('mouseup', e => {
    if (translateBtn && translateBtn.contains(e.target)) return;
    if (bubble       && bubble.contains(e.target))       return;

    setTimeout(() => {
      const sel  = window.getSelection();
      const text = sel?.toString().trim() || '';

      if (text.length > 2 && hasChinese(text)) {
        try {
          const range = sel.getRangeAt(0);
          const rect  = range.getBoundingClientRect();
          showBtn(text, rect);
        } catch (_) {}
      } else {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          if (translateBtn && !translateBtn.matches(':hover')) hideBtn();
        }, 400);
      }
    }, 30);
  });

  document.addEventListener('mousedown', e => {
    if (translateBtn && translateBtn.contains(e.target)) return; // let button handle it
    if (bubble       && bubble.contains(e.target))       return;
    closeBubble();
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => hideBtn(), 250);
  });

  // ── Messages from background (context menu) ───────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'translateText') {
      const fakeRect = {
        top: 80, bottom: 100,
        left: Math.max(20, window.innerWidth / 2 - 180),
        width: 360,
      };
      showBubble(msg.text, fakeRect);
      sendResponse({ ok: true });
    }
    if (msg.action === 'summarizePage') {
      showSummaryPanel();
      sendResponse({ ok: true });
    }
    return false;
  });

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  document.addEventListener('keydown', e => {
    // Alt+T → translate selection
    if (e.altKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      const sel  = window.getSelection();
      const text = sel?.toString().trim() || '';
      if (text.length > 1) {
        try {
          const rect = sel.getRangeAt(0).getBoundingClientRect();
          showBubble(text, rect);
        } catch (_) {}
      }
    }
    // Escape → close everything
    if (e.key === 'Escape') { closeBubble(); hideBtn(); }
  });

  // ── Utility ───────────────────────────────────────────────────────────────

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

})();
