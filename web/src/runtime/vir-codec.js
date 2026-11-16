/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function asBytes(bytes, label) {
  if (bytes instanceof Uint8Array) {
    return bytes;
  }
  if (bytes instanceof ArrayBuffer) {
    return new Uint8Array(bytes);
  }
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  throw new Error(`${label} must be an ArrayBuffer or Uint8Array`);
}

export class BinaryWriter {
  constructor() {
    this.bytes = [];
  }

  u8(value) {
    this.bytes.push(value & 0xff);
  }

  u32(value) {
    const normalized = normalizeUint32(value, "u32");
    this.bytes.push(
      normalized & 0xff,
      (normalized >>> 8) & 0xff,
      (normalized >>> 16) & 0xff,
      (normalized >>> 24) & 0xff,
    );
  }

  take() {
    return Uint8Array.from(this.bytes);
  }
}

export function normalizeUint32(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} must be an integer in 0..4294967295`);
  }
  return value >>> 0;
}

export function requireSha256() {
  const subtle = globalThis.crypto?.subtle;
  if (typeof subtle?.digest !== "function") {
    throw new Error(
      "WebCrypto SHA-256 is unavailable; serve resources in a secure context (HTTPS or trusted localhost)",
    );
  }
  return subtle;
}

export async function sha256Hex(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("SHA256 input must be a Uint8Array");
  }
  const subtle = requireSha256();
  const digest = new Uint8Array(
    await subtle.digest(
      "SHA-256",
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
