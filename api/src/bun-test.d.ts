declare module 'bun:test' {
  export const describe: typeof import('bun:test').describe
  export const expect: typeof import('bun:test').expect
  export const it: typeof import('bun:test').it
  export const test: typeof import('bun:test').test
}
