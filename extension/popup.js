// popup.js — Extension popup logic

const $ = id => document.getElementById(id);

// ── Load saved settings ───────────────────────────────────────────────────────

chrome.storage.sync.get(["apiKey", "model"], data => {
  if (data.apiKey) $("apiKey").value = data.apiKey;
  if (data.model)  $("modelSelect").value = data.model;
  updateStatus(data.apiKey);
});

function updateStatus(key) {
  const dot  = $("statusDot");
  const text = $("statusText");
  if (key && key.length > 10) {
    dot.className  = "status-dot ok";
    text.textContent = "Sẵn sàng dịch ✓";
  } else {
    dot.className  = "status-dot err";
    text.textContent = "Chưa cài API Key — nhập key bên dưới";
  }
}

// ── Toggle key visibility ─────────────────────────────────────────────────────

$("toggleKey").addEventListener("click", () => {
  const input = $("apiKey");
  if (input.type === "password") {
    input.type = "text";
    $("toggleKey").textContent = "🙈";
  } else {
    input.type = "password";
    $("toggleKey").textContent = "👁";
  }
});

// ── Save settings ─────────────────────────────────────────────────────────────

$("saveBtn").addEventListener("click", () => {
  const key   = $("apiKey").value.trim();
  const model = $("modelSelect").value;

  if (!key) { showToast("Vui lòng nhập API Key!", true); return; }

  chrome.storage.sync.set({ apiKey: key, model }, () => {
    updateStatus(key);
    showToast("Đã lưu cài đặt ✓");
  });
});

// ── Quick translate ───────────────────────────────────────────────────────────

$("translateBtn").addEventListener("click", async () => {
  const text = $("quickInput").value.trim();
  if (!text) { showToast("Nhập text cần dịch!", true); return; }

  const { apiKey, model } = await chrome.storage.sync.get(["apiKey", "model"]);
  if (!apiKey) {
    showToast("Chưa có API Key! Nhập key bên trên rồi Save.", true);
    $("apiKey").focus();
    return;
  }

  // Show loading state
  $("translateBtn").innerHTML = '<span class="spinner"></span>Đang dịch...';
  $("translateBtn").disabled  = true;
  $("quickResult").innerHTML  = '<span style="color:#888;font-size:12px">⏳ Đang gửi tới Gemini AI…</span>';
  $("quickResult").className  = "quick-result show";
  $("copyBtn").style.display  = "none";

  try {
    const result = await callGemini(apiKey, model || "gemini-3-flash-preview", text);
    // Format result: convert newlines to paragraphs
    const html = result.split("\n").filter(l => l.trim())
      .map(l => `<span style="display:block;margin-bottom:6px">${escHtml(l)}</span>`)
      .join("");
    $("quickResult").innerHTML  = html;
    $("quickResult").className  = "quick-result show";
    $("copyBtn").style.display  = "block";
    $("copyBtn").dataset.text   = result;
    showToast("Dịch thành công ✓");
  } catch (e) {
    $("quickResult").innerHTML  = `<span style="color:#f87171">❌ ${escHtml(e.message)}</span>`;
    $("quickResult").className  = "quick-result show";
    showToast("Lỗi: " + e.message.substring(0, 40), true);
  } finally {
    $("translateBtn").innerHTML = "🔥 Dịch ngay";
    $("translateBtn").disabled  = false;
  }
});

// Enter trong textarea → Ctrl+Enter để dịch
$("quickInput").addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    $("translateBtn").click();
  }
});

// Copy button
$("copyBtn").addEventListener("click", () => {
  navigator.clipboard.writeText($("copyBtn").dataset.text)
    .then(() => showToast("Đã copy ✓"))
    .catch(() => showToast("Copy thất bại!", true));
});

// ── Gemini API call ───────────────────────────────────────────────────────────

async function callGemini(apiKey, model, text) {
  const prompt = `Dịch đoạn text tiếng Trung sau sang tiếng Việt tự nhiên, văn học. 
Nếu là tên nhân vật hoặc địa danh Trung Quốc, hãy phiên âm sang tiếng Việt (VD: 乔桑 → Kiều Tang).
Chỉ trả về bản dịch, không giải thích gì thêm.

Text cần dịch:
${text}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${resp.status}`);
  }

  const data = await resp.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "(Không có kết quả)";
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(msg, isErr = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className   = "toast show" + (isErr ? " err" : "");
  setTimeout(() => { t.className = "toast"; }, 2500);
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
