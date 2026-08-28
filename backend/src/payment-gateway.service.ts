import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import Stripe from "stripe";
import type { MobilePaymentMethod } from "./mobile.dtos";

export type GatewayPaymentStatus = "authorized" | "requires_action" | "rejected";

export type GatewayPaymentIntent = {
  clientSecret?: string;
  externalId: string;
  provider: "SANDBOX" | "STRIPE";
  status: GatewayPaymentStatus;
};

export type GatewaySettlement = {
  capturedAmount: number;
  externalPaymentId: string;
  provider: "SANDBOX" | "STRIPE";
  status: "approved" | "pending" | "rejected";
};

type CreateGatewayIntentInput = {
  idempotencyKey: string;
  internalIntentId: string;
  method: MobilePaymentMethod;
  spendingLimit: number | null;
};

@Injectable()
export class PaymentGatewayService {
  private readonly mode = (process.env.PAYMENT_PROVIDER ?? "sandbox").toLowerCase();
  private readonly stripe = process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY)
    : null;

  async createIntent(input: CreateGatewayIntentInput): Promise<GatewayPaymentIntent> {
    if (this.mode === "sandbox") {
      return {
        externalId: `sandbox_${input.internalIntentId}`,
        provider: "SANDBOX",
        status: "authorized",
      };
    }

    if (this.mode !== "stripe") {
      throw new ServiceUnavailableException("Provedor de pagamento não configurado");
    }
    if (!this.stripe) {
      throw new ServiceUnavailableException("STRIPE_SECRET_KEY não configurada");
    }
    if (!input.spendingLimit) {
      throw new BadRequestException(
        "Defina um limite de gasto para autorizar um pagamento externo",
      );
    }

    try {
      const isPix = input.method === "pix";
      const intent = await this.stripe.paymentIntents.create(
        {
          amount: Math.round(input.spendingLimit * 100),
          capture_method: isPix ? "automatic" : "manual",
          currency: "brl",
          metadata: { emps_payment_intent_id: input.internalIntentId },
          payment_method_types: [isPix ? "pix" : "card"],
        },
        { idempotencyKey: input.idempotencyKey },
      );

      return {
        clientSecret: intent.client_secret ?? undefined,
        externalId: intent.id,
        provider: "STRIPE",
        status:
          intent.status === "requires_capture" || intent.status === "succeeded"
            ? "authorized"
            : intent.status === "canceled"
              ? "rejected"
              : "requires_action",
      };
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError) {
        throw new BadGatewayException("O provedor de pagamento recusou a solicitação");
      }
      throw error;
    }
  }

  async settleIntent(input: {
    amount: number;
    externalId: string;
    method: MobilePaymentMethod;
    provider: string;
  }): Promise<GatewaySettlement> {
    if (input.provider.toUpperCase() === "SANDBOX") {
      return {
        capturedAmount: input.amount,
        externalPaymentId: `sandbox_payment_${input.externalId}`,
        provider: "SANDBOX",
        status: "approved",
      };
    }
    if (!this.stripe || input.provider.toUpperCase() !== "STRIPE") {
      throw new ServiceUnavailableException("Provedor externo indisponível para captura");
    }

    try {
      let intent = await this.stripe.paymentIntents.retrieve(input.externalId, {
        expand: ["latest_charge"],
      });
      const amountInCents = Math.max(50, Math.round(input.amount * 100));

      if (input.method === "pix") {
        if (intent.status !== "succeeded") {
          return {
            capturedAmount: 0,
            externalPaymentId: intent.id,
            provider: "STRIPE",
            status: intent.status === "canceled" ? "rejected" : "pending",
          };
        }
        const excess = Math.max(0, intent.amount_received - amountInCents);
        const latestCharge = intent.latest_charge;
        const chargeId = typeof latestCharge === "string" ? latestCharge : latestCharge?.id;
        if (excess > 0 && chargeId) {
          await this.stripe.refunds.create(
            { amount: excess, charge: chargeId },
            { idempotencyKey: `emps-refund-${intent.id}-${amountInCents}` },
          );
        }
      } else if (intent.status === "requires_capture") {
        intent = await this.stripe.paymentIntents.capture(
          intent.id,
          { amount_to_capture: Math.min(amountInCents, intent.amount_capturable) },
          { idempotencyKey: `emps-capture-${intent.id}-${amountInCents}` },
        );
      }

      return {
        capturedAmount: intent.status === "succeeded" ? input.amount : 0,
        externalPaymentId: intent.id,
        provider: "STRIPE",
        status:
          intent.status === "succeeded"
            ? "approved"
            : intent.status === "canceled"
              ? "rejected"
              : "pending",
      };
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError) {
        throw new BadGatewayException("Não foi possível concluir o pagamento no provedor");
      }
      throw error;
    }
  }

  constructWebhookEvent(rawBody: Buffer, signature: string) {
    if (!this.stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
      throw new ServiceUnavailableException("Webhook Stripe não configurado");
    }
    return this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  }
}
