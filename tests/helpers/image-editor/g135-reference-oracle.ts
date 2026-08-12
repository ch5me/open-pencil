function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
}

export function calculateG135ReferencePixel(
  background: readonly [number, number, number, number],
  foreground: readonly [number, number, number, number],
  opacity: number
): number[] {
  const sourceAlpha = (foreground[3] / 255) * opacity
  const destinationAlpha = background[3] / 255
  const resultAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha)
  const channels = foreground.slice(0, 3).map((channel, index) => {
    const source = srgbToLinear(channel / 255)
    const destination = srgbToLinear(background[index] / 255)
    return Math.round(
      linearToSrgb(
        (source * sourceAlpha + destination * destinationAlpha * (1 - sourceAlpha)) / resultAlpha
      ) * 255
    )
  })
  return [...channels, Math.round(resultAlpha * 255)]
}
