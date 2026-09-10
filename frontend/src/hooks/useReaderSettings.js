import { useEffect, useRef, useState } from 'react'

export const DEFAULT_SETTINGS = {
  fontSize: 21,
  fontFamily: 'Times New Roman, serif',
  theme: 'sepia',
  contentWidth: 800,
  lineHeight: 1.7,
  ttsVoice: '',
  ttsRate: 1,
}

// Danh sách duy nhất; màu lấy từ .reader--<id> trong index.css.
export const THEMES = {
  white: 'Trắng',
  sepia: 'Giấy',
  green: 'Xanh lá',
  dark: 'Tối',
  blue: 'Xanh lam',
}

const LEGACY_KEYS = ['epub_theme', 'epub_fontSize', 'epub_font']

function readSettings() {
  try {
    const raw = localStorage.getItem('readerSettings')
    if (raw !== null) {
      const saved = JSON.parse(raw)
      return { settings: { ...DEFAULT_SETTINGS, ...saved }, migrate: false }
    }
    const [theme, size, fontFamily] = LEGACY_KEYS.map(key => localStorage.getItem(key))
    const settings = { ...DEFAULT_SETTINGS }
    if (theme) settings.theme = theme
    if (size && Number.isFinite(Number(size)) && Number(size) > 0) settings.fontSize = Number(size)
    if (fontFamily) settings.fontFamily = fontFamily
    return { settings, migrate: [theme, size, fontFamily].some(value => value !== null) }
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, migrate: false }
  }
}

export default function useReaderSettings() {
  const [initial] = useState(readSettings)
  const [settings, setSettings] = useState(initial.settings)
  const migrationPending = useRef(initial.migrate)

  useEffect(() => {
    try {
      localStorage.setItem('readerSettings', JSON.stringify(settings))
      // Chỉ xóa nguồn cũ sau khi lưu đích thành công (kể cả StrictMode).
      if (migrationPending.current) {
        LEGACY_KEYS.forEach(key => localStorage.removeItem(key))
        migrationPending.current = false
      }
    } catch { /* Storage bị chặn/đầy: giữ settings trong bộ nhớ và key cũ. */ }
  }, [settings])

  const onChange = (key, value) => setSettings(previous => ({ ...previous, [key]: value }))
  return { settings, onChange }
}
