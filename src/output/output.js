import { renderState } from './render.js';
import { fitFontSize } from './fit.js';

const root = document.getElementById('output-root');
const connectionIndicator = document.getElementById('connection-indicator');
// Leave the top ~45% of the frame clear: this is a lower third, not a full-screen slide.
const MAX_HEIGHT_RATIO = 0.55;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

let lastState = null;
let resizeTimer = null;
let reconnectAttempts = 0;

function heightBudget() {
  // Anchor the budget to the box's actual bottom offset (`bottom: 0` for the default
  // presets, `bottom: 15%` for the centered ones) rather than a fixed share of the
  // window, so the "top ~45% stays clear" invariant holds for every preset, not just the
  // ones anchored flush to the bottom of the frame.
  const boxBottom = root.getBoundingClientRect().bottom;
  const topClearance = window.innerHeight * (1 - MAX_HEIGHT_RATIO);
  return Math.max(Math.round(boxBottom - topClearance), 0);
}

function render(state) {
  lastState = state ?? lastState;
  renderState(lastState, root);
  const textEl = root.querySelector('.output-text');
  if (!textEl) return;
  const referenceEl = root.querySelector('.output-reference');
  const truncatedEl = root.querySelector('.output-truncated');

  // Read the preset's own design size before touching the inline style, and fit down
  // from *that* (with a proportional floor) instead of a fixed 48/24 -- otherwise every
  // preset renders at the same size and only the border/background differ.
  const presetSize = parseFloat(getComputedStyle(textEl).fontSize) || 48;
  const min = Math.round(presetSize / 2);
  const budget = heightBudget() - (referenceEl ? referenceEl.scrollHeight : 0);

  const size = fitFontSize((candidate) => {
    textEl.style.fontSize = `${candidate}px`;
    return textEl.scrollHeight > budget;
  }, { max: presetSize, min, step: 2 });
  textEl.style.fontSize = `${size}px`;

  // Cap the text box's own height to the budget (rather than the whole frame's) so an
  // unfittable verse clips inside the text box and never pushes the reference out of
  // frame. Surface a visible signal whenever fitting bottoms out and it still overflows,
  // instead of clipping silently.
  const stillOverflows = textEl.scrollHeight > budget;
  textEl.style.maxHeight = `${Math.max(budget, 0)}px`;
  if (truncatedEl) truncatedEl.hidden = !stillOverflows;
}

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${protocol}://${location.host}/ws`);
  socket.addEventListener('open', () => {
    reconnectAttempts = 0;
    if (connectionIndicator) connectionIndicator.hidden = true;
  });
  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return; // A malformed frame from a bad peer/proxy should be ignored, not crash the page.
    }
    if (message.type === 'live_update') render(message.payload);
  });
  socket.addEventListener('close', () => {
    if (connectionIndicator) connectionIndicator.hidden = false;
    scheduleReconnect();
  });
  socket.addEventListener('error', () => socket.close());
}

function scheduleReconnect() {
  // Exponential backoff with jitter, capped, so a server that's down for a while doesn't
  // get hammered with one connection attempt per second forever.
  const backoff = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, RECONNECT_MAX_MS);
  reconnectAttempts += 1;
  const jitter = backoff * 0.2 * Math.random();
  setTimeout(connect, backoff + jitter);
}

// No load-time fetch('/api/state') here: the server already pushes the current state
// synchronously inside its WebSocket 'connection' handler (see server.ts), which is what
// makes OBS self-heal on reconnect. A separate fetch raced that push -- render() assigns
// unconditionally, so a slow fetch resolving AFTER a live_update could revert the output
// to older content, and it would not self-heal again until the next change.

// A Browser Source can be resized after the fact; re-fit rather than overflow. Debounced
// so dragging the source in OBS doesn't restart the fit loop (and visibly jump font
// sizes) on every one of the dozens of resize events a drag fires.
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => render(null), 100);
});

connect();
