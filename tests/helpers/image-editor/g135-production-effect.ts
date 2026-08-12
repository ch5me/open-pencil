import golden from './g135-production-effect.golden.json'

export const G135_FIXTURE = {
  width: 1,
  height: 1,
  backgroundRgba8: [0, 0, 0, 255],
  foregroundRgba8: [188, 188, 188, 255],
  groupOpacity: 0.5
} as const

export const G135_GOLDEN = golden.expectedRgba8

export function assertG135Output(actual: readonly number[]): readonly number[] {
  if (actual.every((channel) => channel === 0)) {
    throw new Error('G135 production effect produced a zero pixel')
  }
  if (!actual.every((channel, index) => channel === G135_GOLDEN[index])) {
    throw new Error(
      `G135 pixel mismatch: expected ${G135_GOLDEN.join(',')}, got ${actual.join(',')}`
    )
  }
  return actual
}
