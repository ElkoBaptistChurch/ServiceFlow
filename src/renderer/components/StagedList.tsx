import { useEffect, useRef } from 'react';
import type { LiveState, StagedItem } from '../../shared/types';

interface Props {
  items: StagedItem[];
  liveState: LiveState;
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

export default function StagedList({ items, liveState, onSelectActive, onChanged }: Props) {
  const liveRef = useRef<HTMLLIElement>(null);

  // The sidebar scrolls past 10 items, but the live card must always stay in view --
  // an operator scrolled away from it should never lose sight of what is on the stream.
  useEffect(() => {
    liveRef.current?.scrollIntoView({ block: 'nearest' });
  }, [liveState.stagedItemId]);

  return (
    <ul className="staged-list">
      {items.map((item, index) => {
        const isLive = liveState.stagedItemId === item.id;
        return (
          <li
            key={item.id}
            ref={isLive ? liveRef : undefined}
            className={`staged-card ${isLive ? 'staged-card--live' : ''}`}
          >
            <button className="staged-card__main" onClick={() => onSelectActive(item)}>
              <span className="staged-card__badge">{badgeFor(index)}</span>
              <span className="staged-card__body">
                <span className="staged-card__title">{item.label}</span>
              </span>
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
