import { novelType } from '../utils/propTypes'

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Eye, Star, BookMarked, Download, Check, Loader2 } from 'lucide-react'
import NovelCover from './NovelCover'
import Badge from './ui/Badge'
import { fmtNumber, novelDisplayTitle } from '../utils/format'
import { splitGenres } from '../utils/genreLabels'
import { isEpubDownloaded, downloadEpubOffline } from '../utils/epubOffline'
import { isNovelCompleted } from '../utils/novelStatus'
import '../styles/library-epub.css'

/**
 * EpubCard — thẻ hiển thị 1 truyện trong lưới (dùng ở EpubCatalogPage và
 * SearchSection trên trang chủ). Tách riêng khỏi EpubCatalogPage.jsx để trang
 * chủ (eager-loaded) không kéo theo toàn bộ code của trang /epub (lazy-loaded).
 */
export function EpubCard({ novel }) {
  const genres = splitGenres(novel.genre)
  const title = novelDisplayTitle(novel)
  const hasChapters = Number(novel.chapter_count) > 0;
  const isEpubOnly = !hasChapters && Boolean(novel.has_epub)

  const [downloaded, setDownloaded] = useState(false)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    if (!isEpubOnly) return
    let cancelled = false
    isEpubDownloaded(novel.slug).then(v => { if (!cancelled) setDownloaded(v) })
    return () => { cancelled = true }
  }, [isEpubOnly, novel.slug])

  const handleDownload = async (e) => {
    e.preventDefault()
    if (downloading || downloaded) return
    setDownloading(true)
    try {
      await downloadEpubOffline(novel.slug)
      setDownloaded(true)
    } catch {
      // Lỗi tải (offline/mạng lỗi) — người dùng có thể thử lại, không cần báo ồn ào.
    } finally {
      setDownloading(false)
    }
  }

  const readLabel = hasChapters ? 'Đọc truyện' : 'Đọc EPUB'
  const readTo = hasChapters ? `/novel/${novel.slug}` : `/novel/${novel.slug}/epub-reader`
  const ReadIcon = hasChapters ? BookOpen : BookMarked
  const downloadLabel = downloaded ? 'Đã tải để đọc offline' : 'Tải để đọc offline'

  // Hover/nhấn xử lý bằng CSS (.epub-card trong styles/library-epub.css):
  // nhấc lên chỉ trên thiết bị có chuột, co nhẹ khi chạm trên mobile.
  return (
    <div className="epub-card">
      {/* Cover */}
      <Link to={`/novel/${novel.slug}`} aria-label={title} className="epub-card__cover">
        <NovelCover novel={novel} size="lg" style={{ width: '100%', height: '100%' }} />
        {hasChapters ? (
          <span className="badge-overlay badge-overlay--left"><Badge variant="live">TRỰC TIẾP</Badge></span>
        ) : novel.has_epub ? (
          <span className="badge-overlay badge-overlay--left"><Badge variant="epub">EPUB</Badge></span>
        ) : null}
        {isNovelCompleted(novel) && (
          <span className="badge-overlay badge-overlay--right"><Badge variant="full">FULL</Badge></span>
        )}
      </Link>

      {/* Info */}
      <div className="epub-card__info">
        <Link to={`/novel/${novel.slug}`} className="epub-card__title-link">
          <div className="epub-card__title">{title}</div>
        </Link>

        {genres.length > 0 ? (
          <div className="epub-card__genres">{genres.join(', ')}</div>
        ) : null}

        {/* Stats */}
        <div className="epub-card__stats">
          <span className="epub-card__stat">
            <BookOpen size={12} aria-hidden="true" /> {fmtNumber(novel.chapter_count || novel.total_chapters || 0)} chương
          </span>
          {novel.views > 0 && (
            <span className="epub-card__stat">
              <Eye size={12} aria-hidden="true" /> {fmtNumber(novel.views)}
            </span>
          )}
          {novel.rating > 0 && (
            <span className="epub-card__stat epub-card__stat--rating">
              <Star size={12} fill="#fbbf24" aria-hidden="true" /> {novel.rating}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div className="epub-card__actions">
          <Link to={readTo} className="epub-card__read">
            <ReadIcon size={14} aria-hidden="true" /> {readLabel}
          </Link>
          {isEpubOnly && (
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading || downloaded}
              title={downloadLabel}
              aria-label={downloadLabel}
              className={`epub-card__download${downloaded ? ' is-done' : ''}${downloading ? ' is-busy' : ''}`}
            >
              {downloaded ? <Check size={16} /> : downloading ? <Loader2 size={16} /> : <Download size={16} />}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
EpubCard.propTypes = {
  novel: novelType,
};


export default EpubCard
