export type EvidencePhase =
  | "allocated"
  | "staged"
  | "prepared"
  | "committed"
  | "published"
  | "failed"
  | "rolled-back";

export interface RuntimeIdentity {
  readonly repo: string;
  readonly commit: string;
  readonly runtime: string;
}

export interface EvidenceEvent {
  readonly phase: EvidencePhase;
  readonly at: number;
  readonly bytes: number;
  readonly identity: RuntimeIdentity;
}

export interface LaneReceipt {
  readonly schema: "ch5.open-pencil.image-editor.receipt.v1";
  readonly lane: string;
  readonly identity: RuntimeIdentity;
  readonly events: readonly EvidenceEvent[];
  readonly outputBytes: number;
  readonly stale: boolean;
  readonly substituted: boolean;
}

export class EvidenceContractError extends Error {
  readonly code = "evidence-contract-error";
}
