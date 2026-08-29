import { Injectable } from "@nestjs/common";
import type { Namespace } from "socket.io";
import {
  REALTIME_CHANGE_EVENT,
  type RealtimeChange,
  type RealtimeChangeInput,
  type RealtimeCustomerChangeInput,
  type RealtimeOperationsChangeInput,
} from "./realtime.contract";
import { createRealtimeChange, routeRealtimeChange } from "./realtime.helpers";

type RealtimeEmitter = Pick<Namespace, "to">;

@Injectable()
export class RealtimeService {
  private emitter?: RealtimeEmitter;

  attachEmitter(emitter: RealtimeEmitter): void {
    this.emitter = emitter;
  }

  isReady(): boolean {
    return this.emitter !== undefined;
  }

  publish(input: RealtimeChangeInput): RealtimeChange {
    const change = createRealtimeChange(input);
    const rooms = routeRealtimeChange(input);
    this.emitter?.to(rooms).emit(REALTIME_CHANGE_EVENT, change);
    return change;
  }

  publishToOperations(input: RealtimeOperationsChangeInput): RealtimeChange {
    return this.publish({ ...input, operational: true });
  }

  publishToCustomer(
    customerId: string,
    input: RealtimeCustomerChangeInput,
  ): RealtimeChange {
    return this.publish({ ...input, customerId });
  }
}
