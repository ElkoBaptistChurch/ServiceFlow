import { describe, it, expect, beforeEach } from 'vitest';
import { renderState } from '../../../src/output/render.js';

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
