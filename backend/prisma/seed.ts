import { PrismaClient, ChargerStatus, SessionStatus, PaymentMethod, PaymentStatus, AlertSeverity } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();
const daysAgo = (days: number, hour = 12) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, 0, 0, 0);
  return date;
};

async function main() {
  await prisma.payment.deleteMany();
  await prisma.chargingSession.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.charger.deleteMany();
  await prisma.client.deleteMany();
  await prisma.user.deleteMany();

  await prisma.user.create({
    data: { name: "Administrador EMPS", email: "admin@emps.com", passwordHash: await bcrypt.hash("admin123", 10), role: "ADMIN" },
  });

  const clients = await Promise.all([
    ["João Silva", "BYD Dolphin", "ABC1D23"],
    ["Maria Souza", "Volvo EX30", "XYZ9A88"],
    ["Carlos Lima", "GWM Ora 03", "BRA2E45"],
    ["Ana Costa", "Tesla Model 3", "FIAP202"],
    ["Felipe Martins", "BYD Song Plus", "EV2026"],
  ].map(([name, vehicle, plate]) => prisma.client.create({ data: { name, vehicle, plate } })));

  const chargerData: Array<[string, string, number, number, ChargerStatus, string, number | null]> = [
    ["Charger Alpha", "Vaga A01", 7.4, 2.5, "AVAILABLE", "Tipo 2", 31],
    ["Charger Beta", "Vaga A02", 11, 2.8, "IN_USE", "CCS2", 47],
    ["Charger Gamma", "Vaga B01", 22, 3.2, "OFFLINE", "CCS2", null],
    ["Charger Delta", "Vaga B02", 7.4, 2.4, "MAINTENANCE", "Tipo 2", 28],
    ["Charger Orion", "Vaga C01", 11, 2.95, "AVAILABLE", "CCS2", 33],
    ["Charger Vega", "Vaga C02", 22, 3.1, "IN_USE", "CCS2", 39],
  ];
  const chargers = await Promise.all(chargerData.map(([name, location, powerKw, pricePerKwh, status, connectorType, temperature]) =>
    prisma.charger.create({ data: { name, location, powerKw, pricePerKwh, status, connectorType, temperature } })));

  for (let i = 0; i < 14; i++) {
    const charger = chargers[i % chargers.length];
    const startTime = daysAgo(i % 7, 8 + (i % 12));
    const energy = 5 + i * 0.8;
    const session = await prisma.chargingSession.create({
      data: {
        code: `EMP-${1001 + i}`, clientId: clients[i % clients.length].id, chargerId: charger.id,
        startTime, endTime: new Date(startTime.getTime() + (25 + i) * 60000), durationMinutes: 25 + i,
        energyKwh: energy, totalPrice: energy * Number(charger.pricePerKwh), status: SessionStatus.FINISHED,
      },
    });
    await prisma.payment.create({
      data: {
        code: `PAY-${901 + i}`, sessionId: session.id, method: i % 2 ? PaymentMethod.PIX : PaymentMethod.CARD,
        amount: session.totalPrice!, status: i === 2 ? PaymentStatus.PENDING : PaymentStatus.APPROVED, paidAt: i === 2 ? null : session.endTime,
      },
    });
  }
  for (const index of [1, 5]) {
    await prisma.chargingSession.create({
      data: { code: `EMP-ACT-${index}`, clientId: clients[index % clients.length].id, chargerId: chargers[index].id, startTime: new Date(Date.now() - 42 * 60000), status: SessionStatus.ACTIVE },
    });
  }
  const alerts: Array<[string, string, AlertSeverity, number | null]> = [
    ["Carregador offline", "Charger Gamma offline há 2h.", "HIGH", 2],
    ["Temperatura elevada", "Charger Beta com temperatura acima da média.", "MEDIUM", 1],
    ["Pagamento pendente", "Pagamento pendente na sessão EMP-1003.", "MEDIUM", null],
    ["Pico de uso", "Pico de uso previsto entre 18h e 20h.", "LOW", null],
    ["Manutenção programada", "Charger Delta em manutenção programada.", "LOW", 3],
  ];
  await Promise.all(alerts.map(([title, description, severity, charger]) => prisma.alert.create({
    data: { title, description, severity, chargerId: charger === null ? null : chargers[charger].id },
  })));
}

main().finally(() => prisma.$disconnect());
