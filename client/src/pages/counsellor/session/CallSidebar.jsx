import { useEffect, useRef, useState, useCallback } from "react";
import CoachPanel from "./CoachPanel";
import { scoreColor, TOKEN_HEX } from "../../../lib/format";

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
function Bubble({ message }) {
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

// ── Transcript tab ─────────────────────────────────────────────────────────────
function TranscriptTab({ messages, awaitingReply, onSend, inputRef }) {
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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || userScrolledRef.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, awaitingReply]);

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
          {awaitingReply && <TypingIndicator />}
        </div>
      </div>

      {/* Text input */}
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
    </>
  );
}

// ── Foot strip (compact status line under both tabs) ──────────────────────────
function FootStrip({ satisfaction, deliveryMetrics }) {
  const satColorKey = scoreColor(satisfaction ?? 0);
  const satHex = TOKEN_HEX[satColorKey] || "#8b90a8";

  const tone = deliveryMetrics?.tone || "—";
  const pace = deliveryMetrics?.paceVerdict || "—";

  return (
    <div style={{
      borderTop: "1px solid #262a36",
      padding: "5px 14px",
      fontSize: "0.6875rem",
      color: "#8b90a8",
      flexShrink: 0,
      display: "flex",
      gap: 8,
    }}>
      <span>sat <span style={{ color: satHex, fontWeight: 600 }}>{satisfaction ?? 0}</span></span>
      <span>·</span>
      <span>tone <span style={{ color: "#c7d2fe" }}>{tone}</span></span>
      <span>·</span>
      <span>pace <span style={{ color: "#c7d2fe" }}>{pace}</span></span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── CallSidebar ───────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
export default function CallSidebar({
  open,
  onToggle,
  tab,
  onTab,
  messages,
  awaitingReply,
  onSend,
  satisfaction,
  scoreHistory,
  deliveryMetrics,
  milestones,
  emotion,
  inputRef: externalInputRef,
}) {
  const internalInputRef = useRef(null);
  const inputRef = externalInputRef || internalInputRef;

  // Focus textarea when switching to transcript tab or opening.
  useEffect(() => {
    if (open && tab === "transcript") {
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open, tab]); // eslint-disable-line react-hooks/exhaustive-deps

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
          {/* Header: tabs + collapse hint */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "10px 14px",
            borderBottom: "1px solid #262a36",
            flexShrink: 0,
          }}>
            <button
              type="button"
              onClick={() => onTab("transcript")}
              style={{
                padding: "4px 12px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontSize: "0.875rem",
                fontWeight: tab === "transcript" ? 600 : 400,
                background: tab === "transcript" ? "rgba(38,42,54,0.6)" : "transparent",
                color: tab === "transcript" ? "#e7e9f4" : "#8b90a8",
                transition: "all 150ms",
              }}
            >
              Transcript
            </button>
            <button
              type="button"
              onClick={() => onTab("coach")}
              style={{
                padding: "4px 12px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontSize: "0.875rem",
                fontWeight: tab === "coach" ? 600 : 400,
                background: tab === "coach" ? "rgba(38,42,54,0.6)" : "transparent",
                color: tab === "coach" ? "#e7e9f4" : "#8b90a8",
                transition: "all 150ms",
              }}
            >
              Coach
            </button>
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {tab === "transcript" ? (
              <TranscriptTab
                messages={messages}
                awaitingReply={awaitingReply}
                onSend={onSend}
                inputRef={inputRef}
              />
            ) : (
              <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                <div style={{ flex: 1, overflowY: "auto" }}>
                  <CoachPanel
                    satisfaction={satisfaction}
                    scoreHistory={scoreHistory}
                    deliveryMetrics={deliveryMetrics}
                    milestones={milestones}
                    emotion={emotion}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Foot strip */}
          <FootStrip satisfaction={satisfaction} deliveryMetrics={deliveryMetrics} />
        </div>
      </div>
    </div>
  );
}
