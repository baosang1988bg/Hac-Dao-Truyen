export function getCatalogChapterNumber(chapter) {
  const raw = chapter?.chapter_number ?? chapter?.number
  const number = Number(raw)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

function escapedNumber(number) {
  return String(number).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function canonicalScore(chapter, number) {
  const n = escapedNumber(number)
  const title = String(chapter?.title || '')
  const filename = String(chapter?.filename || '')
  let score = 0

  if (new RegExp(`(?:第\\s*0*${n}\\s*章|(?:chương|chapter)\\s*0*${n}(?:\\D|$))`, 'i').test(title)) score += 100
  if (new RegExp(`^0*${n}(?:\\D|$)`).test(filename)) score += 50
  if (new RegExp(`(?:第\\s*0*${n}\\s*章|(?:chương|chapter)[-_\\s]*0*${n}(?:\\D|$))`, 'i').test(filename)) score += 25
  return score
}

function preferCanonical(current, candidate, number) {
  const scoreDiff = canonicalScore(candidate, number) - canonicalScore(current, number)
  if (scoreDiff !== 0) return scoreDiff > 0 ? candidate : current
  const filenameDiff = String(candidate.filename).localeCompare(String(current.filename), undefined, { numeric: true })
  return filenameDiff < 0 ? candidate : current
}

/**
 * Loại trùng filename và số chương dương. Mục không đánh số vẫn được giữ,
 * nhưng xếp sau các chương có số để không chiếm vị trí "Đọc từ đầu".
 */
export function normalizeChapterCatalog(catalog) {
  if (!Array.isArray(catalog)) return []

  const byFilename = new Map()
  for (const chapter of catalog) {
    if (chapter?.filename && !byFilename.has(chapter.filename)) {
      byFilename.set(chapter.filename, chapter)
    }
  }

  const byNumber = new Map()
  const unnumbered = []
  for (const chapter of byFilename.values()) {
    const number = getCatalogChapterNumber(chapter)
    if (number === null) {
      unnumbered.push(chapter)
      continue
    }
    const current = byNumber.get(number)
    byNumber.set(number, current ? preferCanonical(current, chapter, number) : chapter)
  }

  const numbered = [...byNumber.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, chapter]) => chapter)
  unnumbered.sort((a, b) => String(a.filename).localeCompare(String(b.filename), undefined, { numeric: true }))
  return [...numbered, ...unnumbered]
}
