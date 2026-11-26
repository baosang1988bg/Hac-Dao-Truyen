import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyCasing, NAME_CASING_STYLES, expandSelection,
  parseNamePack, buildNamePack, namePackFilename, NAME_PACK_MAX_RULES,
} from '../src/utils/nameEditor.js'
import { lookupNameZh, normalizeNameKey } from '../src/utils/engagement.js'
import {
  applyReplacements, mergeReplacementRules, saveReplacement, mergeImportedRules, escapeRegExp,
} from '../src/utils/readerReplacements.js'
import { compactRules, buildPrefs, mergeReplacementLists } from '../src/utils/userPrefsSync.js'

const storage = new Map()
global.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear(),
  get length() { return storage.size },
  key: (i) => [...storage.keys()][i] ?? null,
}

// ── 1. Tra chữ Hán ───────────────────────────────────────────────────────────
test('lookupNameZh: không phân biệt hoa thường, gộp khoảng trắng, NFC/NFD', () => {
  const idx = [
    { vi: 'Hạ Thần', zh: ['夏辰', '夏晨'] },
    { vi: 'Lâm Phong', zh: ['林风'] },
    { vi: 'hạ thần', zh: ['夏辰', '下臣'] }, // trùng khoá → gộp, bỏ trùng
    { vi: 'Rỗng', zh: [] },
    null,
  ]
  assert.deepEqual(lookupNameZh(idx, '  hạ   THẦN '), ['夏辰', '夏晨', '下臣'])
  assert.deepEqual(lookupNameZh(idx, 'Lâm Phong'.normalize('NFD')), ['林风'])
  assert.deepEqual(lookupNameZh({ names: idx }, 'lâm phong'), ['林风'], 'nhận cả object response')
  assert.deepEqual(lookupNameZh(idx, 'Lâm'), [], 'không khớp một phần')
  assert.deepEqual(lookupNameZh(idx, 'Rỗng'), [])
  assert.deepEqual(lookupNameZh(null, 'Hạ Thần'), [])
  assert.deepEqual(lookupNameZh(idx, ''), [])
  // Trả bản sao — sửa kết quả không làm hỏng cache.
  lookupNameZh(idx, 'Lâm Phong').push('x')
  assert.deepEqual(lookupNameZh(idx, 'Lâm Phong'), ['林风'])
  assert.equal(normalizeNameKey(' Đ\tÂU '), 'đ âu')
})

// ── 2. Kiểu viết hoa ─────────────────────────────────────────────────────────
test('applyCasing: 5 kiểu, tiếng Việt có dấu, giữ khoảng trắng', () => {
  assert.equal(NAME_CASING_STYLES.length, 5)
  const s = 'âu dương PHONG'
  assert.equal(applyCasing(s, 'title'), 'Âu Dương Phong')
  assert.equal(applyCasing(s, 'sentence'), 'Âu dương phong')
  assert.equal(applyCasing(s, 'lower'), 'âu dương phong')
  assert.equal(applyCasing(s, 'upper'), 'ÂU DƯƠNG PHONG')
  assert.equal(applyCasing(s, 'first2'), 'Âu Dương phong')
  assert.equal(applyCasing('đường  tam', 'title'), 'Đường  Tam', 'giữ 2 khoảng trắng')
  assert.equal(applyCasing('ỷ thiên', 'upper'), 'Ỷ THIÊN')
  assert.equal(applyCasing('“lâm phong”', 'title'), '“Lâm Phong”', 'bỏ qua dấu câu mở đầu')
  assert.equal(applyCasing('lâm - phong', 'title'), 'Lâm - Phong')
  assert.equal(applyCasing('Lâm', 'không-có'), 'Lâm')
  assert.equal(applyCasing('', 'title'), '')
  // Dạng NFD (dấu tách rời) vẫn viết hoa đúng chữ cái gốc.
  assert.equal(applyCasing('ân'.normalize('NFD'), 'title').normalize('NFC'), 'Ân')
})

// ── 3. Mở rộng cụm ───────────────────────────────────────────────────────────
test('expandSelection: mở rộng theo từ, dừng ở dấu câu và đầu/cuối đoạn', () => {
  const ctx = 'Hắn nói: “Âu Dương Phong, đi thôi.”'
  const s = ctx.indexOf('Dương')
  const e = s + 'Dương'.length
  assert.deepEqual(expandSelection(ctx, s, e, 'left'), { start: ctx.indexOf('Âu'), end: e, text: 'Âu Dương' })
  const r = expandSelection(ctx, s, e, 'right')
  assert.equal(r.text, 'Dương Phong')
  assert.equal(expandSelection(ctx, r.start, r.end, 'right'), null, 'dấu phẩy chặn')
  const l = expandSelection(ctx, ctx.indexOf('Âu'), e, 'left')
  assert.equal(l, null, 'ngoặc kép chặn')
  // Đang chọn dở giữa từ → hoàn tất từ trước.
  const mid = ctx.indexOf('Phong')
  assert.equal(expandSelection(ctx, mid, mid + 2, 'right').text, 'Phong')
  assert.equal(expandSelection(ctx, mid + 2, mid + 5, 'left').text, 'Phong')
  // Đầu/cuối đoạn
  assert.equal(expandSelection('Lâm Phong', 0, 3, 'left'), null)
  assert.equal(expandSelection('Lâm Phong', 4, 9, 'right'), null)
  assert.equal(expandSelection('Lâm   Phong', 0, 3, 'right').text, 'Lâm   Phong')
  // Tham số hỏng
  assert.equal(expandSelection('abc', 2, 1, 'left'), null)
  assert.equal(expandSelection('abc', 0, 9, 'left'), null)
  assert.equal(expandSelection('abc def', 0, 3, 'up'), null)
  assert.equal(expandSelection('', 0, 0, 'left'), null)
  // Quá maxLen → null
  assert.equal(expandSelection('aaaa bbbb', 0, 4, 'right', 5), null)
  // Ký tự ngoài BMP (surrogate) được coi là chữ
  const sp = 'A 𠀀𠀁 B'
  assert.equal(expandSelection(sp, 0, 1, 'right').text, 'A 𠀀𠀁')
})

// ── 4. Khớp nguyên từ ────────────────────────────────────────────────────────
test('applyReplacements whole: chỉ thay khi hai bên không phải chữ/số Unicode', () => {
  const text = 'Lâm gặp Lâm Phong, Lâmthư và lâm. (Lâm)!Lâm'
  assert.equal(applyReplacements(text, [{ from: 'Lâm', to: 'Lam', whole: true }]),
    'Lam gặp Lam Phong, Lâmthư và lâm. (Lam)!Lam')
  // Không cờ → chuỗi con như cũ
  assert.equal(applyReplacements('Lâmthư', [{ from: 'Lâm', to: 'Lam' }]), 'Lamthư')
  assert.equal(applyReplacements('Lâmthư', [{ from: 'Lâm', to: 'Lam', whole: false }]), 'Lamthư')
  // Chữ có dấu liền kề (ư, ạ) là chữ → không thay
  assert.equal(applyReplacements('ạLâm Lâmư', [{ from: 'Lâm', to: 'X', whole: true }]), 'ạLâm Lâmư')
  // Số liền kề
  assert.equal(applyReplacements('A1 A 1A', [{ from: 'A', to: 'B', whole: true }]), 'A1 B 1A')
  // Ký tự đặc biệt regex trong from được escape
  const special = 'x (a+b)*[c]$ y.z | ^q {2} \\d -1 a/b'
  const rules = ['(a+b)*[c]$', 'y.z', '^q', '{2}', '\\d', '-1', 'a/b'].map(from => ({ from, to: '#', whole: true }))
  assert.equal(applyReplacements(special, rules), 'x # # | # # # # #')
  assert.equal(new RegExp(escapeRegExp('.*+?^$()[]{}|/\\-'), 'u').test('.*+?^$()[]{}|/\\-'), true)
  // Cụm kết thúc bằng dấu câu — 2 lần liên tiếp vẫn thay cả hai
  assert.equal(applyReplacements('Lâm,Lâm,', [{ from: 'Lâm,', to: 'L;', whole: true }]), 'L;L;')
  // NFD: dấu kết hợp liền sau là "chữ" → không thay giữa chừng
  const nfd = 'Lâm'.normalize('NFD') // L a ̂ m
  assert.equal(applyReplacements(nfd, [{ from: 'La', to: 'X', whole: true }]), nfd)
})

test('applyReplacements whole: chương 20k ký tự × 300 quy tắc chạy nhanh', () => {
  const words = ['Lâm', 'Phong', 'gặp', 'Hạ', 'Thần', 'tại', 'Thanh', 'Vân', 'môn', '.']
  let text = ''
  for (let i = 0; text.length < 20000; i++) text += words[i % words.length] + ' '
  const rules = Array.from({ length: 300 }, (_, i) => ({ from: `Tên${i}`, to: `Name${i}`, whole: true }))
  rules.push({ from: 'Lâm Phong', to: 'Lâm Phượng', whole: true }, { from: 'Hạ', to: 'Hạ', whole: true })
  const t0 = performance.now()
  for (let k = 0; k < 5; k++) applyReplacements(text, rules)
  const ms = (performance.now() - t0) / 5
  assert.ok(ms < 100, `quá chậm: ${ms.toFixed(1)} ms`)
  assert.ok(applyReplacements(text, rules).includes('Lâm Phượng'))
})

test('mergeReplacementRules + saveReplacement giữ cờ whole; quy tắc mới mặc định whole', () => {
  const merged = mergeReplacementRules(
    [{ from: 'A', to: 'a', whole: true }, { from: 'B', to: 'b' }],
    [{ id: '1', from: 'C', to: 'c', whole: true }],
  )
  assert.deepEqual(merged, [{ from: 'A', to: 'a', whole: true }, { from: 'B', to: 'b' }, { id: '1', from: 'C', to: 'c', whole: true }])
  storage.clear()
  let list = saveReplacement('s', { from: 'Lâm', to: 'Lam' })
  assert.equal(list[0].whole, true, 'mới → whole mặc định true')
  list = saveReplacement('s', { from: 'lâm', to: 'Lam2' })
  assert.equal(list[0].whole, true, 'cập nhật không truyền whole → giữ')
  list = saveReplacement('s', { from: 'Lâm', to: 'Lam3', whole: false })
  assert.equal(list[0].whole, false)
  list = saveReplacement('s', { from: 'Mới', to: 'x', whole: false })
  assert.equal(list[1].whole, false)
})

test('đồng bộ prefs giữ cờ whole (compactRules / buildPrefs / mergeReplacementLists)', () => {
  assert.deepEqual(compactRules([
    { id: '1', from: 'A', to: 'a', whole: true, createdAt: 5 },
    { id: '2', from: 'B', to: 'b', whole: false, createdAt: 6 },
    { id: '3', from: 'C', to: 'c', createdAt: 7 },
  ]), [
    { from: 'A', to: 'a', updatedAt: 5, whole: true },
    { from: 'B', to: 'b', updatedAt: 6 },
    { from: 'C', to: 'c', updatedAt: 7 },
  ])
  const prefs = buildPrefs({}, { s: [{ id: '1', from: 'A', to: 'a', whole: true, createdAt: 1 }] })
  assert.equal(prefs.replacements.s[0].whole, true)
  // Remote mới hơn mang cờ → local nhận cờ; remote mới hơn không cờ → local bỏ cờ.
  const local = [
    { id: 'l1', from: 'A', to: 'a', createdAt: 100 },
    { id: 'l2', from: 'B', to: 'b', whole: true, createdAt: 100 },
  ]
  const remote = [
    { from: 'A', to: 'a2', whole: true, updatedAt: 200 },
    { from: 'B', to: 'b2', updatedAt: 200 },
    { from: 'C', to: 'c', whole: true, updatedAt: 300 },
  ]
  const merged = mergeReplacementLists(local, remote, 0, 999)
  assert.equal(merged[0].whole, true)
  assert.equal('whole' in merged[1], false)
  assert.equal(merged[2].whole, true)
})

// ── 5. Gói name ──────────────────────────────────────────────────────────────
test('buildNamePack + parseNamePack: khứ hồi JSON', () => {
  const pack = buildNamePack('dau-la', [
    { id: '1', from: ' Lâm ', to: 'Lam', whole: true },
    { id: '2', from: 'Hạ', to: 'Hà' },
    { from: '', to: 'x' },
  ])
  assert.deepEqual(pack, {
    format: 'hacdao-names', v: 1, slug: 'dau-la',
    rules: [{ from: 'Lâm', to: 'Lam', whole: true }, { from: 'Hạ', to: 'Hà', whole: false }],
  })
  const res = parseNamePack(JSON.stringify(pack), 'dau-la')
  assert.equal(res.ok, true)
  assert.equal(res.kind, 'json')
  assert.deepEqual(res.rules, pack.rules)
  assert.equal(res.slugMismatch, false)
  assert.equal(parseNamePack(JSON.stringify(pack), 'khac').slugMismatch, true)
  assert.equal(namePackFilename('dau-la'), 'name-dau-la.json')
  assert.equal(namePackFilename('../x'), 'name-x.json')
})

test('parseNamePack JSON: từ chối sai định dạng, quá lớn, quá nhiều; bỏ quy tắc hỏng', () => {
  assert.equal(parseNamePack('{bad json', 's').ok, false)
  assert.equal(parseNamePack('{"format":"khac","v":1,"rules":[]}').ok, false)
  assert.equal(parseNamePack('{"format":"hacdao-names","v":2,"rules":[]}').ok, false)
  assert.equal(parseNamePack('{"format":"hacdao-names","v":1}').ok, false)
  assert.equal(parseNamePack('[]').ok, false)
  assert.equal(parseNamePack('').ok, false)
  const tooMany = { format: 'hacdao-names', v: 1, rules: Array.from({ length: NAME_PACK_MAX_RULES + 1 }, (_, i) => ({ from: `a${i}`, to: 'b' })) }
  assert.equal(parseNamePack(JSON.stringify(tooMany)).ok, false)
  assert.equal(parseNamePack('A=B\n'.repeat(60 * 1024)).ok, false, '> 200 KB')
  const res = parseNamePack({
    format: 'hacdao-names', v: 1, slug: 's',
    rules: [
      { from: 'A', to: 'a' }, // whole vắng → true
      { from: 'B', to: 'b', whole: false },
      { from: 'x'.repeat(101), to: 'y' },
      { from: 'C', to: 5 },
      null,
      { from: '  ', to: 'z' },
      { from: 'a', to: 'a-sau' }, // trùng A (hoa thường) → bản sau thắng
    ],
  })
  assert.equal(res.ok, true)
  assert.equal(res.skipped, 4)
  assert.deepEqual(res.rules, [{ from: 'B', to: 'b', whole: false }, { from: 'a', to: 'a-sau', whole: true }])
})

test('parseNamePack văn bản kiểu STV: chỉ nhận A=B không chữ Hán', () => {
  const txt = '\uFEFF$唐三=Đường Tam~//~$魂力=Hồn Lực\nLạc Lông Vũ=Lạc Vũ\r\n$Diệp phàm=Diệp Phàm\n#中文=x\n@a|b=c|d\nkhông có dấu bằng\n\n=thiếu vế trái\nA=B=C'
  const res = parseNamePack(txt, 's')
  assert.equal(res.ok, true)
  assert.equal(res.kind, 'text')
  assert.equal(res.skippedHan, 2)
  assert.equal(res.skipped, 4) // #, @, không có '=', '=thiếu vế trái'
  assert.deepEqual(res.rules, [
    { from: 'Lạc Lông Vũ', to: 'Lạc Vũ', whole: true },
    { from: 'Diệp phàm', to: 'Diệp Phàm', whole: true },
    { from: 'A', to: 'B=C', whole: true },
  ])
  assert.equal(parseNamePack('chỉ là chữ').ok, true, 'có dòng hỏng → vẫn ok, báo số bỏ')
  assert.equal(parseNamePack('chỉ là chữ').rules.length, 0)
})

test('mergeImportedRules: file mới thắng khi trùng from, giữ id, đếm đúng', () => {
  const cur = [
    { id: 'r1', from: 'Lâm', to: 'Lam', whole: true, createdAt: 1 },
    { id: 'r2', from: 'Hạ', to: 'Hà', createdAt: 1 },
  ]
  const res = mergeImportedRules(cur, [
    { from: 'lâm', to: 'Lâm Mới', whole: true },
    { from: 'Hạ', to: 'Hà', whole: false }, // y hệt (whole false = không cờ)
    { from: 'Mới', to: 'New', whole: true },
  ], 500)
  assert.deepEqual([res.added, res.updated, res.unchanged], [1, 1, 1])
  assert.equal(res.list[0].id, 'r1')
  assert.equal(res.list[0].to, 'Lâm Mới')
  assert.equal(res.list[0].updatedAt, 500)
  assert.equal(res.list[2].from, 'Mới')
  assert.equal(cur[0].to, 'Lam', 'không sửa input')
})
