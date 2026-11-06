/**
 * The TRACE mark: a "T" whose crossbar is a liquidity range (the band a position
 * covers) and whose stem is the traced price path, ending at the current price.
 * Ink tile, brand ochre, paper stroke. One component for every place the logo
 * appears (sidebar, mobile menu, launch intro); the favicon is src/app/icon.svg.
 */
export const MARK = { ink: "#17181B", ochre: "#C9A35C", paper: "#F4F3EF" } as const;

export function TraceMarkSvg({ size = 32, title }: { size?: number; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <rect width="32" height="32" rx="7.5" fill={MARK.ink} />
      <rect x="6" y="7" width="20" height="4.8" rx="1" fill={MARK.ochre} />
      <path d="M16 11.8 V16.2 L19.4 19.4 L16 22.6" fill="none" stroke={MARK.paper} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="24.9" r="2.2" fill={MARK.ochre} />
    </svg>
  );
}

export function BrandMark({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-grid shrink-0 ${className}`} style={{ width: size, height: size }}>
      <TraceMarkSvg size={size} />
    </span>
  );
}
