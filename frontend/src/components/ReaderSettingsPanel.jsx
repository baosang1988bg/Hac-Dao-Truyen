import PropTypes from 'prop-types'
import { THEMES } from '../hooks/useReaderSettings'

const FONTS = [
  ['Times New Roman, serif', 'Times New Roman'],
  ['Arial, sans-serif', 'Arial'],
  ['Georgia, serif', 'Georgia'],
  ['Palatino, serif', 'Palatino'],
  ['Inter, sans-serif', 'Inter'],
  ['serif', 'Có chân (Serif)'],
  ['sans-serif', 'Không chân (Sans)'],
]

export default function ReaderSettingsPanel({ settings, onChange }) {
  const themeId = THEMES[settings.theme] ? settings.theme : 'sepia'
  return (
    <div className="reader-settings-panel">
      <div className={`reader-settings-preview reader--${themeId}`} style={{
        fontSize: `${settings.fontSize}px`, fontFamily: settings.fontFamily, lineHeight: settings.lineHeight,
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
        ['lineHeight', 'Giãn dòng', 1, 3, 0.1, ''],
      ].map(([key, label, min, max, step, unit]) => (
        <label key={key}>
          {label}: {settings[key]}{unit}
          <input type="range" aria-label={label} min={Math.min(min, settings[key])} max={Math.max(max, settings[key])}
            step={step} value={settings[key]} onChange={event => onChange(key, Number(event.target.value))} />
        </label>
      ))}
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
  }).isRequired,
  onChange: PropTypes.func.isRequired,
}
