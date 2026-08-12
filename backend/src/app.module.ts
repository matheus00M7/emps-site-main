import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { AuthController, JwtGuard } from "./auth";
import { DashboardController } from "./dashboard.controller";
import { OperationsController } from "./operations.controller";
import { PrismaService } from "./prisma.service";
import { UsersController } from "./users.controller";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({ global: true, secret: process.env.JWT_SECRET ?? "change-me", signOptions: { expiresIn: "1d" } }),
  ],
  controllers: [AuthController, UsersController, OperationsController, DashboardController],
  providers: [PrismaService, JwtGuard],
})
export class AppModule {}
