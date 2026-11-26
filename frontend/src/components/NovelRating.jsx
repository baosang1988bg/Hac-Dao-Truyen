import PropTypes from 'prop-types'
import { useRef, useState } from 'react'
import { Star } from 'lucide-react'
import { publicApi } from '../api'
import userApi, { isLoggedIn } from '../userApi'
import { trackEvent } from '../utils/analytics'
import { fmtNumber } from '../utils/format'
import {
  clampStars, getOrCreateGuestId, readMyRating, saveMyRating, nextStarFromKey, ratingSummary,
} from '../utils/engagement'
import '../styles/novel-rating.css'

const STARS = [1, 2, 3, 4, 5]

function safeLocalStorage() {
  try { return typeof window !== 'undefined' ? window.localStorage : null } catch { return null }
}

/**
 * POST /api/novels/:slug/rate. Đã đăng nhập → userApi (Authorization, 1 phiếu
 * / tài khoản); khách → publicApi + X-Guest-Id (1 phiếu / trình duyệt). Gửi
 * lại chỉ CẬP NHẬT phiếu cũ (Worker rateNovel), không cộng dồn.
 */
async function postRating(slug, stars) {
  const path = `/novels/${encodeURIComponent(slug)}/rate`
  if (isLoggedIn()) {
    const { data } = await userApi.post(path, { stars })
    return data
  }
  const guestId = getOrCreateGuestId(safeLocalStorage())
  const { data } = await publicApi.post(path, { stars }, { headers: { 'X-Guest-Id': guestId } })
  return data
}

/**
 * NovelRating — khối 5 sao bấm được trên trang truyện.
 * - Điểm TB + số lượt CHỈ hiện khi server trả số thật (props từ chi tiết
 *   truyện nếu có, hoặc response sau khi chấm) — không bịa.
 * - Nhớ số sao mình đã chấm ở localStorage `myRating:<slug>` để tô sẵn.
 * - Accessible: role="radiogroup", mỗi sao là role="radio" aria-label
 *   "Chấm N sao", roving tabindex + mũi tên/Home/End để chọn, Enter/Space
 *   để gửi. Không dùng `disabled` khi đang gửi (mất focus bàn phím).
 */
export default function NovelRating({ slug, initialRating, initialCount }) {
  const [mine, setMine] = useState(() => readMyRating(safeLocalStorage(), slug))
  const [hover, setHover] = useState(0)
  const [summary, setSummary] = useState(() => ratingSummary(initialRating, initialCount))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const btnRefs = useRef({})

  const submit = async (stars) => {
    const n = clampStars(stars)
    if (!n || busy) return
    setBusy(true)
    setMessage('')
    const prev = mine
    setMine(n) // optimistic — tô ngay, lỗi thì hoàn tác
    try {
      const data = await postRating(slug, n)
      saveMyRating(safeLocalStorage(), slug, n)
      const next = ratingSummary(data?.rating, data?.rating_count)
      if (next) setSummary(next)
      setMessage(prev ? `Đã cập nhật: ${n} sao. Cảm ơn bạn!` : `Đã chấm ${n} sao. Cảm ơn bạn!`)
      trackEvent('novel_rate', { novel_slug: slug, stars: n, is_update: Boolean(prev), logged_in: isLoggedIn() })
    } catch (err) {
      setMine(prev)
      const status = err?.response?.status
      if (status === 429) setMessage('Bạn bấm hơi nhanh — đợi vài giây rồi thử lại nhé.')
      else if (status === 404) setMessage('Không tìm thấy truyện để chấm điểm.')
      else setMessage(err?.response?.data?.error || 'Chưa gửi được đánh giá. Vui lòng thử lại.')
    } finally {
      setBusy(false)
    }
  }

  // Mũi tên/Home/End chỉ chuyển focus + xem trước (onFocus đặt hover) — gửi
  // khi bấm Enter/Space (click mặc định của button). Gửi ngay mỗi lần nhấn
  // mũi tên sẽ dính rate limit 5 giây của Worker.
  const onKeyDown = (e, n) => {
    const next = nextStarFromKey(n, e.key)
    if (next === null) return
    e.preventDefault()
    btnRefs.current[next]?.focus()
  }

  const shown = hover || mine
  // Roving tabindex: chỉ 1 sao nhận Tab — sao đã chấm, hoặc sao đầu nếu chưa chấm.
  const tabStar = mine || 1

  return (
    <div className="novel-rating" data-track-section="novel_rating">
      <span className="novel-rating__label" id={`novel-rating-${slug}`}>Đánh giá</span>
      <div
        className={`novel-rating__stars${busy ? ' is-busy' : ''}`}
        role="radiogroup"
        aria-labelledby={`novel-rating-${slug}`}
        aria-busy={busy}
        onMouseLeave={() => setHover(0)}
      >
        {STARS.map(n => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={mine === n}
            aria-label={`Chấm ${n} sao`}
            title={`Chấm ${n} sao`}
            tabIndex={n === tabStar ? 0 : -1}
            ref={el => { btnRefs.current[n] = el }}
            className={`novel-rating__star${n <= shown ? ' is-on' : ''}`}
            onMouseEnter={() => setHover(n)}
            onFocus={() => setHover(n)}
            onBlur={() => setHover(0)}
            onClick={() => submit(n)}
            onKeyDown={e => onKeyDown(e, n)}
            aria-disabled={busy}
          >
            <Star size={22} aria-hidden="true" fill={n <= shown ? 'currentColor' : 'none'} />
          </button>
        ))}
      </div>
      <span className="novel-rating__summary">
        {summary
          ? <><strong>{summary.rating.toFixed(1)}</strong>/5 · {fmtNumber(summary.count)} lượt</>
          : (mine ? `Bạn đã chấm ${mine} sao` : 'Bấm sao để chấm điểm')}
      </span>
      <span className="novel-rating__msg" role="status" aria-live="polite">{message}</span>
    </div>
  )
}
NovelRating.propTypes = {
  slug: PropTypes.string.isRequired,
  initialRating: PropTypes.number,
  initialCount: PropTypes.number,
}
