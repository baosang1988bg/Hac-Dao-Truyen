import PropTypes from 'prop-types'
import { useEffect, useState } from 'react';
import { cachedGet, peekCache } from '../../utils/apiCache'
import { normalizeGenreList, GENRES_URL, GENRES_TTL } from '../../utils/genreLabels'

/**
 * GenreChips – Dải chip thể loại cuộn ngang dưới ô tìm kiếm, lọc nhanh
 * AllNovelsSection theo thể loại. Dùng endpoint /api/novels/genres đã có sẵn,
 * chuẩn hoá qua normalizeGenreList (tách chuỗi gộp, Việt hoá mã thô
 * "cultivation"/"other", bỏ Unknown, bỏ trùng). Giá trị chọn là nhãn tiếng Việt.
 * Props:
 *   activeGenre – string ('' nghĩa là "Tất cả")
 *   onSelect    – (genre: string) => void
 */
export default function GenreChips({ activeGenre, onSelect }) {
  const [genres, setGenres] = useState(() => normalizeGenreList(peekCache(GENRES_URL)))

  useEffect(() => {
    let alive = true
    cachedGet(GENRES_URL, { ttl: GENRES_TTL })
      .then(data => { if (alive) setGenres(normalizeGenreList(data)) })
      .catch(() => { if (alive) setGenres([]) })
    return () => { alive = false }
  }, [])

  if (genres.length === 0) return null

  return (
    <div className="hp-genre-chips" role="group" aria-label="Lọc theo thể loại" style={{ marginBottom: 'var(--space-5, 24px)' }}>
      <button
        type="button"
        className={`hp-genre-chip${!activeGenre ? ' active' : ''}`}
        aria-pressed={!activeGenre}
        onClick={() => onSelect('')}
      >
        Tất cả
      </button>
      {genres.map(g => (
        <button
          type="button"
          key={g}
          className={`hp-genre-chip${activeGenre === g ? ' active' : ''}`}
          aria-pressed={activeGenre === g}
          onClick={() => onSelect(activeGenre === g ? '' : g)}
        >
          {g}
        </button>
      ))}
    </div>
  )
}
GenreChips.propTypes = {
  activeGenre: PropTypes.string,
  onSelect: PropTypes.func,
};
