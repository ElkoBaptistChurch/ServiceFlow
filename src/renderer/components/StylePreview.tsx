import type { ContentType } from '../../shared/types';

// Keep in sync with src/output/output.css — this reproduces the same template
// presets at a smaller, non-fixed-position scale for the settings screen preview.
const SAMPLE_TEXT: Record<ContentType, { text: string; reference: string }> = {
  bible: {
    text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
    reference: 'John 3:16',
  },
  song: {
    text: 'Amazing grace, how sweet the sound\nThat saved a wretch like me',
    reference: 'Amazing Grace',
  },
};

interface Props {
  contentType: ContentType;
  templateKey: string;
  scale: number;
  variant: 'card' | 'modal';
}

export default function StylePreview({ contentType, templateKey, scale, variant }: Props) {
  const sample = SAMPLE_TEXT[contentType];
  return (
    <div className={`style-preview style-preview--${variant}`}>
      <div className={`style-preview__stage ${templateKey}`} style={{ transform: `scale(${scale})` }}>
        <div className="style-preview__text">{sample.text}</div>
        <div className="style-preview__reference">{sample.reference}</div>
      </div>
    </div>
  );
}
