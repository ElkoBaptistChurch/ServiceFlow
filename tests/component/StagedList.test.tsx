import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StagedList from '../../src/renderer/components/StagedList';

const items = [
  { id: 1, type: 'bible' as const, refId: 7, chapter: 3, position: 0, label: 'John 3 (KJV)' },
  { id: 2, type: 'song' as const, refId: 1, chapter: null, position: 1, label: 'Amazing Grace' },
];

const EMPTY_LIVE = {
  stagedItemId: null,
  verseOrBlockId: null,
  styleId: null,
  hidden: false,
  updatedAt: '',
  reference: null,
};

beforeEach(() => {
  (window as any).api = {
    unstageItem: vi.fn().mockResolvedValue(undefined),
    reorderStagedItems: vi.fn().mockResolvedValue(undefined),
  };
});

describe('StagedList', () => {
  it('renders every staged item label', () => {
    render(<StagedList items={items} liveState={EMPTY_LIVE} onSelectActive={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getByText('John 3 (KJV)')).toBeInTheDocument();
    expect(screen.getByText('Amazing Grace')).toBeInTheDocument();
  });

  it('calls onSelectActive when an item is clicked', () => {
    const onSelectActive = vi.fn();
    render(<StagedList items={items} liveState={EMPTY_LIVE} onSelectActive={onSelectActive} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByText('John 3 (KJV)'));
    expect(onSelectActive).toHaveBeenCalledWith(items[0]);
  });

  it('unstages an item when its remove button is clicked', async () => {
    const onChanged = vi.fn();
    render(<StagedList items={items} liveState={EMPTY_LIVE} onSelectActive={vi.fn()} onChanged={onChanged} />);
    fireEvent.click(screen.getAllByRole('button', { name: /remove/i })[0]);
    await waitFor(() => expect(window.api.unstageItem).toHaveBeenCalledWith(1));
    expect(onChanged).toHaveBeenCalled();
  });

  // The live card is marked with a LIVE tag instead of a remove button (IMPLEMENTATION.md:
  // the live card must not change height, and it must stay identifiable at a glance).
  it('marks the live item with a LIVE tag instead of a remove button', () => {
    const liveOnFirst = { ...EMPTY_LIVE, stagedItemId: 1, reference: 'John 3 (KJV)' };
    render(<StagedList items={items} liveState={liveOnFirst} onSelectActive={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove john 3/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove amazing grace/i })).toBeInTheDocument();
  });
});
