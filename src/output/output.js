import { renderState } from './render.js';
import { fitFontSize } from './fit.js';

const root = document.getElementById('output-root');
// Leave the top ~45% of the frame clear: this is a lower third, not a full-screen slide.
const MAX_HEIGHT_RATIO = 0.55;

let lastState = null;

function render(state) {
  lastState = state ?? lastState;
  renderState(lastState, root);
  const textEl = root.querySelector('.output-text');
  if (!textEl) return;
  const maxHeight = window.innerHeight * MAX_HEIGHT_RATIO;
  const size = fitFontSize((candidate) => {
    textEl.style.fontSize = `${candidate}px`;
    return root.scrollHeight > maxHeight;
  });
  textEl.style.fontSize = `${size}px`;
}

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${protocol}://${location.host}/ws`);
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'live_update') render(message.payload);
  });
  socket.addEventListener('close', () => setTimeout(connect, 1000));
  socket.addEventListener('error', () => socket.close());
}

fetch('/api/state')
  .then((res) => res.json())
  .then(render)
  .catch(() => {});

// A Browser Source can be resized after the fact; re-fit rather than overflow.
window.addEventListener('resize', () => render(null));

connect();
