// api/_lib/secret-box.js — authenticated encryption for stored OAuth tokens.
//
// Why: a YouTube refresh token is a long-lived credential that can read and
// modify a user's channel. Storing one in plaintext means a database read
// (a leaked connection string, a backup, a mis-scoped log) hands over the
// channel. Encrypting at rest means a database-only compromise is not
// enough to use the token.
//
// AES-256-GCM: authenticated, so a tampered ciphertext fails to decrypt
// rather than silently yielding attacker-influenced plaintext. A fresh
// 12-byte IV per encryption; GCM is catastrophically broken if an IV is
// ever reused with the same key, so the IV is random per call and stored
// alongside the ciphertext.
//
// Key: SWR_TOKEN_KEY, 32 bytes as hex (64 chars) or base64. Generate with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// Fails CLOSED: with no key, encrypt() throws rather than silently writing
// plaintext. Refusing to store a token is recoverable; storing it in the
// clear because a var was unset is not.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PREFIX = 'v1';          // format tag so the scheme can be rotated later
const IV_BYTES = 12;
const TAG_BYTES = 16;

function loadKey() {
  const raw = process.env.SWR_TOKEN_KEY || '';
  if (!raw) return null;
  let buf;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, 'hex');
  else {
    try { buf = Buffer.from(raw, 'base64'); } catch (_) { return null; }
  }
  return buf && buf.length === 32 ? buf : null;
}

export function secretBoxAvailable() {
  return loadKey() !== null;
}

// Returns a self-describing string: v1.<iv>.<tag>.<ciphertext>, all base64url.
export function encryptSecret(plaintext) {
  if (typeof plaintext !== 'string' || !plaintext) {
    throw new Error('encryptSecret: plaintext must be a non-empty string');
  }
  const key = loadKey();
  if (!key) {
    throw new Error(
      'encryptSecret: SWR_TOKEN_KEY is missing or not 32 bytes. Refusing to ' +
      'store a credential in plaintext. Generate one with: ' +
      'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

// Throws on tampering, wrong key, or malformed input — never returns a
// partially-decrypted value.
export function decryptSecret(sealed) {
  if (typeof sealed !== 'string' || !sealed) throw new Error('decryptSecret: missing value');
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error('decryptSecret: unrecognised format');
  }
  const key = loadKey();
  if (!key) throw new Error('decryptSecret: SWR_TOKEN_KEY is missing or not 32 bytes');
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const ct = Buffer.from(parts[3], 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('decryptSecret: malformed iv/tag');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
