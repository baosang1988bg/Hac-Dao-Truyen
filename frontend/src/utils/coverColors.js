// ── Cover colors ─────────────────────────────────────────────────────────────
// Sinh gradient deterministic từ slug truyện (không cần ảnh bìa thật).
// Cùng một slug luôn cho ra cùng một gradient.

export function coverGradient(slug = '') {
  let h = 0
  for (let i = 0; i < slug.length; i++) {
    h = (h * 31 + slug.charCodeAt(i)) | 0
  }
  const hue1 = Math.abs(h) % 360
  const hue2 = (hue1 + 40 + (Math.abs(h >> 8) % 60)) % 360
  const angle = 135 + (Math.abs(h >> 16) % 90)
  return `linear-gradient(${angle}deg, hsl(${hue1}, 45%, 30%) 0%, hsl(${hue2}, 55%, 18%) 100%)`
}

export default coverGradient
