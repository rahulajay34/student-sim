import { useEffect } from "react";

// Binds a single-key shortcut (default "n") that fires `onTrigger`, but ignores
// the press when the user is typing in an input/textarea/select/contentEditable
// or holding a modifier. Used on admin list pages to open the create flow.
export function useCreateShortcut(onTrigger, { key = "n", enabled = true } = {}) {
  useEffect(() => {
    if (!enabled || typeof onTrigger !== "function") return;
    const handler = (e) => {
      // shiftKey: Shift+N is not the shortcut. isComposing: IME composition
      // keydowns must never trigger navigation.
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.isComposing) return;
      if (e.key.toLowerCase() !== key.toLowerCase()) return;
      const el = document.activeElement;
      const tag = el?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      onTrigger();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onTrigger, key, enabled]);
}
