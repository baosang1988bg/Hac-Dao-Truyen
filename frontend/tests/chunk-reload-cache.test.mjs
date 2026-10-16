import test from 'node:test'
import assert from 'node:assert/strict'

// ── Mock storage trình duyệt (phải có TRƯỚC khi import module) ───────────────
function memoryStorage() {
  const m = new Map()
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
  }
}
globalThis.sessionStorage = memoryStorage()
globalThis.localStorage = memoryStorage()

const { isChunkLoadError, withChunkReload, CHUNK_RELOAD_KEY } = await import('../src/utils/lazyWithReload.js')
const { cachedGet, peekCache, invalidateCache } = await import('../src/utils/apiCache.js')
const { default: api } = await import('../src/api.js')

// ── isChunkLoadError ─────────────────────────────────────────────────────────

test('isChunkLoadError nhận diện lỗi tải chunk của các trình duyệt', () => {
  assert.equal(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/NovelPage-abc.js')), true)
  assert.equal(isChunkLoadError(new TypeError('Importing a module script failed.')), true)
  assert.equal(isChunkLoadError(new TypeError('error loading dynamically imported module: https://x/a.js')), true)
  assert.equal(isChunkLoadError(Object.assign(new Error('Loading chunk 12 failed.'), { name: 'ChunkLoadError' })), true)
  assert.equal(isChunkLoadError({ name: 'ChunkLoadError', message: '' }), true)
  assert.equal(isChunkLoadError('Failed to fetch dynamically imported module'), true)
})

test('isChunkLoadError bỏ qua lỗi thường', () => {
  assert.equal(isChunkLoadError(null), false)
  assert.equal(isChunkLoadError(undefined), false)
  assert.equal(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')")), false)
  assert.equal(isChunkLoadError(new Error('Network Error')), false)
  assert.equal(isChunkLoadError(new Error('Failed to fetch')), false)
})

// ── withChunkReload ──────────────────────────────────────────────────────────

const chunkErr = () => new TypeError('Failed to fetch dynamically imported module: /assets/x.js')

test('withChunkReload: lỗi chunk → reload đúng 1 lần, lần sau ném lỗi', async () => {
  sessionStorage.clear()
  let reloads = 0
  const load = withChunkReload(() => Promise.reject(chunkErr()), { reload: () => { reloads++ } })
  // Lần 1: reload và promise treo (không resolve/reject).
  const r1 = await Promise.race([load().then(() => 'resolved', () => 'rejected'), new Promise(r => setTimeout(() => r('pending'), 20))])
  assert.equal(r1, 'pending')
  assert.equal(reloads, 1)
  assert.equal(sessionStorage.getItem(CHUNK_RELOAD_KEY), '1')
  // Lần 2 (sau reload, dấu còn) → không reload nữa, ném lỗi cho ErrorBoundary.
  await assert.rejects(load(), /dynamically imported module/)
  assert.equal(reloads, 1)
})

test('withChunkReload: tải thành công xoá dấu; lỗi khác ném tiếp không reload', async () => {
  sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
  let reloads = 0
  const ok = withChunkReload(() => Promise.resolve({ default: 'X' }), { reload: () => { reloads++ } })
  assert.deepEqual(await ok(), { default: 'X' })
  assert.equal(sessionStorage.getItem(CHUNK_RELOAD_KEY), null)
  const bad = withChunkReload(() => Promise.reject(new Error('boom')), { reload: () => { reloads++ } })
  await assert.rejects(bad(), /boom/)
  assert.equal(reloads, 0)
})

test('withChunkReload: storage bị chặn → không reload (tránh vòng lặp), ném lỗi', async () => {
  const saved = globalThis.sessionStorage
  globalThis.sessionStorage = { getItem: () => null, setItem: () => { throw new Error('denied') }, removeItem: () => {} }
  try {
    let reloads = 0
    const load = withChunkReload(() => Promise.reject(chunkErr()), { reload: () => { reloads++ } })
    await assert.rejects(load(), /dynamically imported module/)
    assert.equal(reloads, 0)
  } finally {
    globalThis.sessionStorage = saved
  }
})

// ── apiCache.cachedGet ───────────────────────────────────────────────────────

function mockApiGet() {
  const calls = []
  const original = api.get
  api.get = (url, cfg) => {
    calls.push({ url, cfg })
    return new Promise(resolve => setTimeout(() => resolve({ data: { url, n: calls.length } }), 5))
  }
  return { calls, restore: () => { api.get = original } }
}

test('cachedGet (guest): gộp inflight và lưu cache theo TTL', async () => {
  localStorage.clear()
  invalidateCache()
  const m = mockApiGet()
  try {
    const [a, b] = await Promise.all([cachedGet('/novels', { params: { page: 1 } }), cachedGet('/novels', { params: { page: 1 } })])
    assert.equal(m.calls.length, 1)
    assert.deepEqual(a, b)
    assert.deepEqual(peekCache('/novels', { page: 1 }), a)
    await cachedGet('/novels', { params: { page: 1 } })
    assert.equal(m.calls.length, 1, 'hit cache, không gọi mạng')
  } finally {
    m.restore()
  }
})

test('cachedGet (admin có authToken): vẫn gộp inflight nhưng KHÔNG lưu/đọc cache', async () => {
  invalidateCache()
  localStorage.clear()
  // Dữ liệu guest đã cache trước đó không được trả cho admin.
  const m = mockApiGet()
  try {
    await cachedGet('/novels/abc')
    assert.equal(m.calls.length, 1)
    localStorage.setItem('authToken', 'tok')
    const [a, b] = await Promise.all([cachedGet('/novels/abc'), cachedGet('/novels/abc')])
    assert.equal(m.calls.length, 2, 'admin bỏ qua hit guest, 2 lời gọi đồng thời gộp 1 request')
    assert.deepEqual(a, b)
    await cachedGet('/novels/xyz')
    assert.equal(peekCache('/novels/xyz'), undefined, 'admin không lưu vào store')
    await cachedGet('/novels/xyz')
    assert.equal(m.calls.length, 4)
  } finally {
    m.restore()
    localStorage.clear()
    invalidateCache()
  }
})

test('cachedGet: localStorage ném lỗi → coi như guest, không vỡ', async () => {
  const saved = globalThis.localStorage
  globalThis.localStorage = { getItem: () => { throw new Error('SecurityError') } }
  invalidateCache()
  const m = mockApiGet()
  try {
    await cachedGet('/novels/q')
    assert.notEqual(peekCache('/novels/q'), undefined)
  } finally {
    m.restore()
    globalThis.localStorage = saved
    invalidateCache()
  }
})
