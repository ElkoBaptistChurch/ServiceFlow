export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderState(state, rootEl) {
  // `hidden` is the operator's blank-output toggle: keep the selection, show nothing.
  if (!state || !state.contentType || state.hidden) {
    hideAndClear(rootEl);
    return;
  }
  rootEl.className = `output-root visible ${state.templateKey ?? ''}`;
  rootEl.innerHTML = `
    <div class="output-text">${escapeHtml(state.text ?? '')}</div>
    <div class="output-truncated" hidden>Text truncated</div>
    <div class="output-reference">${escapeHtml(state.reference ?? '')}</div>
  `;
}

// The fade-out is only visible if content stays on screen while opacity animates: flip
// the class first and clear the DOM once the transition actually finishes, so a hard cut
// (content vanishing in the same frame as the class change) can't happen. The timeout is
// a fallback for a transition that never fires (e.g. `prefers-reduced-motion` suppressing
// it), so content can't be stranded on screen forever.
const HIDE_TRANSITION_FALLBACK_MS = 500;

function hideAndClear(rootEl) {
  rootEl.className = 'output-root hidden';
  if (!rootEl.innerHTML) return;
  let cleared = false;
  const clear = () => {
    if (cleared) return;
    cleared = true;
    clearTimeout(timeout);
    rootEl.innerHTML = '';
  };
  const timeout = setTimeout(clear, HIDE_TRANSITION_FALLBACK_MS);
  rootEl.addEventListener('transitionend', clear, { once: true });
}
