/**
 * Authenticated encryption of cookie contents: AES-256-GCM with Web Crypto.
 *
 * A sealed value is `v1.` followed by base64url(iv ‖ ciphertext ‖ tag): a
 * fresh 96-bit IV per seal, a 128-bit tag. The key is derived from each
 * secret with HKDF-SHA-256, so a secret of any length becomes a 256-bit key.
 * The additional authenticated data names what the value is for, so a sign-in
 * cookie can't be passed off as a session cookie.
 *
 * Rotation: the first secret seals; every secret unseals. A value sealed with
 * an older secret is sealed again with the first one the next time it is
 * written.
 */

/** What a sealed value is for. Part of the authenticated data. */
export type SealPurpose = "session" | "sign-in";

const FORMAT = "v1.";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HKDF_SALT = new TextEncoder().encode("qeet-id-nextjs");
const HKDF_INFO = new TextEncoder().encode("cookie encryption v1");

/** Seals and unseals values with the configured secrets. One per configuration; safe for concurrent use. */
export class Sealer {
  readonly #secrets: readonly string[];
  #keys: Promise<CryptoKey[]> | undefined;

  constructor(secrets: readonly string[]) {
    if (secrets.length === 0) throw new TypeError("Sealer needs at least one secret.");
    this.#secrets = secrets;
  }

  /** Encrypts `value` (as JSON) for `purpose` with the first secret. */
  async seal(value: unknown, purpose: SealPurpose): Promise<string> {
    const [key] = await this.#derive();
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: aad(purpose), tagLength: TAG_BYTES * 8 },
        key as CryptoKey,
        plaintext,
      ),
    );
    const sealed = new Uint8Array(IV_BYTES + ciphertext.byteLength);
    sealed.set(iv);
    sealed.set(ciphertext, IV_BYTES);
    return FORMAT + Buffer.from(sealed).toString("base64url");
  }

  /**
   * Decrypts a sealed value for `purpose`, trying each secret. Returns
   * `undefined` for anything that isn't one: a value sealed with an unknown
   * secret, for another purpose, tampered with, truncated or malformed.
   */
  async unseal(sealed: string, purpose: SealPurpose): Promise<unknown> {
    if (typeof sealed !== "string" || !sealed.startsWith(FORMAT)) return undefined;
    const encoded = sealed.slice(FORMAT.length);
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return undefined;
    const bytes = new Uint8Array(Buffer.from(encoded, "base64url"));
    if (bytes.byteLength < IV_BYTES + TAG_BYTES) return undefined;
    const iv = bytes.slice(0, IV_BYTES);
    const ciphertext = bytes.slice(IV_BYTES);
    for (const key of await this.#derive()) {
      let plaintext: ArrayBuffer;
      try {
        plaintext = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv, additionalData: aad(purpose), tagLength: TAG_BYTES * 8 },
          key,
          ciphertext,
        );
      } catch {
        continue; // not this key, or not authentic
      }
      try {
        return JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  #derive(): Promise<CryptoKey[]> {
    this.#keys ??= Promise.all(this.#secrets.map(deriveKey));
    return this.#keys;
  }
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: HKDF_INFO },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function aad(purpose: SealPurpose): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`qeet-id-nextjs:${purpose}`);
}
