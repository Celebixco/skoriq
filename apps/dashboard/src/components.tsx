import type { ReactNode } from "react";
import { formatEligibility, formatPercent, statusLabel } from "./format";
import type { CoverageBlock, FeatureStatus, FootballAnalyticsMatchReport, H2HBlock } from "./types";

export function StatusBadge({ status }: { status: FeatureStatus }) {
  return <span className={`badge badge-${status}`}>{statusLabel(status)}</span>;
}

export function BooleanBadge({ value, tone = "neutral" }: { value: boolean; tone?: "good" | "warn" | "neutral" }) {
  return <span className={`badge badge-${value ? tone : "muted"}`}>{formatEligibility(value)}</span>;
}

export function ProgressBar({ value }: { value: number }) {
  const bounded = Math.max(0, Math.min(100, value));
  return (
    <div className="progress" aria-label={`Kapsam skoru ${bounded.toFixed(0)}%`}>
      <span style={{ width: `${bounded}%` }} />
    </div>
  );
}

export function MetricCard({ title, value, children }: { title: string; value: ReactNode; children?: ReactNode }) {
  return (
    <section className="metric-card">
      <p>{title}</p>
      <strong>{value}</strong>
      {children}
    </section>
  );
}

export function CoverageCard({ title, block }: { title: string; block: CoverageBlock }) {
  return (
    <MetricCard title={title} value={formatPercent(block.coverageScore)}>
      <span>Örneklem {block.sampleSize}</span>
      {block.scope ? <span>Kapsam {block.scope}</span> : null}
      {block.windowSize ? <span>Pencere {block.windowSize}</span> : null}
    </MetricCard>
  );
}

export function H2HCard({ block }: { block: H2HBlock }) {
  return (
    <MetricCard title="H2H karşılaştırma" value={formatPercent(block.coverageScore)}>
      <span>Örneklem {block.sampleSize}</span>
      <span>{block.h2hMissing ? "Eksik veya sıfır örneklem" : "Veri mevcut"}</span>
    </MetricCard>
  );
}

export function TeamLogo({ name, logoUrl, size = "md" }: { name: string; logoUrl?: string | null; size?: "sm" | "md" | "lg" }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  if (logoUrl) {
    return <img className={`team-logo team-logo-${size}`} src={logoUrl} alt={`${name} logo`} loading="lazy" referrerPolicy="no-referrer" />;
  }

  return (
    <span className={`team-logo team-logo-${size} team-logo-fallback`} aria-label={`${name} logosu yok`}>
      {initials || "FC"}
    </span>
  );
}

export function SignalList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="panel">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="muted">Kayıt yok.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function MatchTitle({ report }: { report: FootballAnalyticsMatchReport }) {
  return (
    <div className="match-title">
      <TeamLogo name={report.match.homeTeam.name} logoUrl={report.match.homeTeam.logoUrl} size="lg" />
      <div>
        <p className="eyebrow">{report.match.competition.name}</p>
        <h1>
          {report.match.homeTeam.name} <span>vs</span> {report.match.awayTeam.name}
        </h1>
      </div>
      <TeamLogo name={report.match.awayTeam.name} logoUrl={report.match.awayTeam.logoUrl} size="lg" />
    </div>
  );
}
