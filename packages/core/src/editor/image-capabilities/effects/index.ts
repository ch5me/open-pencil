export type RasterEffect = "fill" | "gradient" | "dodge" | "burn" | "smudge" | "blur" | "sharpen";

export interface RasterEffectMutation {
  readonly effect: RasterEffect;
  readonly transactionId: `tx:${string}`;
}
