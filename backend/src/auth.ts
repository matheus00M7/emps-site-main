import { Body, CanActivate, Controller, ExecutionContext, Injectable, Post, Get, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { PrismaService } from "./prisma.service";
import { LoginDto } from "./dtos";

export type AuthRequest = { headers: { authorization?: string }; user: { sub: string; email: string; role: string } };

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

@Controller("auth")
export class AuthController {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}
  @Post("login")
  async login(@Body() dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
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
