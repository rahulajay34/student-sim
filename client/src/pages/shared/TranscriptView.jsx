// Presentational chat-transcript renderer.
// Props:
//   transcript = [{ role:'counsellor'|'student', text, phase, scoreAfter, ts,
//                   turnType?, scoreReason?, emotion? }]
//   showScoreReason — when true, counsellor entries with a scoreReason get a
//     small annotation below the bubble (admin and counsellors who see the
//     report already see scoreAfter, so showing the reason is consistent).
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

// scoreAfter: 0–100 → compact colored dot for counsellor bubbles.
function ScoreDot({ score }) {
  if (score == null || isNaN(score)) return null;
  const color =
    score >= 70 ? "#10b981" : score >= 50 ? "#f59e0b" : "#f43f5e";
  return (
    <span
      title={`Satisfaction after this turn: ${score}`}
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}

function TurnTypeBadge({ type }) {
  if (!type) return null;
  const colors = {
    question: "bg-brand-50 text-brand-700",
    invite: "bg-success-soft text-success",
    statement: "bg-canvas text-muted",
  };
  return (
    <span
      className={`rounded-full px-1.5 py-px text-xs font-medium italic ${colors[type] || colors.statement}`}
    >
      {type}
    </span>
  );
}

function Bubble({ turn, showScoreReason, showOriginal }) {
  const isCounsellor = turn.role === "counsellor";
  const time = formatTime(turn.ts);
  const emotion =
    !isCounsellor && turn.emotion && turn.emotion !== "neutral"
      ? turn.emotion
      : null;
  const scoreReason =
    isCounsellor && showScoreReason && turn.scoreReason
      ? turn.scoreReason
      : null;
  const turnType = isCounsellor ? turn.turnType : null;
  const scoreAfter = isCounsellor ? turn.scoreAfter : null;
  // Turns captured in a non-Latin script carry a Latin-script latinText (set at
  // report time). Show the converted text by default; "show original" (admin
  // toggle) flips back to the raw captured turn.text.
  const converted = !showOriginal && turn.latinText ? turn.latinText : (turn.text || "");
  // Strip old inline [emotion:X] artifacts embedded in the text by pre-split
  // sessions (modern sessions carry emotion in turn.emotion, shown as a chip).
  const displayText = converted.replace(/\[emotion:[^\]]*\]/gi, "").trim();

  return (
    <div className={`flex flex-col ${isCounsellor ? "items-end" : "items-start"}`}>
      <div className="mb-1 flex flex-wrap items-center gap-2 px-1 text-xs text-muted">
        <span className="font-medium">{isCounsellor ? "Counsellor" : "Student"}</span>
        {emotion && (
          <span className="rounded-full bg-canvas px-1.5 py-px text-xs text-muted/70 italic">
            {emotion}
          </span>
        )}
        {turnType && <TurnTypeBadge type={turnType} />}
        {scoreAfter != null && (
          <span className="flex items-center gap-1">
            <ScoreDot score={scoreAfter} />
            <span className="text-muted/70">{scoreAfter}</span>
          </span>
        )}
        {time && <span className="text-muted/70">{time}</span>}
      </div>

      <div
        className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
          isCounsellor
            ? "rounded-br-md bg-brand-600 text-white"
            : "rounded-bl-md bg-canvas text-ink"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{displayText}</p>
      </div>

      {/* Score reason annotation — counsellor turns only, shown when prop is set */}
      {scoreReason && (
        <div className="mt-1 max-w-[78%] rounded-xl border border-line bg-canvas px-3 py-1.5 text-xs text-muted">
          <span className="font-medium text-ink/70">Score note: </span>
          {scoreReason}
        </div>
      )}
    </div>
  );
}

export default function TranscriptView({ transcript = [], showScoreReason = false, showOriginal = false }) {
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
        <Bubble
          key={turn.ts ? `${turn.ts}-${i}` : i}
          turn={turn}
          showScoreReason={showScoreReason}
          showOriginal={showOriginal}
        />
      ))}
    </div>
  );
}
