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

// ── Nhiều bản dịch (?ban=<code>, Worker migration 016) ──────────────────────
// Bản AI hiện có là bản MẶC ĐỊNH 'he-thong' — URL không mang ?ban và đọc qua
// route cũ /novels/:slug/chapters[/:id]. Bản khác: /novels/:slug/editions/:code/...
export const DEFAULT_EDITION_CODE = 'he-thong'
const EDITION_CODE_RE = /^[a-z0-9-]{1,40}$/

/**
 * Chuẩn hoá mã bản dịch từ URL/localStorage: mã hợp lệ KHÁC mặc định → giữ
 * nguyên; null/rỗng/'he-thong'/chuỗi rác → null (= bản mặc định).
 */
export function normalizeEditionCode(ban) {
  if (typeof ban !== 'string') return null
  const code = ban.trim()
  return EDITION_CODE_RE.test(code) && code !== DEFAULT_EDITION_CODE ? code : null
}

/** Gắn `?ban=<code>` vào đường dẫn khi là bản phụ; bản mặc định giữ nguyên URL. */
export function withEditionQuery(path, ban) {
  const code = normalizeEditionCode(ban)
  if (!code || !path || path === '#') return path
  return `${path}${path.includes('?') ? '&' : '?'}ban=${code}`
}

/** Đường dẫn API mục lục (tương đối với baseURL '/api'). */
export function chapterListPath(slug, ban) {
  const code = normalizeEditionCode(ban)
  return code ? `/novels/${slug}/editions/${code}/chapters` : `/novels/${slug}/chapters`
}

/** Đường dẫn API nội dung chương; `id` đã ở dạng request (chapterIdentifier/chapterRequestId). */
export function chapterContentPath(slug, id, ban) {
  return `${chapterListPath(slug, ban)}/${id}`
}

/** URL Reader của một chương ('#' nếu không xác định được); giữ `?ban` khi là bản phụ. */
export function chapterUrl(slug, chapter, ban) {
  const id = chapterIdentifier(chapter)
  return id ? withEditionQuery(`/novel/${slug}/read/${id}`, ban) : '#'
}

/**
 * URL "Đọc tiếp" từ một mục lịch sử đọc: `chapter` là tham số chương đã lưu
 * (chuỗi số "12" hoặc filename), `ban` là mã bản dịch đang đọc (null = mặc
 * định). Chương dạng số đi qua chapterUrl như mọi link chương khác; filename
 * giữ nguyên dạng cũ (`/read/<chapter>`) để không đổi URL của dữ liệu cũ.
 */
export function continueReadingUrl(slug, chapter, ban) {
  if (!slug || chapter === null || chapter === undefined || chapter === '') return `/novel/${slug}`
  const raw = String(chapter)
  if (/^\d+$/.test(raw) && Number(raw) > 0) return chapterUrl(slug, { number: Number(raw) }, ban)
  return withEditionQuery(`/novel/${slug}/read/${raw}`, ban)
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
