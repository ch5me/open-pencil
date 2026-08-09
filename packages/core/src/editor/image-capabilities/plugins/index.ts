export type RasterPluginOperation = "paint" | "eraser" | "clone" | "healing";

export interface RasterPluginMutation {
  readonly operation: RasterPluginOperation;
  readonly transactionId: `tx:${string}`;
}
