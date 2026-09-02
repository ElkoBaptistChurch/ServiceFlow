import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StagedList from '../../src/renderer/components/StagedList';

const items = [
  { id: 1, type: 'bible' as const, refId: 7, chapter: 3, position: 0, label: 'John 3 (KJV)' },
  { id: 2, type: 'song' as const, refId: 1, chapter: null, position: 1, label: 'Amazing Grace' },
];

beforeEach(() => {
  (window as any).api = {
    unstageItem: vi.fn().mockResolvedValue(undefined),
    reorderStagedItems: vi.fn().mockResolvedValue(undefined),
  };
});

describe('StagedList', () => {
  it('renders every staged item label', () => {
    render(<StagedList items={items} activeItemId={null} liveStagedItemId={null} onSelectActive={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getByText('John 3 (KJV)')).toBeInTheDocument();
    expect(screen.getByText('Amazing Grace')).toBeInTheDocument();
  });

  it('calls onSelectActive when an item is clicked', () => {
    const onSelectActive = vi.fn();
    render(<StagedList items={items} activeItemId={null} liveStagedItemId={null} onSelectActive={onSelectActive} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByText('John 3 (KJV)'));
    expect(onSelectActive).toHaveBeenCalledWith(items[0]);
  });

  it('unstages an item when its remove button is clicked', async () => {
    const onChanged = vi.fn();
    render(<StagedList items={items} activeItemId={null} liveStagedItemId={null} onSelectActive={vi.fn()} onChanged={onChanged} />);
    fireEvent.click(screen.getAllByRole('button', { name: /remove/i })[0]);
    await waitFor(() => expect(window.api.unstageItem).toHaveBeenCalledWith(1));
    expect(onChanged).toHaveBeenCalled();
  });

  // The live card is marked with a LIVE tag instead of a remove button (IMPLEMENTATION.md:
  // the live card must not change height, and it must stay identifiable at a glance).
  it('marks the live item with a LIVE tag instead of a remove button', () => {
    render(<StagedList items={items} activeItemId={null} liveStagedItemId={1} onSelectActive={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove john 3/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove amazing grace/i })).toBeInTheDocument();
  });

  // R-02: the operator must be able to see which item they're browsing, not just which
  // one is live -- today nothing lights up until a verse actually goes live.
  it('marks the active item as pressed', () => {
    render(
      <StagedList items={items} activeItemId={1} liveStagedItemId={null} onSelectActive={vi.fn()} onChanged={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: 'John 3 (KJV)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Amazing Grace' })).toHaveAttribute('aria-pressed', 'false');
  });

  // R-07: reorderStagedItems is fully wired end to end but nothing ever called it -- the
  // operator had no way to control the running order.
  it('reorders items via drag-and-drop and calls reorderStagedItems with the new order', async () => {
    render(
      <StagedList items={items} activeItemId={null} liveStagedItemId={null} onSelectActive={vi.fn()} onChanged={vi.fn()} />
    );
    const cards = screen.getAllByRole('listitem');
    fireEvent.dragStart(cards[1]);
    fireEvent.dragOver(cards[0]);
    fireEvent.drop(cards[0]);
    await waitFor(() => expect(window.api.reorderStagedItems).toHaveBeenCalledWith([2, 1]));
  });
});
