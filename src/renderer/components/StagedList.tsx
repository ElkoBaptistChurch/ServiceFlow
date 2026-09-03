import { useEffect, useRef, useState } from 'react';
import type { StagedItem } from '../../shared/types';

interface Props {
  items: StagedItem[];
  /** The item the operator is currently browsing in the content pane, if any. */
  activeItemId: number | null;
  /** liveState.stagedItemId — which item (if any) is actually on the stream. */
  liveStagedItemId: number | null;
  onSelectActive: (item: StagedItem) => void;
  onChanged: () => void;
}

function reorder(items: StagedItem[], fromIndex: number, toIndex: number): number[] {
  const reordered = items.slice();
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  return reordered.map((item) => item.id);
}

export default function StagedList({ items, activeItemId, liveStagedItemId, onSelectActive, onChanged }: Props) {
  const liveRef = useRef<HTMLLIElement>(null);
  // Index currently being dragged, so the drop target can be styled and the drop handler
  // knows which item to move without threading it through a DataTransfer round-trip.
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // The sidebar scrolls past 10 items, but the live card must always stay in view --
  // an operator scrolled away from it should never lose sight of what is on the stream.
  useEffect(() => {
    liveRef.current?.scrollIntoView({ block: 'nearest' });
  }, [liveStagedItemId]);

  function handleDrop(targetIndex: number) {
    if (draggedIndex !== null && draggedIndex !== targetIndex) {
      window.api.reorderStagedItems(reorder(items, draggedIndex, targetIndex)).then(onChanged);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  }

  return (
    <ul className="staged-list">
      {items.map((item, index) => {
        const isLive = liveStagedItemId === item.id;
        const isActive = activeItemId === item.id;
        return (
          <li
            key={item.id}
            ref={isLive ? liveRef : undefined}
            className={[
              'staged-card',
              isLive ? 'staged-card--live' : '',
              isActive ? 'staged-card--browsing' : '',
              dragOverIndex === index ? 'staged-card--drag-over' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            draggable
            onDragStart={() => setDraggedIndex(index)}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverIndex(index);
            }}
            onDragLeave={() => setDragOverIndex((current) => (current === index ? null : current))}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(index);
            }}
            onDragEnd={() => {
              setDraggedIndex(null);
              setDragOverIndex(null);
            }}
          >
            <span className="staged-card__handle" aria-hidden="true">
              <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
                <circle cx="2" cy="2" r="1.5" />
                <circle cx="8" cy="2" r="1.5" />
                <circle cx="2" cy="8" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="2" cy="14" r="1.5" />
                <circle cx="8" cy="14" r="1.5" />
              </svg>
            </span>
            <button
              className="staged-card__main"
              aria-pressed={isActive}
              data-live={isLive ? 'true' : undefined}
              onClick={() => onSelectActive(item)}
            >
              <span className="staged-card__body">
                <span className="staged-card__title">{item.label}</span>
              </span>
            </button>
            {isLive && (
              <span className="staged-card__live-tag">
                <span className="dot" />
                LIVE
              </span>
            )}
            <button
              className={`staged-card__remove ${isLive ? 'staged-card__remove--live' : ''}`}
              aria-label={`Remove ${item.label}`}
              onClick={() => window.api.unstageItem(item.id).then(onChanged)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
