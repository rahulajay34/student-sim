// Deterministic spoken-fluency metrics from a Whisper verbose_json result.
//
// PURE (no env / network) so it can be unit-tested directly under node. Input is
// Whisper's word list ([{word,start,end}]), the verbatim text, and the audio
// duration. Output is a flat metrics object that anchors the LLM fluency judge to
// measurable evidence (it never sees raw audio).
//
// Key idea: the recording is the counsellor's mic for the WHOLE call, so it has
// long silences while the student speaks. We segment words into "utterances"
// (runs separated by gaps > UTTERANCE_GAP_S — i.e. the student's turns) and base
// rate/pause stats on speaking time WITHIN utterances, not wall-clock duration.

const UTTERANCE_GAP_S = 2.0;   // gap larger than this = a turn boundary (student spoke)
const LONG_PAUSE_S = 0.6;      // within-utterance silence counted as a hesitation pause

// Classic filled pauses (strict — these are almost never real content words).
const FILLER_RE = /\b(uh|um|uhh|umm|uhm|er|err|erm|ah|mhm|hmm|huh)\b/gi;
// Discourse markers often used as crutches (reported separately, not as hard fillers).
const DISCOURSE_RE = /\b(you know|i mean|sort of|kind of|like)\b/gi;

const round = (n, d = 2) => {
  const f = 10 ** d;
  return Math.round((Number(n) || 0) * f) / f;
};
const normWord = (w) => (w || "").toLowerCase().replace(/[^a-z']/g, "");

// Group consecutive words into utterances split on large inter-word gaps.
function segment(words) {
  const utts = [];
  let cur = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (cur.length) {
      const gap = (Number(w.start) || 0) - (Number(words[i - 1].end) || 0);
      if (gap > UTTERANCE_GAP_S) {
        utts.push(cur);
        cur = [];
      }
    }
    cur.push(w);
  }
  if (cur.length) utts.push(cur);
  return utts;
}

// Count immediate repetitions + short false-start/repair patterns from the token
// stream (e.g. "the the", "I I want", "we can we can"). Heuristic but verbatim.
function countRepairs(tokens) {
  let repairs = 0;
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] && tokens[i] === tokens[i - 1]) { repairs++; continue; }
    // repeated bigram: a b a b
    if (i >= 3 && tokens[i] === tokens[i - 2] && tokens[i - 1] === tokens[i - 3]) repairs++;
  }
  return repairs;
}

/**
 * computeFluencyMetrics(words, text, audioDurationSec)
 * Returns a metrics object; timing-derived fields are null when word timings are
 * absent (text-only fallback still yields filler/repair counts).
 */
export function computeFluencyMetrics(words, text, audioDurationSec) {
  const fullText = typeof text === "string" ? text : "";
  const hasWords = Array.isArray(words) && words.length > 0 && typeof words[0]?.start === "number";

  // Token list for lexical/repair stats — prefer Whisper words, fall back to text.
  const rawTokens = hasWords ? words.map((w) => w.word) : fullText.split(/\s+/);
  const tokens = rawTokens.map(normWord).filter(Boolean);
  const wordCount = tokens.length;

  // Filled pauses + discourse markers (verbatim text retains them; Realtime hid them).
  const filledPauseCount = (fullText.match(FILLER_RE) || []).length;
  const discourseMarkerCount = (fullText.match(DISCOURSE_RE) || []).length;
  const repairCount = countRepairs(tokens);
  const per100 = (n) => (wordCount > 0 ? round((n / wordCount) * 100, 1) : 0);

  const base = {
    wordCount,
    audioDurationSec: round(audioDurationSec, 1),
    filledPauseCount,
    filledPauseRatePer100: per100(filledPauseCount),
    discourseMarkerCount,
    discourseMarkerRatePer100: per100(discourseMarkerCount),
    repairCount,
    repairRatePer100: per100(repairCount),
    // timing-derived (null until proven)
    speakingSec: null,
    wpm: null,
    articulationRatePerSec: null,
    longPauseCount: null,
    midRunLongPauseCount: null,
    meanPauseSec: null,
    meanLengthOfRunWords: null,
    hasWordTimings: hasWords,
  };

  if (!hasWords) return base;

  const utts = segment(words);
  let speakingSec = 0;       // sum of utterance spans (includes within-utterance pauses)
  let phonationSec = 0;      // sum of word durations (actual sound)
  let longPauseCount = 0;    // within-utterance silences > LONG_PAUSE_S
  let longPauseTotal = 0;
  let runs = 1;              // mean-length-of-run denominator (interruptions + 1)

  for (const utt of utts) {
    const first = Number(utt[0].start) || 0;
    const last = Number(utt[utt.length - 1].end) || 0;
    speakingSec += Math.max(0, last - first);
    for (let i = 0; i < utt.length; i++) {
      phonationSec += Math.max(0, (Number(utt[i].end) || 0) - (Number(utt[i].start) || 0));
      if (i > 0) {
        const gap = (Number(utt[i].start) || 0) - (Number(utt[i - 1].end) || 0);
        if (gap > LONG_PAUSE_S) { longPauseCount++; longPauseTotal += gap; runs++; }
      }
    }
  }

  base.speakingSec = round(speakingSec, 1);
  base.wpm = speakingSec > 0 ? round((wordCount / speakingSec) * 60, 0) : null;
  base.articulationRatePerSec = phonationSec > 0 ? round(wordCount / phonationSec, 2) : null;
  base.longPauseCount = longPauseCount;
  base.midRunLongPauseCount = longPauseCount; // all counted pauses are within an utterance (mid-run)
  base.meanPauseSec = longPauseCount > 0 ? round(longPauseTotal / longPauseCount, 2) : 0;
  base.meanLengthOfRunWords = round(wordCount / runs, 1);
  return base;
}
