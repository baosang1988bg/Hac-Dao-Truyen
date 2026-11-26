/**
 * ttsQueue.js — Hàng đợi đọc TTS theo đoạn (học từ truyentrung ReaderTtsPlayer).
 *
 * File THUẦN (không React, không DOM, không speechSynthesis) để test bằng
 * node --test:
 *   - buildTtsQueue: mảng đoạn văn (textContent của `.reader-p`) → danh sách
 *     khúc { p, text } — mỗi khúc ≤ TTS_CHUNK_MAX ký tự, giữ chỉ số đoạn `p`
 *     (khớp chỉ số dùng cho saveReadParagraph / chapterParagraphs).
 *   - Máy trạng thái bất biến (idle/playing/paused, vị trí khúc hiện tại,
 *     next/prev theo ĐOẠN, bắt đầu từ đoạn đang thấy).
 *   - Cờ "đọc tiếp sang chương kế" lưu ở sessionStorage (TTL 30 giây).
 *   - Tạo WAV im lặng (data URI) cho Media Session trên Chrome Android.
 */

// Chrome (desktop/Android) hay ngắt utterance dài (~15 giây âm thanh) hoặc treo
// với chuỗi nhiều nghìn ký tự → mỗi utterance chỉ 1 khúc ngắn.
export const TTS_CHUNK_MAX = 220
export const TTS_CONTINUE_KEY = 'hd:tts-continue'
export const TTS_CONTINUE_TTL_MS = 30_000

// Dấu kết câu Việt/Trung/Anh (kể cả "…" và dấu đóng ngoặc/nháy theo sau).
const SENTENCE_RE = /[^.!?…。！？；;]+(?:[.!?…。！？；;]+["'”’»)\]]*|$)/g
// Chỗ ngắt phụ khi 1 câu vẫn quá dài: dấu phẩy, hai chấm, gạch ngang.
const CLAUSE_RE = /[^,，:：、—–]+(?:[,，:：、—–]+|$)/g

function normalizeSpace(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

/** Cắt cứng theo khoảng trắng (từ quá dài thì cắt giữa từ) — mỗi phần ≤ max. */
function hardSplit(text, max) {
  const out = []
  let cur = ''
  for (const word of text.split(' ')) {
    if (!word) continue
    if (word.length > max) {
      if (cur) { out.push(cur); cur = '' }
      for (let i = 0; i < word.length; i += max) out.push(word.slice(i, i + max))
      continue
    }
    const next = cur ? `${cur} ${word}` : word
    if (next.length > max) { out.push(cur); cur = word } else cur = next
  }
  if (cur) out.push(cur)
  return out
}

/** Gộp các mẩu (câu/vế) liên tiếp thành khúc gần sát `max` nhưng không vượt. */
function packPieces(pieces, max) {
  const out = []
  let cur = ''
  for (const raw of pieces) {
    const piece = raw.trim()
    if (!piece) continue
    const next = cur ? `${cur} ${piece}` : piece
    if (next.length <= max) { cur = next; continue }
    if (cur) out.push(cur)
    cur = piece
  }
  if (cur) out.push(cur)
  return out
}

/**
 * Tách 1 đoạn văn thành các khúc ≤ max ký tự: ưu tiên ranh giới câu, câu quá
 * dài tách theo dấu phẩy/hai chấm, vẫn quá dài thì cắt theo khoảng trắng.
 */
export function splitParagraph(text, max = TTS_CHUNK_MAX) {
  const clean = normalizeSpace(text)
  if (!clean) return []
  if (clean.length <= max) return [clean]
  const pieces = []
  for (const sentence of clean.match(SENTENCE_RE) || [clean]) {
    const s = sentence.trim()
    if (!s) continue
    if (s.length <= max) { pieces.push(s); continue }
    for (const clause of s.match(CLAUSE_RE) || [s]) {
      const c = clause.trim()
      if (!c) continue
      if (c.length <= max) pieces.push(c)
      else pieces.push(...hardSplit(c, max))
    }
  }
  return packPieces(pieces, max)
}

/**
 * Mảng đoạn văn → hàng đợi khúc [{ p, text }]. Đoạn rỗng bị bỏ qua nhưng chỉ
 * số `p` vẫn là vị trí GỐC trong mảng (khớp `.reader-p` thứ p trong DOM).
 */
export function buildTtsQueue(paragraphs, { max = TTS_CHUNK_MAX } = {}) {
  const items = []
  if (!Array.isArray(paragraphs)) return items
  paragraphs.forEach((para, p) => {
    for (const text of splitParagraph(para, max)) items.push({ p, text })
  })
  return items
}

/** Văn bản thô (API play(text) cũ) → mảng đoạn: tách theo dòng. */
export function textToParagraphs(text) {
  return String(text ?? '').split(/\n+/).map(normalizeSpace).filter(Boolean)
}

// ── Máy trạng thái (bất biến — mỗi hàm trả state MỚI) ───────────────────────
// state = { status: 'idle'|'playing'|'paused', items, pos }
// pos = chỉ số khúc hiện tại trong items (-1 khi idle chưa bắt đầu).

export function createTtsState(items = []) {
  return { status: 'idle', items: Array.isArray(items) ? items : [], pos: -1 }
}

/** Vị trí khúc ĐẦU TIÊN thuộc đoạn ≥ startParagraph (-1 nếu không còn khúc nào). */
export function findStartPos(items, startParagraph = 0) {
  const start = Number.isFinite(startParagraph) ? startParagraph : 0
  return items.findIndex(it => it.p >= start)
}

/** Bắt đầu đọc từ đoạn startParagraph (đoạn đang thấy); hết khúc → idle. */
export function ttsStart(state, startParagraph = 0) {
  let pos = findStartPos(state.items, startParagraph)
  // Đoạn đang thấy nằm sau đoạn cuối có chữ (vd đã cuộn xuống phần bình luận)
  // → đọc lại từ đầu chương thay vì im lặng.
  if (pos < 0 && state.items.length) pos = 0
  if (pos < 0) return { ...state, status: 'idle', pos: -1 }
  return { ...state, status: 'playing', pos }
}

export function currentItem(state) {
  return state.pos >= 0 && state.pos < state.items.length ? state.items[state.pos] : null
}

export function currentParagraph(state) {
  const it = currentItem(state)
  return it ? it.p : -1
}

/** Khúc hiện tại đọc xong → sang khúc kế; hết hàng đợi → idle + ended. */
export function ttsAdvance(state) {
  if (state.status === 'idle') return state
  const pos = state.pos + 1
  if (pos >= state.items.length) return { ...state, status: 'idle', pos: -1, ended: true }
  return { ...state, pos, ended: false }
}

/**
 * Nhảy theo ĐOẠN: delta = +1 → khúc đầu của đoạn kế; delta = -1 → về đầu đoạn
 * hiện tại nếu đang ở giữa đoạn, ngược lại về khúc đầu của đoạn trước.
 * Giữ nguyên status (đang pause nhảy đoạn vẫn pause). Không còn đoạn → giữ nguyên.
 */
export function ttsSeekParagraph(state, delta) {
  const { items } = state
  if (!items.length || state.pos < 0) return state
  const curP = items[state.pos].p
  if (delta > 0) {
    const pos = items.findIndex((it, i) => i > state.pos && it.p > curP)
    return pos < 0 ? state : { ...state, pos }
  }
  const startOfCur = items.findIndex(it => it.p === curP)
  if (startOfCur < state.pos) return { ...state, pos: startOfCur }
  if (startOfCur <= 0) return { ...state, pos: 0 }
  const prevP = items[startOfCur - 1].p
  return { ...state, pos: items.findIndex(it => it.p === prevP) }
}

export function ttsPause(state) {
  return state.status === 'playing' ? { ...state, status: 'paused' } : state
}

export function ttsResume(state) {
  return state.status === 'paused' ? { ...state, status: 'playing' } : state
}

export function ttsStopState(state) {
  return { ...state, status: 'idle', pos: -1, ended: false }
}

// ── Cờ đọc tiếp sang chương kế (sessionStorage) ─────────────────────────────

/**
 * Giá trị (chuỗi JSON) ghi vào sessionStorage[TTS_CONTINUE_KEY]. `chain` = số
 * chương đã TỰ sang liên tiếp không có thao tác người dùng (mang qua lần
 * chuyển chương để giới hạn TTS_AUTO_NEXT_MAX_CHAIN không bị reset).
 */
export function makeTtsContinue(slug, chapter, now = Date.now(), chain = 0) {
  const n = Number.isInteger(chain) && chain > 0 ? chain : 0
  return JSON.stringify({ slug: String(slug), chapter: String(chapter), ts: now, chain: n })
}

/** Đọc `chain` trong cờ đọc tiếp (cờ cũ/hỏng → 0). */
export function readTtsContinueChain(raw) {
  try {
    const n = Number(JSON.parse(raw)?.chain)
    return Number.isInteger(n) && n > 0 ? n : 0
  } catch { return 0 }
}

/**
 * Cờ hợp lệ cho đúng (slug, chapter) và chưa quá TTL → true. `chapter` có thể
 * là tham số URL đã giải mã (useParams) trong khi cờ lưu dạng mã hoá
 * (chapterIdentifier encodeURIComponent filename) → so cả hai dạng.
 */
export function isTtsContinueValid(raw, slug, chapter, now = Date.now(), ttl = TTS_CONTINUE_TTL_MS) {
  if (!raw) return false
  let flag
  try { flag = JSON.parse(raw) } catch { return false }
  if (!flag || typeof flag !== 'object') return false
  if (flag.slug !== String(slug)) return false
  const ts = Number(flag.ts)
  if (!Number.isFinite(ts) || now - ts < 0 || now - ts > ttl) return false
  const want = String(chapter)
  const candidates = new Set([want])
  try { candidates.add(encodeURIComponent(want)) } catch { /* bỏ qua */ }
  try { candidates.add(decodeURIComponent(want)) } catch { /* chuỗi % lỗi */ }
  return candidates.has(String(flag.chapter))
}

// ── WAV im lặng cho Media Session (Chrome Android) ──────────────────────────

function toBase64(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin) // trình duyệt + Node ≥ 16 đều có btoa toàn cục
}

/**
 * data URI WAV PCM 8-bit mono im lặng (mặc định 1 giây @ 8 kHz ≈ 8 KB) — phát
 * lặp để Chrome Android coi trang "đang phát media" và hiện điều khiển màn
 * hình khoá cho Media Session (speechSynthesis không tính là media).
 */
export function makeSilentWavDataUri(seconds = 1, sampleRate = 8000) {
  const samples = Math.max(1, Math.round(seconds * sampleRate))
  const bytes = new Uint8Array(44 + samples)
  const view = new DataView(bytes.buffer)
  const ascii = (off, s) => { for (let i = 0; i < s.length; i++) bytes[off + i] = s.charCodeAt(i) }
  ascii(0, 'RIFF'); view.setUint32(4, 36 + samples, true); ascii(8, 'WAVE')
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate, true) // byteRate = rate × 1 byte
  view.setUint16(32, 1, true); view.setUint16(34, 8, true) // blockAlign, 8 bit
  ascii(36, 'data'); view.setUint32(40, samples, true)
  bytes.fill(128, 44) // PCM 8-bit không dấu: 128 = im lặng
  return `data:audio/wav;base64,${toBase64(bytes)}`
}

// ── Chống "tự lật chương liên tục" khi engine TTS hỏng ──────────────────────
// Máy thiếu giọng / engine lỗi → mọi utterance lỗi ngay → hàng đợi "đọc xong"
// tức thì → tự sang chương → lặp tới hết truyện (ghi đè reading_progress).
// Các quyết định dưới đây thuần để test được; hook/Reader chỉ thực thi.

// Mã lỗi SpeechSynthesisErrorEvent cho thấy engine/giọng KHÔNG dùng được —
// đọc tiếp khúc sau cũng sẽ lỗi y hệt → dừng + báo người dùng ngay.
export const TTS_FATAL_ERRORS = new Set([
  'synthesis-unavailable', 'synthesis-failed', 'language-unavailable',
  'voice-unavailable', 'audio-busy', 'audio-hardware', 'network',
])
// Lỗi lẻ tẻ (text-too-long, invalid-argument…) bỏ khúc đọc tiếp, nhưng quá
// ngần này lỗi LIÊN TIẾP (chưa có khúc nào onstart xen giữa) → coi là hỏng.
export const TTS_MAX_CONSECUTIVE_ERRORS = 3

/**
 * Quyết định khi utterance bắn onerror:
 *   'ignore'  — interrupted/canceled (do chính mình cancel)
 *   'blocked' — not-allowed (thiếu thao tác người dùng) → chờ "Tiếp tục nghe"
 *   'fatal'   — engine/giọng hỏng hoặc lỗi liên tiếp ≥ max → dừng + báo
 *   'skip'    — lỗi lẻ: bỏ khúc này, đọc khúc sau
 * `consecutive` = số lỗi liên tiếp TRƯỚC lỗi này.
 */
export function classifyTtsError(code, consecutive = 0, max = TTS_MAX_CONSECUTIVE_ERRORS) {
  const c = String(code || '')
  if (c === 'interrupted' || c === 'canceled') return 'ignore'
  if (c === 'not-allowed') return 'blocked'
  if (TTS_FATAL_ERRORS.has(c)) return 'fatal'
  return consecutive + 1 >= max ? 'fatal' : 'skip'
}

/**
 * Hàng đợi vừa hết (ttsAdvance trả ended): chỉ coi là "đọc xong chương" (gọi
 * onEnd → có thể tự sang chương) khi phiên có ≥ 1 khúc THẬT SỰ phát (onstart).
 * Không khúc nào phát → 'fail' (báo lỗi, không lật chương).
 */
export function ttsQueueEndAction(spokenCount) {
  return Number(spokenCount) > 0 ? 'end' : 'fail'
}

// Reader: chặn tự sang chương khi chương vừa "đọc xong" quá nhanh (engine
// hỏng mà vẫn bắn onstart/onend tức thì) hoặc đã tự lật quá nhiều chương liên
// tiếp mà người dùng không chạm gì (ngủ quên/tab bỏ quên).
export const TTS_AUTO_NEXT_MIN_MS = 3000
export const TTS_AUTO_NEXT_MAX_CHAIN = 50

/**
 * startedAt = lúc bắt đầu đọc chương (ms), chain = số chương đã tự sang liên
 * tiếp. Trả { ok, reason } với reason 'too-fast' | 'chain-limit' | null.
 */
export function ttsAutoNextDecision({
  startedAt, now = Date.now(), chain = 0,
  minMs = TTS_AUTO_NEXT_MIN_MS, maxChain = TTS_AUTO_NEXT_MAX_CHAIN,
} = {}) {
  if (!Number.isFinite(startedAt) || now - startedAt < minMs) return { ok: false, reason: 'too-fast' }
  if (chain >= maxChain) return { ok: false, reason: 'chain-limit' }
  return { ok: true, reason: null }
}

/**
 * Chrome DESKTOP (kể cả Edge/Chromium) mới cần mẹo pause()+resume() mỗi 10
 * giây chống tự dừng sau ~15 giây. Android: pause = cancel; Safari/iOS (kể cả
 * Chrome iOS — CriOS — dùng WebKit): pause/resume làm hỏng phiên.
 */
export function needsTtsKeepAlive(ua) {
  const s = String(ua || '')
  if (!/(?:Chrome|Chromium)\//.test(s)) return false
  return !/Android|iPhone|iPad|iPod|CriOS|FxiOS|EdgiOS/i.test(s)
}
