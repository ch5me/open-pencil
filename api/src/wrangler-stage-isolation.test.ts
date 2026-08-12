import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

/**
 * Stage isolation is a config invariant, and config is the one place nothing type-checks.
 *
 * Until 2026-07-25 the `staging` env block bound DOCUMENTS and ASSETS to the PRODUCTION
 * buckets while binding D1 to openpencil-db-staging. Staging therefore wrote snapshots and
 * assets into production storage, and since deleteHostedDocument/deleteHostedAsset address
 * objects by userId, a staging delete could remove a production object. Nothing failed; the
 * deploy was green the whole time.
 *
 * Wrangler named environments do NOT inherit bindings, so every stage repeats the full list
 * by hand — which is exactly the shape that drifts. This asserts each stage's storage is its
 * own, so the next hand-copied block fails here instead of in production.
 */
function loadWranglerConfig(): {
  r2_buckets: Array<{ binding: string; bucket_name: string }>
  d1_databases: Array<{ binding: string; database_name: string }>
  env: Record<string, {
    r2_buckets?: Array<{ binding: string; bucket_name: string }>
    d1_databases?: Array<{ database_name: string }>
  }>
} {
  const source = readFileSync(`${import.meta.dir}/../wrangler.jsonc`, "utf8")
  // Bun's JSON parser rejects JSONC comments; strip line comments that are not inside a string.
  const stripped = source
    .split("\n")
    .map((line) => (/^\s*\/\//.test(line) ? "" : line))
    .join("\n")
  return JSON.parse(stripped)
}

describe("wrangler stage isolation", () => {
  const config = loadWranglerConfig()
  const productionBuckets = new Set(config.r2_buckets.map((bucket) => bucket.bucket_name))

  test("production binds the unsuffixed buckets", () => {
    expect(productionBuckets).toEqual(new Set(["openpencil-documents", "openpencil-assets"]))
  })

  for (const [stage, block] of Object.entries(config.env)) {
    test(`env.${stage} binds no production bucket`, () => {
      const buckets = block.r2_buckets ?? []
      // A stage that declares no buckets at all would pass vacuously; wrangler does not
      // inherit them, so an empty list is itself the bug.
      expect(buckets.length).toBe(config.r2_buckets.length)
      for (const bucket of buckets) {
        expect(productionBuckets.has(bucket.bucket_name)).toBe(false)
        expect(bucket.bucket_name).toStartWith(`openpencil-`)
        expect(bucket.bucket_name).toEndWith(`-${stage}`)
      }
    })

    test(`env.${stage} binds no production database`, () => {
      const databases = block.d1_databases ?? []
      expect(databases.length).toBe(config.d1_databases.length)
      for (const database of databases) {
        expect(database.database_name).toEndWith(`-${stage}`)
      }
    })
  }
})
