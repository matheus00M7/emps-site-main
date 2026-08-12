import { ChargerStatus, PaymentMethod, AlertStatus } from "@prisma/client";
import { IsEmail, IsEnum, IsNumber, IsOptional, IsString, Min } from "class-validator";

export class LoginDto { @IsEmail() email!: string; @IsString() password!: string; }
export class CreateClientDto { @IsString() name!: string; @IsString() vehicle!: string; @IsString() plate!: string; }
export class UpdateClientDto { @IsOptional() @IsString() name?: string; @IsOptional() @IsString() vehicle?: string; @IsOptional() @IsString() plate?: string; }
export class CreateChargerDto {
  @IsString() name!: string; @IsString() location!: string; @IsString() connectorType!: string;
  @IsNumber() @Min(0) powerKw!: number; @IsNumber() @Min(0) pricePerKwh!: number;
  @IsOptional() @IsNumber() temperature?: number; @IsOptional() @IsEnum(ChargerStatus) status?: ChargerStatus;
}
export class UpdateChargerDto extends CreateChargerDto {}
export class UpdateChargerStatusDto { @IsEnum(ChargerStatus) status!: ChargerStatus; }
export class StartChargingSessionDto { @IsString() clientId!: string; @IsString() chargerId!: string; }
export class FinishChargingSessionDto { @IsOptional() @IsNumber() durationMinutes?: number; }
export class SimulatePaymentDto { @IsString() sessionId!: string; @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod; }
export class UpdateAlertStatusDto { @IsEnum(AlertStatus) status!: AlertStatus; }
