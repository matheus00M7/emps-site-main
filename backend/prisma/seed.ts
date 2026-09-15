import {
  GeocodingStatus,
  PrismaClient,
  Role,
  StationStatus,
} from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

const legacyDemoChargerIds = [
  "chg_001",
  "seed_charger_beta",
  "seed_charger_gamma",
  "seed_charger_delta",
  "seed_charger_orion",
  "seed_charger_vega",
];

const legacyDemoAlertIds = [
  "seed_alert_payment",
  "seed_alert_peak",
  "seed_alert_offline",
  "seed_alert_temperature",
  "seed_alert_maintenance",
];

const legacyDemoClientPlates = [
  "ABC1D23",
  "XYZ9A88",
  "BRA2E45",
  "FIAP202",
  "EV2026",
];

async function removeLegacyDemoChargers() {
  await prisma.$transaction(async (tx) => {
    const legacySessions = await tx.chargingSession.findMany({
      where: { chargerId: { in: legacyDemoChargerIds } },
      select: { id: true },
    });
    const legacySessionIds = legacySessions.map(({ id }) => id);

    await tx.payment.deleteMany({
      where: { sessionId: { in: legacySessionIds } },
    });
    await tx.chargingCommand.deleteMany({
      where: { chargerId: { in: legacyDemoChargerIds } },
    });
    await tx.chargingSession.deleteMany({
      where: { chargerId: { in: legacyDemoChargerIds } },
    });
    await tx.paymentIntent.deleteMany({
      where: { chargerId: { in: legacyDemoChargerIds } },
    });
    await tx.alert.deleteMany({
      where: {
        OR: [
          { chargerId: { in: legacyDemoChargerIds } },
          { id: { in: legacyDemoAlertIds } },
        ],
      },
    });
    await tx.charger.deleteMany({
      where: { id: { in: legacyDemoChargerIds } },
    });
    await tx.client.deleteMany({
      where: { plate: { in: legacyDemoClientPlates } },
    });
  });
}

async function main() {
  const [adminPasswordHash, driverPasswordHash, operatorPasswordHash, goodwePasswordHash] = await Promise.all([
    bcrypt.hash("admin123", 10),
    bcrypt.hash("emps123", 10),
    bcrypt.hash("operador123", 10),
    bcrypt.hash("goodwe123", 10),
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

  await prisma.user.upsert({
    where: { email: "operador@emps.com" },
    update: {
      name: "Operador de Homologação EMPS",
      passwordHash: operatorPasswordHash,
      role: Role.OPERATOR,
    },
    create: {
      name: "Operador de Homologação EMPS",
      email: "operador@emps.com",
      passwordHash: operatorPasswordHash,
      role: Role.OPERATOR,
    },
  });

  await prisma.user.upsert({
    where: { email: "goodwe@emps.com" },
    update: {
      name: "Administrador GoodWe",
      passwordHash: goodwePasswordHash,
      role: Role.GOODWE_ADMIN,
    },
    create: {
      name: "Administrador GoodWe",
      email: "goodwe@emps.com",
      passwordHash: goodwePasswordHash,
      role: Role.GOODWE_ADMIN,
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

  await prisma.station.upsert({
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

  await removeLegacyDemoChargers();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
