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

  // Không dùng key trực tiếp — route qua backend local để key không lộ ra network
  const { model } = await chrome.storage.sync.get(["model"]);

  // Show loading state
  $("translateBtn").innerHTML = '<span class="spinner"></span>Đang dịch...';
  $("translateBtn").disabled  = true;
  $("quickResult").innerHTML  = '<span style="color:#888;font-size:12px">⏳ Đang gửi tới backend…</span>';
  $("quickResult").className  = "quick-result show";
  $("copyBtn").style.display  = "none";

  try {
    const result = await callViaBackend(model || "gemini-2.5-flash", text);
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

// ── Translation via local backend (key không lộ ra ngoài) ────────────────────
// Route qua http://localhost:4444 thay vì gọi Gemini trực tiếp.
// Lý do: gọi Gemini API từ browser với key trong URL sẽ bị lộ qua DevTools
// và có thể bị Google scanner phát hiện → revoke key.

async function callViaBackend(model, text) {
  const resp = await fetch("http://localhost:4444/api/translate-quick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, model }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.detail || `HTTP ${resp.status} — Backend không phản hồi. Đảm bảo server đang chạy.`);
  }

  const data = await resp.json();
  return data?.result || "(Không có kết quả)";
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
