/**
 * FNV-1a based text hashing for change detection of editor blocks. Not a
 * cryptographic hash – it is only used to detect whether a block's text
 * changed between a translation request and its response, and to compare the
 * last automatically translated text against the current mirror text.
 */

const FNV_32_PRIME = 0x01000193;

/**
 * Hashes a string into 16 hex characters (two independent FNV-1a 32-bit
 * passes with different offsets) to keep collisions unlikely for short text.
 *
 * @param input The text to hash.
 * @returns A stable 16 character hex digest.
 */
export function textHash(input: string): string {
  const h1 = fnv1a(input, 0x811c9dc5);
  const h2 = fnv1a(input + "\u0000salt", 0x811c9dc5);
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

/**
 * Computes one FNV-1a 32-bit pass over the input string (UTF-16 code units).
 *
 * @param input The text to hash.
 * @param offsetBasis The initial hash offset basis.
 * @returns The raw 32-bit hash value.
 */
function fnv1a(input: string, offsetBasis: number): number {
  let hash = offsetBasis;

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    hash ^= code & 0xff;
    hash = Math.imul(hash, FNV_32_PRIME);
    hash ^= (code >>> 8) & 0xff;
    hash = Math.imul(hash, FNV_32_PRIME);
  }

  return hash;
}
