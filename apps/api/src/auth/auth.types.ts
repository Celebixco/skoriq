export type AuthRole = "admin" | "member";
export type AuthStatus = "active" | "disabled";

export interface AuthUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phoneNumber?: string | null;
  role: AuthRole;
  status: AuthStatus;
  createdAt?: string;
  lastLoginAt?: string | null;
}

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthUser;
}

export interface CookieResponse {
  setHeader(name: string, value: string | string[]): void;
}
