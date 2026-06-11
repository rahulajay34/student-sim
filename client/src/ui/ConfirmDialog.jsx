import { useState } from "react";
import Modal from "./Modal";
import Button from "./Button";
import Spinner from "./Spinner";

// Confirmation dialog built on Modal. Drives an async confirm action with a
// built-in loading state, so callers don't have to thread their own spinner.
//
// Props:
//   open            — controlled visibility
//   onClose         — called on cancel / backdrop / Escape (ignored while loading)
//   onConfirm       — async fn; the dialog awaits it and closes on success
//   title           — dialog heading
//   children/body   — the explanatory copy (children preferred; `body` fallback)
//   confirmLabel    — confirm button text (default "Confirm")
//   cancelLabel     — cancel button text (default "Cancel")
//   danger          — style the confirm button as destructive (default true)
export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = "Are you sure?",
  body,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = true,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function handleClose() {
    if (loading) return;
    setError("");
    onClose?.();
  }

  async function handleConfirm() {
    setLoading(true);
    setError("");
    try {
      await onConfirm?.();
      // Parent typically closes via its own state on success; reset local flag.
      setLoading(false);
    } catch (err) {
      setError(err?.message || "Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading && <Spinner size={16} className="text-white" />}
            {loading ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-muted">
        {children || (body && <p>{body}</p>)}
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-danger"
          >
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
