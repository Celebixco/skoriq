import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError, login, register, requestPasswordReset, resetPassword } from "../api";
import type { AuthUser } from "../types";
import { AuthLayout, AuthLink } from "./AuthLayout";
import type { AuthNavigate } from "./AuthLayout";
import { AuthField, AuthMessage, AuthPasswordField, AuthSubmit } from "./AuthFields";

type NavigationProps = { navigate: AuthNavigate };
const passwordHint = "En az 12 karakter; büyük/küçük harf ve rakam.";
const authError = (error: unknown, fallback: string) => error instanceof ApiError && error.status < 500 ? error.message : fallback;

export function LoginPage({ onLogin, navigate }: NavigationProps & { onLogin: (user: AuthUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await login(email, password);
      onLogin(response.user);
      navigate("/football/analytics");
    } catch (error) {
      setError(authError(error, "Giriş servisine şu an ulaşılamıyor. Lütfen birazdan tekrar deneyin."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout navigate={navigate} kicker="SKORIQ ÜYE GİRİŞİ" title="Tekrar hoş geldin." subtitle="Kaldığın yerden devam et." footer={<>Hesabın yok mu? <AuthLink to="/register" navigate={navigate}>Kayıt ol</AuthLink></>}>
      <form className="arena-auth__form" onSubmit={submit} aria-busy={loading} aria-describedby={error ? "login-error" : undefined}>
        <AuthField id="login-email" label="E-posta" value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" placeholder="ornek@eposta.com" required />
        <AuthPasswordField id="login-password" label="Şifre" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="Şifreni gir" required labelAction={<AuthLink to="/forgot-password" navigate={navigate}>Şifremi unuttum</AuthLink>} />
        <AuthMessage id="login-error" error={error} />
        <AuthSubmit loading={loading} loadingText="Giriş yapılıyor...">Giriş yap</AuthSubmit>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage({ onRegister, navigate }: NavigationProps & { onRegister: (user: AuthUser) => void }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mathChallenge, setMathChallenge] = useState(createMathChallenge);
  const [mathAnswer, setMathAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<"confirm" | "challenge" | null>(null);

  const refreshChallenge = () => { setMathChallenge(createMathChallenge()); setMathAnswer(""); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    setError(null);
    setInvalidField(null);
    if (password !== confirmPassword) {
      setError("Şifre onayı eşleşmiyor.");
      setInvalidField("confirm");
      return;
    }
    if (mathAnswer.trim() === "" || Number(mathAnswer) !== mathChallenge.answer) {
      setError("Güvenlik sorusunu kontrol edip tekrar deneyin.");
      setInvalidField("challenge");
      refreshChallenge();
      return;
    }
    setLoading(true);
    try {
      const response = await register({ email, firstName, lastName, phoneNumber: `+90${phoneNumber}`, password, confirmPassword, mathLeft: mathChallenge.left, mathOperator: mathChallenge.operator, mathRight: mathChallenge.right, mathAnswer: Number(mathAnswer) });
      onRegister(response.user);
      navigate("/football/analytics");
    } catch (error) {
      setError(authError(error, "Kayıt servisine şu an ulaşılamıyor. Birazdan tekrar deneyin."));
      refreshChallenge();
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout variant="register" navigate={navigate} kicker="SKORIQ ÜYELİK" title="Hesabını oluştur." footer={<>Zaten hesabın var mı? <AuthLink to="/login" navigate={navigate}>Giriş yap</AuthLink></>}>
      <form className="arena-auth__form" onSubmit={submit} aria-busy={loading} aria-describedby={error ? "register-error" : undefined}>
        <div className="arena-auth__name-row">
          <AuthField id="register-first-name" label="Ad" value={firstName} onChange={(event) => setFirstName(event.target.value)} type="text" autoComplete="given-name" placeholder="Adın" minLength={2} maxLength={80} required />
          <AuthField id="register-last-name" label="Soyad" value={lastName} onChange={(event) => setLastName(event.target.value)} type="text" autoComplete="family-name" placeholder="Soyadın" minLength={2} maxLength={80} required />
        </div>
        <div className="arena-auth__field">
          <label htmlFor="register-phone">Telefon</label>
          <div className="arena-auth__phone"><span aria-hidden="true">+90</span><input id="register-phone" value={phoneNumber} onChange={(event) => setPhoneNumber(onlyDigits(event.target.value).slice(0, 10))} type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="5xx xxx xx xx" aria-describedby="register-phone-hint" minLength={10} maxLength={10} pattern="[0-9]{10}" required /></div>
          <span id="register-phone-hint" className="arena-auth__sr-only">Türkiye ülke kodu +90. 10 haneli telefon numaranı gir.</span>
        </div>
        <AuthField id="register-email" label="E-posta" value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" placeholder="ornek@eposta.com" required />
        <AuthPasswordField id="register-password" label="Şifre" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder="En az 12 karakter" minLength={12} hint={passwordHint} required />
        <AuthPasswordField id="register-confirm" label="Şifre tekrar" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" placeholder="Şifreni tekrar gir" minLength={12} aria-invalid={invalidField === "confirm" || undefined} aria-describedby={invalidField === "confirm" ? "register-error" : undefined} required />
        <div className="arena-auth__challenge">
          <label htmlFor="register-challenge"><span>Güvenlik sorusu</span><strong>{mathChallenge.left} {mathChallenge.operator} {mathChallenge.right} = ?</strong></label>
          <input id="register-challenge" value={mathAnswer} onChange={(event) => setMathAnswer(onlyDigits(event.target.value).slice(0, 2))} type="text" inputMode="numeric" autoComplete="off" placeholder="Cevabını gir" aria-invalid={invalidField === "challenge" || undefined} aria-describedby={invalidField === "challenge" ? "register-error" : undefined} required />
        </div>
        <AuthMessage id="register-error" error={error} />
        <AuthSubmit loading={loading} loadingText="Kayıt oluşturuluyor...">Kayıt ol</AuthSubmit>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage({ navigate }: NavigationProps) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try { setSuccess((await requestPasswordReset(email)).message); }
    catch (error) { setError(authError(error, "Şifre sıfırlama servisine şu an ulaşılamıyor. Lütfen birazdan tekrar deneyin.")); }
    finally { setLoading(false); }
  };
  return (
    <AuthLayout navigate={navigate} kicker="SKORIQ HESAP ERİŞİMİ" title="Şifreni yenile." subtitle="E-posta adresini gir. Hesabın varsa sana güvenli bir yenileme bağlantısı gönderelim." footer={<AuthLink to="/login" navigate={navigate}>Giriş ekranına dön</AuthLink>}>
      <form className="arena-auth__form" onSubmit={submit} aria-busy={loading} aria-describedby={error || success ? "forgot-message" : undefined}>
        <AuthField id="forgot-email" label="E-posta" value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" placeholder="ornek@eposta.com" required />
        <AuthMessage id="forgot-message" error={error} success={success} />
        <AuthSubmit loading={loading} loadingText="Bağlantı hazırlanıyor...">Sıfırlama bağlantısı gönder</AuthSubmit>
      </form>
    </AuthLayout>
  );
}

export function ResetPasswordPage({ navigate }: NavigationProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const token = new URLSearchParams(window.location.search).get("token")?.trim() ?? "";
  const tokenError = !token ? "Şifre sıfırlama bağlantısı eksik veya geçersiz." : null;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    if (!token) { setError(tokenError); return; }
    if (password !== confirmPassword) { setError("Şifre onayı eşleşmiyor."); return; }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      setSuccess((await resetPassword({ token, password, confirmPassword })).message);
      window.setTimeout(() => navigate("/login"), 1200);
    } catch (error) { setError(authError(error, "Şifre yenileme işlemi şu an tamamlanamıyor. Lütfen birazdan tekrar deneyin.")); }
    finally { setLoading(false); }
  };
  return (
    <AuthLayout navigate={navigate} kicker="SKORIQ HESAP GÜVENLİĞİ" title="Yeni şifreni belirle." subtitle="Hesabın için güçlü ve benzersiz bir şifre seç." footer={<AuthLink to="/login" navigate={navigate}>Giriş ekranına dön</AuthLink>}>
      <form className="arena-auth__form" onSubmit={submit} aria-busy={loading} aria-describedby={error || tokenError || success ? "reset-message" : undefined}>
        <AuthPasswordField id="reset-password" label="Yeni şifre" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder="En az 12 karakter" minLength={12} hint={passwordHint} required />
        <AuthPasswordField id="reset-confirm" label="Şifre tekrar" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" placeholder="Yeni şifreni tekrar gir" minLength={12} aria-invalid={error === "Şifre onayı eşleşmiyor." || undefined} required />
        <AuthMessage id="reset-message" error={error || tokenError} success={success} />
        <AuthSubmit loading={loading} loadingText="Şifre güncelleniyor..." disabled={!token}>Şifreyi güncelle</AuthSubmit>
      </form>
    </AuthLayout>
  );
}

function onlyDigits(value: string) { return value.replace(/\D/g, ""); }
function randomInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function createMathChallenge() {
  const operator: "+" | "-" = Math.random() > 0.5 ? "+" : "-";
  const left = randomInt(3, 12);
  const right = operator === "-" ? randomInt(1, left - 1) : randomInt(1, 9);
  return { left, operator, right, answer: operator === "+" ? left + right : left - right };
}
