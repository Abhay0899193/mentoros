import type { ApiKeyState } from "../types.js";
import type { KeyKv } from "../llm/keys.js";

/**
 * Secret store for the fal.ai API key. Backed by the same `settings(key,value)`
 * KV table as the Anthropic {@link import("../llm/keys.js").KeyStore}, under the
 * reserved `keys.` prefix — the key is a SECRET, never a setting: it must never
 * appear in AppSettings / GET /settings, and SettingsStore rejects any `keys.*`
 * patch. fal has no cheap validation ping, so a stored non-empty key is 'valid'.
 *
 * Rows:
 *   keys.fal        → the raw key
 *   keys.fal.state  → 'valid'
 */

const KEY = "keys.fal";
const STATE = "keys.fal.state";

/** Display mask for a fal key: '…' + its last 4 chars (short-string safe). */
export function maskFalKey(key: string): string {
  return `…${key.slice(-4)}`;
}

export class FalKeyStore {
  constructor(private readonly kv: KeyKv) {}

  private read(): Map<string, string> {
    return new Map(this.kv.readAll().map(({ key, value }) => [key, value]));
  }

  /** The stored raw key, or null when none is set. */
  getKey(): string | null {
    const v = this.read().get(KEY);
    return v && v.length > 0 ? v : null;
  }

  /** 'none' when no key stored, else 'valid' (fal keys are stored unvalidated). */
  getState(): ApiKeyState {
    return this.getKey() ? "valid" : "none";
  }

  /** Masked display form, or undefined when no key is stored. */
  getMask(): string | undefined {
    const key = this.getKey();
    return key ? maskFalKey(key) : undefined;
  }

  /** Store the key (state 'valid' since non-empty). */
  setKey(key: string): void {
    this.kv.writeMany([
      [KEY, key],
      [STATE, "valid"],
    ]);
  }

  /** Forget the key and its state row. */
  clear(): void {
    this.kv.deleteKeys([KEY, STATE]);
  }
}
