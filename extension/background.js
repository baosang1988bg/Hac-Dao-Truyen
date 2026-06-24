// background.js — Service Worker (context menu only, translation handled by content.js)

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'translate-selection',
    title: '📖 Dịch sang tiếng Việt',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'translate-page-summary',
    title: '📄 Tóm tắt trang này',
    contexts: ['page'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;

  if (info.menuItemId === 'translate-selection' && info.selectionText) {
    // Inject content script first (in case page was open before extension install)
    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, files: ['content.js'] },
      () => {
        // Ignore "already injected" error
        chrome.runtime.lastError;
        // Small delay to ensure script is ready
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, {
            action: 'translateText',
            text: info.selectionText,
          }).catch(() => {
            // Content script not ready — try injecting CSS too
            chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] });
          });
        }, 100);
      }
    );
  }

  if (info.menuItemId === 'translate-page-summary') {
    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, files: ['content.js'] },
      () => {
        chrome.runtime.lastError;
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, { action: 'summarizePage' }).catch(() => {});
        }, 100);
      }
    );
  }
});

// ── Message Listener for Translation ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translate') {
    handleTranslation(request.text, request.mode)
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Giữ kênh tin nhắn mở để trả về bất đồng bộ
  }
});

async function handleTranslation(text, mode) {
  // 1. Thử gọi qua local backend trước (bảo mật tuyệt đối, key nằm ở file .env của backend)
  try {
    const { model } = await chrome.storage.sync.get(['model']);
    const m = model || 'gemini-3-flash-preview';
    
    const resp = await fetch("http://localhost:4444/api/translate-quick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, model: m }),
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data?.result) {
        return data.result;
      }
    }
  } catch (e) {
    // Local backend offline hoặc lỗi kết nối, tiếp tục fallback gọi trực tiếp
    console.log("Local backend offline, fallback sang gọi trực tiếp Gemini API...", e);
  }

  // 2. Fallback: gọi trực tiếp Google Gemini API bằng key đã cài đặt trong extension
  const { apiKey, model } = await chrome.storage.sync.get(['apiKey', 'model']);
  if (!apiKey) {
    throw new Error('Local backend server chưa chạy và chưa cấu hình Gemini API Key trong Extension. Vui lòng bật backend hoặc Click icon extension để nhập API Key.');
  }

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

  // Đảm bảo không đính kèm key trên URL để tránh Google Secret Scanner quét trúng
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey // Sử dụng header x-goog-api-key để bảo mật
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 3000 },
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const msg = err?.error?.message || `HTTP ${resp.status}`;
    if (resp.status === 400) throw new Error('API Key không hợp lệ hoặc model không hoạt động.');
    if (resp.status === 403) throw new Error('API Key bị từ chối. Vui lòng kiểm tra lại key.');
    if (resp.status === 429) throw new Error('Hết hạn quota API. Vui lòng thử lại sau ít phút.');
    throw new Error(msg);
  }

  const data = await resp.json();
  const result = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!result) throw new Error('Gemini không trả về kết quả. Vui lòng thử lại.');
  return result;
}

