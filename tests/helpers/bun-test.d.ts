import type * as bunTest from 'bun:test'

declare module 'bun:test' {
  export const describe: typeof bunTest.describe
  export const expect: typeof bunTest.expect
  export const test: typeof bunTest.test
  export const it: typeof bunTest.it
}
