import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  loadHanViet, resetHanVietCache, hanVietReadings, hanVietSuggestion,
  cycleHanVietPick, isHanText,
} from '../src/utils/hanviet.js'
import { applyCasing } from '../src/utils/nameEditor.js'

const TABLE = { 林: 'lâm', 凡: 'phàm', 樂: 'lạc|nhạc', 乐: 'lạc|nhạc', 长: 'trường|trưởng', 阿: 'a', 莫: 'mạc' }

test('hanVietReadings: mảng âm từng chữ, chữ thiếu → ?', () => {
  assert.deepEqual(hanVietReadings('林凡', TABLE), [['lâm'], ['phàm']])
  assert.deepEqual(hanVietReadings('樂', TABLE), [['lạc', 'nhạc']])
  assert.deepEqual(hanVietReadings('林X凡', {}), [['?'], ['X'], ['?']])
  assert.deepEqual(hanVietReadings('阿·莫', TABLE), [['a'], ['mạc']], 'bỏ dấu ngăn tên')
  assert.deepEqual(hanVietReadings(' 林 凡 ', TABLE), [['lâm'], ['phàm']], 'bỏ khoảng trắng')
  assert.deepEqual(hanVietReadings('', TABLE), [])
  assert.deepEqual(hanVietReadings(null, TABLE), [])
  // Chữ ngoài BMP (cặp surrogate) là MỘT chữ.
  assert.deepEqual(hanVietReadings('𠀀', {}), [['?']])
  // Bảng dạng mảng cũng được.
  assert.deepEqual(hanVietReadings('林', { 林: ['lâm', 'lấm'] }), [['lâm', 'lấm']])
})

test('hanVietSuggestion: ghép theo âm đã chọn', () => {
  assert.equal(hanVietSuggestion('林凡', TABLE), 'lâm phàm')
  assert.equal(hanVietSuggestion('乐长', TABLE, [1, 1]), 'nhạc trưởng')
  assert.equal(hanVietSuggestion('乐长', TABLE, [1]), 'nhạc trường', 'thiếu pick → âm đầu')
  assert.equal(hanVietSuggestion('乐', TABLE, [9]), 'lạc', 'pick vượt phạm vi → âm đầu')
  assert.equal(hanVietSuggestion('乐', TABLE, [-1]), 'lạc')
  assert.equal(hanVietSuggestion('林某', TABLE), 'lâm ?')
  assert.equal(applyCasing(hanVietSuggestion('林凡', TABLE), 'title'), 'Lâm Phàm')
  assert.equal(applyCasing(hanVietSuggestion('乐长', TABLE, [1, 0]), 'sentence'), 'Nhạc trường')
})

test('cycleHanVietPick: vòng qua các âm, không sửa mảng cũ', () => {
  const a = []
  const b = cycleHanVietPick(a, 1, 2)
  assert.deepEqual(a, [])
  assert.deepEqual(b, [0, 1])
  assert.deepEqual(cycleHanVietPick(b, 1, 2), [0, 0])
  assert.deepEqual(cycleHanVietPick([0], 0, 1), [0])
  assert.deepEqual(cycleHanVietPick(null, 0, 3), [1])
})

test('isHanText', () => {
  assert.equal(isHanText('林凡'), true)
  assert.equal(isHanText(' 阿·莫 '), true)
  assert.equal(isHanText('Lâm Phàm'), false)
  assert.equal(isHanText('林 Phàm'), false)
  assert.equal(isHanText(''), false)
  assert.equal(isHanText(undefined), false)
})

test('loadHanViet: cache Promise, lỗi thì cho thử lại', async () => {
  resetHanVietCache()
  let calls = 0
  const loader = async () => { calls += 1; return { default: TABLE } }
  const [a, b] = await Promise.all([loadHanViet(loader), loadHanViet(loader)])
  assert.equal(a, TABLE)
  assert.equal(b, TABLE)
  assert.equal(calls, 1, 'chỉ tải một lần')

  resetHanVietCache()
  let fail = true
  const flaky = async () => {
    if (fail) { fail = false; throw new Error('chunk lỗi') }
    return { 林: 'lâm' } // không có default cũng nhận
  }
  await assert.rejects(loadHanViet(flaky), /chunk lỗi/)
  assert.deepEqual(await loadHanViet(flaky), { 林: 'lâm' })
  resetHanVietCache()
})

test('dữ liệu thật hanviet.json: đúng dạng, chữ thường gặp có âm đúng', () => {
  const url = new URL('../src/data/hanviet.json', import.meta.url)
  const raw = readFileSync(url, 'utf8')
  const table = JSON.parse(raw)
  const keys = Object.keys(table)
  assert.ok(keys.length > 1000, `quá ít chữ: ${keys.length}`)
  for (const k of keys.slice(0, 200)) {
    assert.equal(Array.from(k).length, 1, `khoá phải là 1 chữ: ${k}`)
    assert.match(table[k], /^[^\s|]+(\|[^\s|]+)*$/u)
  }
  assert.equal(applyCasing(hanVietSuggestion('林凡', table), 'title'), 'Lâm Phàm')
  assert.ok(table['樂'].split('|').includes('nhạc'))
})
