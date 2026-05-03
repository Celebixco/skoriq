import { BadRequestException, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AdminGuard } from "./admin.guard.js";
import { AuthGuard } from "./auth.guard.js";
import type { PasswordResetEmailSender } from "./password-reset-email.service.js";
import { AuthService, hashPasswordResetToken, isStrongPassword, normalizeEmail, normalizePhoneNumber } from "./auth.service.js";
import { serializeAuthCookie } from "./cookies.js";
import { hashPassword } from "./password.js";
import type { CookieResponse } from "./auth.types.js";
import type { AppConfig } from "@sports-data/config";
import type { Database } from "@sports-data/database";

describe("AuthService", () => {
  it("logs in with normalized email, sets an httpOnly cookie, and returns no password hash", async () => {
    const passwordHash = await hashPassword("correct-password");
    const database = mockDatabase([
      [
        {
          id: "user-1",
          email: "admin@example.test",
          password_hash: passwordHash,
          role: "admin",
          status: "active",
          created_at: new Date("2026-04-30T00:00:00.000Z"),
          last_login_at: null
        }
      ],
      []
    ]);
    const response = mockResponse();
    const service = new AuthService(database, testConfig());

    const user = await service.login(" ADMIN@EXAMPLE.TEST ", "correct-password", response);

    expect(user).toMatchObject({ id: "user-1", email: "admin@example.test", role: "admin", status: "active" });
    expect(JSON.stringify(user)).not.toContain("password_hash");
    expect(response.setHeader).toHaveBeenCalledWith("Set-Cookie", expect.stringContaining("HttpOnly"));
    expect(response.setHeader).toHaveBeenCalledWith("Set-Cookie", expect.stringContaining("SameSite=Lax"));
    expect(String(response.setHeader.mock.calls[0]?.[1])).not.toContain("correct-password");
    expect(String(response.setHeader.mock.calls[0]?.[1])).not.toContain(passwordHash);
  });

  it("falls back to legacy users schema when optional profile columns are missing during login", async () => {
    const passwordHash = await hashPassword("correct-password");
    const database = {
      execute: vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('column "phone_number" does not exist'), { code: "42703" }))
        .mockResolvedValueOnce([
          {
            payload: {
              id: "user-1",
              email: "admin@example.test",
              password_hash: passwordHash,
              role: "admin",
              status: "active",
              created_at: new Date("2026-04-30T00:00:00.000Z"),
              last_login_at: null
            }
          }
        ])
        .mockResolvedValueOnce([])
    } as unknown as Database;
    const response = mockResponse();

    const user = await new AuthService(database, testConfig()).login("admin@example.test", "correct-password", response);

    expect(user).toMatchObject({ id: "user-1", email: "admin@example.test", role: "admin", status: "active" });
    expect(database.execute).toHaveBeenCalledTimes(3);
  });

  it("uses generic 401 for invalid credentials and disabled users", async () => {
    const passwordHash = await hashPassword("correct-password");
    const disabledDatabase = mockDatabase([
      [
        {
          id: "user-1",
          email: "admin@example.test",
          password_hash: passwordHash,
          role: "admin",
          status: "disabled",
          created_at: new Date(),
          last_login_at: null
        }
      ]
    ]);
    await expect(new AuthService(disabledDatabase, testConfig()).login("admin@example.test", "correct-password", mockResponse())).rejects.toThrow(
      new UnauthorizedException("E-posta veya şifre hatalı.")
    );

    const wrongPasswordDatabase = mockDatabase([
      [
        {
          id: "user-1",
          email: "admin@example.test",
          password_hash: passwordHash,
          role: "admin",
          status: "active",
          created_at: new Date(),
          last_login_at: null
        }
      ]
    ]);
    await expect(new AuthService(wrongPasswordDatabase, testConfig()).login("admin@example.test", "wrong-password", mockResponse())).rejects.toThrow(
      new UnauthorizedException("E-posta veya şifre hatalı.")
    );
  });

  it("returns current user from a valid cookie and null without a cookie", async () => {
    const token = serializeAuthCookie("betify_auth", "token-placeholder", { maxAgeSeconds: 86400, secure: false });
    expect(token).toContain("betify_auth=token-placeholder");
    const serviceToken = await createValidCookieValue();
    const database = mockDatabase([
      [
        {
          id: "user-1",
          email: "admin@example.test",
          password_hash: "redacted",
          role: "admin",
          status: "active",
          created_at: new Date("2026-04-30T00:00:00.000Z"),
          last_login_at: null
        }
      ]
    ]);
    const service = new AuthService(database, testConfig());

    await expect(service.currentUserFromRequest({ headers: {} })).resolves.toBeNull();
    await expect(service.currentUserFromRequest({ headers: { cookie: `betify_auth=${serviceToken}` } })).resolves.toMatchObject({
      id: "user-1",
      email: "admin@example.test"
    });
  });

  it("falls back to legacy users schema when loading the current user", async () => {
    const serviceToken = await createValidCookieValue();
    const database = {
      execute: vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('column "first_name" does not exist'), { code: "42703" }))
        .mockResolvedValueOnce([
          {
            payload: {
              id: "user-1",
              email: "admin@example.test",
              password_hash: "redacted",
              role: "admin",
              status: "active",
              created_at: new Date("2026-04-30T00:00:00.000Z"),
              last_login_at: null
            }
          }
        ])
    } as unknown as Database;

    const user = await new AuthService(database, testConfig()).currentUserFromRequest({ headers: { cookie: `betify_auth=${serviceToken}` } });

    expect(user).toMatchObject({ id: "user-1", email: "admin@example.test", role: "admin", status: "active" });
    expect(database.execute).toHaveBeenCalledTimes(2);
  });

  it("clears auth cookie on logout", () => {
    const response = mockResponse();
    const result = new AuthService(mockDatabase([]), testConfig()).logout(response);

    expect(result).toEqual({ ok: true });
    expect(response.setHeader).toHaveBeenCalledWith("Set-Cookie", expect.stringContaining("Max-Age=0"));
  });

  it("normalizes email lowercase", () => {
    expect(normalizeEmail(" Admin@Example.TEST ")).toBe("admin@example.test");
  });

  it("normalizes Turkish phone numbers to +90 format", () => {
    expect(normalizePhoneNumber("555 111 22 33")).toBe("+905551112233");
    expect(normalizePhoneNumber("0555 111 22 33")).toBe("+905551112233");
    expect(normalizePhoneNumber("+90 (555) 111-22-33")).toBe("+905551112233");
  });

  it("registers a member with normalized email, hashed password, and auth cookie", async () => {
    const database = mockDatabase([
      [],
      [
        {
          id: "user-2",
          email: "member@example.test",
          first_name: "Ada",
          last_name: "Yılmaz",
          phone_number: "+905551112233",
          password_hash: "stored-hash",
          role: "member",
          status: "active",
          created_at: new Date("2026-04-30T00:00:00.000Z"),
          last_login_at: new Date("2026-04-30T00:00:01.000Z")
        }
      ]
    ]);
    const response = mockResponse();
    const user = await new AuthService(database, testConfig()).register(
      {
        email: " Member@Example.TEST ",
        firstName: " Ada ",
        lastName: " Yılmaz ",
        phoneNumber: " +905551112233 ",
        password: "StrongPass123",
        confirmPassword: "StrongPass123",
        mathLeft: 5,
        mathOperator: "-",
        mathRight: 3,
        mathAnswer: 2
      },
      response
    );

    expect(user).toMatchObject({ email: "member@example.test", firstName: "Ada", lastName: "Yılmaz", phoneNumber: "+905551112233", role: "member", status: "active" });
    expect(JSON.stringify(user)).not.toContain("password_hash");
    expect(response.setHeader).toHaveBeenCalledWith("Set-Cookie", expect.stringContaining("HttpOnly"));
    const serializedCalls = JSON.stringify((database.execute as ReturnType<typeof vi.fn>).mock.calls);
    expect(serializedCalls).not.toContain("StrongPass123");
  });

  it("creates a password reset token and sends a reset email without exposing membership", async () => {
    const emailSender = mockPasswordResetEmailSender();
    const database = mockDatabase([
      [
        {
          id: "user-2",
          email: "member@example.test",
          password_hash: "stored-hash",
          role: "member",
          status: "active",
          created_at: new Date("2026-04-30T00:00:00.000Z"),
          last_login_at: new Date("2026-04-30T00:00:01.000Z")
        }
      ],
      [],
      []
    ]);

    const result = await new AuthService(database, testConfig(), emailSender).requestPasswordReset(" Member@Example.TEST ");

    expect(result).toEqual({
      ok: true,
      message: "Eger bu e-posta sistemde kayitliysa, sifre sifirlama baglantisi gonderildi."
    });
    expect(emailSender.sendPasswordResetEmail).toHaveBeenCalledWith({
      email: "member@example.test",
      resetUrl: expect.stringContaining("/reset-password?token=")
    });
    const serializedCalls = JSON.stringify((database.execute as ReturnType<typeof vi.fn>).mock.calls);
    expect(serializedCalls).not.toContain("member@example.test/reset-password?token=");
  });

  it("returns the same forgot-password response when the user does not exist", async () => {
    const result = await new AuthService(mockDatabase([[]]), testConfig(), mockPasswordResetEmailSender()).requestPasswordReset("missing@example.test");
    expect(result).toEqual({
      ok: true,
      message: "Eger bu e-posta sistemde kayitliysa, sifre sifirlama baglantisi gonderildi."
    });
  });

  it("resets a password only with a valid unused token", async () => {
    const database = mockDatabase([
      [
        {
          id: "prt-1",
          user_id: "user-2",
          token_hash: hashPasswordResetToken("reset-token-value-1234567890"),
          expires_at: new Date("2026-05-01T13:00:00.000Z"),
          used_at: null
        }
      ],
      [],
      [],
      []
    ]);

    const result = await new AuthService(database, testConfig(), mockPasswordResetEmailSender()).resetPassword({
      token: "reset-token-value-1234567890",
      password: "StrongPass123",
      confirmPassword: "StrongPass123"
    });

    expect(result).toEqual({ ok: true, message: "Şifreniz güncellendi. Giriş yapabilirsiniz." });
    const calls = (database.execute as ReturnType<typeof vi.fn>).mock.calls.map((entry) => JSON.stringify(entry));
    expect(calls.join(" ")).not.toContain("StrongPass123");
  });

  it("rejects invalid reset tokens and missing password reset service safely", async () => {
    await expect(
      new AuthService(mockDatabase([[]]), testConfig(), mockPasswordResetEmailSender()).resetPassword({
        token: "reset-token-value-1234567890",
        password: "StrongPass123",
        confirmPassword: "StrongPass123"
      })
    ).rejects.toThrow(new BadRequestException("Şifre sıfırlama bağlantısı geçersiz veya süresi dolmuş."));

    await expect(new AuthService(mockDatabase([]), { ...testConfig(), FRONTEND_ORIGIN: undefined }, mockPasswordResetEmailSender(false)).requestPasswordReset("member@example.test")).rejects.toThrow(
      new ServiceUnavailableException("Şifre sıfırlama servisi henüz hazır değil.")
    );
  });

  it("rejects duplicate email, weak password, and confirm password mismatch safely", async () => {
    const validMemberInput = {
      email: "bad@example.test",
      firstName: "Ada",
      lastName: "Yılmaz",
      phoneNumber: "+905551112233",
      mathLeft: 5,
      mathOperator: "-" as const,
      mathRight: 3,
      mathAnswer: 2
    };
    await expect(new AuthService(mockDatabase([]), testConfig()).register({ ...validMemberInput, password: "weak" }, mockResponse())).rejects.toThrow(
      new BadRequestException("Şifre en az 12 karakter olmalı; büyük harf, küçük harf ve rakam içermeli.")
    );
    await expect(
      new AuthService(mockDatabase([]), testConfig()).register(
        { ...validMemberInput, password: "StrongPass123", confirmPassword: "Different123" },
        mockResponse()
      )
    ).rejects.toThrow(new BadRequestException("Şifre onayı eşleşmiyor."));
    await expect(
      new AuthService(mockDatabase([]), testConfig()).register({ ...validMemberInput, firstName: "A", password: "StrongPass123" }, mockResponse())
    ).rejects.toThrow(new BadRequestException("Kayıt işlemi tamamlanamadı. Bilgileri kontrol edip tekrar deneyin."));
    await expect(
      new AuthService(mockDatabase([]), testConfig()).register({ ...validMemberInput, phoneNumber: "123", password: "StrongPass123" }, mockResponse())
    ).rejects.toThrow(new BadRequestException("Kayıt işlemi tamamlanamadı. Bilgileri kontrol edip tekrar deneyin."));
    await expect(
      new AuthService(mockDatabase([]), testConfig()).register({ ...validMemberInput, password: "StrongPass123", mathAnswer: 9 }, mockResponse())
    ).rejects.toThrow(new BadRequestException("Güvenlik sorusu hatalı."));

    const passwordHash = await hashPassword("StrongPass123");
    await expect(
      new AuthService(
        mockDatabase([
          [
            {
              id: "user-1",
              email: "member@example.test",
              password_hash: passwordHash,
              role: "member",
              status: "active",
              created_at: new Date(),
              last_login_at: null
            }
          ]
        ]),
        testConfig()
      ).register({ ...validMemberInput, email: "member@example.test", password: "StrongPass123" }, mockResponse())
    ).rejects.toThrow(new BadRequestException("Kayıt işlemi tamamlanamadı. Bilgileri kontrol edip tekrar deneyin."));
  });

  it("validates password complexity", () => {
    expect(isStrongPassword("StrongPass123")).toBe(true);
    expect(isStrongPassword("strongpass123")).toBe(false);
    expect(isStrongPassword("STRONGPASS123")).toBe(false);
    expect(isStrongPassword("StrongPassword")).toBe(false);
    expect(isStrongPassword("Short1A")).toBe(false);
  });
});

describe("AuthGuard", () => {
  it("blocks unauthenticated requests when auth is enabled", async () => {
    const service = {
      enabled: true,
      currentUserFromRequest: vi.fn().mockResolvedValue(null)
    } as unknown as AuthService;
    const guard = new AuthGuard(service);

    await expect(guard.canActivate(mockExecutionContext({ headers: {} }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("allows authenticated requests and attaches user", async () => {
    const request = { headers: {} };
    const service = {
      enabled: true,
      currentUserFromRequest: vi.fn().mockResolvedValue({ id: "user-1", email: "admin@example.test", role: "admin", status: "active" })
    } as unknown as AuthService;
    const guard = new AuthGuard(service);

    await expect(guard.canActivate(mockExecutionContext(request))).resolves.toBe(true);
    expect(request).toMatchObject({ user: { email: "admin@example.test" } });
  });

  it("allows requests when auth is disabled", async () => {
    const service = {
      enabled: false,
      currentUserFromRequest: vi.fn()
    } as unknown as AuthService;

    await expect(new AuthGuard(service).canActivate(mockExecutionContext({ headers: {} }))).resolves.toBe(true);
  });
});

describe("AdminGuard", () => {
  it("returns 403 for authenticated non-admin users", () => {
    const request = { headers: {}, user: { id: "user-1", email: "member@example.test", role: "member", status: "active" } };
    const guard = new AdminGuard({ enabled: true } as AuthService);

    expect(() => guard.canActivate(mockExecutionContext(request))).toThrow(new ForbiddenException("Admin access required."));
  });

  it("returns 403 without an admin user even when auth is disabled", () => {
    const guard = new AdminGuard({ enabled: false } as AuthService);

    expect(() => guard.canActivate(mockExecutionContext({ headers: {} }))).toThrow(new ForbiddenException("Admin access required."));
  });

  it("allows admin users", () => {
    const adminRequest = { headers: {}, user: { id: "admin-1", email: "admin@example.test", role: "admin", status: "active" } };

    expect(new AdminGuard({ enabled: true } as AuthService).canActivate(mockExecutionContext(adminRequest))).toBe(true);
    expect(new AdminGuard({ enabled: false } as AuthService).canActivate(mockExecutionContext(adminRequest))).toBe(true);
  });
});

async function createValidCookieValue() {
  const { signAuthToken } = await import("./token.js");
  return signAuthToken({ sub: "user-1", email: "admin@example.test", role: "admin" }, "test-secret", 86400);
}

function mockResponse() {
  const setHeader = vi.fn((name: string, value: string | string[]) => {
    void name;
    void value;
  });
  return {
    setHeader
  } satisfies CookieResponse;
}

function mockPasswordResetEmailSender(configured = true): PasswordResetEmailSender {
  return {
    configured,
    sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined)
  };
}

function mockDatabase(results: unknown[][]): Database {
  return {
    execute: vi.fn().mockImplementation(() => Promise.resolve(results.shift() ?? []))
  } as unknown as Database;
}

function mockExecutionContext(request: object) {
  return {
    switchToHttp: () => ({
      getRequest: () => request
    })
  } as ExecutionContext;
}

function testConfig(): AppConfig {
  return {
    NODE_ENV: "test",
    LOG_LEVEL: "error",
    API_PORT: 3000,
    WORKER_CONCURRENCY: 3,
    SCHEDULER_TICK_CRON: "*/15 * * * *",
    CLEANUP_CRON: "0 3 * * *",
    MOCK_PROVIDER_ENABLED: false,
    APIFOOTBALL_COM_API_KEY: undefined,
    APIFOOTBALL_COM_BASE_URL: "https://apiv3.apifootball.com/",
    APIFOOTBALL_COM_ENABLED: false,
    APIFOOTBALL_COM_TIMEOUT_MS: 15000,
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/sports_data",
    DB_EXECUTION_TARGET: "local",
    ALLOW_REMOTE_TEST_DB: false,
    NEON_BRANCH_NAME: undefined,
    REDIS_URL: "redis://localhost:6379",
    AUTH_ENABLED: true,
    AUTH_JWT_SECRET: "test-secret",
    AUTH_COOKIE_NAME: "betify_auth",
    AUTH_TOKEN_TTL_SECONDS: 86400,
    RESEND_API_KEY: "re_test_123",
    AUTH_PASSWORD_RESET_FROM_EMAIL: "noreply@example.test",
    AUTH_PASSWORD_RESET_URL_BASE: "https://skoriq.example.test",
    AUTH_PASSWORD_RESET_TTL_MINUTES: 60,
    FRONTEND_ORIGIN: "https://skoriq.example.test",
    CORS_ORIGIN: "https://skoriq.example.test",
    RAW_PAYLOAD_SUCCESS_RETENTION_DAYS: 7,
    RAW_PAYLOAD_FAILED_RETENTION_DAYS: 30,
    SYNC_LOG_RETENTION_DAYS: 14,
    PROVIDER_DEFAULT_RATE_LIMIT_PER_MINUTE: 60
  };
}
