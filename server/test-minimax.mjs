import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({path: join(__dirname, '../.env')});

const key = process.env.MINIMAX_API_KEY;
if (!key) {
  console.log("No key found");
  process.exit(1);
}

const res = await fetch("https://api.minimax.io/v1/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": "Bearer " + key,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: "MiniMax-M3",
    messages: [{role: "user", content: "hi"}]
  })
});

const text = await res.text();
console.log("Status:", res.status);
console.log("Response:", text.slice(0, 300));
