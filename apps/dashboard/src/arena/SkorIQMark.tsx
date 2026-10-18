import "./brand.css";

/** Shared brand asset for public, member, auth and loading surfaces. */
export function SkorIQMark({ size = 38, className = "" }: { size?: number; className?: string }) {
  return <img className={`skoriq-brand-mark${className ? ` ${className}` : ""}`} src="/assets/brand/skoriq-mark-v1.svg" width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
}
