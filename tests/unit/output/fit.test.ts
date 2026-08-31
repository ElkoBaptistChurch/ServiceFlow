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

  it('terminates with a zero step and an always-true predicate, returning the floor', () => {
    expect(fitFontSize(() => true, { max: 48, min: 24, step: 0 })).toBe(24);
  });

  it('terminates with a negative step', () => {
    expect(fitFontSize(() => true, { max: 48, min: 24, step: -2 })).toBe(24);
  });

  it('keeps the result within the effective range when min > max', () => {
    const result = fitFontSize(() => true, { max: 24, min: 48, step: 2 });
    expect(result).toBeGreaterThanOrEqual(24);
    expect(result).toBeLessThanOrEqual(48);
  });
});
