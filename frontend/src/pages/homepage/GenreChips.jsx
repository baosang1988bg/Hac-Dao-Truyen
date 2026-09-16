import PropTypes from 'prop-types'
import { useEffect, useState } from 'react';
import api from '../../api'

/**
 * GenreChips – Dải chip thể loại cuộn ngang dưới ô tìm kiếm, lọc nhanh
 * AllNovelsSection theo thể loại. Dùng endpoint /api/novels/genres đã có sẵn.
 * Props:
 *   activeGenre – string ('' nghĩa là "Tất cả")
 *   onSelect    – (genre: string) => void
 */
export default function GenreChips({ activeGenre, onSelect }) {
  const [genres, setGenres] = useState([])

  useEffect(() => {
    let alive = true
    api.get('/novels/genres')
      .then(res => { if (alive) setGenres(Array.isArray(res.data) ? res.data : []) })
      .catch(() => { if (alive) setGenres([]) })
    return () => { alive = false }
  }, [])

  if (genres.length === 0) return null

  return (
    <div className="hp-genre-chips" style={{ marginBottom: 'var(--space-5, 24px)' }}>
      <button
        className={`hp-genre-chip${!activeGenre ? ' active' : ''}`}
        aria-pressed={!activeGenre}
        onClick={() => onSelect('')}
      >
        Tất cả
      </button>
      {genres.map(g => (
        <button
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
