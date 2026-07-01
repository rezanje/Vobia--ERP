export function buildSkuCode(styleCode: string, colorCode: string, size: string): string {
  return `${styleCode}-${colorCode}-${size}`
}

export function overrideKey(colorCode: string, size: string): string {
  return `${colorCode}-${size}`
}

export function resolveSkuCode(
  styleCode: string,
  colorCode: string,
  size: string,
  overrides: Record<string, string>,
): string {
  return overrides[overrideKey(colorCode, size)] ?? buildSkuCode(styleCode, colorCode, size)
}
