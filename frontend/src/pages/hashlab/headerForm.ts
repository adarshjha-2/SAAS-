import type { HeaderInput } from "@/types/hashlab";

export type FormState = Record<keyof HeaderInput, string>;
export type FieldErrors = Partial<Record<keyof HeaderInput, string>>;

export const UINT32_MAX = 2 ** 32 - 1;
const HEX64 = /^[0-9a-fA-F]{64}$/;

export const FIELD_LABELS: Record<keyof HeaderInput, string> = {
  version: "Version",
  prev_block_hash: "Previous block hash",
  merkle_root: "Merkle root",
  timestamp: "Timestamp",
  bits: "Bits (compact target)",
  nonce: "Nonce",
};

export function toForm(header: HeaderInput): FormState {
  return {
    version: String(header.version),
    prev_block_hash: header.prev_block_hash,
    merkle_root: header.merkle_root,
    timestamp: String(header.timestamp),
    bits: header.bits.toString(16).padStart(8, "0"),
    nonce: String(header.nonce),
  };
}

/** Exported for tests: parse the form, or explain what is wrong with each field. */
export function parseHeaderForm(form: FormState): { header: HeaderInput | null; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const int = (key: keyof HeaderInput, min: number, max: number): number => {
    const raw = form[key].trim();
    const value = Number(raw);
    if (!/^-?\d+$/.test(raw) || value < min || value > max) {
      errors[key] = `Whole number from ${min.toLocaleString()} to ${max.toLocaleString()}`;
    }
    return value;
  };
  const version = int("version", -(2 ** 31), 2 ** 31 - 1);
  const timestamp = int("timestamp", 0, UINT32_MAX);
  const nonce = int("nonce", 0, UINT32_MAX);
  for (const key of ["prev_block_hash", "merkle_root"] as const) {
    if (!HEX64.test(form[key].trim())) errors[key] = "64 hexadecimal characters";
  }
  const bitsRaw = form.bits.trim();
  if (!/^[0-9a-fA-F]{1,8}$/.test(bitsRaw)) errors.bits = "Up to 8 hexadecimal characters, e.g. 1d00ffff";
  if (Object.keys(errors).length > 0) return { header: null, errors };
  return {
    header: {
      version,
      prev_block_hash: form.prev_block_hash.trim().toLowerCase(),
      merkle_root: form.merkle_root.trim().toLowerCase(),
      timestamp,
      bits: parseInt(bitsRaw, 16),
      nonce,
    },
    errors,
  };
}
