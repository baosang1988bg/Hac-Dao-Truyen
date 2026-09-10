import { act, createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import useReaderSettings, { DEFAULT_SETTINGS } from '../src/hooks/useReaderSettings'

export async function runHookTests() {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const passed = []
  let current
  let root
  let container
  function Probe() {
    current = useReaderSettings()
    return null
  }
  async function mount() {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(createElement(StrictMode, null, createElement(Probe))))
  }
  async function unmount() {
    await act(async () => root.unmount())
    container.remove()
  }
  function equal(actual, expected, label) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}: ${JSON.stringify(actual)}`)
  }
  const stored = () => JSON.parse(localStorage.getItem('readerSettings'))
  try {
    localStorage.clear()
    localStorage.setItem('epub_theme', 'dark')
    localStorage.setItem('epub_fontSize', '12')
    localStorage.setItem('epub_font', 'sans-serif')
    localStorage.setItem('epub_cfi_demo', 'keep-cfi')
    await mount()
    const migrated = { ...DEFAULT_SETTINGS, theme: 'dark', fontSize: 12, fontFamily: 'sans-serif' }
    equal(current.settings, migrated, 'Migrate giữ giá trị EPUB')
    equal(stored(), migrated, 'Migrate ghi format mới')
    equal(['epub_theme', 'epub_fontSize', 'epub_font'].map(key => localStorage.getItem(key)), [null, null, null], 'Xóa 3 key cũ')
    equal(localStorage.getItem('epub_cfi_demo'), 'keep-cfi', 'Không đụng tiến độ EPUB')
    await unmount()
    await mount()
    equal(current.settings, migrated, 'Migrate chỉ một lần qua remount/StrictMode')
    await unmount()
    passed.push('migrate legacy + xóa key sau khi lưu + giữ CFI + StrictMode/remount')

    localStorage.clear()
    await mount()
    equal(current.settings, DEFAULT_SETTINGS, 'Không có key cũ dùng mặc định Reader')
    equal(stored(), DEFAULT_SETTINGS, 'Lưu mặc định')
    await unmount()
    passed.push('không có key cũ: defaults và persistence')

    localStorage.clear()
    const existing = { fontSize: 35, fontFamily: 'Palatino, serif', theme: 'blue', contentWidth: 1150, lineHeight: 2.3 }
    localStorage.setItem('readerSettings', JSON.stringify(existing))
    localStorage.setItem('epub_theme', 'dark')
    await mount()
    equal(current.settings, existing, 'Reader cũ thắng legacy EPUB')
    await act(async () => current.onChange('fontSize', 33))
    equal(stored(), { ...existing, fontSize: 33 }, 'Ghi chỉ trường thay đổi')
    await unmount()
    await mount()
    equal(current.settings, { ...existing, fontSize: 33 }, 'Đọc lại sau remount')
    await unmount()
    passed.push('readerSettings có sẵn được giữ; onChange ghi và remount đọc đúng')

    localStorage.clear()
    localStorage.setItem('epub_font', 'serif')
    await mount()
    equal(current.settings, { ...DEFAULT_SETTINGS, fontFamily: 'serif' }, 'Legacy thiếu trường')
    await unmount()
    passed.push('legacy thiếu trường: chỉ bổ sung defaults')

    localStorage.clear()
    localStorage.setItem('epub_theme', 'white')
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'readerSettings') throw new DOMException('Quota exceeded', 'QuotaExceededError')
      return original.call(this, key, value)
    }
    try {
      await mount()
      equal(localStorage.getItem('epub_theme'), 'white', 'Không xóa legacy khi lưu thất bại')
      equal(current.settings.theme, 'white', 'Vẫn đọc được trong bộ nhớ')
      await unmount()
    } finally { Storage.prototype.setItem = original }
    passed.push('lỗi ghi storage không xóa settings legacy')
    return passed
  } finally {
    localStorage.clear()
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
  }
}
