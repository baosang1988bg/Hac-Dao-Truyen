/** Giây → "45s" / "3m 20s" */
export function fmtTime(seconds) {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60), s = seconds % 60
  return `${m}m ${s}s`
}

/** Style tiêu đề section trong panel. */
export const sectionTitle = {
  fontSize: '1rem', fontWeight: 600, marginBottom: '1rem',
  display: 'flex', alignItems: 'center', gap: '8px',
}
