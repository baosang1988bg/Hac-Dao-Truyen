import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildTtsQueue, textToParagraphs, createTtsState, ttsStart, ttsAdvance, ttsSeekParagraph,
  ttsPause as pauseState, ttsResume as resumeState, ttsStopState, currentItem, makeSilentWavDataUri,
  classifyTtsError, ttsQueueEndAction, needsTtsKeepAlive,
} from '../utils/ttsQueue'

// Text-to-Speech dùng Web Speech API (window.speechSynthesis) — không cần
// backend. Giọng đọc tiếng Việt phụ thuộc hệ điều hành/trình duyệt.
//
// Đọc theo HÀNG ĐỢI khúc (utils/ttsQueue.js): mỗi utterance ≤ 220 ký tự, giữ
// chỉ số đoạn → Reader tô sáng/tự cuộn/lưu tiến độ theo đoạn đang đọc.
//
// Tạm dừng = huỷ utterance + nhớ vị trí khúc, tiếp tục = đọc lại khúc đó từ
// đầu (≤ 220 ký tự nên mất rất ít). Tránh speechSynthesis.pause()/resume() vì
// Chrome Android coi pause như cancel và Chrome desktop hay "kẹt" sau resume.
//
// API cũ vẫn giữ: { supported, isPlaying, isPaused, voices, hasVietnameseVoice,
// play(text, { voiceName, rate }), pause, resume, stop }. isPlaying = có phiên
// đọc (kể cả đang tạm dừng) như trước.
//
// Tuỳ chọn (đọc qua ref — đổi không làm play/stop đổi danh tính):
//   onParagraph(p)   — bắt đầu đọc đoạn p (chỉ số trong mảng đoạn truyền vào)
//   onEnd()          — đọc hết hàng đợi (tự sang chương do nơi gọi quyết định)
//   onStateChange()  — status đổi (để nơi gọi gỡ tô sáng khi dừng)
//   media            — { title?, artist?, onNextTrack, onPrevTrack } cho Media
//                      Session (điều khiển màn hình khoá)

// Chrome desktop có lỗi utterance "im lặng mãi" (không onend) — watchdog kiểm
// mỗi khoảng này; quá STALL_LIMIT lần liên tiếp không nói gì → đọc lại khúc.
const WATCHDOG_MS = 2000
const STALL_LIMIT = 3
// Chrome desktop tự dừng hẳn sau ~15 giây nói liên tục: pause()+resume() định
// kỳ giữ phiên sống — CHỈ Chrome/Chromium desktop (needsTtsKeepAlive): Android
// coi pause = cancel, Safari/iOS làm hỏng phiên.
const KEEPALIVE_MS = 10_000

let silentUri = null
function getSilentUri() {
  if (!silentUri) silentUri = makeSilentWavDataUri(1, 8000)
  return silentUri
}

function wantsKeepAlive() {
  return typeof navigator !== 'undefined' && needsTtsKeepAlive(navigator.userAgent)
}

function pickVoice(voices, voiceName) {
  if (voiceName) {
    const v = voices.find(x => x.name === voiceName)
    if (v) return v
  }
  // Không chọn / giọng đã chọn không có trên máy này → ưu tiên giọng tiếng Việt.
  return voices.find(x => (x.lang || '').toLowerCase().startsWith('vi')) || null
}

export default function useTextToSpeech(options = {}) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const [isPlaying, setIsPlaying] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  // Trình duyệt chặn speak() vì không có thao tác người dùng (vd tự sang
  // chương sau khi tab chạy nền) → nơi gọi hiện nút "Tiếp tục nghe".
  const [blocked, setBlocked] = useState(false)
  // Mã lỗi khi engine/giọng không dùng được (vd 'synthesis-unavailable',
  // 'no-speech') — nơi gọi hiện thông báo kèm nút "Thử lại". '' = không lỗi.
  const [error, setError] = useState('')
  const [paragraph, setParagraph] = useState(-1)
  const [voices, setVoices] = useState([])

  const stateRef = useRef(createTtsState())
  const optsRef = useRef(options)
  optsRef.current = options
  const voiceOptsRef = useRef({ voiceName: '', rate: 1 })
  const voicesRef = useRef(voices)
  voicesRef.current = voices
  // "token" phiên/utterance — tăng mỗi lần speak/cancel; callback của
  // utterance cũ (onend/onerror bắn trễ sau cancel) so token để bỏ qua.
  const tokenRef = useRef(0)
  const lastParagraphRef = useRef(-1)
  const audioRef = useRef(null)
  const stallRef = useRef(0)
  const currentUtteranceRef = useRef(null)
  const startedRef = useRef(false) // utterance hiện tại đã bắn onstart chưa
  const spokenRef = useRef(0) // số khúc đã THẬT SỰ phát (onstart) trong phiên
  const errorStreakRef = useRef(0) // số lỗi liên tiếp (reset khi có khúc onstart)

  useEffect(() => {
    if (!supported) return undefined
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices())
    loadVoices()
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices)
  }, [supported])

  // ── Audio im lặng (Chrome Android cần media đang phát để hiện điều khiển) ──
  const startSilentAudio = useCallback(() => {
    if (typeof Audio === 'undefined') return
    try {
      let a = audioRef.current
      if (!a) {
        a = new Audio()
        a.loop = true
        a.preload = 'auto'
        a.setAttribute?.('aria-hidden', 'true')
        audioRef.current = a
      }
      if (!a.src) a.src = getSilentUri()
      const p = a.play()
      if (p && typeof p.catch === 'function') p.catch(() => { /* bị chặn autoplay — chỉ mất điều khiển màn hình khoá */ })
    } catch { /* trình duyệt không hỗ trợ — bỏ qua */ }
  }, [])

  const stopSilentAudio = useCallback((release) => {
    const a = audioRef.current
    if (!a) return
    try {
      a.pause()
      if (release) {
        a.removeAttribute('src')
        a.load()
        audioRef.current = null
      }
    } catch { /* bỏ qua */ }
  }, [])

  const syncFlags = useCallback(() => {
    const st = stateRef.current
    setIsPlaying(st.status !== 'idle')
    setIsPaused(st.status === 'paused')
    try {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = st.status === 'playing' ? 'playing' : st.status === 'paused' ? 'paused' : 'none'
      }
    } catch { /* bỏ qua */ }
    optsRef.current.onStateChange?.(st.status)
  }, [])

  // Engine/giọng hỏng: dừng nói ngay (cancel), giữ vị trí ở trạng thái tạm
  // dừng + blocked để thanh TTS vẫn hiện thông báo và nút "Thử lại" (dừng hẳn
  // về idle thì thanh biến mất, người dùng không biết vì sao im lặng). TUYỆT
  // ĐỐI không gọi onEnd → Reader không tự sang chương.
  const failSession = useCallback((code) => {
    tokenRef.current += 1
    stateRef.current = pauseState(stateRef.current)
    if (supported) window.speechSynthesis.cancel()
    stopSilentAudio(false)
    setBlocked(true)
    setError(code || 'synthesis-failed')
    syncFlags()
  }, [supported, stopSilentAudio, syncFlags])

  // ── Đọc khúc hiện tại ──────────────────────────────────────────────────────
  const speakCurrent = useCallback(function speakCurrentImpl() {
    if (!supported) return
    const st = stateRef.current
    const item = currentItem(st)
    if (st.status !== 'playing' || !item) return
    const synth = window.speechSynthesis
    const myToken = ++tokenRef.current
    stallRef.current = 0
    startedRef.current = false
    synth.cancel()

    if (item.p !== lastParagraphRef.current) {
      lastParagraphRef.current = item.p
      setParagraph(item.p)
      try { optsRef.current.onParagraph?.(item.p) } catch (err) { console.error(err) }
    }

    const u = new SpeechSynthesisUtterance(item.text)
    const { voiceName, rate } = voiceOptsRef.current
    const voice = pickVoice(voicesRef.current, voiceName)
    if (voice) { u.voice = voice; u.lang = voice.lang } else u.lang = 'vi-VN'
    u.rate = Number.isFinite(rate) && rate > 0 ? rate : 1
    u.onstart = () => {
      if (tokenRef.current !== myToken) return
      startedRef.current = true
      spokenRef.current += 1
      errorStreakRef.current = 0
      setBlocked(false)
      setError('')
    }
    u.onend = () => {
      if (tokenRef.current !== myToken) return
      const next = ttsAdvance(stateRef.current)
      if (next.status === 'idle' && next.ended && ttsQueueEndAction(spokenRef.current) === 'fail') {
        // Hết hàng đợi mà chưa khúc nào phát → engine hỏng, KHÔNG báo "xong chương".
        failSession('no-speech')
        return
      }
      stateRef.current = next
      if (next.status === 'idle') {
        lastParagraphRef.current = -1
        setParagraph(-1)
        // Chỉ pause audio im lặng (không giải phóng): nếu Reader tự sang chương,
        // Media Session Android không chập chờn. Giải phóng ở stop()/unmount.
        stopSilentAudio(false)
        syncFlags()
        if (next.ended) {
          try { optsRef.current.onEnd?.() } catch (err) { console.error(err) }
        }
        return
      }
      speakImplRef.current()
    }
    u.onerror = (e) => {
      if (tokenRef.current !== myToken) return
      const code = e?.error || ''
      const action = classifyTtsError(code, errorStreakRef.current)
      // 'interrupted'/'canceled': do chính mình cancel (đã đổi token) — bỏ qua.
      if (action === 'ignore') return
      if (action === 'blocked') {
        // Bị chặn vì không có thao tác người dùng → tạm dừng, chờ bấm "Tiếp tục nghe".
        stateRef.current = pauseState(stateRef.current)
        setBlocked(true)
        syncFlags()
        return
      }
      errorStreakRef.current += 1
      if (action === 'fatal') {
        // Thiếu giọng/engine hỏng (hoặc lỗi liên tiếp ≥ 3): đọc tiếp cũng lỗi
        // y hệt → dừng + báo, không "bỏ khúc" tới hết chương rồi tự lật chương.
        console.warn('TTS lỗi engine, dừng đọc', code)
        failSession(code || 'synthesis-failed')
        return
      }
      // Lỗi lẻ (text quá dài…): bỏ khúc này, đọc tiếp.
      console.warn('TTS lỗi khúc', code)
      u.onend()
    }
    currentUtteranceRef.current = u
    synth.speak(u)
  }, [supported, stopSilentAudio, syncFlags, failSession])
  const speakImplRef = useRef(speakCurrent)
  speakImplRef.current = speakCurrent

  // ── Watchdog: Chrome bỏ onend / tự dừng sau ~15 giây ──────────────────────
  useEffect(() => {
    if (!supported || !isPlaying || isPaused) return undefined
    const synth = window.speechSynthesis
    const keepAliveOn = wantsKeepAlive()
    const watch = setInterval(() => {
      if (stateRef.current.status !== 'playing') return
      if (synth.speaking || synth.pending) { stallRef.current = 0; return }
      stallRef.current += 1
      if (stallRef.current < STALL_LIMIT) return
      if (startedRef.current) {
        // Đã đọc nhưng mất onend (lỗi Chrome) → sang khúc kế.
        startedRef.current = false
        currentUtteranceRef.current?.onend?.()
      } else {
        // Chưa từng bắt đầu: Safari/WebView chặn speak() im lặng (không bắn
        // 'not-allowed') → coi như bị chặn, chờ người dùng bấm "Tiếp tục nghe".
        tokenRef.current += 1
        stateRef.current = pauseState(stateRef.current)
        synth.cancel()
        setBlocked(true)
        syncFlags()
      }
    }, WATCHDOG_MS)
    const keepAlive = !keepAliveOn ? null : setInterval(() => {
      if (stateRef.current.status === 'playing' && synth.speaking && !synth.paused) {
        synth.pause()
        synth.resume()
      }
    }, KEEPALIVE_MS)
    return () => {
      clearInterval(watch)
      if (keepAlive) clearInterval(keepAlive)
    }
  }, [supported, isPlaying, isPaused, syncFlags])

  // ── Điều khiển ─────────────────────────────────────────────────────────────
  /**
   * Dừng hẳn phiên. { keepAudio: true } (dùng khi tự sang chương) chỉ pause
   * audio im lặng, không giải phóng → Media Session Android không chập chờn
   * giữa 2 chương; dừng bởi người dùng/rời Reader thì giải phóng.
   */
  const stop = useCallback((opts) => {
    const keepAudio = Boolean(opts && typeof opts === 'object' && opts.keepAudio)
    tokenRef.current += 1
    stateRef.current = ttsStopState(stateRef.current)
    lastParagraphRef.current = -1
    setParagraph(-1)
    setBlocked(false)
    setError('')
    if (supported) window.speechSynthesis.cancel()
    stopSilentAudio(!keepAudio)
    syncFlags()
  }, [supported, stopSilentAudio, syncFlags])

  /**
   * Đọc mảng đoạn văn từ đoạn startParagraph. Tuỳ chọn: voiceName, rate.
   * Gọi lại khi đang đọc → huỷ phiên cũ, bắt đầu phiên mới.
   */
  const playParagraphs = useCallback((paragraphs, { voiceName, rate = 1, startParagraph = 0 } = {}) => {
    if (!supported) return false
    tokenRef.current += 1
    window.speechSynthesis.cancel()
    voiceOptsRef.current = { voiceName: voiceName || '', rate }
    const items = buildTtsQueue(paragraphs)
    stateRef.current = ttsStart(createTtsState(items), startParagraph)
    lastParagraphRef.current = -1
    spokenRef.current = 0
    errorStreakRef.current = 0
    setBlocked(false)
    setError('')
    syncFlags()
    if (stateRef.current.status !== 'playing') return false
    startSilentAudio()
    speakImplRef.current()
    return true
  }, [supported, startSilentAudio, syncFlags])

  // API cũ: văn bản thô → tách theo dòng thành đoạn.
  const play = useCallback((text, opts = {}) => {
    if (!text) return false
    return playParagraphs(textToParagraphs(text), opts)
  }, [playParagraphs])

  const pause = useCallback(() => {
    if (!supported || stateRef.current.status !== 'playing') return
    tokenRef.current += 1 // onerror 'interrupted' của khúc đang đọc bị bỏ qua
    stateRef.current = pauseState(stateRef.current)
    window.speechSynthesis.cancel()
    stopSilentAudio(false)
    syncFlags()
  }, [supported, stopSilentAudio, syncFlags])

  const resume = useCallback(() => {
    if (!supported || stateRef.current.status !== 'paused') return
    stateRef.current = resumeState(stateRef.current)
    setBlocked(false)
    setError('')
    errorStreakRef.current = 0 // "Thử lại" sau lỗi engine: cho 3 lần lỗi mới
    startSilentAudio()
    syncFlags()
    speakImplRef.current() // đọc lại khúc đang dở từ đầu khúc
  }, [supported, startSilentAudio, syncFlags])

  /** Nhảy theo đoạn (+1 đoạn sau, -1 đoạn trước). */
  const seekParagraph = useCallback((delta) => {
    const st = stateRef.current
    if (st.status === 'idle') return
    const next = ttsSeekParagraph(st, delta)
    if (next === st) return
    stateRef.current = next
    if (next.status === 'playing') speakImplRef.current()
    else {
      // Đang tạm dừng: chỉ dời vị trí + báo đoạn mới (tô sáng), chưa đọc.
      const it = currentItem(next)
      if (it && it.p !== lastParagraphRef.current) {
        lastParagraphRef.current = it.p
        setParagraph(it.p)
        optsRef.current.onParagraph?.(it.p)
      }
    }
  }, [])
  const nextParagraph = useCallback(() => seekParagraph(1), [seekParagraph])
  const prevParagraph = useCallback(() => seekParagraph(-1), [seekParagraph])

  /** Đổi giọng/tốc độ giữa chừng — áp từ khúc kế tiếp. */
  const setVoiceOptions = useCallback(({ voiceName, rate } = {}) => {
    const cur = voiceOptsRef.current
    voiceOptsRef.current = {
      voiceName: voiceName === undefined ? cur.voiceName : voiceName,
      rate: rate === undefined ? cur.rate : rate,
    }
  }, [])

  // Huỷ giọng đọc + audio im lặng khi rời trang (unmount).
  useEffect(() => () => {
    tokenRef.current += 1
    stateRef.current = ttsStopState(stateRef.current)
    if (supported) window.speechSynthesis.cancel()
    const a = audioRef.current
    if (a) { try { a.pause(); a.removeAttribute('src'); a.load() } catch { /* bỏ qua */ } }
    audioRef.current = null
  }, [supported])

  // ── Media Session: nút điều khiển (màn hình khoá / tai nghe / thông báo) ──
  useEffect(() => {
    if (!isPlaying || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return undefined
    const ms = navigator.mediaSession
    const handlers = {
      play: () => resume(),
      pause: () => pause(),
      stop: () => stop(),
      nexttrack: () => optsRef.current.media?.onNextTrack?.(),
      previoustrack: () => optsRef.current.media?.onPrevTrack?.(),
      seekforward: () => seekParagraph(1),
      seekbackward: () => seekParagraph(-1),
    }
    for (const [action, fn] of Object.entries(handlers)) {
      try { ms.setActionHandler(action, fn) } catch { /* action không hỗ trợ */ }
    }
    return () => {
      for (const action of Object.keys(handlers)) {
        try { ms.setActionHandler(action, null) } catch { /* bỏ qua */ }
      }
    }
  }, [isPlaying, pause, resume, stop, seekParagraph])

  // Metadata: chỉ đặt khi nơi gọi truyền media.title (Reader tự đặt metadata
  // trong effect riêng vì tên chương tính sau lời gọi hook).
  const mediaTitle = options.media?.title || ''
  const mediaArtist = options.media?.artist || ''
  useEffect(() => {
    if (!isPlaying || !mediaTitle || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    try {
      if (typeof window.MediaMetadata === 'function') {
        navigator.mediaSession.metadata = new window.MediaMetadata({ title: mediaTitle, artist: mediaArtist })
      }
    } catch { /* bỏ qua */ }
  }, [isPlaying, mediaTitle, mediaArtist])

  useEffect(() => {
    if (isPlaying || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    try { navigator.mediaSession.metadata = null } catch { /* bỏ qua */ }
  }, [isPlaying])

  // Có ít nhất 1 giọng tiếng Việt (lang bắt đầu 'vi') — UI cảnh báo khi phải
  // dùng giọng mặc định.
  const hasVietnameseVoice = voices.some(v => (v.lang || '').toLowerCase().startsWith('vi'))

  return {
    supported, isPlaying, isPaused, blocked, error, paragraph, voices, hasVietnameseVoice,
    play, playParagraphs, pause, resume, stop, nextParagraph, prevParagraph, setVoiceOptions,
  }
}
