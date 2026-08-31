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
    rootEl.innerHTML = '';
    rootEl.className = 'output-root hidden';
    return;
  }
  rootEl.className = `output-root visible ${state.templateKey ?? ''}`;
  rootEl.innerHTML = `
    <div class="output-text">${escapeHtml(state.text ?? '')}</div>
    <div class="output-reference">${escapeHtml(state.reference ?? '')}</div>
  `;
}
