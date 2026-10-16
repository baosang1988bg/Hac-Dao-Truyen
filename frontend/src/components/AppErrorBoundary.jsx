import { Component } from 'react'
import PropTypes from 'prop-types'
import { isChunkLoadError } from '../utils/lazyWithReload'

/**
 * Lưới an toàn cuối cho toàn bộ <Routes>: lỗi render hoặc chunk lazy tải hỏng
 * (sau khi lazyWithReload đã thử reload 1 lần) → hiện khối lỗi thay vì trang trắng.
 * `resetKey` (pathname) đổi → tự xoá lỗi để điều hướng sang trang khác vẫn chạy.
 */
export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, resetKey: props.resetKey }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey }
    }
    return null
  }

  componentDidCatch(error, info) {
    console.error('[AppErrorBoundary]', error, info?.componentStack)
  }

  handleReload = () => {
    window.location.reload()
  }

  handleHome = () => {
    window.location.assign('/')
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const chunk = isChunkLoadError(error)
    return (
      <div className="container" style={{ padding: '2rem 1rem' }}>
        <div className="glass-panel hd-error-block" role="alert">
          <div className="hd-error-block__title">
            {chunk ? 'Không tải được trang' : 'Đã xảy ra lỗi khi hiển thị trang'}
          </div>
          <div className="hd-error-block__desc">
            {chunk
              ? 'Trang web vừa được cập nhật hoặc kết nối mạng đang gián đoạn. Hãy tải lại trang để nhận phiên bản mới nhất.'
              : 'Rất tiếc, trang này gặp sự cố ngoài ý muốn. Bạn có thể tải lại trang hoặc quay về trang chủ.'}
          </div>
          <div className="hd-error-block__actions">
            <button type="button" className="btn btn-primary" onClick={this.handleReload}>
              Tải lại trang
            </button>
            <button type="button" className="btn btn-secondary" onClick={this.handleHome}>
              Về trang chủ
            </button>
          </div>
        </div>
      </div>
    )
  }
}

AppErrorBoundary.propTypes = {
  children: PropTypes.node,
  resetKey: PropTypes.string,
}
