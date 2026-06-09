// Slim top bar for the authenticated shells. Shows a mobile menu button, the
// current section title, and a right-hand slot (user menu / actions).
export default function Topbar({ title, right, onMenu }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-white/80 px-4 backdrop-blur lg:px-8">
      <button
        type="button"
        onClick={onMenu}
        className="-ml-1 rounded-lg p-2 text-muted hover:bg-canvas hover:text-ink lg:hidden"
        aria-label="Open menu"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
          <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
        </svg>
      </button>
      <h1 className="truncate text-base font-semibold text-ink">{title}</h1>
      <div className="ml-auto flex items-center gap-3">{right}</div>
    </header>
  );
}
