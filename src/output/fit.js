/**
 * Largest font size (px) at which `overflows(size)` is false, stepping down from max.
 * Kept free of DOM access so it can be unit-tested; output.js supplies the real measure.
 */
export function fitFontSize(overflows, { max = 48, min = 24, step = 2 } = {}) {
  let size = max;
  while (size > min && overflows(size)) size -= step;
  return Math.max(size, min);
}
