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
  const pool = gender
    ? STUDENT_VOICES.filter((v) => v.gender === gender)
    : STUDENT_VOICES;
  const list = pool.length ? pool : STUDENT_VOICES;
  return list[Math.abs(hash) % list.length];
}
