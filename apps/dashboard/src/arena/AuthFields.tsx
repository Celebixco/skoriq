import { useState } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { AuthArrow } from "./AuthLayout";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; labelAction?: ReactNode; hint?: string };

export function AuthField({ id, label, labelAction, hint, className = "", ...inputProps }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={`arena-auth__field ${className}`}>
      <div className="arena-auth__label-row"><label htmlFor={id}>{label}</label>{labelAction}</div>
      <input id={id} aria-describedby={hintId} {...inputProps} />
      {hint ? <p id={hintId} className="arena-auth__hint">{hint}</p> : null}
    </div>
  );
}

export function AuthPasswordField({ id, label, labelAction, hint, ...inputProps }: FieldProps) {
  const [visible, setVisible] = useState(false);
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="arena-auth__field">
      <div className="arena-auth__label-row"><label htmlFor={id}>{label}</label>{labelAction}</div>
      <div className="arena-auth__password">
        <input id={id} type={visible ? "text" : "password"} aria-describedby={hintId} {...inputProps} />
        <button type="button" onClick={() => setVisible(!visible)} aria-label={`${label === "Şifre tekrar" ? "Şifre tekrarını" : "Şifreyi"} ${visible ? "gizle" : "göster"}`} aria-pressed={visible} aria-controls={id}>
          <svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" stroke="currentColor" strokeWidth="1.6" /><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />{visible ? <path d="m3 3 18 18" stroke="currentColor" strokeWidth="1.6" /> : null}</svg>
        </button>
      </div>
      {hint ? <p id={hintId} className="arena-auth__hint">{hint}</p> : null}
    </div>
  );
}

export function AuthMessage({ error, success, id }: { error: string | null; success?: string | null; id: string }) {
  if (error) return <p id={id} className="arena-auth__message arena-auth__message--error" role="alert">{error}</p>;
  if (success) return <p id={id} className="arena-auth__message arena-auth__message--success" role="status">{success}</p>;
  return null;
}

export function AuthSubmit({ loading, children, loadingText, disabled = false }: { loading: boolean; children: ReactNode; loadingText: string; disabled?: boolean }) {
  return <button className="arena-auth__submit" type="submit" disabled={loading || disabled}><span aria-live="polite">{loading ? loadingText : children}</span>{loading ? <span className="arena-auth__spinner" aria-hidden="true" /> : <AuthArrow />}</button>;
}
