import React, { useEffect, useState } from 'react'
import { Plus, Trash2, Search, Edit2, Check, X, ChevronLeft, ChevronRight } from 'lucide-react'
import api from '../../api'

/**
 * Trình soạn glossary (tách từ GlossaryTab của NovelDetail.jsx cũ).
 * Tự quản lý state + tự lưu qua POST /novels/{slug}/glossary.
 *
 * @param {string} slug
 * @param {Object} glossary — object {hán tự: nghĩa} từ novel (admin)
 * @param {(glObj: Object) => void} [onSaved] — báo cho trang cha cập nhật số đếm
 */
export default function GlossaryEditor({ slug, glossary: glossaryProp, onSaved }) {
  const [glossary, setGlossary] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [newKey, setNewKey] = useState('')
  const [newVal, setNewVal] = useState('')
  const [editingKey, setEditingKey] = useState(null)
  const [editKey, setEditKey] = useState('')
  const [editVal, setEditVal] = useState('')
  const itemsPerPage = 20

  // Đồng bộ khi prop thay đổi (fetch lại novel)
  useEffect(() => {
    setGlossary(Object.entries(glossaryProp || {}).map(([k, v]) => ({ key: k, val: v })))
  }, [glossaryProp])

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

  // Lọc danh sách theo từ khóa tìm kiếm (tìm cả key lẫn val)
  const filtered = glossary.filter(item =>
    item.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.val.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Phân trang
  const totalPages = Math.ceil(filtered.length / itemsPerPage)
  const paginated = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  // Reset trang về 1 khi bắt đầu tìm kiếm
  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery])

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

      {/* Toolbar Tìm kiếm & Thống kê */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
        <div style={{ position: 'relative', flex: '1 1 250px' }}>
          <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#666', display: 'flex', alignItems: 'center' }}>
            <Search size={16} />
          </span>
          <input type="text" placeholder="Tìm kiếm theo từ gốc hoặc nghĩa dịch..." className="input-field"
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            style={{ paddingLeft: '36px', width: '100%' }} />
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Tìm thấy: <strong>{filtered.length}</strong> / <strong>{glossary.length}</strong> từ
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
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#f3f4f6', flex: '1 1 120px', wordBreak: 'break-all' }}>
                      {item.key}
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
            disabled={currentPage === 1} style={{ padding: '6px 10px', opacity: currentPage === 1 ? 0.4 : 1, display: 'flex', alignItems: 'center' }}>
            <ChevronLeft size={16} />
          </button>

          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Trang <strong>{currentPage}</strong> / <strong>{totalPages}</strong>
          </span>

          <button className="btn btn-secondary" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages} style={{ padding: '6px 10px', opacity: currentPage === totalPages ? 0.4 : 1, display: 'flex', alignItems: 'center' }}>
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
