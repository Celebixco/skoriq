import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AuthController } from "./auth.controller.js";
import type { AuthService } from "./auth.service.js";

describe("AuthController", () => {
  it("returns user summary on login and delegates cookie handling", async () => {
    const service = mockService();
    const response = { setHeader: vi.fn() };
    const controller = new AuthController(service);

    const result = await controller.login({ email: "admin@example.test", password: "correct-password" }, response);

    expect(service.login).toHaveBeenCalledWith("admin@example.test", "correct-password", response);
    expect(result).toEqual({
      user: {
        id: "user-1",
        email: "admin@example.test",
        role: "admin",
        status: "active"
      }
    });
    expect(JSON.stringify(result)).not.toContain("password_hash");
  });

  it("returns generic login failure", async () => {
    const service = mockService({
      login: vi.fn().mockRejectedValue(new UnauthorizedException("Invalid email or password."))
    });

    await expect(new AuthController(service).login({ email: "admin@example.test", password: "wrong-password" }, { setHeader: vi.fn() })).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });

  it("registers a member and delegates cookie handling", async () => {
    const service = mockService();
    const response = { setHeader: vi.fn() };
    const controller = new AuthController(service);

    const result = await controller.register(
      {
        email: "member@example.test",
        firstName: "Ada",
        lastName: "Yılmaz",
        phoneNumber: "+905551112233",
        password: "StrongPass123",
        confirmPassword: "StrongPass123",
        mathLeft: 5,
        mathOperator: "-",
        mathRight: 3,
        mathAnswer: 2
      },
      response
    );

    expect(service.register).toHaveBeenCalledWith(
      {
        email: "member@example.test",
        firstName: "Ada",
        lastName: "Yılmaz",
        phoneNumber: "+905551112233",
        password: "StrongPass123",
        confirmPassword: "StrongPass123",
        mathLeft: 5,
        mathOperator: "-",
        mathRight: 3,
        mathAnswer: 2
      },
      response
    );
    expect(result).toEqual({
      user: {
        id: "user-2",
        email: "member@example.test",
        role: "member",
        status: "active"
      }
    });
    expect(JSON.stringify(result)).not.toContain("password_hash");
  });

  it("delegates forgot-password and reset-password to the auth service", async () => {
    const service = mockService();
    const controller = new AuthController(service);

    await expect(controller.forgotPassword({ email: "member@example.test" })).resolves.toEqual({ ok: true, message: "sent" });
    expect(service.requestPasswordReset).toHaveBeenCalledWith("member@example.test");

    await expect(
      controller.resetPassword({ token: "reset-token", password: "NewStrongPass123", confirmPassword: "NewStrongPass123" })
    ).resolves.toEqual({ ok: true, message: "updated" });
    expect(service.resetPassword).toHaveBeenCalledWith({
      token: "reset-token",
      password: "NewStrongPass123",
      confirmPassword: "NewStrongPass123"
    });
  });

  it("changes a password only for an authenticated user", async () => {
    const service = mockService();
    const controller = new AuthController(service);
    const request = { headers: {}, user: { id: "user-1", email: "admin@example.test", role: "admin" as const, status: "active" as const } };

    await expect(
      controller.changePassword(
        { currentPassword: "CurrentPass123", password: "NewStrongPass123", confirmPassword: "NewStrongPass123" },
        request
      )
    ).resolves.toEqual({ ok: true, message: "changed" });
    expect(service.changePassword).toHaveBeenCalledWith({
      userId: "user-1",
      currentPassword: "CurrentPass123",
      password: "NewStrongPass123",
      confirmPassword: "NewStrongPass123"
    });

    expect(() =>
      controller.changePassword(
        { currentPassword: "CurrentPass123", password: "NewStrongPass123", confirmPassword: "NewStrongPass123" },
        { headers: {} }
      )
    ).toThrow(UnauthorizedException);
  });

  it("returns current user only when the guard attached one", () => {
    const controller = new AuthController(mockService());

    expect(controller.me({ headers: {}, user: { id: "user-1", email: "admin@example.test", role: "admin", status: "active" } })).toEqual({
      user: { id: "user-1", email: "admin@example.test", role: "admin", status: "active" }
    });
    expect(() => controller.me({ headers: {} })).toThrow(UnauthorizedException);
  });

  it("clears cookie on logout", () => {
    const service = mockService();
    const response = { setHeader: vi.fn() };

    expect(new AuthController(service).logout(response)).toEqual({ ok: true });
    expect(service.logout).toHaveBeenCalledWith(response);
  });
});

function mockService(overrides: Partial<AuthService> = {}): AuthService {
  return {
    login: vi.fn().mockResolvedValue({
      id: "user-1",
      email: "admin@example.test",
      role: "admin",
      status: "active"
    }),
    register: vi.fn().mockResolvedValue({
      id: "user-2",
      email: "member@example.test",
      role: "member",
      status: "active"
    }),
    logout: vi.fn().mockReturnValue({ ok: true }),
    requestPasswordReset: vi.fn().mockResolvedValue({ ok: true, message: "sent" }),
    resetPassword: vi.fn().mockResolvedValue({ ok: true, message: "updated" }),
    changePassword: vi.fn().mockResolvedValue({ ok: true, message: "changed" }),
    enabled: true,
    currentUserFromRequest: vi.fn(),
    ...overrides
  } as unknown as AuthService;
}
