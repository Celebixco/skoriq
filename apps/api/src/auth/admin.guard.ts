import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import type { AuthenticatedRequest } from "./auth.types.js";

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user?.role !== "admin") {
      throw new ForbiddenException("Admin access required.");
    }
    return true;
  }
}
