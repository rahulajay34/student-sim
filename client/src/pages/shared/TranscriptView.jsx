// Presentational chat-transcript renderer.
// Props: transcript = [{ role:'counsellor'|'student', text, phase, scoreAfter, ts }]
// Student bubbles sit on the LEFT, counsellor bubbles on the RIGHT, each
// capped at 78% width with a tiny role label above. Empty -> muted notice.

function formatTime(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function Bubble({ turn }) {
  const isCounsellor = turn.role === "counsellor";
  const time = formatTime(turn.ts);

  return (
    <div className={`flex flex-col ${isCounsellor ? "items-end" : "items-start"}`}>
      <div className="mb-1 flex items-center gap-2 px-1 text-xs text-muted">
        <span className="font-medium">{isCounsellor ? "Counsellor" : "Student"}</span>
        {time && <span className="text-muted/70">{time}</span>}
      </div>

      <div
        className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
          isCounsellor
            ? "rounded-br-md bg-brand-600 text-white"
            : "rounded-bl-md bg-canvas text-ink"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{turn.text}</p>
      </div>
    </div>
  );
}

export default function TranscriptView({ transcript = [] }) {
  if (!transcript || transcript.length === 0) {
    return (
      <div className="flex items-center justify-center py-10 text-sm text-muted">
        No transcript
      </div>
    );
  }

  return (
    <div className="max-h-[480px] space-y-4 overflow-y-auto pr-1">
      {transcript.map((turn, i) => (
        <Bubble key={turn.ts ? `${turn.ts}-${i}` : i} turn={turn} />
      ))}
    </div>
  );
}
