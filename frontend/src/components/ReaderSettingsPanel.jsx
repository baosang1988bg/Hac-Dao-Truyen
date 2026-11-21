import PropTypes from 'prop-types'
import { THEMES, READER_FONTS } from '../hooks/useReaderSettings'

// Literata/Noto Serif tải từ Google Fonts (index.html, subset vietnamese) —
// hiển thị dấu tiếng Việt chuẩn hơn các font hệ thống.
const FONTS = [
  ...READER_FONTS,
  ['Times New Roman, serif', 'Times New Roman'],
  ['Arial, sans-serif', 'Arial'],
  ['Georgia, serif', 'Georgia'],
  ['Palatino, serif', 'Palatino'],
  ['Inter, sans-serif', 'Inter'],
  ['serif', 'Có chân (Serif)'],
  ['sans-serif', 'Không chân (Sans)'],
]

// C08: chỉ hiện mục Giọng đọc khi trang gọi truyền `ttsVoices` (Reader.jsx —
// EpubReader.jsx chưa có tính năng TTS, không tự thêm ở đợt này).
export default function ReaderSettingsPanel({ settings, onChange, ttsVoices, customReplacementsCount = 0, onOpenReplacementsManager }) {
  const themeId = THEMES[settings.theme] ? settings.theme : 'sepia'
  const previewLineHeight = Math.max(settings.lineHeight, 1.5)
  const showTts = Array.isArray(ttsVoices)
  // Ưu tiên hiện giọng tiếng Việt lên đầu danh sách cho dễ chọn.
  const sortedVoices = showTts
    ? [...ttsVoices].sort((a, b) => {
        const aVi = (a.lang || '').toLowerCase().startsWith('vi') ? 0 : 1
        const bVi = (b.lang || '').toLowerCase().startsWith('vi') ? 0 : 1
        return aVi - bVi || a.name.localeCompare(b.name)
      })
    : []
  const hasVietnameseVoice = sortedVoices.some(v => (v.lang || '').toLowerCase().startsWith('vi'))
  return (
    <div className="reader-settings-panel">
      <div className={`reader-settings-preview reader--${themeId}`} style={{
        fontSize: `${settings.fontSize}px`, fontFamily: settings.fontFamily, lineHeight: previewLineHeight,
      }}>
        Hắc phong gào thét, trăng lạnh treo cao. Hắn khoác áo bào đen, một mình bước vào màn đêm.
      </div>
      <fieldset>
        <legend>Chủ đề</legend>
        <div className="reader-settings-themes">
          {Object.entries(THEMES).map(([id, label]) => (
            <button key={id} type="button" className={`reader--${id}`} aria-label={`Chủ đề ${label}`}
              aria-pressed={settings.theme === id} onClick={() => onChange('theme', id)}>
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <label>
        Font chữ
        <select aria-label="Font chữ" value={settings.fontFamily} onChange={event => onChange('fontFamily', event.target.value)}>
          {!FONTS.some(([value]) => value === settings.fontFamily) && <option value={settings.fontFamily}>{settings.fontFamily}</option>}
          {FONTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {[
        ['fontSize', 'Cỡ chữ', 12, 36, 1, 'px'],
        ['contentWidth', 'Độ rộng', 400, 1200, 50, 'px'],
        ['lineHeight', 'Giãn dòng', 1.5, 3, 0.1, ''],
      ].map(([key, label, min, max, step, unit]) => (
        <label key={key}>
          {label}: {settings[key]}{unit}
          <input type="range" aria-label={label} min={Math.min(min, settings[key])} max={Math.max(max, settings[key])}
            step={step} value={settings[key]} onChange={event => onChange(key, Number(event.target.value))} />
        </label>
      ))}

      {showTts && (
        <fieldset>
          <legend>Giọng đọc (Text-to-Speech)</legend>
          {sortedVoices.length === 0 ? (
            <p className="reader-settings-tts-note">
              Trình duyệt này chưa có giọng đọc nào khả dụng — thử trên Chrome/Edge hoặc cài thêm giọng đọc ở hệ điều hành.
            </p>
          ) : (
            <>
              <label>
                Giọng đọc
                <select
                  aria-label="Giọng đọc"
                  value={settings.ttsVoice}
                  onChange={event => onChange('ttsVoice', event.target.value)}
                >
                  <option value="">Mặc định hệ thống</option>
                  {sortedVoices.map(v => (
                    <option key={v.name} value={v.name}>
                      {v.name} {(v.lang || '').toLowerCase().startsWith('vi') ? '— Tiếng Việt' : `(${v.lang})`}
                    </option>
                  ))}
                </select>
              </label>
              {!hasVietnameseVoice && (
                <p className="reader-settings-tts-note">
                  Không tìm thấy giọng đọc tiếng Việt trên trình duyệt/thiết bị này — sẽ dùng giọng mặc định
                  (có thể phát âm không chuẩn tiếng Việt).
                </p>
              )}
            </>
          )}
          <label>
            Tốc độ đọc: {settings.ttsRate}x
            <input
              type="range" aria-label="Tốc độ đọc"
              min={0.5} max={2} step={0.1}
              value={settings.ttsRate}
              onChange={event => onChange('ttsRate', Number(event.target.value))}
            />
          </label>
        </fieldset>
      )}
      {typeof onOpenReplacementsManager === 'function' && (
        <div style={{ paddingTop: '0.75rem', marginTop: '0.5rem', borderTop: '1px solid rgba(128,128,128,0.2)' }}>
          <button
            type="button"
            onClick={onOpenReplacementsManager}
            className="reader-settings-replacements-btn"
            style={{
              display: 'flex', width: '100%', justifyContent: 'space-between',
              alignItems: 'center', padding: '0.5rem 0.75rem', borderRadius: '0.375rem',
              border: '1px solid rgba(217,119,6,0.3)', cursor: 'pointer', background: 'transparent'
            }}
          >
            <span>✏️ Từ đã sửa thủ công</span>
            <span style={{ fontSize: '0.75rem', fontWeight: 'bold', padding: '0.125rem 0.5rem', borderRadius: '9999px', background: 'rgba(217,119,6,0.2)' }}>
              {customReplacementsCount}
            </span>
          </button>
        </div>
      )}
    </div>
  )
}

ReaderSettingsPanel.propTypes = {
  settings: PropTypes.shape({
    fontSize: PropTypes.number.isRequired,
    fontFamily: PropTypes.string.isRequired,
    theme: PropTypes.string.isRequired,
    contentWidth: PropTypes.number.isRequired,
    lineHeight: PropTypes.number.isRequired,
    ttsVoice: PropTypes.string,
    ttsRate: PropTypes.number,
  }).isRequired,
  onChange: PropTypes.func.isRequired,
  // Danh sách SpeechSynthesisVoice — chỉ truyền từ Reader.jsx (có TTS).
  ttsVoices: PropTypes.array,
  customReplacementsCount: PropTypes.number,
  onOpenReplacementsManager: PropTypes.func,
}
