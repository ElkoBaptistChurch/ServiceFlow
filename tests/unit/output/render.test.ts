import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderState } from '../../../src/output/render.js';

const outputCssPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../src/output/output.css'
);

describe('renderState', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
  });

  it('renders nothing and hides the root when contentType is null', () => {
    renderState({ contentType: null, text: null, reference: null, styleId: null, templateKey: null, hidden: false }, root);
    expect(root.innerHTML).toBe('');
    expect(root.className).toContain('hidden');
  });

  it('renders nothing when the operator has blanked the output', () => {
    renderState(
      {
        contentType: 'bible',
        text: 'For God so loved the world.',
        reference: 'John 3:16',
        styleId: 1,
        templateKey: 'bible-classic',
        hidden: true,
      },
      root
    );
    expect(root.innerHTML).toBe('');
    expect(root.className).toContain('hidden');
  });

  it('renders verse text and reference for a bible payload', () => {
    renderState(
      { contentType: 'bible', text: 'For God so loved the world.', reference: 'John 3:16', styleId: 1, templateKey: 'bible-classic', hidden: false },
      root
    );
    expect(root.querySelector('.output-text')?.textContent).toBe('For God so loved the world.');
    expect(root.querySelector('.output-reference')?.textContent).toBe('John 3:16');
    expect(root.className).toContain('bible-classic');
    expect(root.className).toContain('visible');
  });

  it('escapes HTML in the verse text to prevent injection', () => {
    renderState(
      { contentType: 'song', text: '<script>alert(1)</script>', reference: 'Test', styleId: 1, templateKey: 'song-classic', hidden: false },
      root
    );
    expect(root.innerHTML).not.toContain('<script>');
    expect(root.querySelector('.output-text')?.textContent).toBe('<script>alert(1)</script>');
  });
});

describe('renderState (O-01/O-05: output.css text wrapping)', () => {
  let style: HTMLStyleElement;
  let root: HTMLElement;

  beforeEach(() => {
    style = document.createElement('style');
    style.textContent = readFileSync(outputCssPath, 'utf8');
    document.head.appendChild(style);
    root = document.createElement('div');
    root.className = 'output-root';
    document.body.appendChild(root);
  });

  afterEach(() => {
    document.head.removeChild(style);
    document.body.removeChild(root);
  });

  it('preserves line breaks in lyric text', () => {
    renderState(
      {
        contentType: 'song',
        text: 'Amazing grace how sweet the sound\nThat saved a wretch like me',
        reference: '',
        styleId: 1,
        templateKey: 'song-classic',
        hidden: false,
      },
      root
    );
    const textEl = root.querySelector('.output-text') as HTMLElement;
    expect(textEl.textContent).toBe('Amazing grace how sweet the sound\nThat saved a wretch like me');
    expect(getComputedStyle(textEl).whiteSpace).toBe('pre-line');
  });

  it('wraps a token wider than the box instead of clipping it', () => {
    renderState(
      { contentType: 'song', text: 'x', reference: '', styleId: 1, templateKey: 'song-classic', hidden: false },
      root
    );
    const textEl = root.querySelector('.output-text') as HTMLElement;
    expect(getComputedStyle(textEl).overflowWrap).toBe('break-word');
  });
});

describe('renderState (O-03: hiding fades before it clears)', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
    renderState(
      { contentType: 'bible', text: 'For God so loved the world.', reference: 'John 3:16', styleId: 1, templateKey: 'bible-classic', hidden: false },
      root
    );
    expect(root.innerHTML).not.toBe('');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps content in the DOM until the hide transition completes', () => {
    renderState({ contentType: 'bible', text: null, reference: null, styleId: null, templateKey: null, hidden: true }, root);

    // The hard-cut bug was clearing innerHTML in the same synchronous call that flips
    // the class -- there would be nothing left for the opacity transition to fade out.
    expect(root.className).toContain('hidden');
    expect(root.innerHTML).not.toBe('');

    root.dispatchEvent(new Event('transitionend'));
    expect(root.innerHTML).toBe('');
  });

  it('clears content via the fallback timeout if transitionend never fires', () => {
    vi.useFakeTimers();
    renderState({ contentType: 'bible', text: null, reference: null, styleId: null, templateKey: null, hidden: true }, root);
    expect(root.innerHTML).not.toBe('');

    vi.advanceTimersByTime(500);
    expect(root.innerHTML).toBe('');
  });
});
