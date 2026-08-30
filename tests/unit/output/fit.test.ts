import { describe, it, expect } from 'vitest';
import { fitFontSize } from '../../../src/output/fit.js';

describe('fitFontSize', () => {
  it('keeps the maximum size when the text already fits', () => {
    expect(fitFontSize(() => false, { max: 48, min: 24, step: 2 })).toBe(48);
  });

  it('shrinks until the text fits', () => {
    expect(fitFontSize((size) => size > 34, { max: 48, min: 24, step: 2 })).toBe(34);
  });

  it('never goes below the readable floor', () => {
    expect(fitFontSize(() => true, { max: 48, min: 24, step: 2 })).toBe(24);
  });
});
