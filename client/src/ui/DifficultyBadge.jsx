// Pill badge for a scenario difficulty level (easy/medium/hard).
// Color is derived from the shared difficultyColor helper so the tone
// stays consistent with the rest of the design system.

import Badge from "./Badge";
import { difficultyColor } from "../lib/format";

export default function DifficultyBadge({ level }) {
  const value = level || "medium";
  const text = value.charAt(0).toUpperCase() + value.slice(1);

  return <Badge color={difficultyColor(value)}>{text}</Badge>;
}
