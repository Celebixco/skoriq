import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import type { AppConfig } from "@sports-data/config";
import { loadConfig } from "@sports-data/config";
import { createDatabase } from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { sql } from "drizzle-orm";
import { parseCookies, serializeAuthCookie, serializeExpiredCookie } from "./cookies.js";
import { hashPassword, verifyPassword } from "./password.js";
import { signAuthToken, verifyAuthToken } from "./token.js";
import type { AuthRole, AuthStatus, AuthUser, AuthenticatedRequest, CookieResponse } from "./auth.types.js";

const invalidCredentialsMessage = "Invalid email or password.";
const registerFailureMessage = "Kayıt işlemi tamamlanamadı. Bilgileri kontrol edip tekrar deneyin.";
const weakPasswordMessage = "Şifre en az 12 karakter olmalı; büyük harf, küçük harf ve rakam içermeli.";

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

@Injectable()
export class AuthService {
  private readonly database: Database;
  private readonly config: AppConfig;

  constructor(database?: Database, config: AppConfig = loadConfig()) {
    this.database = database ?? createDatabase(config.DATABASE_URL);
    this.config = config;
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
  }

  private async findUserById(id: string): Promise<UserRow | undefined> {
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
  }

  private async markLastLogin(id: string): Promise<void> {
    await this.database.execute(sql`update users set last_login_at = now(), updated_at = now() where id = ${id}`);
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
