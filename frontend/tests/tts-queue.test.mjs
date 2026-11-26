import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TTS_CHUNK_MAX, TTS_CONTINUE_TTL_MS, splitParagraph, buildTtsQueue, textToParagraphs,
  createTtsState, ttsStart, ttsAdvance, ttsSeekParagraph, ttsPause, ttsResume, ttsStopState,
  currentItem, currentParagraph, findStartPos, makeTtsContinue, isTtsContinueValid, makeSilentWavDataUri,
  readTtsContinueChain, classifyTtsError, ttsQueueEndAction, ttsAutoNextDecision, needsTtsKeepAlive,
  TTS_FATAL_ERRORS, TTS_MAX_CONSECUTIVE_ERRORS, TTS_AUTO_NEXT_MIN_MS, TTS_AUTO_NEXT_MAX_CHAIN,
} from '../src/utils/ttsQueue.js'
import { sanitizeSettings, DEFAULT_SETTINGS } from '../src/utils/readerSettingsSchema.js'
import { syncableReaderSettings, applyRemoteReaderSettings } from '../src/utils/userPrefsSync.js'

// ── Tách khúc ────────────────────────────────────────────────────────────────

test('splitParagraph: đoạn ngắn giữ nguyên, chuẩn hoá khoảng trắng', () => {
  assert.deepEqual(splitParagraph('  Hắn   cười.\n Rồi đi. '), ['Hắn cười. Rồi đi.'])
  assert.deepEqual(splitParagraph(''), [])
  assert.deepEqual(splitParagraph('   '), [])
  assert.deepEqual(splitParagraph(null), [])
})

test('splitParagraph: đoạn dài tách theo câu, mỗi khúc ≤ 220 ký tự, không mất chữ', () => {
  const sentence = 'Hắc phong gào thét, trăng lạnh treo cao trên đỉnh núi mờ sương.'
  const para = Array.from({ length: 12 }, () => sentence).join(' ')
  const chunks = splitParagraph(para)
  assert.ok(chunks.length > 1)
  for (const c of chunks) {
    assert.ok(c.length <= TTS_CHUNK_MAX, `khúc dài ${c.length}`)
    assert.ok(c.endsWith('.'), 'cắt đúng ranh giới câu')
  }
  assert.equal(chunks.join(' '), para)
})

test('splitParagraph: câu quá dài tách theo dấu phẩy, rồi theo khoảng trắng', () => {
  const longClause = Array.from({ length: 30 }, (_, i) => `vế${i}`).join(', ') + '.'
  const chunks = splitParagraph(longClause, 50)
  assert.ok(chunks.every(c => c.length <= 50))
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), longClause)

  const noPunct = Array.from({ length: 80 }, () => 'chữ').join(' ')
  const c2 = splitParagraph(noPunct, 40)
  assert.ok(c2.every(c => c.length <= 40))
  assert.equal(c2.join(' '), noPunct)

  const giant = 'x'.repeat(130) // 1 "từ" dài hơn giới hạn → cắt cứng
  assert.deepEqual(splitParagraph(giant, 50).map(c => c.length), [50, 50, 30])
})

test('splitParagraph: dấu câu tiếng Trung/ngoặc kép đi kèm câu', () => {
  const t = '“Ngươi dám?” Hắn quát. 你好。再见！' + ' Thêm chữ cho dài.'.repeat(15)
  const chunks = splitParagraph(t, 60)
  assert.ok(chunks[0].startsWith('“Ngươi dám?”'))
  assert.ok(chunks.every(c => c.length <= 60))
})

test('buildTtsQueue: giữ chỉ số đoạn gốc, bỏ đoạn rỗng', () => {
  const long = 'Một câu khá dài để kiểm tra tách khúc theo câu văn. '.repeat(10)
  const items = buildTtsQueue(['Đoạn 0.', '', long, 'Đoạn 3.'])
  assert.equal(items[0].p, 0)
  assert.ok(!items.some(it => it.p === 1))
  const p2 = items.filter(it => it.p === 2)
  assert.ok(p2.length > 1)
  assert.equal(items.at(-1).p, 3)
  assert.ok(items.every(it => it.text.length <= TTS_CHUNK_MAX))
  assert.deepEqual(buildTtsQueue(null), [])
})

test('textToParagraphs: API play(text) cũ tách theo dòng', () => {
  assert.deepEqual(textToParagraphs('A\n\nB  c\n'), ['A', 'B c'])
})

// ── Máy trạng thái ───────────────────────────────────────────────────────────

function sampleState() {
  // đoạn 0: 1 khúc, đoạn 1: rỗng, đoạn 2: 3 khúc, đoạn 3: 1 khúc
  return createTtsState([
    { p: 0, text: 'a' }, { p: 2, text: 'b1' }, { p: 2, text: 'b2' }, { p: 2, text: 'b3' }, { p: 3, text: 'c' },
  ])
}

test('ttsStart: bắt đầu từ đoạn đang thấy (đoạn rỗng → đoạn có chữ kế tiếp)', () => {
  const s0 = sampleState()
  assert.equal(s0.status, 'idle')
  assert.equal(currentItem(s0), null)
  const s = ttsStart(s0, 1)
  assert.equal(s.status, 'playing')
  assert.equal(currentItem(s).text, 'b1')
  assert.equal(currentParagraph(s), 2)
  assert.equal(findStartPos(s0.items, 99), -1)
  // Đoạn đang thấy sau đoạn cuối (vùng bình luận) → đọc lại từ đầu.
  assert.equal(ttsStart(s0, 99).pos, 0)
  assert.equal(ttsStart(createTtsState([]), 0).status, 'idle')
  assert.equal(s0.pos, -1, 'bất biến: state cũ không đổi')
})

test('ttsAdvance: đi hết hàng đợi → idle + ended', () => {
  let s = ttsStart(sampleState(), 3)
  assert.equal(currentItem(s).text, 'c')
  s = ttsAdvance(s)
  assert.equal(s.status, 'idle')
  assert.equal(s.ended, true)
  assert.equal(ttsAdvance(s), s, 'idle thì giữ nguyên')
})

test('ttsSeekParagraph: next/prev theo đoạn', () => {
  let s = ttsStart(sampleState(), 0)
  s = ttsSeekParagraph(s, 1)
  assert.equal(currentItem(s).text, 'b1')
  s = ttsAdvance(s) // b2 (giữa đoạn 2)
  assert.equal(ttsSeekParagraph(s, -1).pos, 1, 'giữa đoạn → về đầu đoạn hiện tại')
  const atStart = ttsSeekParagraph(s, -1)
  assert.equal(currentItem(ttsSeekParagraph(atStart, -1)).text, 'a', 'đầu đoạn → đoạn trước')
  assert.equal(ttsSeekParagraph(ttsStart(sampleState(), 0), -1).pos, 0, 'đoạn đầu → giữ ở 0')
  s = ttsSeekParagraph(s, 1)
  assert.equal(currentItem(s).text, 'c')
  assert.equal(ttsSeekParagraph(s, 1), s, 'đoạn cuối → không đổi')
  assert.equal(ttsSeekParagraph(sampleState(), 1).pos, -1, 'idle → không đổi')
})

test('pause/resume/stop', () => {
  const s = ttsStart(sampleState(), 2)
  const p = ttsPause(s)
  assert.equal(p.status, 'paused')
  assert.equal(p.pos, s.pos, 'tạm dừng giữ vị trí')
  assert.equal(ttsSeekParagraph(p, 1).status, 'paused', 'nhảy đoạn khi tạm dừng vẫn tạm dừng')
  assert.equal(ttsResume(p).status, 'playing')
  assert.equal(ttsPause(sampleState()).status, 'idle')
  assert.equal(ttsResume(s), s)
  const st = ttsStopState(p)
  assert.equal(st.status, 'idle')
  assert.equal(st.pos, -1)
  assert.equal(st.items.length, 5)
})

// ── Cờ đọc tiếp sang chương kế ───────────────────────────────────────────────

test('cờ hd:tts-continue: đúng slug/chương, hết hạn sau 30 giây', () => {
  const now = 1_000_000
  const raw = makeTtsContinue('tien-nghich', '12', now)
  assert.equal(isTtsContinueValid(raw, 'tien-nghich', '12', now + 1000), true)
  assert.equal(isTtsContinueValid(raw, 'tien-nghich', 12, now + 1000), true)
  assert.equal(isTtsContinueValid(raw, 'tien-nghich', '13', now), false)
  assert.equal(isTtsContinueValid(raw, 'khac', '12', now), false)
  assert.equal(isTtsContinueValid(raw, 'tien-nghich', '12', now + TTS_CONTINUE_TTL_MS + 1), false)
  assert.equal(isTtsContinueValid(raw, 'tien-nghich', '12', now - 5000), false, 'ts ở tương lai → bỏ')
  assert.equal(isTtsContinueValid('{hỏng', 'tien-nghich', '12', now), false)
  assert.equal(isTtsContinueValid(null, 'tien-nghich', '12', now), false)
  assert.equal(isTtsContinueValid('"x"', 'tien-nghich', '12', now), false)
  // Chương không số: cờ lưu dạng mã hoá (chapterIdentifier), useParams trả dạng giải mã.
  const enc = makeTtsContinue('s', encodeURIComponent('Lời tác giả.md'), now)
  assert.equal(isTtsContinueValid(enc, 's', 'Lời tác giả.md', now), true)
})

// ── WAV im lặng ──────────────────────────────────────────────────────────────

test('makeSilentWavDataUri: header WAV hợp lệ, toàn mẫu im lặng', () => {
  const uri = makeSilentWavDataUri(0.5, 8000)
  assert.ok(uri.startsWith('data:audio/wav;base64,'))
  const buf = Buffer.from(uri.split(',')[1], 'base64')
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF')
  assert.equal(buf.toString('ascii', 8, 12), 'WAVE')
  assert.equal(buf.readUInt32LE(24), 8000)
  assert.equal(buf.readUInt32LE(40), 4000)
  assert.equal(buf.length, 44 + 4000)
  assert.ok(buf.subarray(44).every(b => b === 128))
  assert.ok(makeSilentWavDataUri().length < 12_000, 'data URI nhỏ')
})

// ── Cài đặt mới ttsAutoNext / ttsAutoScroll ─────────────────────────────────

test('readerSettingsSchema: ttsAutoNext/ttsAutoScroll mặc định true, chỉ nhận boolean', () => {
  assert.equal(DEFAULT_SETTINGS.ttsAutoNext, true)
  assert.equal(DEFAULT_SETTINGS.ttsAutoScroll, true)
  assert.equal(sanitizeSettings({ ttsAutoNext: false }).ttsAutoNext, false)
  assert.equal(sanitizeSettings({ ttsAutoScroll: 'no' }).ttsAutoScroll, true)
  assert.equal(sanitizeSettings({}).ttsAutoNext, true)
})

test('userPrefsSync: ttsAutoNext/ttsAutoScroll được đồng bộ, ttsVoice thì không', () => {
  const synced = syncableReaderSettings({ ...DEFAULT_SETTINGS, ttsAutoNext: false, ttsAutoScroll: false, ttsVoice: 'X' })
  assert.equal(synced.ttsAutoNext, false)
  assert.equal(synced.ttsAutoScroll, false)
  assert.ok(!('ttsVoice' in synced))
  const merged = applyRemoteReaderSettings({ ...DEFAULT_SETTINGS, ttsVoice: 'Giọng máy này' }, { ttsAutoNext: false, ttsAutoScroll: 1, ttsVoice: 'khác' })
  assert.equal(merged.ttsAutoNext, false)
  assert.equal(merged.ttsAutoScroll, true, 'giá trị server sai kiểu → giữ local')
  assert.equal(merged.ttsVoice, 'Giọng máy này')
})

// ── Chống tự lật chương liên tục khi engine TTS hỏng ────────────────────────

test('classifyTtsError: mã "unavailable/failed" → fatal ngay, không bỏ khúc đọc tiếp', () => {
  for (const code of ['synthesis-unavailable', 'language-unavailable', 'voice-unavailable',
    'audio-busy', 'network', 'synthesis-failed']) {
    assert.ok(TTS_FATAL_ERRORS.has(code), code)
    assert.equal(classifyTtsError(code, 0), 'fatal', code)
  }
  assert.equal(classifyTtsError('interrupted'), 'ignore')
  assert.equal(classifyTtsError('canceled'), 'ignore')
  assert.equal(classifyTtsError('not-allowed'), 'blocked')
})

test('classifyTtsError: lỗi lẻ bỏ khúc, lỗi liên tiếp thứ 3 → fatal', () => {
  assert.equal(TTS_MAX_CONSECUTIVE_ERRORS, 3)
  assert.equal(classifyTtsError('text-too-long', 0), 'skip')
  assert.equal(classifyTtsError('invalid-argument', 1), 'skip')
  assert.equal(classifyTtsError('invalid-argument', 2), 'fatal')
  assert.equal(classifyTtsError('', 5), 'fatal')
})

test('ttsQueueEndAction: hết hàng đợi mà chưa khúc nào onstart → fail (không onEnd)', () => {
  assert.equal(ttsQueueEndAction(0), 'fail')
  assert.equal(ttsQueueEndAction(undefined), 'fail')
  assert.equal(ttsQueueEndAction(1), 'end')
  assert.equal(ttsQueueEndAction(40), 'end')
})

test('mô phỏng engine hỏng: mọi khúc lỗi ngay → dừng sau tối đa 3 lỗi, không bao giờ ended', () => {
  // Chương 50 khúc, mỗi khúc onerror ngay (mã không thuộc danh sách fatal).
  const items = Array.from({ length: 50 }, (_, i) => ({ p: i, text: `Đoạn ${i}.` }))
  let st = ttsStart(createTtsState(items), 0)
  let streak = 0
  let spoken = 0
  let outcome = null
  for (let guard = 0; guard < 100 && !outcome; guard++) {
    const action = classifyTtsError('some-weird-error', streak)
    streak += 1
    if (action === 'fatal') { outcome = 'fatal'; break }
    const next = ttsAdvance(st)
    if (next.ended) { outcome = ttsQueueEndAction(spoken) === 'end' ? 'ended' : 'fail'; break }
    st = next
  }
  assert.equal(outcome, 'fatal')
  assert.equal(streak, 3)
  assert.equal(st.pos, 2, 'dừng ở khúc thứ 3, không chạy tới hết chương')
})

test('ttsAutoNextDecision: chương xong < 3 giây → không tự sang', () => {
  const now = 1_000_000
  assert.equal(TTS_AUTO_NEXT_MIN_MS, 3000)
  assert.deepEqual(ttsAutoNextDecision({ startedAt: now - 500, now, chain: 0 }), { ok: false, reason: 'too-fast' })
  assert.deepEqual(ttsAutoNextDecision({ startedAt: now - 2999, now, chain: 0 }), { ok: false, reason: 'too-fast' })
  assert.deepEqual(ttsAutoNextDecision({ startedAt: now - 3000, now, chain: 0 }), { ok: true, reason: null })
  // Chưa ghi lúc bắt đầu (0/NaN) vẫn an toàn: 0 thì "lâu rồi" → ok; NaN → chặn.
  assert.equal(ttsAutoNextDecision({ startedAt: NaN, now }).ok, false)
})

test('ttsAutoNextDecision: tối đa 50 chương tự sang liên tiếp', () => {
  const now = 10_000_000
  assert.equal(TTS_AUTO_NEXT_MAX_CHAIN, 50)
  assert.equal(ttsAutoNextDecision({ startedAt: now - 600_000, now, chain: 49 }).ok, true)
  assert.deepEqual(ttsAutoNextDecision({ startedAt: now - 600_000, now, chain: 50 }), { ok: false, reason: 'chain-limit' })
})

test('cờ hd:tts-continue mang theo chain; cờ cũ/hỏng → 0', () => {
  const raw = makeTtsContinue('s', '3', 1000, 7)
  assert.equal(readTtsContinueChain(raw), 7)
  assert.equal(isTtsContinueValid(raw, 's', '3', 1000), true)
  assert.equal(readTtsContinueChain(JSON.stringify({ slug: 's', chapter: '3', ts: 1 })), 0)
  assert.equal(readTtsContinueChain('{hỏng'), 0)
  assert.equal(readTtsContinueChain(makeTtsContinue('s', '3', 1000, -2)), 0)
})

test('needsTtsKeepAlive: chỉ Chrome/Chromium desktop', () => {
  const chromeWin = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  const chromeMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  const chromium = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chromium/120.0 Chrome/120.0 Safari/537.36'
  const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
  const safariMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
  const iosChrome = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1'
  const firefox = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0'
  assert.equal(needsTtsKeepAlive(chromeWin), true)
  assert.equal(needsTtsKeepAlive(chromeMac), true)
  assert.equal(needsTtsKeepAlive(chromium), true)
  assert.equal(needsTtsKeepAlive(android), false)
  assert.equal(needsTtsKeepAlive(safariMac), false)
  assert.equal(needsTtsKeepAlive(iosChrome), false)
  assert.equal(needsTtsKeepAlive(firefox), false)
  assert.equal(needsTtsKeepAlive(''), false)
})
