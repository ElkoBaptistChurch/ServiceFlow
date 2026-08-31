/**
 * Largest font size (px) at which `overflows(size)` is false, stepping down from max.
 * Kept free of DOM access so it can be unit-tested; output.js supplies the real measure.
 */
export function fitFontSize(overflows, { max = 48, min = 24, step = 2 } = {}) {
  // Guard against inputs that would otherwise loop forever or return an out-of-range
  // size: a non-positive step can never make progress toward `min`, and `min > max`
  // (a misconfigured range) must not let the initial `size = max` escape unclamped.
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const safeStep = step > 0 ? step : 1;
  let size = hi;
  while (size > lo && overflows(size)) size -= safeStep;
  return Math.min(Math.max(size, lo), hi);
}
