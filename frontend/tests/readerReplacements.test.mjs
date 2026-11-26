import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getReplacements,
  saveReplacement,
  removeReplacement,
  applyReplacements,
} from '../src/utils/readerReplacements.js'

// Mock localStorage
const storage = new Map()
global.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, val) => storage.set(key, String(val)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
}

test('getReplacements: rỗng khi chưa có dữ liệu hoặc slug không hợp lệ', () => {
  storage.clear()
  assert.deepEqual(getReplacements(''), [])
  assert.deepEqual(getReplacements('test-slug'), [])
})

test('saveReplacement: thêm và cập nhật quy tắc thay thế', () => {
  storage.clear()
  const slug = 'test-novel'

  // Thêm mới
  const list1 = saveReplacement(slug, { from: 'Lạc Lông Vũ', to: 'Lạc Vũ' })
  assert.equal(list1.length, 1)
  assert.equal(list1[0].from, 'Lạc Lông Vũ')
  assert.equal(list1[0].to, 'Lạc Vũ')

  // Cập nhật từ đã có (case-insensitive)
  const list2 = saveReplacement(slug, { from: 'lạc lông vũ', to: 'Lạc Vũ Đại Ca' })
  assert.equal(list2.length, 1)
  assert.equal(list2[0].to, 'Lạc Vũ Đại Ca')

  // Thêm từ thứ 2
  const list3 = saveReplacement(slug, { from: 'Mực đen', to: 'Mực Nước Ngư' })
  assert.equal(list3.length, 2)
})

test('removeReplacement: xoá đúng quy tắc theo ID', () => {
  storage.clear()
  const slug = 'test-novel'
  const list = saveReplacement(slug, { from: 'Từ Sai', to: 'Từ Đúng' })
  const id = list[0].id

  const remaining = removeReplacement(slug, id)
  assert.equal(remaining.length, 0)
  assert.deepEqual(getReplacements(slug), [])
})

test('applyReplacements: thay thế an toàn mọi lần xuất hiện mà không lỗi ký tự đặc biệt', () => {
  const content = 'Hắn nói: "Lạc Lông Vũ (cấp 1) rất mạnh!". Sau đó Lạc Lông Vũ rời đi.'
  const replacements = [
    { from: 'Lạc Lông Vũ (cấp 1)', to: 'Lạc Vũ [LV1]' },
    { from: 'Lạc Lông Vũ', to: 'Lạc Vũ' },
  ]

  const result = applyReplacements(content, replacements)
  assert.equal(result, 'Hắn nói: "Lạc Vũ [LV1] rất mạnh!". Sau đó Lạc Vũ rời đi.')
})

test('applyReplacements: trả về text gốc khi không có quy tắc hoặc text rỗng', () => {
  assert.equal(applyReplacements('', []), '')
  assert.equal(applyReplacements('Hello world', null), 'Hello world')
  assert.equal(applyReplacements('Hello world', []), 'Hello world')
})
