import { useEffect, useId, useRef } from "react";

// Selector matching the elements a focus trap should cycle through.
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Centered, accessible modal dialog.
// - Closes on backdrop click or Escape.
// - Traps focus inside the dialog (Tab / Shift-Tab cycle within), focuses the
//   first focusable element on open, and restores focus to the trigger on close.
// - Wired with aria-modal + aria-labelledby (title) for screen readers.
export default function Modal({ open, onClose, title, children, footer, labelledBy }) {
  const dialogRef = useRef(null);
  const restoreRef = useRef(null);
  const headingId = useId();
  const titleId = labelledBy || (title ? headingId : undefined);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // On open: remember the trigger, focus the first focusable element in the dialog.
  // On close/unmount: restore focus to the trigger.
  useEffect(() => {
    if (!open) return;
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Defer to after paint so the dialog content is in the DOM.
    const id = requestAnimationFrame(() => {
      const node = dialogRef.current;
      if (!node) return;
      const focusables = node.querySelectorAll(FOCUSABLE);
      const first = focusables[0];
      if (first instanceof HTMLElement) first.focus();
      else node.focus();
    });

    return () => {
      cancelAnimationFrame(id);
      const toRestore = restoreRef.current;
      if (toRestore && document.contains(toRestore)) {
        toRestore.focus();
      }
    };
  }, [open]);

  // Tab / Shift-Tab focus trap.
  function handleKeyDown(e) {
    if (e.key !== "Tab") return;
    const node = dialogRef.current;
    if (!node) return;
    const focusables = Array.from(node.querySelectorAll(FOCUSABLE)).filter(
      (el) => el instanceof HTMLElement && el.offsetParent !== null,
    );
    if (focusables.length === 0) {
      e.preventDefault();
      node.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !node.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/40 animate-modal-fade" onClick={onClose} />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto bg-white rounded-2xl shadow-xl outline-none animate-modal-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-line flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-base font-semibold text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-canvas hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 text-sm text-ink">{children}</div>

        {footer && (
          <div className="px-5 py-4 border-t border-line flex justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
