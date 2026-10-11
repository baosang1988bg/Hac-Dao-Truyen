import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, BookOpen, Book, Sparkles, ShieldCheck, Zap,
  FileText, Eye,
} from 'lucide-react'
import api from '../../api'
import useTranslationStatus from '../../hooks/useTranslationStatus'
import TranslationPanel from '../../components/admin/TranslationPanel'
import GlossaryEditor from '../../components/admin/GlossaryEditor'
import HealthPanel from '../../components/admin/HealthPanel'
import ToolsPanel from '../../components/admin/ToolsPanel'
import CatalogBrowser from '../../components/admin/CatalogBrowser'
import ChapterListAdmin from '../../components/shared/ChapterListAdmin'
import { InfoRow } from '../../components/shared/ui'
import { sectionTitle } from '../../components/shared/presentation'

const TABS = { CHAPTERS: 'chapters', CATALOG: 'catalog', GLOSSARY: 'glossary', HEALTH: 'health', TOOLS: 'tools' }

/**
 * Trang quản trị 1 truyện (/admin/novels/:slug) — thay thế NovelDetail.jsx cũ.
 * Trái: TranslationPanel + thẻ thông tin. Phải: tabs Chương / Mục lục / Glossary / Kiểm tra / Công cụ.
 */
// Truyện có nhiều hơn ngưỡng này mới phân trang danh sách chương — đa số
// truyện (vài trăm chương) vẫn tải hết 1 lần để giữ nguyên trải nghiệm tìm
// kiếm/sắp xếp tức thời của ChapterListAdmin.
const CHAPTERS_PAGE_SIZE = 300

export default function AdminNovelDetail() {
  const { slug } = useParams()
  const [novel, setNovel] = useState(null)
  const [chapters, setChapters] = useState([])
  const [chaptersPage, setChaptersPage] = useState(1)
  const [chaptersPages, setChaptersPages] = useState(1)
  const [chaptersTotal, setChaptersTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [catalog, setCatalog] = useState([])
  const [glossaryCount, setGlossaryCount] = useState(0)
  const [translateCount, setTranslateCount] = useState(5)
  const [activeTab, setActiveTab] = useState(TABS.CHAPTERS)

  const fetchData = useCallback(async () => {
    try {
      const [nRes, cRes, catRes] = await Promise.all([
        api.get(`/novels/${slug}`), // admin token → kèm glossary
        api.get(`/novels/${slug}/chapters`, { params: { page: 1, limit: CHAPTERS_PAGE_SIZE } }),
        api.get(`/novels/${slug}/catalog`).catch(() => ({ data: [] })),
      ])
      setNovel(nRes.data)
      setChapters(cRes.data?.chapters || [])
      setChaptersPage(cRes.data?.page || 1)
      setChaptersPages(cRes.data?.pages || 1)
      setChaptersTotal(cRes.data?.total || 0)
      setCatalog(catRes.data || [])
      setGlossaryCount(Object.keys(nRes.data.glossary || {}).length)
    } catch (err) {
      console.error(err)
    }
  }, [slug])

  const loadMoreChapters = useCallback(async () => {
    if (loadingMore || chaptersPage >= chaptersPages) return
    setLoadingMore(true)
    try {
      const nextPage = chaptersPage + 1
      const res = await api.get(`/novels/${slug}/chapters`, { params: { page: nextPage, limit: CHAPTERS_PAGE_SIZE } })
      setChapters(prev => [...prev, ...(res.data?.chapters || [])])
      setChaptersPage(res.data?.page || nextPage)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingMore(false)
    }
  }, [slug, chaptersPage, chaptersPages, loadingMore])

  useEffect(() => { fetchData() }, [fetchData])

  const {
    taskStatus, isRunning, translating, elapsedSec, start, stop,
  } = useTranslationStatus(slug, { onFinished: fetchData })

  if (!novel) {
    return <div style={{ paddingTop: '2rem', color: 'var(--text-muted)' }}>Đang tải...</div>
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <Link to="/admin/novels" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '0.75rem', minHeight: '32px' }}>
          <ArrowLeft size={15} /> Danh sách truyện
        </Link>
        <h1 className="page-title" style={{ marginBottom: '0.25rem', fontSize: '1.7rem' }}>{novel.title}</h1>
        <p className="page-subtitle" style={{ fontSize: '0.95rem' }}>
          {[novel.original_title, novel.author].filter(Boolean).join(' • ')}
          {chaptersTotal > 0 && <span> — <strong style={{ color: 'var(--accent)' }}>{chaptersTotal}</strong> chương đã dịch</span>}
        </p>
      </div>

      {/* Main layout */}
      <div className="novel-detail-grid" style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(260px, 300px) 1fr',
        gap: '1.5rem',
        alignItems: 'start'
      }}>

        {/* ── Trái: bảng điều khiển + info ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <TranslationPanel
            isRunning={isRunning}
            translating={translating}
            translateCount={translateCount}
            setTranslateCount={setTranslateCount}
            taskStatus={taskStatus}
            elapsedSec={elapsedSec}
            onStart={(force, startUrl) => start(translateCount, startUrl, force)}
            onStop={stop}
          />

          <div className="glass-panel p-6">
            <h2 style={sectionTitle}><FileText size={18} style={{ color: 'var(--accent)' }} /> Thông tin</h2>
            <InfoRow label="Slug"     value={novel.slug} mono />
            <InfoRow label="Thể loại" value={novel.genre} />
            <InfoRow label="Chương"   value={`${novel.chapter_count ?? chaptersTotal}${novel.total_chapters ? ' / ' + novel.total_chapters : ''}`} />
            <InfoRow label="Glossary" value={glossaryCount} />
            {novel.notes && <InfoRow label="Ghi chú" value={novel.notes} />}
            <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--border-panel)', paddingTop: '0.75rem' }}>
              <Link to={`/novel/${slug}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem' }}>
                <Eye size={14} /> Xem trang guest
              </Link>
            </div>
          </div>
        </div>

        {/* ── Phải: tabs ── */}
        <div className="glass-panel" style={{ overflow: 'hidden' }}>
          <div className="tab-bar" style={{ display: 'flex', borderBottom: '1px solid var(--border-panel)', padding: '0 1rem' }}>
            {[
              { id: TABS.CHAPTERS, label: `Chương (${chaptersTotal})`, icon: <BookOpen size={15} /> },
              ...(catalog.length > 0 ? [
                { id: TABS.CATALOG, label: `Mục lục gốc (${catalog.length})`, icon: <Sparkles size={15} /> }
              ] : []),
              { id: TABS.GLOSSARY, label: `Glossary (${glossaryCount})`, icon: <Book size={15} /> },
              { id: TABS.HEALTH,   label: 'Kiểm tra', icon: <ShieldCheck size={15} /> },
              { id: TABS.TOOLS,    label: 'Công cụ', icon: <Zap size={15} /> },
            ].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '0.9rem 1rem', fontSize: '0.88rem', fontWeight: 500,
                background: 'none', border: 'none', cursor: 'pointer',
                color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-muted)',
                borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: '-1px', transition: 'color 0.2s',
              }}>
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>

          <div style={{ padding: '1.5rem' }}>
            {activeTab === TABS.CHAPTERS && (
              <>
                <ChapterListAdmin chapters={chapters} slug={slug} />
                {chaptersPage < chaptersPages && (
                  <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                    <button className="btn btn-secondary" onClick={loadMoreChapters} disabled={loadingMore}>
                      {loadingMore ? 'Đang tải...' : `Tải thêm chương (${chapters.length}/${chaptersTotal})`}
                    </button>
                  </div>
                )}
              </>
            )}
            {activeTab === TABS.CATALOG && (
              <CatalogBrowser
                catalog={catalog}
                chapters={chapters}
                slug={slug}
                readOnly={false}
                onTranslateFromChapter={(startUrl) => start(translateCount, startUrl, false)}
              />
            )}
            {activeTab === TABS.GLOSSARY && (
              <GlossaryEditor
                slug={slug}
                glossary={novel.glossary || {}}
                onSaved={(glObj) => setGlossaryCount(Object.keys(glObj).length)}
              />
            )}
            {activeTab === TABS.HEALTH && <HealthPanel slug={slug} />}
            {activeTab === TABS.TOOLS && <ToolsPanel slug={slug} />}
          </div>
        </div>
      </div>
    </div>
  )
}
