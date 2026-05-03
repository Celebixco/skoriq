import { BadRequestException, Inject, Injectable, Optional, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { AppConfig } from "@sports-data/config";
import { loadConfig } from "@sports-data/config";
import { createDatabase } from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { sql } from "drizzle-orm";
import { parseCookies, serializeAuthCookie, serializeExpiredCookie } from "./cookies.js";
import { hashPassword, verifyPassword } from "./password.js";
import type { PasswordResetEmailSender } from "./password-reset-email.service.js";
import { signAuthToken, verifyAuthToken } from "./token.js";
import type { AuthRole, AuthStatus, AuthUser, AuthenticatedRequest, CookieResponse } from "./auth.types.js";

const invalidCredentialsMessage = "E-posta veya şifre hatalı.";
const registerFailureMessage = "Kayıt işlemi tamamlanamadı. Bilgileri kontrol edip tekrar deneyin.";
const weakPasswordMessage = "Şifre en az 12 karakter olmalı; büyük harf, küçük harf ve rakam içermeli.";
const forgotPasswordSuccessMessage = "Eger bu e-posta sistemde kayitliysa, sifre sifirlama baglantisi gonderildi.";
const invalidResetTokenMessage = "Şifre sıfırlama bağlantısı geçersiz veya süresi dolmuş.";

interface UserRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone_number: string | null;
  password_hash: string;
  role: AuthRole;
  status: AuthStatus;
  created_at: Date | string;
  last_login_at: Date | string | null;
}

interface PasswordResetTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date | string;
  used_at: Date | string | null;
}

interface LegacyUserPayloadRow {
  payload: Record<string, unknown>;
}

@Injectable()
export class AuthService {
  private readonly database: Database;
  private readonly config: AppConfig;

  constructor(
    @Optional() @Inject("AUTH_DATABASE") database?: Database,
    @Optional() @Inject("AUTH_CONFIG") config?: AppConfig,
    @Optional() @Inject("AUTH_PASSWORD_RESET_EMAIL_SENDER") private readonly passwordResetEmailSender?: PasswordResetEmailSender
  ) {
    this.config = config ?? loadConfig();
    this.database = database ?? createDatabase(this.config.DATABASE_URL);
  }

  get enabled() {
    return this.config.AUTH_ENABLED;
  }

  async login(email: string, password: string, response: CookieResponse): Promise<AuthUser> {
    const normalizedEmail = normalizeEmail(email);
    const row = await this.findUserByEmail(normalizedEmail);
    if (!row || row.status !== "active") {
      throw new UnauthorizedException(invalidCredentialsMessage);
    }

    const valid = await verifyPassword(password, row.password_hash);
    if (!valid) {
      throw new UnauthorizedException(invalidCredentialsMessage);
    }

    await this.markLastLogin(row.id);
    const user = mapUserRow({ ...row, last_login_at: new Date() });
    this.setAuthCookie(response, user);
    return user;
  }

  async register(
    input: {
      email: string;
      firstName: string;
      lastName: string;
      phoneNumber: string;
      password: string;
      confirmPassword?: string;
      mathLeft: number;
      mathOperator: "+" | "-";
      mathRight: number;
      mathAnswer: number;
    },
    response: CookieResponse
  ): Promise<AuthUser> {
    const normalizedEmail = normalizeEmail(input.email);
    const firstName = normalizePersonName(input.firstName);
    const lastName = normalizePersonName(input.lastName);
    const phoneNumber = normalizePhoneNumber(input.phoneNumber);
    if (!isValidEmail(normalizedEmail)) {
      throw new BadRequestException(registerFailureMessage);
    }
    if (!isValidPersonName(firstName) || !isValidPersonName(lastName) || !isValidPhoneNumber(phoneNumber)) {
      throw new BadRequestException(registerFailureMessage);
    }
    if (!isStrongPassword(input.password)) {
      throw new BadRequestException(weakPasswordMessage);
    }
    if (input.confirmPassword !== undefined && input.confirmPassword !== input.password) {
      throw new BadRequestException("Şifre onayı eşleşmiyor.");
    }
    if (!isValidMathChallenge(input.mathLeft, input.mathOperator, input.mathRight, input.mathAnswer)) {
      throw new BadRequestException("Güvenlik sorusu hatalı.");
    }

    const existing = await this.findUserByEmail(normalizedEmail).catch(() => {
      throw new BadRequestException(registerFailureMessage);
    });
    if (existing) {
      throw new BadRequestException(registerFailureMessage);
    }

    const passwordHash = await hashPassword(input.password);
    const rows = await executeRows<UserRow>(
      this.database,
      sql`
        insert into users (email, first_name, last_name, phone_number, password_hash, role, status, last_login_at)
        values (${normalizedEmail}, ${firstName}, ${lastName}, ${phoneNumber}, ${passwordHash}, 'member', 'active', now())
        returning id, email, first_name, last_name, phone_number, password_hash, role, status, created_at, last_login_at
      `
    ).catch(() => {
      throw new BadRequestException(registerFailureMessage);
    });

    const row = rows[0];
    if (!row) {
      throw new BadRequestException(registerFailureMessage);
    }

    const user = mapUserRow(row);
    this.setAuthCookie(response, user);
    return user;
  }

  async requestPasswordReset(email: string) {
    if (!this.passwordResetEmailSender?.configured) {
      throw new ServiceUnavailableException("Şifre sıfırlama servisi henüz hazır değil.");
    }

    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) {
      return { ok: true, message: forgotPasswordSuccessMessage };
    }

    const user = await this.findUserByEmail(normalizedEmail).catch(() => undefined);
    if (!user || user.status !== "active") {
      return { ok: true, message: forgotPasswordSuccessMessage };
    }

    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = hashPasswordResetToken(rawToken);
    const expiresAt = new Date(Date.now() + this.config.AUTH_PASSWORD_RESET_TTL_MINUTES * 60_000);

    await this.database.execute(sql`update password_reset_tokens set used_at = now(), updated_at = now() where user_id = ${user.id} and used_at is null`);
    await this.database.execute(
      sql`
        insert into password_reset_tokens (user_id, token_hash, expires_at)
        values (${user.id}, ${tokenHash}, ${expiresAt})
      `
    );

    await this.passwordResetEmailSender.sendPasswordResetEmail({
      email: user.email,
      resetUrl: buildPasswordResetUrl(this.config, rawToken)
    });

    return { ok: true, message: forgotPasswordSuccessMessage };
  }

  async resetPassword(input: { token: string; password: string; confirmPassword?: string }) {
    if (!isStrongPassword(input.password)) {
      throw new BadRequestException(weakPasswordMessage);
    }
    if (input.confirmPassword !== undefined && input.confirmPassword !== input.password) {
      throw new BadRequestException("Şifre onayı eşleşmiyor.");
    }

    const token = input.token.trim();
    if (!token) {
      throw new BadRequestException(invalidResetTokenMessage);
    }

    const tokenRow = await this.findActivePasswordResetToken(token);
    if (!tokenRow) {
      throw new BadRequestException(invalidResetTokenMessage);
    }

    const passwordHash = await hashPassword(input.password);
    await this.database.execute(sql`update users set password_hash = ${passwordHash}, updated_at = now() where id = ${tokenRow.user_id}`);
    await this.database.execute(sql`update password_reset_tokens set used_at = now(), updated_at = now() where id = ${tokenRow.id}`);
    await this.database.execute(
      sql`update password_reset_tokens set used_at = now(), updated_at = now() where user_id = ${tokenRow.user_id} and id <> ${tokenRow.id} and used_at is null`
    );

    return { ok: true, message: "Şifreniz güncellendi. Giriş yapabilirsiniz." };
  }

  logout(response: CookieResponse) {
    response.setHeader("Set-Cookie", serializeExpiredCookie(this.config.AUTH_COOKIE_NAME, this.secureCookie));
    return { ok: true };
  }

  async currentUserFromRequest(request: AuthenticatedRequest): Promise<AuthUser | null> {
    const secret = this.config.AUTH_JWT_SECRET;
    if (!secret) return null;
    const token = parseCookies(request.headers.cookie)[this.config.AUTH_COOKIE_NAME];
    if (!token) return null;
    const claims = verifyAuthToken(token, secret);
    if (!claims) return null;
    const row = await this.findUserById(claims.sub);
    if (!row || row.status !== "active") return null;
    return mapUserRow(row);
  }

  private setAuthCookie(response: CookieResponse, user: AuthUser) {
    const secret = this.config.AUTH_JWT_SECRET;
    if (!secret) {
      throw new Error("AUTH_JWT_SECRET is required when AUTH_ENABLED=true.");
    }
    const token = signAuthToken(
      {
        sub: user.id,
        email: user.email,
        role: user.role
      },
      secret,
      this.config.AUTH_TOKEN_TTL_SECONDS
    );
    response.setHeader(
      "Set-Cookie",
      serializeAuthCookie(this.config.AUTH_COOKIE_NAME, token, {
        maxAgeSeconds: this.config.AUTH_TOKEN_TTL_SECONDS,
        secure: this.secureCookie
      })
    );
  }

  private get secureCookie() {
    return this.config.NODE_ENV === "production";
  }

  private async findUserByEmail(email: string): Promise<UserRow | undefined> {
    try {
      const rows = await executeRows<UserRow>(
        this.database,
        sql`
          select id, email, first_name, last_name, phone_number, password_hash, role, status, created_at, last_login_at
          from users
          where email = ${email}
          limit 1
        `
      );
      return rows[0];
    } catch {
      const rows = await executeRows<LegacyUserPayloadRow>(
        this.database,
        sql`
          select to_jsonb(u) as payload
          from users u
          where u.email = ${email}
          limit 1
        `
      );
      return rows[0] ? mapLegacyUserPayloadRow(rows[0].payload) : undefined;
    }
  }

  private async findUserById(id: string): Promise<UserRow | undefined> {
    try {
      const rows = await executeRows<UserRow>(
        this.database,
        sql`
          select id, email, first_name, last_name, phone_number, password_hash, role, status, created_at, last_login_at
          from users
          where id = ${id}
          limit 1
        `
      );
      return rows[0];
    } catch {
      const rows = await executeRows<LegacyUserPayloadRow>(
        this.database,
        sql`
          select to_jsonb(u) as payload
          from users u
          where u.id = ${id}
          limit 1
        `
      );
      return rows[0] ? mapLegacyUserPayloadRow(rows[0].payload) : undefined;
    }
  }

  private async markLastLogin(id: string): Promise<void> {
    await this.database.execute(sql`update users set last_login_at = now(), updated_at = now() where id = ${id}`);
  }

  private async findActivePasswordResetToken(rawToken: string): Promise<PasswordResetTokenRow | undefined> {
    const tokenHash = hashPasswordResetToken(rawToken);
    const rows = await executeRows<PasswordResetTokenRow>(
      this.database,
      sql`
        select id, user_id, token_hash, expires_at, used_at
        from password_reset_tokens
        where token_hash = ${tokenHash}
          and used_at is null
          and expires_at > now()
        limit 1
      `
    );
    return rows[0];
  }
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function normalizePersonName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizePhoneNumber(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+90${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+90${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("90")) return `+${digits}`;
  return value.trim();
}

export function isStrongPassword(password: string) {
  return password.length >= 12 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
}

export function hashPasswordResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPersonName(value: string) {
  return value.length >= 2 && value.length <= 80;
}

function isValidPhoneNumber(value: string) {
  return /^\+90\d{10}$/.test(value);
}

function isValidMathChallenge(left: number, operator: "+" | "-", right: number, answer: number) {
  if (!Number.isInteger(left) || !Number.isInteger(right) || !Number.isInteger(answer)) return false;
  if (left < 1 || left > 20 || right < 1 || right > 20) return false;
  const expected = operator === "+" ? left + right : left - right;
  return expected >= 0 && answer === expected;
}

function buildPasswordResetUrl(config: AppConfig, token: string) {
  const base = config.AUTH_PASSWORD_RESET_URL_BASE ?? config.FRONTEND_ORIGIN;
  if (!base) {
    throw new ServiceUnavailableException("Şifre sıfırlama servisi henüz hazır değil.");
  }
  const url = new URL("/reset-password", base);
  url.searchParams.set("token", token);
  return url.toString();
}

export function mapUserRow(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    phoneNumber: row.phone_number,
    role: row.role,
    status: row.status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
    lastLoginAt: row.last_login_at ? (row.last_login_at instanceof Date ? row.last_login_at.toISOString() : new Date(row.last_login_at).toISOString()) : null
  };
}

function mapLegacyUserPayloadRow(payload: Record<string, unknown>): UserRow {
  const createdAt = payload.created_at instanceof Date || typeof payload.created_at === "string" ? payload.created_at : new Date();
  const lastLoginAt =
    payload.last_login_at instanceof Date || typeof payload.last_login_at === "string" ? payload.last_login_at : null;

  return {
    id: String(payload.id ?? ""),
    email: String(payload.email ?? ""),
    first_name: typeof payload.first_name === "string" ? payload.first_name : null,
    last_name: typeof payload.last_name === "string" ? payload.last_name : null,
    phone_number: typeof payload.phone_number === "string" ? payload.phone_number : null,
    password_hash: String(payload.password_hash ?? ""),
    role: (typeof payload.role === "string" && payload.role ? payload.role : "member") as AuthRole,
    status: (typeof payload.status === "string" && payload.status ? payload.status : "active") as AuthStatus,
    created_at: createdAt,
    last_login_at: lastLoginAt
  };
}

async function executeRows<T>(database: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await database.execute(query);
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)) {
    return result.rows as T[];
  }
  return [];
}
