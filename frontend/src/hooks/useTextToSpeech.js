import { useCallback, useEffect, useRef, useState } from 'react'

// C08: nhiều trình duyệt (đặc biệt Chrome desktop/Android) giới hạn hoặc cắt
// utterance quá dài (thường ngắt sau ~15s âm thanh hoặc treo với text nhiều
// nghìn ký tự). Chia chương dài thành nhiều utterance nhỏ, xếp hàng nối tiếp
// (đọc ổn định hơn) thay vì 1 utterance khổng lồ cho cả chương.
const CHUNK_MAX_CHARS = 220

function splitIntoChunks(text) {
  // Tách theo dấu kết câu (Việt/Trung/Anh), gộp lại tới gần giới hạn ký tự để
  // không cắt giữa câu một cách vô nghĩa.
  const sentences = text.split(/(?<=[.!?…。！？；;])\s+/).filter(Boolean)
  const chunks = []
  let current = ''
  for (const s of sentences) {
    const next = current ? `${current} ${s}` : s
    if (next.length > CHUNK_MAX_CHARS && current) {
      chunks.push(current.trim())
      current = s
    } else {
      current = next
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks.length ? chunks : [text]
}

// Text-to-Speech dùng Web Speech API (window.speechSynthesis) — không cần
// backend. Giọng đọc tiếng Việt phụ thuộc hệ điều hành/trình duyệt; không
// cam kết chất lượng đồng đều trên mọi nền tảng (rõ nhất trên Chrome/Edge).
export default function useTextToSpeech() {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const [isPlaying, setIsPlaying] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [voices, setVoices] = useState([])
  // "token" phiên đọc hiện tại — huỷ (tăng token) khi stop/play mới/unmount để
  // chuỗi utterance nối tiếp cũ (onend → speak chunk kế) không tiếp tục phát
  // nhầm sau khi đã dừng hoặc đổi chương.
  const tokenRef = useRef(0)

  useEffect(() => {
    if (!supported) return
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices())
    loadVoices()
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices)
  }, [supported])

  const stop = useCallback(() => {
    tokenRef.current += 1
    if (!supported) return
    window.speechSynthesis.cancel()
    setIsPlaying(false)
    setIsPaused(false)
  }, [supported])

  // Huỷ giọng đọc khi rời trang/đổi chương để tránh chồng lấn hoặc đọc nhầm
  // nội dung chương cũ.
  useEffect(() => () => {
    tokenRef.current += 1
    if (supported) window.speechSynthesis.cancel()
  }, [supported])

  const play = useCallback((text, { voiceName, rate = 1 } = {}) => {
    if (!supported || !text) return
    window.speechSynthesis.cancel()
    const myToken = ++tokenRef.current
    const chunks = splitIntoChunks(text)
    const voice = voices.find(v => v.name === voiceName)
    setIsPlaying(true)
    setIsPaused(false)

    let i = 0
    const speakNext = () => {
      if (tokenRef.current !== myToken) return // đã stop/play chương khác — không phát tiếp
      if (i >= chunks.length) {
        setIsPlaying(false)
        setIsPaused(false)
        return
      }
      const utterance = new SpeechSynthesisUtterance(chunks[i])
      if (voice) utterance.voice = voice
      utterance.rate = rate
      utterance.onend = () => { i += 1; speakNext() }
      utterance.onerror = () => {
        if (tokenRef.current === myToken) { setIsPlaying(false); setIsPaused(false) }
      }
      window.speechSynthesis.speak(utterance)
    }
    speakNext()
  }, [supported, voices])

  const pause = useCallback(() => {
    if (!supported) return
    window.speechSynthesis.pause()
    setIsPaused(true)
  }, [supported])

  const resume = useCallback(() => {
    if (!supported) return
    window.speechSynthesis.resume()
    setIsPaused(false)
  }, [supported])

  // Có ít nhất 1 giọng ưu tiên tiếng Việt (lang bắt đầu 'vi') hay không — dùng
  // để UI cảnh báo rõ khi phải fallback sang giọng mặc định.
  const hasVietnameseVoice = voices.some(v => (v.lang || '').toLowerCase().startsWith('vi'))

  return { supported, isPlaying, isPaused, voices, hasVietnameseVoice, play, pause, resume, stop }
}
