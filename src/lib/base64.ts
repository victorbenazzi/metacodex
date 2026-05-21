/**
 * Base64 <-> binary helpers for PTY IPC.
 *
 * We send terminal bytes over Tauri events as base64 strings (JSON-safe).
 * These helpers stay in the hot path — keep them allocation-light.
 */

export function utf8ToBase64(s: string): string {
  // Encode UTF-8 first so the binary string contains the right bytes.
  const utf8 = new TextEncoder().encode(s);
  return uint8ArrayToBase64(utf8);
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  // For terminal-sized chunks (~8KB) this is fast enough.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

export function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
