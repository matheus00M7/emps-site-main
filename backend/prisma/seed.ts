import {
  AlertSeverity,
  ChargerAdministrativeStatus,
  ChargerOperationalStatus,
  ChargerPowerType,
  ChargerStatus,
  GeocodingStatus,
  PaymentMethod,
  PaymentStatus,
  PrismaClient,
  Role,
  SessionStatus,
  StationStatus,
} from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

const daysAgo = (days: number, hour = 12) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, 0, 0, 0);
  return date;
};

async function main() {
  const [adminPasswordHash, driverPasswordHash] = await Promise.all([
    bcrypt.hash("admin123", 10),
    bcrypt.hash("emps123", 10),
  ]);

  const admin = await prisma.user.upsert({
    where: { email: "admin@emps.com" },
    update: {
      name: "Administrador EMPS",
      passwordHash: adminPasswordHash,
      role: Role.ADMIN,
    },
    create: {
      name: "Administrador EMPS",
      email: "admin@emps.com",
      passwordHash: adminPasswordHash,
      role: Role.ADMIN,
    },
  });

  const driverUser = await prisma.user.upsert({
    where: { email: "motorista@emps.com" },
    update: {
      name: "Motorista EMPS",
      passwordHash: driverPasswordHash,
      role: Role.CUSTOMER,
    },
    create: {
      name: "Motorista EMPS",
      email: "motorista@emps.com",
      passwordHash: driverPasswordHash,
      role: Role.CUSTOMER,
    },
  });

  await prisma.client.upsert({
    where: { userId: driverUser.id },
    update: {
      name: "Motorista EMPS",
      vehicle: "BYD Dolphin",
      plate: "EMP5M23",
    },
    create: {
      userId: driverUser.id,
      name: "Motorista EMPS",
      vehicle: "BYD Dolphin",
      plate: "EMP5M23",
    },
  });

  const clientData: Array<[string, string, string]> = [
    ["João Silva", "BYD Dolphin", "ABC1D23"],
    ["Maria Souza", "Volvo EX30", "XYZ9A88"],
    ["Carlos Lima", "GWM Ora 03", "BRA2E45"],
    ["Ana Costa", "Tesla Model 3", "FIAP202"],
    ["Felipe Martins", "BYD Song Plus", "EV2026"],
  ];

  const clients = await Promise.all(
    clientData.map(([name, vehicle, plate]) =>
      prisma.client.upsert({
        where: { plate },
        update: { name, vehicle },
        create: { name, vehicle, plate },
      }),
    ),
  );

  const station = await prisma.station.upsert({
    where: { code: "EMPS-PAULISTA" },
    update: {
      adminId: admin.id,
      name: "EMPS Paulista",
      postalCode: "01419-001",
      street: "Alameda Santos",
      addressNumber: "1437",
      neighborhood: "Jardins",
      city: "São Paulo",
      state: "SP",
      countryCode: "BR",
      latitude: -23.56158,
      longitude: -46.65593,
      geocodingStatus: GeocodingStatus.SUCCESS,
      powerLimitKw: 240,
      status: StationStatus.ACTIVE,
      timezone: "America/Sao_Paulo",
      openingHours: "Aberto 24 horas",
      amenities: ["Café", "Wi-Fi", "Banheiro"],
      featured: true,
    },
    create: {
      id: "st_001",
      adminId: admin.id,
      code: "EMPS-PAULISTA",
      name: "EMPS Paulista",
      postalCode: "01419-001",
      street: "Alameda Santos",
      addressNumber: "1437",
      neighborhood: "Jardins",
      city: "São Paulo",
      state: "SP",
      countryCode: "BR",
      latitude: -23.56158,
      longitude: -46.65593,
      geocodingStatus: GeocodingStatus.SUCCESS,
      powerLimitKw: 240,
      status: StationStatus.ACTIVE,
      timezone: "America/Sao_Paulo",
      openingHours: "Aberto 24 horas",
      amenities: ["Café", "Wi-Fi", "Banheiro"],
      featured: true,
    },
  });

  const chargerData: Array<{
    id: string;
    name: string;
    location: string;
    powerKw: number;
    pricePerKwh: number;
    status: ChargerStatus;
    connectorType: string;
    temperature: number | null;
  }> = [
    {
      id: "chg_001",
      name: "Carregador A01",
      location: "Vaga A01",
      powerKw: 60,
      pricePerKwh: 1.89,
      status: ChargerStatus.AVAILABLE,
      connectorType: "CCS2",
      temperature: 31,
    },
    {
      id: "seed_charger_beta",
      name: "Charger Beta",
      location: "Vaga A02",
      powerKw: 11,
      pricePerKwh: 2.8,
      status: ChargerStatus.IN_USE,
      connectorType: "CCS2",
      temperature: 47,
    },
    {
      id: "seed_charger_gamma",
      name: "Charger Gamma",
      location: "Vaga B01",
      powerKw: 22,
      pricePerKwh: 3.2,
      status: ChargerStatus.OFFLINE,
      connectorType: "CCS2",
      temperature: null,
    },
    {
      id: "seed_charger_delta",
      name: "Charger Delta",
      location: "Vaga B02",
      powerKw: 7.4,
      pricePerKwh: 2.4,
      status: ChargerStatus.MAINTENANCE,
      connectorType: "Tipo 2",
      temperature: 28,
    },
    {
      id: "seed_charger_orion",
      name: "Charger Orion",
      location: "Vaga C01",
      powerKw: 11,
      pricePerKwh: 2.95,
      status: ChargerStatus.AVAILABLE,
      connectorType: "CCS2",
      temperature: 33,
    },
    {
      id: "seed_charger_vega",
      name: "Charger Vega",
      location: "Vaga C02",
      powerKw: 22,
      pricePerKwh: 3.1,
      status: ChargerStatus.IN_USE,
      connectorType: "CCS2",
      temperature: 39,
    },
  ];

  const chargers = await Promise.all(
    chargerData.map((charger, index) =>
      prisma.charger.upsert({
        where: { id: charger.id },
        update: {
          name: charger.name,
          location: charger.location,
          powerKw: charger.powerKw,
          pricePerKwh: charger.pricePerKwh,
          status: charger.status,
          connectorType: charger.connectorType,
          temperature: charger.temperature,
          ...(index === 0
            ? {
                stationId: station.id,
                publicCode: "EMPS-PAULISTA-A01",
                ocppIdentity: "EMPS-PAULISTA-A01",
                ocppVersion: "1.6J",
                serialNumber: "EMPS-PAULISTA-A01-DEMO",
                manufacturer: "EMPS",
                model: "DC 60",
                firmwareVersion: "demo-1.0.0",
                powerType: ChargerPowerType.DC,
                phaseCount: 3,
                configuredPowerLimitKw: 60,
                administrativeStatus: ChargerAdministrativeStatus.ENABLED,
                provisionedAt: new Date(),
              }
            : {}),
        },
        create: {
          ...charger,
          ...(index === 0
            ? {
                stationId: station.id,
                publicCode: "EMPS-PAULISTA-A01",
                ocppIdentity: "EMPS-PAULISTA-A01",
                ocppVersion: "1.6J",
                serialNumber: "EMPS-PAULISTA-A01-DEMO",
                manufacturer: "EMPS",
                model: "DC 60",
                firmwareVersion: "demo-1.0.0",
                powerType: ChargerPowerType.DC,
                phaseCount: 3,
                configuredPowerLimitKw: 60,
                administrativeStatus: ChargerAdministrativeStatus.ENABLED,
                provisionedAt: new Date(),
              }
            : {}),
        },
      }),
    ),
  );

  await prisma.chargerLiveStatus.upsert({
    where: { chargerId: chargers[0].id },
    update: {
      operationalStatus: ChargerOperationalStatus.AVAILABLE,
      currentPowerKw: 0,
      meterTotalKwh: 1284.52,
      voltageV: 400,
      currentA: 0,
      lastErrorCode: null,
      lastSeenAt: new Date(),
    },
    create: {
      chargerId: chargers[0].id,
      operationalStatus: ChargerOperationalStatus.AVAILABLE,
      currentPowerKw: 0,
      meterTotalKwh: 1284.52,
      voltageV: 400,
      currentA: 0,
      lastSeenAt: new Date(),
    },
  });

  await prisma.qrBinding.upsert({
    where: { publicToken: "paulista-a01-demo" },
    update: {
      chargerId: chargers[0].id,
      code: "EMPS-PAULISTA-A01",
      version: 1,
      expiresAt: null,
      revokedAt: null,
    },
    create: {
      id: "qr_001",
      chargerId: chargers[0].id,
      publicToken: "paulista-a01-demo",
      code: "EMPS-PAULISTA-A01",
      version: 1,
    },
  });

  for (let index = 0; index < 14; index += 1) {
    const charger = chargers[index % chargers.length];
    const startTime = daysAgo(index % 7, 8 + (index % 12));
    const endTime = new Date(startTime.getTime() + (25 + index) * 60_000);
    const energyKwh = 5 + index * 0.8;
    const totalPrice = energyKwh * Number(charger.pricePerKwh);
    const meterStartKwh = 800 + index * 20;

    const session = await prisma.chargingSession.upsert({
      where: { code: `EMP-${1001 + index}` },
      update: {
        clientId: clients[index % clients.length].id,
        chargerId: charger.id,
        stationId: charger.stationId,
        startTime,
        endTime,
        durationMinutes: 25 + index,
        energyKwh,
        totalPrice,
        pricePerKwhSnapshot: charger.pricePerKwh,
        meterStartKwh,
        meterEndKwh: meterStartKwh + energyKwh,
        lastMeterKwh: meterStartKwh + energyKwh,
        status: SessionStatus.FINISHED,
      },
      create: {
        code: `EMP-${1001 + index}`,
        clientId: clients[index % clients.length].id,
        chargerId: charger.id,
        stationId: charger.stationId,
        startTime,
        endTime,
        durationMinutes: 25 + index,
        energyKwh,
        totalPrice,
        pricePerKwhSnapshot: charger.pricePerKwh,
        meterStartKwh,
        meterEndKwh: meterStartKwh + energyKwh,
        lastMeterKwh: meterStartKwh + energyKwh,
        status: SessionStatus.FINISHED,
      },
    });

    await prisma.payment.upsert({
      where: { sessionId: session.id },
      update: {
        method: index % 2 ? PaymentMethod.PIX : PaymentMethod.CARD,
        amount: session.totalPrice!,
        currency: "BRL",
        status: index === 2 ? PaymentStatus.PENDING : PaymentStatus.APPROVED,
        provider: "SIMULATED",
        providerPaymentId: `seed-provider-${901 + index}`,
        idempotencyKey: `seed-payment-${901 + index}`,
        paidAt: index === 2 ? null : endTime,
        capturedAt: index === 2 ? null : endTime,
      },
      create: {
        code: `PAY-${901 + index}`,
        sessionId: session.id,
        method: index % 2 ? PaymentMethod.PIX : PaymentMethod.CARD,
        amount: session.totalPrice!,
        currency: "BRL",
        status: index === 2 ? PaymentStatus.PENDING : PaymentStatus.APPROVED,
        provider: "SIMULATED",
        providerPaymentId: `seed-provider-${901 + index}`,
        idempotencyKey: `seed-payment-${901 + index}`,
        paidAt: index === 2 ? null : endTime,
        capturedAt: index === 2 ? null : endTime,
      },
    });
  }

  for (const index of [1, 5]) {
    await prisma.chargingSession.upsert({
      where: { code: `EMP-ACT-${index}` },
      update: {
        clientId: clients[index % clients.length].id,
        chargerId: chargers[index].id,
        stationId: chargers[index].stationId,
        startTime: new Date(Date.now() - 42 * 60_000),
        pricePerKwhSnapshot: chargers[index].pricePerKwh,
        status: SessionStatus.ACTIVE,
      },
      create: {
        code: `EMP-ACT-${index}`,
        clientId: clients[index % clients.length].id,
        chargerId: chargers[index].id,
        stationId: chargers[index].stationId,
        startTime: new Date(Date.now() - 42 * 60_000),
        pricePerKwhSnapshot: chargers[index].pricePerKwh,
        status: SessionStatus.ACTIVE,
      },
    });
  }

  const alerts: Array<{
    id: string;
    title: string;
    description: string;
    severity: AlertSeverity;
    chargerIndex: number | null;
  }> = [
    {
      id: "seed_alert_offline",
      title: "Carregador offline",
      description: "Charger Gamma offline há 2h.",
      severity: AlertSeverity.HIGH,
      chargerIndex: 2,
    },
    {
      id: "seed_alert_temperature",
      title: "Temperatura elevada",
      description: "Charger Beta com temperatura acima da média.",
      severity: AlertSeverity.MEDIUM,
      chargerIndex: 1,
    },
    {
      id: "seed_alert_payment",
      title: "Pagamento pendente",
      description: "Pagamento pendente na sessão EMP-1003.",
      severity: AlertSeverity.MEDIUM,
      chargerIndex: null,
    },
    {
      id: "seed_alert_peak",
      title: "Pico de uso",
      description: "Pico de uso previsto entre 18h e 20h.",
      severity: AlertSeverity.LOW,
      chargerIndex: null,
    },
    {
      id: "seed_alert_maintenance",
      title: "Manutenção programada",
      description: "Charger Delta em manutenção programada.",
      severity: AlertSeverity.LOW,
      chargerIndex: 3,
    },
  ];

  await Promise.all(
    alerts.map(({ id, title, description, severity, chargerIndex }) =>
      prisma.alert.upsert({
        where: { id },
        update: {
          title,
          description,
          severity,
          chargerId: chargerIndex === null ? null : chargers[chargerIndex].id,
        },
        create: {
          id,
          title,
          description,
          severity,
          chargerId: chargerIndex === null ? null : chargers[chargerIndex].id,
        },
      }),
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
