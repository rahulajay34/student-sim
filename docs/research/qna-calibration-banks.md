# QnA Style Calibration — Round 1 (2026-06-12)

Owner reviewed 120 generated student lines (6 moments × 20 candidates, each spanning a
controlled style spectrum: fillers none→heavy, hindi 0→2, length S→L; all grounded in the
real-call register from `server/data/seed/register-lines.json` / `voice-bank.json` /
`objections.json`). The accepted lines live in `server/data/seed/style-exemplars.json`
and are injected into the voice + text prompts as style anchors.

## Picks

| Bank | Moment | Accepted (of 20) |
|---|---|---|
| 1 | Opening greeting reply | 4, 7, 10, 15, 19, 20 |
| 2 | Self-introduction | 1, 2, 5, 7, 8, 9, 10, 12, 14, 15, 16, 19, 20 |
| 3 | Fee reveal reaction | 3, 4, 5, 7, 9, 10, 13, 14, 16, 17, 18, 19, 20 |
| 4 | Placement questions | 1, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20 |
| 5 | Money & logistics questions | all 20 |
| 6 | Close attempt response | 1, 2, 3, 4, 5, 7, 9, 11, 12, 14, 15, 16, 19 |

## Decoded dials (encoded in style-exemplars.json `dials` + prompt rules)

- **Fillers:** light is home base (1–2 per turn); trailing-off "..." hesitation good;
  doubled-word stammers at most once per call (rejected: "this is, this is Priya").
- **Hinglish:** Hindi *particles* woven into English (haan, thoda, abhi, achha, matlab,
  bhi, sentence-final "na") about once every 1–3 turns — more than the post-Hinglish-fix
  near-zero, less than the original flood. Full Hindi clauses rejected ("kitna hai",
  "thoda time do na", "block karna").
- **Length:** medium (9–18 words) is the norm.
- **Address:** "sir" frequency was liked, but it must match the counsellor's gender —
  "ma'am" for female counsellors (owner feedback: bot said "sir" to everyone).

## Process for future rounds

Generate candidate banks spanning a style spectrum (tag each line), owner picks
favorites + rejects, update `style-exemplars.json` (bump `version`), re-verify prompt
injection tests. Provenance for round 1 generation: three parallel agents grounded in
the seed register data, 2026-06-12.
