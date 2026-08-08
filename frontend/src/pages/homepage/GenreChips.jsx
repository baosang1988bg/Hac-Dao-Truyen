import React, { useEffect, useState } from 'react'
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
    <div className="hp-genre-chips" style={{ marginBottom: '1.5rem' }}>
      <button
        className={`hp-genre-chip${!activeGenre ? ' active' : ''}`}
        onClick={() => onSelect('')}
      >
        Tất cả
      </button>
      {genres.map(g => (
        <button
          key={g}
          className={`hp-genre-chip${activeGenre === g ? ' active' : ''}`}
          onClick={() => onSelect(activeGenre === g ? '' : g)}
        >
          {g}
        </button>
      ))}
    </div>
  )
}
