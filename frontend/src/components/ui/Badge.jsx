import PropTypes from 'prop-types'


/**
 * Badge – Badge chip nhỏ hiển thị trạng thái truyện.
 * Đây là nguồn style DUY NHẤT cho badge trạng thái (FULL/MỚI/EPUB/TRỰC TIẾP...)
 * trong toàn bộ app — dùng inline (trong danh sách) hoặc đặt trong một span
 * `.badge-overlay` để phủ lên góc bìa truyện (xem NovelGrid.jsx, EpubCard.jsx).
 * Variants: 'new' | 'full' | 'epub' | 'live' | 'hot' | 'default'
 */
export default function Badge({ variant = 'default', children, style }) {
  const variantStyles = {
    new:     { background: 'var(--accent)', color: '#000', fontWeight: 700 },
    full:    { background: 'var(--success, #22c55e)', color: '#000', fontWeight: 700 },
    epub:    { background: 'var(--info, #3b82f6)', color: '#fff', fontWeight: 700 },
    live:    { background: 'var(--success, #22c55e)', color: '#fff', fontWeight: 700 },
    hot:     { background: '#ef4444', color: '#fff', fontWeight: 700 },
    default: { background: 'rgba(255,255,255,0.15)', color: 'var(--text-muted)', fontWeight: 600 },
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: '0.65rem',
        letterSpacing: '0.04em',
        padding: '2px 6px',
        borderRadius: '4px',
        lineHeight: 1.4,
        textTransform: 'uppercase',
        flexShrink: 0,
        ...variantStyles[variant] ?? variantStyles.default,
        ...style,
      }}
    >
      {children}
    </span>
  )
}
Badge.propTypes = {
  variant: PropTypes.string,
  children: PropTypes.node,
  style: PropTypes.object,
};
