import { useEffect, useRef } from 'react';
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

// Item 10 is keyed '0': index 0-8 badge 1-9, index 9 badges '0'. Anything beyond that
// (11th+ staged item) has no keyboard shortcut, so it carries no badge digit.
function badgeFor(index: number): string {
  if (index < 9) return String(index + 1);
  if (index === 9) return '0';
  return '';
}

function move(items: StagedItem[], index: number, offset: number): number[] {
  const target = index + offset;
  const reordered = items.slice();
  const [moved] = reordered.splice(index, 1);
  reordered.splice(target, 0, moved);
  return reordered.map((item) => item.id);
}

export default function StagedList({ items, activeItemId, liveStagedItemId, onSelectActive, onChanged }: Props) {
  const liveRef = useRef<HTMLLIElement>(null);

  // The sidebar scrolls past 10 items, but the live card must always stay in view --
  // an operator scrolled away from it should never lose sight of what is on the stream.
  useEffect(() => {
    liveRef.current?.scrollIntoView({ block: 'nearest' });
  }, [liveStagedItemId]);

  return (
    <ul className="staged-list">
      {items.map((item, index) => {
        const isLive = liveStagedItemId === item.id;
        return (
          <li
            key={item.id}
            ref={isLive ? liveRef : undefined}
            className={`staged-card ${isLive ? 'staged-card--live' : ''}`}
          >
            <button
              className="staged-card__main"
              aria-pressed={item.id === activeItemId}
              data-live={isLive ? 'true' : undefined}
              onClick={() => onSelectActive(item)}
            >
              <span className="staged-card__badge" aria-hidden="true">{badgeFor(index)}</span>
              <span className="staged-card__body">
                <span className="staged-card__title">{item.label}</span>
              </span>
            </button>
            <button
              className="staged-card__move"
              aria-label={`Move ${item.label} up`}
              disabled={index === 0}
              onClick={() => window.api.reorderStagedItems(move(items, index, -1)).then(onChanged)}
            >
              Up
            </button>
            <button
              className="staged-card__move"
              aria-label={`Move ${item.label} down`}
              disabled={index === items.length - 1}
              onClick={() => window.api.reorderStagedItems(move(items, index, 1)).then(onChanged)}
            >
              Down
            </button>
            {isLive ? (
              <span className="staged-card__live-tag">
                <span className="dot" />
                LIVE
              </span>
            ) : (
              <button
                className="staged-card__remove"
                aria-label={`Remove ${item.label}`}
                onClick={() => window.api.unstageItem(item.id).then(onChanged)}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
