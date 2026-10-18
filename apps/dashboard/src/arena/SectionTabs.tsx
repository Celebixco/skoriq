import type { KeyboardEvent, ReactNode } from "react";

type SectionIcon = "overview" | "form" | "team" | "chart" | "signal" | "table" | "calendar";
const iconPaths: Record<SectionIcon, string> = {
  overview: "M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z",
  form: "M3 19h18 M5 14l4-5 5 3 5-8 M15 4h4v4",
  team: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M3 20v-2a6 6 0 0 1 12 0v2 M17 6a3 3 0 0 1 0 6 M18 15a5 5 0 0 1 3 5",
  chart: "M4 20h16 M7 16v-5 M12 16V5 M17 16V9",
  signal: "M3 12h4l3-8 4 16 3-8h4",
  table: "M4 5h16v14H4z M4 10h16 M10 5v14 M4 15h16",
  calendar: "M5 5h14v15H5z M8 3v4 M16 3v4 M5 10h14 M9 14h1 M14 14h1"
};

export function nextTabIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

export function SectionTabs<T extends string>({ idPrefix, label, value, onChange, items, className = "match-center-tab-bar", buttonClassName = "match-center-tab-btn" }: {
  idPrefix: string;
  label: string;
  value: T;
  onChange: (value: T) => void;
  items: ReadonlyArray<{ id: T; label: string; icon?: SectionIcon; count?: number }>;
  className?: string;
  buttonClassName?: string;
}) {
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextTabIndex(event.key, index, items.length);
    if (next === null) return;
    event.preventDefault();
    onChange(items[next]!.id);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  return <nav className={className} role="tablist" aria-label={label}>{items.map((item, index) => <button type="button" role="tab" id={`${idPrefix}-${item.id}-tab`} key={item.id} aria-controls={`${idPrefix}-panel`} aria-selected={value === item.id} tabIndex={value === item.id ? 0 : -1} className={`${buttonClassName}${value === item.id ? " active" : ""}`} onClick={() => onChange(item.id)} onKeyDown={(event) => onKey(event, index)}>
    {item.icon ? <svg className="arena-section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPaths[item.icon]} /></svg> : null}
    <span>{item.label}</span>{typeof item.count === "number" && item.count > 0 ? <span className="team-tab-badge">{item.count}</span> : null}
  </button>)}</nav>;
}

export function FilterDisclosure({ children, active = false, label = "Detaylı filtreler" }: { children: ReactNode; active?: boolean; label?: string }) {
  return <details className="arena-filter-disclosure"><summary>{label}{active ? <span className="arena-filter-active">Filtreler etkin</span> : null}</summary>{children}</details>;
}
