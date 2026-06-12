// _shared/lib/voices.js — ported from server/voices.js.
// CHANGES: no fs/path/process.env deps — byte-identical logic.

export const STUDENT_VOICES = [
  { key: "prashant", name: "Prashant", gender: "male" },
  { key: "priya", name: "Priya", gender: "female" },
  { key: "vikram", name: "Vikram", gender: "male" },
];

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

export function inferGenderFromName(name) {
  if (!name || typeof name !== "string") return null;
  const first = name.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "");
  if (!first) return null;
  if (FEMALE_NAMES.has(first)) return "female";
  if (MALE_NAMES.has(first)) return "male";
  if (/(?:a|i|ee|ya|ika|ita|ani|isha)$/.test(first)) return "female";
  return null;
}

export function pickStudentVoice(seed = "", gender = null) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const g = typeof gender === "string" ? gender.trim().toLowerCase() : null;
  const canonical = g === "f" || g === "female" ? "female" : g === "m" || g === "male" ? "male" : null;
  const pool = canonical
    ? STUDENT_VOICES.filter((v) => v.gender === canonical)
    : STUDENT_VOICES;
  const list = pool.length ? pool : STUDENT_VOICES;
  return list[Math.abs(hash) % list.length];
}
