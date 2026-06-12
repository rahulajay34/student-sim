// Student voice catalog: the named identities the simulated student can take on.
// Assigned per session at start (snapshotted as session.voice) so the student's
// name and gender in the prompt — and the gender-matched OpenAI realtime voice
// (marin/cedar) — stay stable for the whole call and across resumes.
//
// (The per-voice provider id was dropped when the classic/ElevenLabs voice engines
// were removed; only name + gender + key are still consumed — by pickStudentVoice,
// the leadCard name/gender fallback, and the OpenAI voice gender mapping.)

export const STUDENT_VOICES = [
  { key: "prashant", name: "Prashant", gender: "male" },
  { key: "priya", name: "Priya", gender: "female" },
  { key: "vikram", name: "Vikram", gender: "male" },
];

// Curated first-name → gender lookup. We resolve gender primarily from the lead
// profile (its `gender` field is derived from the description's pronouns), but
// when only a bare name is available we fall back to this. Kept deliberately
// conservative: names that are genuinely ambiguous return null so we degrade to
// the voice's own gender rather than guessing wrong.
const FEMALE_NAMES = new Set([
  "priya", "bumika", "bhumika", "indrani", "ashwini", "dvirid", "neha", "pooja", "puja",
  "anjali", "shreya", "shruti", "sneha", "swati", "divya", "kavya", "kavita", "sakshi",
  "riya", "ria", "muskan", "khushi", "tanya", "tania", "isha", "ishita", "aishwarya",
  "nikita", "ananya", "aarti", "arti", "deepika", "deepa", "meena", "meera", "sunita",
  "geeta", "gita", "rekha", "radha", "lakshmi", "laxmi", "preeti", "priti", "rashmi",
  "ritu", "sonia", "sonal", "payal", "pallavi", "megha", "manisha", "nisha", "vidya",
  "vandana", "varsha", "yamini", "jyoti", "kiran", "komal", "mansi", "rachna", "rachana",
  "sanya", "saumya", "soumya", "tanvi", "trisha", "vaishnavi", "vaishali", "namrata",
  "nandini", "parul", "pragya", "simran", "snehal", "shivani", "srishti", "sristi",
  "anushka", "diya", "myra", "saanvi", "aanya", "navya", "siya", "fatima", "ayesha",
  "zoya", "sana", "saba", "farah", "heena", "hina", "rukhsar", "tabassum",
]);
const MALE_NAMES = new Set([
  "prashant", "vikram", "suresh", "ramesh", "rahul", "rohit", "amit", "anil", "sunil",
  "vijay", "ajay", "sanjay", "rajesh", "mahesh", "dinesh", "naresh", "mukesh", "ashok",
  "arjun", "aditya", "abhishek", "akash", "aakash", "ankit", "ankur", "ankush", "arnav",
  "harsh", "harshit", "kunal", "karan", "kartik", "manish", "nikhil", "pankaj", "pranav",
  "raj", "ravi", "sachin", "saurabh", "shubham", "siddharth", "siddhant", "sumit", "tarun",
  "varun", "vishal", "vivek", "yash", "deepak", "gaurav", "gautam", "hardik", "jatin",
  "lakshya", "mohit", "naveen", "nitin", "parth", "piyush", "rishabh", "rohan", "sahil",
  "shrenik", "khushal", "tushar", "uday", "utkarsh", "vaibhav", "vinay", "yogesh",
  "abhinav", "aman", "ayush", "dhruv", "ishaan", "kabir", "krish", "neeraj", "om",
  "prateek", "pratik", "raghav", "samar", "shaurya", "veer", "imran", "salman", "faizan",
  "zaid", "arman", "rehan", "sameer", "danish", "asif", "irfan", "kunwar",
]);

// Best-effort gender from a first name. Returns "male" | "female" | null.
export function inferGenderFromName(name) {
  if (!name || typeof name !== "string") return null;
  const first = name.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "");
  if (!first) return null;
  if (FEMALE_NAMES.has(first)) return "female";
  if (MALE_NAMES.has(first)) return "male";
  // Light suffix heuristic as a last resort. Female-typical endings in the names
  // that populate our profile set; conservative, returns null when unsure.
  if (/(?:a|i|ee|ya|ika|ita|ani|isha)$/.test(first)) return "female";
  return null;
}

// Deterministic pick so the same seed (session id) always resolves to the same
// voice, while consecutive sessions naturally rotate across the catalog. When a
// `gender` is supplied (from the chosen lead profile, or inferred from the
// student's name), the pick is restricted to voices of that gender so the voice
// the prospect speaks with matches their name/identity. Falls back to the full
// catalog when no gendered voice is available.
export function pickStudentVoice(seed = "", gender = null) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  // Normalize so "F"/"M"/"Female" from any future data source still genders the
  // pool instead of silently falling through to the full catalog.
  const g = typeof gender === "string" ? gender.trim().toLowerCase() : null;
  const canonical = g === "f" || g === "female" ? "female" : g === "m" || g === "male" ? "male" : null;
  const pool = canonical
    ? STUDENT_VOICES.filter((v) => v.gender === canonical)
    : STUDENT_VOICES;
  const list = pool.length ? pool : STUDENT_VOICES;
  return list[Math.abs(hash) % list.length];
}
