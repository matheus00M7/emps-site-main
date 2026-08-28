import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  Post,
  Req,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Role } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { PrismaService } from "./prisma.service";
import { LoginDto } from "./dtos";

export type AuthUser = { sub: string; email: string; role: Role };
export type AuthRequest = { headers: { authorization?: string }; user: AuthUser };

const ROLES_KEY = "emps:roles";
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private jwt: JwtService) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const token = request.headers.authorization?.replace(/^Bearer /, "");
    if (!token) throw new UnauthorizedException("Token ausente");
    try { request.user = this.jwt.verify(token); return true; }
    catch { throw new UnauthorizedException("Token inválido"); }
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const allowedRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowedRoles?.length) return true;

    const request = context.switchToHttp().getRequest<AuthRequest>();
    if (!request.user || !allowedRoles.includes(request.user.role)) {
      throw new ForbiddenException("Você não possui permissão para esta operação");
    }
    return true;
  }
}

@Controller("auth")
export class AuthController {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}
  @Post("login")
  async login(@Body() dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) throw new UnauthorizedException("Credenciais inválidas");
    const accessToken = await this.jwt.signAsync({ sub: user.id, email: user.email, role: user.role });
    return { accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
  }
  @UseGuards(JwtGuard)
  @Get("me")
  async me(@Req() request: AuthRequest) {
    return this.prisma.user.findUnique({ where: { id: request.user.sub }, select: { id: true, name: true, email: true, role: true, createdAt: true } });
  }
  @Get("health") health() { return { status: "ok", service: "EMPS API" }; }
}
