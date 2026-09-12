// Tests for the SMTP transport in api/_lib/email.js
// Run: node --test verify-smtp-transport.mjs
//
// Each test sets env vars BEFORE importing the email module (the module
// reads env at call time, not at import time, so dynamic import per
// test is the cleanest way to control the env-snapshot).
//
// The transporter is mocked via the test-only `globalThis.__NODEMAILER__`
// indirection — if email.js imports `nodemailer` directly, we can swap
// the module with a stub in tests via Node's module loader hooks. For
// this verifier we keep it simple: stub `nodemailer` on the global
// before the email module reads it. If the email module's structure
// makes that hard, we'll wire `createTransport` as a parameter.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each test installs its own env then re-imports the email module.
// We use a query-string cache buster so Node treats each re-import as
// fresh (the module reads env at call time, not load time, but we
// still want fresh module identity per test for safety).
const importEmail = async () => {
  const url = new URL('./api/_lib/email.js', `file://${process.cwd()}/`);
  // Force fresh evaluation each call
  url.searchParams.set('t', String(Date.now()) + Math.random());
  return import(url.href);
};

// Stub nodemailer BEFORE email.js loads it. We attach to globalThis
// and have email.js fall back to globalThis.__nodemailerImport if the
// real import fails. (Tests verify this wiring exists.)
const installNodemailerStub = (transporter) => {
  const sendMailMock = async (envelope) => {
    transporter.lastMail = envelope;
    return { messageId: 'stub-' + Date.now() };
  };
  const createTransport = (cfg) => {
    transporter.lastConfig = cfg;
    globalThis.__lastSmtpTransporter__ = transporter;
    return { sendMail: sendMailMock, verify: async () => true };
  };
  globalThis.__NODEMAILER_FACTORY__ = createTransport;
  process.env.__NODEMAILER_STUB__ = '1';
};

const clearNodemailerStub = () => {
  delete globalThis.__NODEMAILER_FACTORY__;
  delete process.env.__NODEMAILER_STUB__;
};

// ---- RED 1: Transport selection — SMTP when SMTP_HOST is set ----
test('selects smtp transport when SMTP_HOST is set', async () => {
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_PORT = '587';
  process.env.SMTP_USER = 'user';
  process.env.SMTP_PASS = 'pass';
  delete process.env.RESEND_API_KEY;
  installNodemailerStub({});
  const email = await importEmail();
  const result = await email.sendMagicLink({
    to: 'a@b.co',
    url: 'http://localhost/verify?token=x',
    appOrigin: 'http://localhost',
  });
  assert.equal(result.transport, 'smtp');
  assert.equal(result.ok, true);
  delete process.env.SMTP_HOST; delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
  clearNodemailerStub();
});

// ---- RED 2: Transport selection — Resend when only RESEND_API_KEY set ----
test('selects resend transport when only RESEND_API_KEY is set', async () => {
  process.env.RESEND_API_KEY = 're_test_key';
  delete process.env.SMTP_HOST;
  const email = await importEmail();
  // Stub global fetch so the Resend call doesn't actually go out
  const origFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async (url, opts) => {
    called = (url === 'https://api.resend.com/emails');
    return { ok: true, text: async () => '{"id":"r1"}', status: 200 };
  };
  const result = await email.sendMagicLink({
    to: 'a@b.co',
    url: 'http://localhost/verify?token=x',
    appOrigin: 'http://localhost',
  });
  globalThis.fetch = origFetch;
  assert.equal(result.transport, 'resend');
  assert.equal(result.ok, true);
  assert.equal(called, true, 'fetch should have been called against api.resend.com');
  delete process.env.RESEND_API_KEY;
});

// ---- RED 3: Transport selection — stdout when neither is set ----
test('selects stdout transport when neither SMTP_HOST nor RESEND_API_KEY is set', async () => {
  delete process.env.SMTP_HOST;
  delete process.env.RESEND_API_KEY;
  const email = await importEmail();
  const origWrite = process.stdout.write;
  let captured = '';
  process.stdout.write = (s) => { captured += s; return true; };
  const result = await email.sendMagicLink({
    to: 'a@b.co',
    url: 'http://localhost/verify?token=y',
    appOrigin: 'http://localhost',
  });
  process.stdout.write = origWrite;
  assert.equal(result.transport, 'stdout');
  assert.equal(result.ok, true);
  assert.match(captured, /magic-link.*to=a@b\.co/);
});

// ---- RED 4: SMTP envelope is well-formed ----
test('SMTP send builds the correct envelope', async () => {
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_PORT = '587';
  process.env.SMTP_USER = 'user';
  process.env.SMTP_PASS = 'pass';
  delete process.env.RESEND_API_KEY;
  installNodemailerStub({});
  const email = await importEmail();
  await email.sendMagicLink({
    to: 'recipient@example.org',
    url: 'http://app.example.com/verify?token=abc',
    appOrigin: 'http://app.example.com',
  });
  // The stub captured lastConfig + lastMail on the global transporter
  const transporter = globalThis.__lastSmtpTransporter__ || {};
  assert.ok(transporter.lastConfig, 'createTransport was not called');
  assert.equal(transporter.lastConfig.host, 'smtp.example.com');
  assert.equal(transporter.lastConfig.port, 587);
  assert.equal(transporter.lastConfig.auth.user, 'user');
  assert.equal(transporter.lastConfig.auth.pass, 'pass');
  // secure=false is the default for STARTTLS (port 587)
  assert.equal(transporter.lastConfig.secure, false);
  // Verify sendMail was called with the right envelope
  assert.ok(transporter.lastMail, 'sendMail was not called');
  assert.match(transporter.lastMail.to, /recipient@example\.org/);
  assert.match(transporter.lastMail.from, /@/); // has an email
  assert.match(transporter.lastMail.text, /http:\/\/app\.example\.com\/verify\?token=abc/);
  delete process.env.SMTP_HOST; delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
  clearNodemailerStub();
});

// ---- RED 5: SMTP_PORT=465 sets secure=true ----
test('SMTP port 465 sets secure=true (implicit TLS)', async () => {
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_PORT = '465';
  delete process.env.RESEND_API_KEY;
  installNodemailerStub({});
  const email = await importEmail();
  await email.sendMagicLink({ to: 'a@b.co', url: 'http://x/verify?token=1', appOrigin: 'http://x' });
  const transporter = globalThis.__lastSmtpTransporter__ || {};
  assert.equal(transporter.lastConfig.port, 465);
  assert.equal(transporter.lastConfig.secure, true);
  delete process.env.SMTP_HOST; delete process.env.SMTP_PORT;
  clearNodemailerStub();
});

// ---- RED 6: SMTP error returns ok:false, transport:'smtp', no stdout fallback ----
test('SMTP sendMail error returns ok:false (does not silently stdout-fallback)', async () => {
  process.env.SMTP_HOST = 'smtp.example.com';
  delete process.env.RESEND_API_KEY;
  globalThis.__NODEMAILER_FACTORY__ = () => ({
    sendMail: async () => { throw new Error('connection refused'); },
    verify: async () => true,
  });
  process.env.__NODEMAILER_STUB__ = '1';
  const email = await importEmail();
  const result = await email.sendMagicLink({ to: 'a@b.co', url: 'http://x/verify?token=1', appOrigin: 'http://x' });
  assert.equal(result.transport, 'smtp');
  assert.equal(result.ok, false);
  assert.match(result.error, /connection refused/);
  delete process.env.SMTP_HOST;
  clearNodemailerStub();
});
