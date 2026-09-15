import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  ChargerAdministrativeStatus,
  ChargerOperationalStatus,
  ChargerProvisioningStatus,
  ChargerPowerType,
  ChargerStatus,
  Role,
  StationStatus,
} from "@prisma/client";
import { ChargerProvisioningService } from "../src/charger-provisioning.service";
import { hashOpaqueToken } from "../src/mobile.utils";
import { PrismaService } from "../src/prisma.service";
import { RealtimeService } from "../src/realtime.service";

const activationCode = "EMPS-AB12-CD34";

function realtimeSpy() {
  const events: unknown[] = [];
  return {
    events,
    service: {
      publish(event: unknown) { events.push(event); },
      publishToOperations(event: unknown) { events.push(event); },
    } as RealtimeService,
  };
}

test("validação física confere token, serial e identidade OCPP antes de avançar", async () => {
  const updates: unknown[] = [];
  const prisma = {
    chargerProvisioning: {
      findUnique() {
        return Promise.resolve({
          activationExpiresAt: new Date(Date.now() + 60_000),
          id: "prov-1",
          ocppIdentity: "OCPP-A02",
          serialNumber: "SERIAL-A02",
          status: ChargerProvisioningStatus.PENDING_CONNECTION,
        });
      },
      updateMany(args: unknown) {
        updates.push(args);
        return Promise.resolve({ count: 1 });
      },
    },
  } as unknown as PrismaService;
  const realtime = realtimeSpy();
  const service = new ChargerProvisioningService(prisma, realtime.service);

  const result = await service.claim({
    activationCode,
    firmwareVersion: "1.0.0",
    ocppIdentity: "ocpp-a02",
    serialNumber: "serial-a02",
  });

  assert.equal(result.status, ChargerProvisioningStatus.PENDING_APPROVAL);
  assert.equal(updates.length, 1);
  assert.equal(realtime.events.length, 1);
});

test("validação física rejeita equipamento diferente mesmo com código correto", async () => {
  let updated = false;
  const prisma = {
    chargerProvisioning: {
      findUnique(args: { where: { activationTokenHash: string } }) {
        assert.equal(args.where.activationTokenHash, hashOpaqueToken(activationCode));
        return Promise.resolve({
          activationExpiresAt: new Date(Date.now() + 60_000),
          id: "prov-1",
          ocppIdentity: "OCPP-A02",
          serialNumber: "SERIAL-A02",
          status: ChargerProvisioningStatus.PENDING_CONNECTION,
        });
      },
      updateMany() {
        updated = true;
        return Promise.resolve({ count: 1 });
      },
    },
  } as unknown as PrismaService;
  const service = new ChargerProvisioningService(prisma, realtimeSpy().service);

  await assert.rejects(
    service.claim({
      activationCode,
      ocppIdentity: "OCPP-FALSO",
      serialNumber: "SERIAL-A02",
    }),
    BadRequestException,
  );
  assert.equal(updated, false);
});

test("repetir a validação já concluída retorna sucesso sem alterar o banco", async () => {
  let updated = false;
  const verifiedAt = new Date();
  const prisma = {
    chargerProvisioning: {
      findUnique() {
        return Promise.resolve({
          activationExpiresAt: new Date(Date.now() + 60_000),
          connectionVerifiedAt: verifiedAt,
          id: "prov-1",
          ocppIdentity: "OCPP-A02",
          serialNumber: "SERIAL-A02",
          status: ChargerProvisioningStatus.PENDING_APPROVAL,
        });
      },
      updateMany() {
        updated = true;
        return Promise.resolve({ count: 1 });
      },
    },
  } as unknown as PrismaService;
  const realtime = realtimeSpy();
  const service = new ChargerProvisioningService(prisma, realtime.service);

  const result = await service.claim({
    activationCode,
    ocppIdentity: "ocpp-a02",
    serialNumber: "serial-a02",
  });

  assert.equal(result.status, ChargerProvisioningStatus.PENDING_APPROVAL);
  assert.equal(result.verifiedAt, verifiedAt.toISOString());
  assert.equal(updated, false);
  assert.equal(realtime.events.length, 0);
});

test("homologação cria carregador habilitado, live status e QR na mesma transação", async () => {
  const chargerCreates: Array<Record<string, unknown>> = [];
  const provisioningUpdates: unknown[] = [];
  let findCalls = 0;
  const approvalRequest = {
    chargerId: null,
    connectionVerifiedAt: new Date(),
    connectorType: "CCS2",
    firmwareVersion: "1.0.0",
    id: "prov-1",
    location: "Vaga A02",
    manufacturer: "EMPS",
    model: "DC 60",
    name: "Carregador A02",
    ocppIdentity: "OCPP-A02",
    ocppVersion: "1.6J",
    phaseCount: 3,
    powerKw: 60,
    powerType: ChargerPowerType.DC,
    pricePerKwh: 1.89,
    serialNumber: "SERIAL-A02",
    station: { code: "EMPS-PAULISTA", id: "st-1", status: StationStatus.ACTIVE },
    stationId: "st-1",
    status: ChargerProvisioningStatus.PENDING_APPROVAL,
  };
  const tx = {
    charger: {
      create(args: { data: Record<string, unknown> }) {
        chargerCreates.push(args.data);
        return Promise.resolve({ id: "charger-a02" });
      },
    },
    chargerProvisioning: {
      update(args: unknown) {
        provisioningUpdates.push(args);
        return Promise.resolve({});
      },
      updateMany(args: unknown) {
        provisioningUpdates.push(args);
        return Promise.resolve({ count: 1 });
      },
    },
  };
  const prisma = {
    $transaction(callback: (client: typeof tx) => Promise<unknown>) {
      return callback(tx);
    },
    chargerProvisioning: {
      findUnique() {
        findCalls += 1;
        return Promise.resolve(findCalls === 1 ? approvalRequest : { id: "prov-1" });
      },
    },
  } as unknown as PrismaService;
  const realtime = realtimeSpy();
  const service = new ChargerProvisioningService(prisma, realtime.service);

  await service.approve(
    { email: "goodwe@emps.test", role: Role.GOODWE_ADMIN, sub: "goodwe-1" },
    "prov-1",
  );

  assert.equal(chargerCreates.length, 1);
  const created = chargerCreates[0];
  assert.equal(created.administrativeStatus, ChargerAdministrativeStatus.ENABLED);
  assert.equal(created.status, ChargerStatus.AVAILABLE);
  assert.deepEqual(created.liveStatus, {
    create: {
      lastSeenAt: approvalRequest.connectionVerifiedAt,
      operationalStatus: ChargerOperationalStatus.AVAILABLE,
    },
  });
  assert.equal(typeof (created.qrBindings as { create: { publicToken: string } }).create.publicToken, "string");
  assert.equal(provisioningUpdates.length, 2);
  assert.equal(realtime.events.length, 3);
});

test("dono exclui uma solicitação cancelada sem carregador liberado", async () => {
  const deletes: unknown[] = [];
  const prisma = {
    chargerProvisioning: {
      deleteMany(args: unknown) {
        deletes.push(args);
        return Promise.resolve({ count: 1 });
      },
      findFirst() {
        return Promise.resolve({
          chargerId: null,
          id: "prov-cancelada",
          status: ChargerProvisioningStatus.CANCELED,
        });
      },
    },
  } as unknown as PrismaService;
  const realtime = realtimeSpy();
  const service = new ChargerProvisioningService(prisma, realtime.service);

  const result = await service.remove(
    { email: "dono@emps.test", role: Role.STATION_OWNER, sub: "dono-1" },
    "prov-cancelada",
  );

  assert.deepEqual(result, { deleted: true, id: "prov-cancelada" });
  assert.equal(deletes.length, 1);
  assert.equal(realtime.events.length, 1);
});

test("não exclui cadastro que já gerou carregador", async () => {
  let deleted = false;
  const prisma = {
    chargerProvisioning: {
      deleteMany() {
        deleted = true;
        return Promise.resolve({ count: 1 });
      },
      findFirst() {
        return Promise.resolve({
          chargerId: "charger-1",
          id: "prov-ativa",
          status: ChargerProvisioningStatus.ENABLED,
        });
      },
    },
  } as unknown as PrismaService;
  const service = new ChargerProvisioningService(prisma, realtimeSpy().service);

  await assert.rejects(
    service.remove(
      { email: "dono@emps.test", role: Role.STATION_OWNER, sub: "dono-1" },
      "prov-ativa",
    ),
    ConflictException,
  );
  assert.equal(deleted, false);
});
