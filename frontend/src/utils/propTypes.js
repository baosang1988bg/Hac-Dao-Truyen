import PropTypes from 'prop-types'

export const novelType = PropTypes.shape({
  slug: PropTypes.string.isRequired,
  title: PropTypes.string,
  author: PropTypes.string,
  genre: PropTypes.string,
  cover_url: PropTypes.string,
  status: PropTypes.string,
  synopsis: PropTypes.string,
  synopsis_preview: PropTypes.string,
  chapter_count: PropTypes.number,
  total_chapters: PropTypes.number,
  glossary_count: PropTypes.number,
  views: PropTypes.number,
  rating: PropTypes.number,
  rating_count: PropTypes.number,
  has_epub: PropTypes.oneOfType([PropTypes.bool, PropTypes.number]),
  last_translated_at: PropTypes.number,
})

export const chapterType = PropTypes.shape({
  filename: PropTypes.string,
  title: PropTypes.string,
  number: PropTypes.number,
  chapter_number: PropTypes.number,
})
