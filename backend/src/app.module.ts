import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule, type JwtSignOptions } from "@nestjs/jwt";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthController, JwtGuard, RolesGuard } from "./auth";
import { AdminOperationsService } from "./admin-operations.service";
import { ChargingGatewayService } from "./charging-gateway.service";
import { DashboardController } from "./dashboard.controller";
import {
  MobileAuthController,
  MobileController,
  PaymentWebhookController,
} from "./mobile.controller";
import { MobileService } from "./mobile.service";
import { OperationsController } from "./operations.controller";
import { PaymentGatewayService } from "./payment-gateway.service";
import { PrismaService } from "./prisma.service";
import { RealtimeModule } from "./realtime.module";
import { UsersController } from "./users.controller";

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET é obrigatório em produção");
  }
  return "emps-development-only-secret-change-before-deploying";
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    JwtModule.register({
      global: true,
      secret: jwtSecret(),
      signOptions: {
        audience: "emps-clients",
        expiresIn: (process.env.JWT_EXPIRES_IN ?? "15m") as JwtSignOptions["expiresIn"],
        issuer: "emps-api",
      },
      verifyOptions: {
        audience: "emps-clients",
        issuer: "emps-api",
      },
    }),
    RealtimeModule,
  ],
  controllers: [
    AuthController,
    MobileAuthController,
    MobileController,
    PaymentWebhookController,
    UsersController,
    OperationsController,
    DashboardController,
  ],
  providers: [
    PrismaService,
    AdminOperationsService,
    MobileService,
    PaymentGatewayService,
    ChargingGatewayService,
    JwtGuard,
    RolesGuard,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
