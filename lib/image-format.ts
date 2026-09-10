export const IMAGE_MIMES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;
export function validImage(bytes: Uint8Array, mime: string): boolean {
  const matches = (offset: number, value: number[]) =>
    value.every((byte, index) => bytes[offset + index] === byte);
  if (mime === 'image/png')
    return matches(0, [137, 80, 78, 71, 13, 10, 26, 10]);
  if (mime === 'image/jpeg') return matches(0, [255, 216, 255]);
  if (mime === 'image/gif')
    return (
      matches(0, [71, 73, 70, 56]) &&
      [55, 57].includes(bytes[4]) &&
      bytes[5] === 97
    );
  if (mime === 'image/webp')
    return matches(0, [82, 73, 70, 70]) && matches(8, [87, 69, 66, 80]);
  return false;
}
