import { useEffect } from 'react';
import type { ContentType, OutputStyle } from '../../shared/types';
import StylePreview from './StylePreview';

interface Props {
  contentType: ContentType;
  style: OutputStyle;
  onClose: () => void;
}

export default function StylePreviewModal({ contentType, style, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="style-preview-modal__backdrop" onClick={onClose}>
      <div className="style-preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="style-preview-modal__header">
          <span>{style.name}</span>
          <button type="button" className="style-preview-modal__close" aria-label="Close preview" onClick={onClose}>
            ✕
          </button>
        </div>
        <StylePreview contentType={contentType} templateKey={style.templateKey} scale={1} variant="modal" />
      </div>
    </div>
  );
}
