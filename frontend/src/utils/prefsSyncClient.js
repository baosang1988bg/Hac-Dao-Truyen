/**
 * prefsSyncClient.js — Instance đồng bộ cài đặt đọc dùng thật trong app (nối
 * createPrefsSync với API + localStorage). Chưa đăng nhập → mọi hàm là no-op,
 * không gọi mạng. Đồng bộ chạy nền, không chặn hiển thị chương.
 */
import { fetchUserPrefs, saveUserPrefs } from '../engagementApi'
import { isLoggedIn, getIdentityNamespace } from '../userApi'
import { createPrefsSync } from './userPrefsSync.js'
import { sanitizeSettings } from './readerSettingsSchema.js'
import { getReplacements, writeReplacements, listReplacementSlugs } from './readerReplacements.js'

const SETTINGS_KEY = 'readerSettings'

function readLocal() {
  let reader = null
  try { reader = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null') } catch { /* dữ liệu hỏng */ }
  const replacementsBySlug = {}
  for (const slug of listReplacementSlugs()) replacementsBySlug[slug] = getReplacements(slug)
  return { reader: sanitizeSettings(reader), replacementsBySlug }
}

const prefsSync = createPrefsSync({
  fetchUserPrefs,
  saveUserPrefs,
  isLoggedIn,
  getIdentityNamespace,
  readLocal,
  applyReader: (reader) => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(reader)) } catch { /* storage bị chặn */ }
  },
  applyReplacements: (slug, list) => writeReplacements(slug, list),
  storage: {
    getItem: (k) => localStorage.getItem(k),
    setItem: (k, v) => localStorage.setItem(k, v),
  },
})

/** Kéo prefs từ server (1 lần / danh tính / phiên). */
export const startPrefsSync = () => prefsSync.start()
/** Đánh dấu có thay đổi cục bộ → đẩy lên sau 3 giây. */
export const schedulePrefsPush = () => prefsSync.schedulePush()
/** Nghe sự kiện áp dữ liệu từ server: { type: 'reader', reader } | { type: 'replacements', slugs } */
export const subscribePrefsSync = (fn) => prefsSync.subscribe(fn)
