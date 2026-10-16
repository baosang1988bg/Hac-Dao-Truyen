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

/**
 * Lấy số chương từ tiêu đề/filename ("第12章", "Chapter 12", "Chương 12", "12.").
 * Trả chuỗi số hoặc null. Dùng chung cho NovelPage, Reader (điều hướng, tải offline).
 */
export function getChapNum(title) {
  const m = String(title || '').match(/第(\d+)章|[Cc]hapter\s*(\d+)|Chương\s*(\d+)|(\d+)\./)
  return m ? (m[1] || m[2] || m[3] || m[4]) : null
}

/**
 * Định danh chương dùng trong URL Reader và request `/novels/:slug/chapters/:id`.
 * Ưu tiên số chương (number → chapter_number → số trong title → số trong filename),
 * không có số thì dùng filename (đã encodeURIComponent). Mọi nơi (link mục lục,
 * nút trước/sau, prefetch, "Tải 10 chương") PHẢI dùng hàm này để URL trùng khớp
 * với cache của service worker và apiCache.
 */
export function chapterIdentifier(chapter) {
  if (!chapter) return null
  const num = chapter.number || chapter.chapter_number || getChapNum(chapter.title) || getChapNum(chapter.filename)
  if (num) return String(num)
  return chapter.filename ? encodeURIComponent(chapter.filename) : null
}

/** URL Reader của một chương ('#' nếu không xác định được). */
export function chapterUrl(slug, chapter) {
  const id = chapterIdentifier(chapter)
  return id ? `/novel/${slug}/read/${id}` : '#'
}

/**
 * Vị trí chương hiện tại trong mục lục theo tham số URL (số hoặc filename).
 * Trả -1 nếu không tìm thấy.
 */
export function findChapterIndex(chapters, param) {
  if (!Array.isArray(chapters) || param === null || param === undefined) return -1
  const raw = String(param)
  let decoded = raw
  try { decoded = decodeURIComponent(raw) } catch { /* giữ nguyên */ }
  const isNumber = /^\d+$/.test(raw)
  const target = isNumber ? parseInt(raw, 10) : null
  return chapters.findIndex(c =>
    c.filename === raw ||
    c.filename === decoded ||
    (isNumber && (
      (c.chapter_number != null && Number(c.chapter_number) === target) ||
      (c.number != null && Number(c.number) === target) ||
      getChapNum(c.title) === String(target)
    ))
  )
}

/**
 * Định danh dùng trong request API từ tham số URL Reader (useParams đã decode):
 * số giữ nguyên, filename thì encodeURIComponent — khớp với chapterIdentifier()
 * để prefetch / "Tải 10 chương" / mở chương dùng CÙNG một URL (cache trùng khớp).
 */
export function chapterRequestId(param) {
  const raw = String(param ?? '')
  if (/^\d+$/.test(raw)) return raw
  let decoded = raw
  try { decoded = decodeURIComponent(raw) } catch { /* giữ nguyên */ }
  return encodeURIComponent(decoded)
}
