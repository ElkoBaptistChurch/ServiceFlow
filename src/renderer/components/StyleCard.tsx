import type { ContentType, OutputStyle } from '../../shared/types';
import StylePreview from './StylePreview';

interface Props {
  contentType: ContentType;
  style: OutputStyle;
  onSelect: (styleId: number) => void;
  onZoom: (style: OutputStyle) => void;
}

export default function StyleCard({ contentType, style, onSelect, onZoom }: Props) {
  return (
    <div
      className="style-card"
      role="button"
      tabIndex={0}
      aria-pressed={style.isActive}
      aria-label={`${contentType} ${style.name}`}
      onClick={() => onSelect(style.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(style.id);
        }
      }}
    >
      <div className="style-card__header">
        <span>{style.name}</span>
        {style.isActive && (
          <span className="style-card__check" aria-hidden="true">
            ✓
          </span>
        )}
      </div>
      <div className="style-card__preview-wrap">
        <StylePreview contentType={contentType} templateKey={style.templateKey} scale={0.4} variant="card" />
        <button
          type="button"
          className="style-card__zoom"
          aria-label={`Zoom preview of ${style.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onZoom(style);
          }}
        >
          🔍
        </button>
      </div>
    </div>
  );
}
