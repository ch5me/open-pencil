import {
  EvidenceContractError,
  type EvidenceEvent,
  type LaneReceipt,
  type RuntimeIdentity,
} from "./types";

export class EvidenceCollector {
  private readonly events: EvidenceEvent[] = [];
  private stale = false;
  private substituted = false;

  constructor(
    private readonly lane: string,
    private readonly identity: RuntimeIdentity,
  ) {}

  record(
    phase: EvidenceEvent["phase"],
    bytes: number,
    at = Date.now(),
    identity = this.identity,
  ): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new EvidenceContractError("evidence bytes must be a non-negative safe integer");
    }
    if (
      identity.commit !== this.identity.commit ||
      identity.repo !== this.identity.repo ||
      identity.runtime !== this.identity.runtime
    ) {
      this.stale = true;
    }
    this.events.push({ phase, at, bytes, identity });
  }

  markSubstituted(): void {
    this.substituted = true;
  }

  assertNonzeroOutput(): void {
    if (this.outputBytes() <= 0) throw new EvidenceContractError("observed output must be nonzero");
  }

  outputBytes(): number {
    return this.events
      .filter((event) => event.phase === "published")
      .reduce((total, event) => total + event.bytes, 0);
  }

  receipt(): LaneReceipt {
    return {
      schema: "ch5.open-pencil.image-editor.receipt.v1",
      lane: this.lane,
      identity: this.identity,
      events: this.events.map((event) => ({ ...event, identity: { ...event.identity } })),
      outputBytes: this.outputBytes(),
      stale: this.stale,
      substituted: this.substituted,
    };
  }
}
