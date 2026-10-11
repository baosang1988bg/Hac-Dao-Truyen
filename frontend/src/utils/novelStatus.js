const COMPLETED_STATUSES = new Set([
  'completed',
  'complete',
  'finished',
  'full',
  'hoàn thành',
  'hoan thanh',
])

/** Backend status là nguồn sự thật; chỉ suy luận từ count khi status bị thiếu. */
export function isNovelCompleted(novel) {
  const status = String(novel?.status || '').trim().toLowerCase()
  if (status) return COMPLETED_STATUSES.has(status)

  const total = Number(novel?.total_chapters) || 0
  const translated = Number(novel?.chapter_count) || 0
  return total > 0 && translated >= total
}
