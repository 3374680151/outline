import crypto from "node:crypto";

/**
 * Compare two strings in constant time to prevent timing attacks.
 *
 * @param a The first string to compare
 * @param b The second string to compare
 * @returns Whether the strings are equal
 */
export function safeEqual(a?: string | null, b?: string | null) {
  if (!a || !b) {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Hash a string using SHA-256.
 *
 * @param input The input string to hash
 * @returns The hashed input
 */
export function hash(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** Prefix of serialized encrypted secrets. */
const ENCRYPTION_PREFIX = "enc:v1:";

/**
 * Derives the AES-256 key used for secret encryption from the application
 * secret, so no additional environment variable is needed.
 *
 * @returns The 32-byte encryption key.
 */
function encryptionKey(): Buffer {
  return crypto
    .createHash("sha256")
    .update(process.env.SECRET_KEY ?? "")
    .digest();
}

/**
 * Encrypts a secret for storage at rest using AES-256-GCM.
 *
 * @param plaintext The secret to encrypt.
 * @returns The serialized ciphertext, prefixed with a version tag.
 */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTION_PREFIX,
    iv.toString("base64"),
    ":",
    tag.toString("base64"),
    ":",
    encrypted.toString("base64"),
  ].join("");
}

/**
 * Decrypts a secret produced by encryptSecret.
 *
 * @param serialized The serialized ciphertext.
 * @returns The plaintext secret.
 * @throws Error when the payload is malformed or fails authentication.
 */
export function decryptSecret(serialized: string): string {
  if (!serialized.startsWith(ENCRYPTION_PREFIX)) {
    throw new Error("Unsupported secret payload");
  }

  const [ivPart, tagPart, dataPart] = serialized
    .slice(ENCRYPTION_PREFIX.length)
    .split(":");

  if (!ivPart || !tagPart || !dataPart) {
    throw new Error("Malformed secret payload");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivPart, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
