import React, { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Search, Edit2, Check, X, ChevronLeft, ChevronRight, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import api from '../../api'

const ITEMS_PER_PAGE = 100
// Giới hạn quét substring O(n²) để không đơ UI với glossary cực lớn
const SUBSTRING_SCAN_LIMIT = 4000

/**
 * Trình soạn glossary (tách từ GlossaryTab của NovelDetail.jsx cũ).
 * Tự quản lý state + tự lưu qua POST /novels/{slug}/glossary.
 *
 * Nâng cấp 3.6: tìm kiếm debounce 200ms (lọc cả key Trung lẫn value Việt),
 * phân trang client-side 100 entry/trang, panel "Kiểm tra mâu thuẫn":
 *   - 1 nghĩa Việt dùng cho >3 key Trung khác nhau → cảnh báo nhẹ
 *   - key A là substring của key B nhưng nghĩa khác nhau → icon ⚠ + tooltip
 *
 * @param {string} slug
 * @param {Object} glossary — object {hán tự: nghĩa} từ novel (admin)
 * @param {(glObj: Object) => void} [onSaved] — báo cho trang cha cập nhật số đếm
 */
export default function GlossaryEditor({ slug, glossary: glossaryProp, onSaved }) {
  const [glossary, setGlossary] = useState([])
  const [searchInput, setSearchInput] = useState('')   // giá trị ô input (tức thời)
  const [searchQuery, setSearchQuery] = useState('')   // giá trị đã debounce 200ms
  const [currentPage, setCurrentPage] = useState(1)
  const [newKey, setNewKey] = useState('')
  const [newVal, setNewVal] = useState('')
  const [editingKey, setEditingKey] = useState(null)
  const [editKey, setEditKey] = useState('')
  const [editVal, setEditVal] = useState('')
  const [conflictOpen, setConflictOpen] = useState(false)

  // Đồng bộ khi prop thay đổi (fetch lại novel)
  useEffect(() => {
    setGlossary(Object.entries(glossaryProp || {}).map(([k, v]) => ({ key: k, val: v })))
  }, [glossaryProp])

  // Debounce tìm kiếm 200ms
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput), 200)
    return () => clearTimeout(t)
  }, [searchInput])

  // Lưu qua API (logic giữ nguyên từ NovelDetail cũ)
  const saveGlossary = async (newGlArr) => {
    const glObj = {}
    newGlArr.forEach(item => { if (item.key.trim()) glObj[item.key.trim()] = item.val.trim() })
    try {
      await api.post(`/novels/${slug}/glossary`, { glossary: glObj })
      setGlossary(newGlArr)
      onSaved?.(glObj)
    } catch {
      alert('Không thể lưu glossary.')
    }
  }

  // Lọc danh sách theo từ khóa đã debounce (tìm cả key Trung lẫn value Việt)
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return glossary
    return glossary.filter(item =>
      item.key.toLowerCase().includes(q) || item.val.toLowerCase().includes(q)
    )
  }, [glossary, searchQuery])

  // Phân trang (clamp trang khi filtered co lại sau xóa/lọc)
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const page = Math.min(currentPage, totalPages)
  const startIdx = (page - 1) * ITEMS_PER_PAGE
  const paginated = filtered.slice(startIdx, startIdx + ITEMS_PER_PAGE)

  // Reset trang về 1 khi đổi từ khóa tìm kiếm
  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery])

  // ── Phát hiện mâu thuẫn (memo — chỉ tính lại khi glossary đổi) ──────────────
  const conflicts = useMemo(() => {
    const valueGroups = []   // 1 nghĩa Việt ← >3 key Trung khác nhau (cảnh báo nhẹ)
    const substrPairs = []   // key A ⊂ key B nhưng nghĩa khác nhau
    const warnByKey = new Map()
    const addWarn = (k, msg) => {
      if (!warnByKey.has(k)) warnByKey.set(k, [])
      warnByKey.get(k).push(msg)
    }

    const entries = glossary.filter(e => e.key.trim())

    // 1) Nhiều key → cùng 1 value: OK, nhưng >3 key thì cảnh báo nhẹ
    const byVal = new Map()
    entries.forEach(({ key, val }) => {
      const v = val.trim()
      if (!v) return
      if (!byVal.has(v)) byVal.set(v, [])
      byVal.get(v).push(key)
    })
    byVal.forEach((keys, val) => {
      if (keys.length > 3) {
        valueGroups.push({ val, keys })
        keys.forEach(k => addWarn(k, `Nghĩa "${val}" đang dùng cho ${keys.length} từ gốc khác nhau`))
      }
    })

    // 2) Key A là substring của key B mà nghĩa khác nhau → nghi mâu thuẫn
    if (entries.length <= SUBSTRING_SCAN_LIMIT) {
      for (let i = 0; i < entries.length; i++) {
        const a = entries[i]
        for (let j = 0; j < entries.length; j++) {
          if (i === j) continue
          const b = entries[j]
          if (a.key.length < b.key.length && b.key.includes(a.key) &&
              a.val.trim() !== b.val.trim()) {
            substrPairs.push({ shortKey: a.key, shortVal: a.val, longKey: b.key, longVal: b.val })
            addWarn(a.key, `"${a.key}" nằm trong "${b.key}" nhưng nghĩa khác nhau ("${a.val}" ≠ "${b.val}")`)
            addWarn(b.key, `"${b.key}" chứa "${a.key}" nhưng nghĩa khác nhau ("${b.val}" ≠ "${a.val}")`)
          }
        }
      }
    }

    return { valueGroups, substrPairs, warnByKey, total: valueGroups.length + substrPairs.length }
  }, [glossary])

  // Xử lý thêm mới từ điển
  const handleAdd = () => {
    const k = newKey.trim()
    const v = newVal.trim()
    if (!k) return

    // Validation trùng lặp từ gốc
    const existing = glossary.find(item => item.key.toLowerCase() === k.toLowerCase())
    if (existing) {
      if (!window.confirm(`Hán tự "${k}" đã tồn tại với nghĩa "${existing.val}". Bạn có muốn ghi đè bằng nghĩa mới "${v}" không?`)) {
        return
      }
      const updated = [{ key: k, val: v }, ...glossary.filter(item => item.key.toLowerCase() !== k.toLowerCase())]
      saveGlossary(updated)
    } else {
      saveGlossary([{ key: k, val: v }, ...glossary])
    }
    setNewKey('')
    setNewVal('')
  }

  // Xử lý xóa từ điển
  const handleRemove = (keyToRemove) => {
    if (window.confirm(`Bạn có chắc chắn muốn xóa từ khóa "${keyToRemove}" khỏi từ điển?`)) {
      const updated = glossary.filter(item => item.key !== keyToRemove)
      saveGlossary(updated)
    }
  }

  // Bắt đầu sửa trực tiếp (Inline Edit)
  const startEdit = (item) => {
    setEditingKey(item.key)
    setEditKey(item.key)
    setEditVal(item.val)
  }

  // Lưu sửa đổi
  const handleSaveEdit = (originalKey) => {
    const k = editKey.trim()
    const v = editVal.trim()
    if (!k) return

    // Nếu đổi sang key khác và key đó trùng với từ khác
    if (k.toLowerCase() !== originalKey.toLowerCase()) {
      const existing = glossary.find(item => item.key.toLowerCase() === k.toLowerCase())
      if (existing) {
        alert(`Từ khóa Hán tự "${k}" đã tồn tại trong từ điển! Vui lòng chọn từ khóa khác.`)
        return
      }
    }

    const updated = glossary.map(item =>
      item.key === originalKey ? { key: k, val: v } : item
    )
    saveGlossary(updated)
    setEditingKey(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Panel Thêm Mới */}
      <div style={{
        background: 'rgba(255,255,255,0.02)', padding: '1rem',
        borderRadius: '10px', border: '1px solid var(--border-panel)'
      }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          ✨ Thêm Từ Điển Mới
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input type="text" placeholder="Hán tự (Ví dụ: 乔桑)" className="input-field"
            value={newKey} onChange={e => setNewKey(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()} style={{ flex: '1 1 150px' }} />
          <input type="text" placeholder="Tiếng Việt (Ví dụ: Kiều Tang)" className="input-field"
            value={newVal} onChange={e => setNewVal(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()} style={{ flex: '1 1 150px' }} />
          <button className="btn btn-primary" onClick={handleAdd} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '10px 16px' }}>
            <Plus size={16} /> Thêm
          </button>
        </div>
      </div>

      {/* Panel gấp/mở: Kiểm tra mâu thuẫn */}
      <div style={{
        background: conflicts.total > 0 ? 'rgba(245,158,11,0.05)' : 'rgba(255,255,255,0.02)',
        borderRadius: '10px',
        border: conflicts.total > 0 ? '1px solid rgba(245,158,11,0.35)' : '1px solid var(--border-panel)'
      }}>
        <button onClick={() => setConflictOpen(o => !o)} style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: '0.75rem 1rem', color: conflicts.total > 0 ? '#f59e0b' : 'var(--text-muted)',
          fontSize: '0.85rem', fontWeight: 600
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <AlertTriangle size={15} /> Kiểm tra mâu thuẫn ({conflicts.total})
          </span>
          {conflictOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {conflictOpen && (
          <div style={{ padding: '0 1rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {conflicts.total === 0 && (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Không phát hiện mâu thuẫn nào trong glossary.
              </div>
            )}

            {conflicts.substrPairs.length > 0 && (
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#f59e0b', marginBottom: '0.4rem' }}>
                  Key lồng nhau nhưng nghĩa khác ({conflicts.substrPairs.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  {conflicts.substrPairs.slice(0, 50).map((p, i) => (
                    <div key={i} style={{ fontSize: '0.82rem', color: '#d1d5db', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                      <strong>{p.shortKey}</strong> → "{p.shortVal}" &nbsp;⊂&nbsp; <strong>{p.longKey}</strong> → "{p.longVal}"
                    </div>
                  ))}
                  {conflicts.substrPairs.length > 50 && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      ... và {conflicts.substrPairs.length - 50} cặp nữa
                    </div>
                  )}
                </div>
              </div>
            )}

            {conflicts.valueGroups.length > 0 && (
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#f59e0b', marginBottom: '0.4rem' }}>
                  1 nghĩa Việt dùng cho &gt;3 từ gốc ({conflicts.valueGroups.length}) — cảnh báo nhẹ
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  {conflicts.valueGroups.slice(0, 50).map((g, i) => (
                    <div key={i} style={{ fontSize: '0.82rem', color: '#d1d5db', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                      "{g.val}" ← {g.keys.length} key: {g.keys.slice(0, 8).join('、')}{g.keys.length > 8 ? '…' : ''}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Toolbar Tìm kiếm & Thống kê */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
        <div style={{ position: 'relative', flex: '1 1 250px' }}>
          <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#666', display: 'flex', alignItems: 'center' }}>
            <Search size={16} />
          </span>
          <input type="text" placeholder="Tìm kiếm theo từ gốc (Trung) hoặc nghĩa dịch (Việt)..." className="input-field"
            value={searchInput} onChange={e => setSearchInput(e.target.value)}
            style={{ paddingLeft: '36px', width: '100%' }} />
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          {filtered.length === 0
            ? <>Tìm thấy: <strong>0</strong> / <strong>{glossary.length}</strong> từ</>
            : <>Hiện <strong>{startIdx + 1}–{Math.min(startIdx + ITEMS_PER_PAGE, filtered.length)}</strong> / tổng <strong>{filtered.length}</strong> từ
              {searchQuery.trim() && <> (lọc từ {glossary.length})</>}</>}
        </div>
      </div>

      {/* Danh sách entries */}
      {filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0',
          background: 'rgba(255,255,255,0.01)', borderRadius: '10px',
          border: '1px dashed var(--border-panel)'
        }}>
          Không tìm thấy từ khóa nào phù hợp.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {paginated.map((item) => {
            const isEditing = editingKey === item.key
            const warns = conflicts.warnByKey.get(item.key)
            return (
              <div key={item.key} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0.65rem 1rem', borderRadius: '8px',
                background: isEditing ? 'rgba(233,69,96,0.04)' : 'rgba(255,255,255,0.03)',
                border: isEditing ? '1px solid rgba(233,69,96,0.3)' : '1px solid var(--border-panel)',
                gap: '1rem', transition: 'all 0.2s'
              }}>
                {isEditing ? (
                  /* Form sửa trực tiếp inline */
                  <div style={{ display: 'flex', gap: '0.5rem', flex: 1, flexWrap: 'wrap' }}>
                    <input type="text" className="input-field" value={editKey}
                      onChange={e => setEditKey(e.target.value)} style={{ flex: '1 1 120px', padding: '6px 10px', fontSize: '0.85rem' }} />
                    <input type="text" className="input-field" value={editVal}
                      onChange={e => setEditVal(e.target.value)} style={{ flex: '1 1 120px', padding: '6px 10px', fontSize: '0.85rem' }} />
                  </div>
                ) : (
                  /* Hiển thị bình thường */
                  <div style={{ display: 'flex', flex: 1, minWidth: 0, alignItems: 'center', gap: '1rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#f3f4f6', flex: '1 1 120px', wordBreak: 'break-all', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {warns && (
                        <span title={warns.join('\n')} style={{ color: '#f59e0b', display: 'inline-flex', alignItems: 'center', cursor: 'help', flexShrink: 0 }}>
                          <AlertTriangle size={14} />
                        </span>
                      )}
                      <span>{item.key}</span>
                    </div>
                    <div style={{ color: '#9ca3af', fontSize: '0.85rem', flex: '1 1 120px', wordBreak: 'break-all' }}>
                      {item.val}
                    </div>
                  </div>
                )}

                {/* Các nút hành động */}
                <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
                  {isEditing ? (
                    <>
                      <button className="btn btn-primary" onClick={() => handleSaveEdit(item.key)} style={{ padding: '6px 8px', background: '#10b981' }} title="Lưu">
                        <Check size={14} />
                      </button>
                      <button className="btn btn-secondary" onClick={() => setEditingKey(null)} style={{ padding: '6px 8px' }} title="Hủy">
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="btn btn-secondary" onClick={() => startEdit(item)} style={{ padding: '6px 8px' }} title="Sửa">
                        <Edit2 size={14} />
                      </button>
                      <button className="btn btn-danger" onClick={() => handleRemove(item.key)} style={{ padding: '6px 8px' }} title="Xóa">
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Phân trang */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.8rem', marginTop: '1rem' }}>
          <button className="btn btn-secondary" onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={page === 1} style={{ padding: '6px 10px', opacity: page === 1 ? 0.4 : 1, display: 'flex', alignItems: 'center' }}>
            <ChevronLeft size={16} />
          </button>

          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Trang <strong>{page}</strong> / <strong>{totalPages}</strong>
          </span>

          <button className="btn btn-secondary" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages} style={{ padding: '6px 10px', opacity: page === totalPages ? 0.4 : 1, display: 'flex', alignItems: 'center' }}>
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
