import type { StagedItem } from '../../shared/types';

interface Props {
  items: StagedItem[];
  onSelectActive: (item: StagedItem) => void;
  onChanged: () => void;
}

export default function StagedList({ items, onSelectActive, onChanged }: Props) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>
          <button onClick={() => onSelectActive(item)}>{item.label}</button>
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
