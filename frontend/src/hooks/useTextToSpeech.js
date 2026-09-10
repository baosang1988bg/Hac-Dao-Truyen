import { useCallback, useEffect, useState } from 'react'

// Text-to-Speech dùng Web Speech API (window.speechSynthesis) — không cần
// backend. Giọng đọc tiếng Việt phụ thuộc hệ điều hành/trình duyệt; không
// cam kết chất lượng đồng đều trên mọi nền tảng (rõ nhất trên Chrome/Edge).
export default function useTextToSpeech() {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const [isPlaying, setIsPlaying] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [voices, setVoices] = useState([])

  useEffect(() => {
    if (!supported) return
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices())
    loadVoices()
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices)
  }, [supported])

  const stop = useCallback(() => {
    if (!supported) return
    window.speechSynthesis.cancel()
    setIsPlaying(false)
    setIsPaused(false)
  }, [supported])

  // Huỷ giọng đọc khi rời trang/đổi chương để tránh chồng lấn.
  useEffect(() => () => { if (supported) window.speechSynthesis.cancel() }, [supported])

  const play = useCallback((text, { voiceName, rate = 1 } = {}) => {
    if (!supported || !text) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    const voice = voices.find(v => v.name === voiceName)
    if (voice) utterance.voice = voice
    utterance.rate = rate
    utterance.onend = () => { setIsPlaying(false); setIsPaused(false) }
    utterance.onerror = () => { setIsPlaying(false); setIsPaused(false) }
    window.speechSynthesis.speak(utterance)
    setIsPlaying(true)
    setIsPaused(false)
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

  return { supported, isPlaying, isPaused, voices, play, pause, resume, stop }
}
