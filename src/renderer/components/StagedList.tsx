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

function move(items: StagedItem[], index: number, offset: number): number[] {
  const target = index + offset;
  const reordered = items.slice();
  const [moved] = reordered.splice(index, 1);
  reordered.splice(target, 0, moved);
  return reordered.map((item) => item.id);
}

export default function StagedList({ items, activeItemId, liveStagedItemId, onSelectActive, onChanged }: Props) {
  return (
    <ul>
      {items.map((item, index) => (
        <li key={item.id}>
          {/* The 1-9 hotkeys map to position, so the mapping needs to be on screen. */}
          {index < 9 && <span>{index + 1}</span>}
          <button
            aria-pressed={item.id === activeItemId}
            data-live={item.id === liveStagedItemId ? 'true' : undefined}
            onClick={() => onSelectActive(item)}
          >
            {item.label}
          </button>
          <button
            aria-label={`Move ${item.label} up`}
            disabled={index === 0}
            onClick={() => window.api.reorderStagedItems(move(items, index, -1)).then(onChanged)}
          >
            Up
          </button>
          <button
            aria-label={`Move ${item.label} down`}
            disabled={index === items.length - 1}
            onClick={() => window.api.reorderStagedItems(move(items, index, 1)).then(onChanged)}
          >
            Down
          </button>
          <button
            aria-label={`Remove ${item.label}`}
            onClick={() => window.api.unstageItem(item.id).then(onChanged)}
          >
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}
