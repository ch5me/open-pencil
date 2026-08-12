export type TextAlignment = 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED'
export type TextWrapping = 'NONE' | 'CHARACTER' | 'WORD'

export interface TextCapability {
  readonly content: string
  readonly fontFamily: string
  readonly fontSize: number
  readonly fontWeight: number
  readonly alignment: TextAlignment
  readonly color: readonly [number, number, number, number]
  readonly letterSpacing: number
  readonly lineHeight: number
  readonly wrapping: TextWrapping
}

export interface ImportedTextMetadata {
  readonly sourceId: string
  readonly editable: boolean
  readonly originalContent: string
}

export function validateTextCapability(value: TextCapability): void {
  if (!value.fontFamily || !Number.isFinite(value.fontSize) || value.fontSize <= 0) {
    throw new RangeError('invalid text font')
  }
  if (!Number.isInteger(value.fontWeight) || value.fontWeight < 1 || value.fontWeight > 1000) {
    throw new RangeError('invalid text weight')
  }
  if (value.color.some((channel) => channel < 0 || channel > 1)) {
    throw new RangeError('invalid text color')
  }
}
