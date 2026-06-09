import { initials } from "../lib/format";

// Size presets: dimensions + initials font size.
const SIZES = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
};

export default function Avatar({ name, color, size = "md" }) {
  return (
    <span
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold leading-none text-white ${
        SIZES[size] || SIZES.md
      }`}
      style={{ background: color || "#4F46E5" }}
      title={name || undefined}
      aria-label={name || undefined}
    >
      {initials(name)}
    </span>
  );
}
