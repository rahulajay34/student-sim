import { memo, useEffect, useRef, useState, useCallback } from "react";

// ── Chevron icons ─────────────────────────────────────────────────────────────
function ChevronOpen() {
  // Points right → meaning "collapse" (close) when sidebar is open
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
      <polyline points="9,18 15,12 9,6" />
      <polyline points="15,18 21,12 15,6" />
    </svg>
  );
}

function ChevronClose() {
  // Points left → meaning "open" when sidebar is collapsed
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
      <polyline points="15,18 9,12 15,6" />
      <polyline points="9,18 3,12 9,6" />
    </svg>
  );
}

// ── Typing indicator (3 bouncing dots) ────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "10px 14px",
        background: "#1d2740",
        border: "1px solid #3730a3",
        borderRadius: "1rem 1rem 1rem 0.25rem",
      }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{
            width: 6, height: 6, borderRadius: "50%",
            background: "#8b90a8", display: "inline-block",
            animation: `orb-pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>
    </div>
  );
}

// ── Message bubble ─────────────────────────────────────────────────────────────
// Memoized so a per-token re-render of the in-flight streaming bubble doesn't
// re-render every settled bubble in the transcript. Each bubble is keyed by its
// stable message id; only the bubble whose `text` is mutating actually re-renders.
const Bubble = memo(function Bubble({ message }) {
  if (message.role === "system") {
    return (
      <div style={{ display: "flex", justifyContent: "center" }}>
        <span style={{
          borderRadius: 9999, padding: "3px 12px", fontSize: "0.75rem", fontWeight: 500,
          background: "#2d1212", color: "#fca5a5", border: "1px solid #7f1d1d",
        }}>
          {message.text}
        </span>
      </div>
    );
  }

  const isCounsellor = message.role === "counsellor";
  return (
    <div style={{ display: "flex", justifyContent: isCounsellor ? "flex-end" : "flex-start" }}>
      <div style={{
        maxWidth: "85%",
        whiteSpace: "pre-wrap",
        padding: "10px 14px",
        fontSize: "0.875rem",
        lineHeight: 1.55,
        ...(isCounsellor
          ? { background: "#16281f", color: "#c9e8d4", borderRadius: "1rem 1rem 0.25rem 1rem" }
          : { background: "#1d2740", color: "#cdd6f4", border: "1px solid #3730a3", borderRadius: "1rem 1rem 1rem 0.25rem" }
        ),
      }}>
        {message.text}
      </div>
    </div>
  );
});

// ── Streaming bubble (isolated per-token render) ──────────────────────────────
// Renders the in-flight student reply while it streams. It owns its own text
// state and registers its setter on the `sinkRef` the parent holds, so per-token
// updates re-render ONLY this component — never the transcript list, CallStage, or
// the orb. The parent commits the canonical reply to `messages` on `done` and
// clears this via sink(""), at which point it renders nothing.
function StreamingBubble({ sinkRef, onGrow }) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (sinkRef) sinkRef.current = setText;
    return () => { if (sinkRef && sinkRef.current === setText) sinkRef.current = null; };
  }, [sinkRef]);
  // Follow the growing reply to the bottom of the scroll area each token.
  useEffect(() => { if (text) onGrow?.(); }, [text, onGrow]);
  if (!text) return null;
  return (
    <div style={{ display: "flex", justifyContent: "flex-start" }}>
      <div style={{
        maxWidth: "85%",
        whiteSpace: "pre-wrap",
        padding: "10px 14px",
        fontSize: "0.875rem",
        lineHeight: 1.55,
        background: "#1d2740",
        color: "#cdd6f4",
        border: "1px solid #3730a3",
        borderRadius: "1rem 1rem 1rem 0.25rem",
      }}>
        {text}
      </div>
    </div>
  );
}

// ── Send icon ─────────────────────────────────────────────────────────────────
function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

// ── Transcript panel ───────────────────────────────────────────────────────────
// `allowInput` controls whether the typed textarea is rendered. Voice sessions
// set this to false (transcript-only); text sessions set it to true.
function TranscriptTab({ messages, awaitingReply, onSend, registerStreamSink, inputRef, allowInput }) {
  const scrollRef = useRef(null);
  const userScrolledRef = useRef(false);
  const [inputVal, setInputVal] = useState("");

  // Auto-scroll: respect manual scroll-up > 80px from bottom.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledRef.current = distFromBottom > 80;
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el || userScrolledRef.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, awaitingReply, scrollToBottom]);

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  }

  function doSend() {
    const text = inputVal.trim();
    if (!text || awaitingReply) return;
    onSend(text);
    setInputVal("");
  }

  return (
    <>
      {/* Messages scroll area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: "auto", padding: "14px 14px 8px" }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {messages.length === 0 && (
            <p style={{ textAlign: "center", fontSize: "0.8125rem", color: "#8b90a8", marginTop: 24 }}>
              No messages yet — start the conversation.
            </p>
          )}
          {messages.map((m) => <Bubble key={m.id} message={m} />)}
          {registerStreamSink && <StreamingBubble sinkRef={registerStreamSink} onGrow={scrollToBottom} />}
          {awaitingReply && <TypingIndicator />}
        </div>
      </div>

      {/* Text input — only in text mode (allowInput=true); voice mode is transcript-only */}
      {allowInput && (
        <div style={{ borderTop: "1px solid #262a36", padding: 10, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <textarea
              ref={inputRef}
              rows={2}
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message… (Enter to send)"
              disabled={awaitingReply}
              style={{
                flex: 1, resize: "none", borderRadius: 12,
                padding: "8px 12px", fontSize: "0.875rem",
                background: "#0f1117", border: "1px solid #262a36",
                color: "#e7e9f4", outline: "none",
                maxHeight: 120, lineHeight: 1.5,
                opacity: awaitingReply ? 0.6 : 1,
                fontFamily: "inherit",
              }}
            />
            <button
              type="button"
              onClick={doSend}
              disabled={awaitingReply || !inputVal.trim()}
              style={{
                width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                background: "#4f46e5", border: "none", color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer",
                opacity: awaitingReply || !inputVal.trim() ? 0.4 : 1,
                transition: "opacity 150ms",
              }}
            >
              <SendIcon />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── CallSidebar ───────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
export default function CallSidebar({
  open,
  onToggle,
  messages,
  awaitingReply,
  onSend,
  allowInput,
  registerStreamSink,
  inputRef: externalInputRef,
}) {
  const internalInputRef = useRef(null);
  const inputRef = externalInputRef || internalInputRef;

  // Focus textarea when opening (text mode only).
  useEffect(() => {
    if (open && allowInput) {
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open, allowInput]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      style={{
        position: "relative",
        flexShrink: 0,
        display: "flex",
        flexDirection: "row",
      }}
    >
      {/* Collapse / expand handle — always visible, sits on the left edge of the sidebar */}
      <button
        type="button"
        title={open ? "Collapse sidebar" : "Expand sidebar"}
        onClick={onToggle}
        style={{
          position: "absolute",
          left: -18,
          top: "50%",
          transform: "translateY(-50%)",
          zIndex: 10,
          width: 18,
          height: 56,
          background: "rgba(22,26,38,0.92)",
          border: "1px solid #262a36",
          borderRight: "none",
          borderRadius: "6px 0 0 6px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: "#8b90a8",
          flexShrink: 0,
        }}
      >
        {open ? <ChevronOpen /> : <ChevronClose />}
      </button>

      {/* Sidebar panel with width animation */}
      <div
        style={{
          width: open ? 380 : 0,
          transition: "width 300ms cubic-bezier(0.4, 0, 0.2, 1)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background: "rgba(22,26,38,0.80)",
          backdropFilter: "blur(12px)",
          borderLeft: "1px solid #262a36",
          height: "100vh",
        }}
      >
        {/* Inner content: fixed width so it doesn't shrink during animation */}
        <div style={{
          width: 380,
          display: "flex",
          flexDirection: "column",
          height: "100%",
        }}>
          {/* Header */}
          <div style={{
            display: "flex",
            alignItems: "center",
            padding: "10px 14px",
            borderBottom: "1px solid #262a36",
            flexShrink: 0,
          }}>
            <span style={{
              fontSize: "0.875rem",
              fontWeight: 600,
              color: "#e7e9f4",
            }}>
              Transcript
            </span>
          </div>

          {/* Transcript panel */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <TranscriptTab
              messages={messages}
              awaitingReply={awaitingReply}
              onSend={onSend}
              allowInput={allowInput}
              registerStreamSink={registerStreamSink}
              inputRef={inputRef}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
