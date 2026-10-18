import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldShowScrollToTop, scrollToTop } from '../src/utils/scroll.js'

test('shouldShowScrollToTop: logic hiển thị với ngưỡng mặc định (400px)', () => {
  assert.equal(shouldShowScrollToTop(0), false)
  assert.equal(shouldShowScrollToTop(399), false)
  assert.equal(shouldShowScrollToTop(400), false)
  assert.equal(shouldShowScrollToTop(401), true)
  assert.equal(shouldShowScrollToTop(1500), true)
})

test('shouldShowScrollToTop: logic hiển thị với ngưỡng tùy chỉnh', () => {
  const customThreshold = 250
  assert.equal(shouldShowScrollToTop(100, customThreshold), false)
  assert.equal(shouldShowScrollToTop(250, customThreshold), false)
  assert.equal(shouldShowScrollToTop(251, customThreshold), true)
  assert.equal(shouldShowScrollToTop(500, customThreshold), true)
})

test('shouldShowScrollToTop: xử lý an toàn các giá trị biên và dữ liệu không hợp lệ', () => {
  assert.equal(shouldShowScrollToTop(-50), false)
  assert.equal(shouldShowScrollToTop(NaN), false)
  assert.equal(shouldShowScrollToTop(null), false)
  assert.equal(shouldShowScrollToTop(undefined), false)
  assert.equal(shouldShowScrollToTop('450'), false)
})

test('scrollToTop: gọi an toàn khi window hoặc window.scrollTo không tồn tại hoặc có mock', () => {
  // Môi trường Node.js không có window -> không ném ngoại lệ
  assert.doesNotThrow(() => {
    scrollToTop('smooth')
  })

  // Thử nghiệm với mock window
  let calledWith = null
  globalThis.window = {
    scrollTo: (options) => {
      calledWith = options
    },
  }

  scrollToTop('smooth')
  assert.deepEqual(calledWith, { top: 0, behavior: 'smooth' })

  // Dọn dẹp mock
  delete globalThis.window
})

test('scrollToTop: tôn trọng prefers-reduced-motion (chuyển smooth → auto)', () => {
  let calledWith = null
  globalThis.window = {
    matchMedia: (q) => ({ matches: q === '(prefers-reduced-motion: reduce)' }),
    scrollTo: (options) => { calledWith = options },
  }
  try {
    scrollToTop('smooth')
    assert.deepEqual(calledWith, { top: 0, behavior: 'auto' })
  } finally {
    delete globalThis.window
  }
})
