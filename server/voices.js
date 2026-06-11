// Student voice catalog: the ElevenLabs cloned voices the simulated student can
// speak with. Assigned per session at start (snapshotted as session.voice) so the
// voice — and the student's name/gender in the prompt — stay stable for the whole
// call and across resumes. The sidecar falls back to its env default when a
// session predates this field.

export const STUDENT_VOICES = [
  { key: "prashant", name: "Prashant", gender: "male", elevenLabsVoiceId: "khNT67c7kgWhlbNQynFY" },
  { key: "priya", name: "Priya", gender: "female", elevenLabsVoiceId: "hK2VWYcsIcpRFeFwf1QD" },
  { key: "vikram", name: "Vikram", gender: "male", elevenLabsVoiceId: "hczKB0VbXLcBTn17ShYS" },
];

// Deterministic pick so the same seed (session id) always resolves to the same
// voice, while consecutive sessions naturally rotate across the catalog.
export function pickStudentVoice(seed = "") {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return STUDENT_VOICES[Math.abs(hash) % STUDENT_VOICES.length];
}
