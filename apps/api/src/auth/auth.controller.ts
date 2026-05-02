import { Body, Controller, Get, Inject, Post, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import { IsEmail, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from "class-validator";
import { AuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import type { AuthenticatedRequest, CookieResponse } from "./auth.types.js";

export class LoginRequestBody {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

export class RegisterRequestBody {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  firstName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  lastName!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(24)
  @Matches(/^[+\d][\d\s().-]{8,23}$/)
  phoneNumber!: string;

  @IsString()
  @MinLength(12)
  @Matches(/[a-z]/)
  @Matches(/[A-Z]/)
  @Matches(/\d/)
  password!: string;

  @IsOptional()
  @IsString()
  confirmPassword?: string;

  @IsInt()
  @Min(1)
  @Max(20)
  mathLeft!: number;

  @IsString()
  @Matches(/^[+-]$/)
  mathOperator!: "+" | "-";

  @IsInt()
  @Min(1)
  @Max(20)
  mathRight!: number;

  @IsInt()
  @Min(0)
  @Max(40)
  mathAnswer!: number;
}

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post("login")
  async login(@Body() body: LoginRequestBody, @Res({ passthrough: true }) response: CookieResponse) {
    const user = await this.authService.login(body.email, body.password, response);
    return { user };
  }

  @Post("register")
  async register(@Body() body: RegisterRequestBody, @Res({ passthrough: true }) response: CookieResponse) {
    const user = await this.authService.register(
      {
        email: body.email,
        firstName: body.firstName,
        lastName: body.lastName,
        phoneNumber: body.phoneNumber,
        password: body.password,
        confirmPassword: body.confirmPassword,
        mathLeft: body.mathLeft,
        mathOperator: body.mathOperator,
        mathRight: body.mathRight,
        mathAnswer: body.mathAnswer
      },
      response
    );
    return { user };
  }

  @Post("logout")
  logout(@Res({ passthrough: true }) response: CookieResponse) {
    return this.authService.logout(response);
  }

  @UseGuards(AuthGuard)
  @Get("me")
  me(@Req() request: AuthenticatedRequest) {
    if (!request.user) {
      throw new UnauthorizedException("Authentication required.");
    }
    return { user: request.user };
  }
}
