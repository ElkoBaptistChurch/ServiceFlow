/**
 * The in-app confirm dialog (d0290db), shared by the library panels. Never
 * window.confirm(): a native dialog leaves the renderer without keyboard focus afterward
 * on Linux, so nothing types until an unrelated click resyncs it.
 */
export interface ConfirmState {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({ state }: { state: ConfirmState }) {
  return (
    <div className="song-library__confirm-overlay" role="presentation" onClick={state.onCancel}>
      <div
        className="song-library__confirm-box"
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <p>{state.message}</p>
        <div className="song-library__confirm-actions">
          <button type="button" className="btn-pill btn-pill--small" onClick={state.onCancel}>
            Cancel
          </button>
          <button type="button" className="btn-pill btn-pill--danger btn-pill--small" onClick={state.onConfirm}>
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
