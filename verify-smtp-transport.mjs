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

// ---- Resend: the request must be well-formed, not merely sent ----
// Resend rejects (401) a missing/incorrect Authorization header and (422)
// a missing or unverified `from`. A test that only asserts "fetch was
// called" passes even when the mail would never send, so assert the
// actual request shape here.
test('resend send builds an authorised request with a resolved from', async () => {
  const ORIG_FROM = process.env.SWR_FROM_EMAIL;
  const ORIG_SMTP_FROM = process.env.SMTP_FROM;
  process.env.RESEND_API_KEY = 're_abc123';
  process.env.SWR_FROM_EMAIL = 'Sainted Word <noreply@example.com>';
  delete process.env.SMTP_HOST;
  const email = await importEmail();

  const origFetch = globalThis.fetch;
  let seen = null;
  globalThis.fetch = async (url, opts) => {
    seen = { url, opts };
    return { ok: true, text: async () => '{"id":"r1"}', status: 200 };
  };
  try {
    const link = 'http://localhost/verify?token=abc';
    const result = await email.sendMagicLink({
      to: 'someone@example.com',
      url: link,
      appOrigin: 'http://localhost',
    });
    assert.equal(result.ok, true);
    assert.equal(result.transport, 'resend');

    assert.ok(seen, 'fetch was not called');
    assert.equal(seen.url, 'https://api.resend.com/emails');
    assert.equal(seen.opts.method, 'POST');

    // Auth + content type — a missing bearer token is a hard 401.
    const h = seen.opts.headers || {};
    assert.equal(h.Authorization, 'Bearer re_abc123', 'Authorization header');
    assert.equal(h['Content-Type'], 'application/json', 'Content-Type header');

    const body = JSON.parse(seen.opts.body);
    assert.equal(body.from, 'Sainted Word <noreply@example.com>', 'from');
    assert.equal(body.to, 'someone@example.com', 'to');
    assert.ok(body.subject, 'subject must be present');
    assert.ok(body.text.includes(link), 'body must carry the magic link');
  } finally {
    globalThis.fetch = origFetch;
    delete process.env.RESEND_API_KEY;
    if (ORIG_FROM === undefined) delete process.env.SWR_FROM_EMAIL;
    else process.env.SWR_FROM_EMAIL = ORIG_FROM;
    if (ORIG_SMTP_FROM === undefined) delete process.env.SMTP_FROM;
    else process.env.SMTP_FROM = ORIG_SMTP_FROM;
  }
});

test('resend from falls back to SMTP_FROM when SWR_FROM_EMAIL is unset', async () => {
  const ORIG_FROM = process.env.SWR_FROM_EMAIL;
  const ORIG_SMTP_FROM = process.env.SMTP_FROM;
  process.env.RESEND_API_KEY = 're_abc123';
  delete process.env.SWR_FROM_EMAIL;
  process.env.SMTP_FROM = 'fallback@example.com';
  delete process.env.SMTP_HOST;
  const email = await importEmail();

  const origFetch = globalThis.fetch;
  let body = null;
  globalThis.fetch = async (url, opts) => {
    body = JSON.parse(opts.body);
    return { ok: true, text: async () => '{"id":"r1"}', status: 200 };
  };
  try {
    await email.sendMagicLink({ to: 'a@b.co', url: 'http://x/v?t=1', appOrigin: 'http://x' });
    assert.equal(body.from, 'fallback@example.com', 'SMTP_FROM fallback');
  } finally {
    globalThis.fetch = origFetch;
    delete process.env.RESEND_API_KEY;
    if (ORIG_FROM === undefined) delete process.env.SWR_FROM_EMAIL;
    else process.env.SWR_FROM_EMAIL = ORIG_FROM;
    if (ORIG_SMTP_FROM === undefined) delete process.env.SMTP_FROM;
    else process.env.SMTP_FROM = ORIG_SMTP_FROM;
  }
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

// ---- Welcome email (first sign-up) ----
// Sent once per account from api/auth/verify.js. Must carry the product
// links, a working unsubscribe affordance, and the postal block when
// SWR_MAILING_ADDRESS is set (CAN-SPAM requirement for commercial mail).
test('welcome email carries product links, unsubscribe, and postal address', async () => {
  const SAVED = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    SMTP_HOST: process.env.SMTP_HOST,
    SWR_FROM_EMAIL: process.env.SWR_FROM_EMAIL,
    SWR_REPLY_TO_EMAIL: process.env.SWR_REPLY_TO_EMAIL,
    SWR_MAILING_ADDRESS: process.env.SWR_MAILING_ADDRESS,
  };
  process.env.RESEND_API_KEY = 're_abc123';
  process.env.SWR_FROM_EMAIL = 'SWR <noreply@example.com>';
  process.env.SWR_REPLY_TO_EMAIL = 'kai@example.com';
  process.env.SWR_MAILING_ADDRESS = '1 Example St, Belgrade 11000, RS';
  delete process.env.SMTP_HOST;
  const email = await importEmail();

  const origFetch = globalThis.fetch;
  let payload = null;
  globalThis.fetch = async (url, opts) => {
    payload = JSON.parse(opts.body);
    return { ok: true, text: async () => '{"id":"r1"}', status: 200 };
  };
  try {
    const r = await email.sendWelcomeEmail({
      to: 'newuser@example.com',
      name: 'newuser',
      appOrigin: 'https://sainted-word-records.vercel.app',
    });
    assert.equal(r.ok, true);
    assert.equal(r.transport, 'resend');
    assert.match(payload.subject, /Welcome/i);

    // Product links, with trailing-slash normalisation applied.
    assert.ok(payload.text.includes('https://sainted-word-records.vercel.app/engine'),
      'text must link the engine');
    assert.ok(payload.text.includes('https://sainted-word-records.vercel.app/versions'),
      'text must link the versions page');
    // The three tips and the reply hook are the point of the email.
    assert.match(payload.text, /3 tips/i);
    assert.match(payload.text, /Hit Reply/i);

    // Compliance: opt-out + postal address.
    const unsub = payload.headers && payload.headers['List-Unsubscribe'];
    assert.ok(unsub, 'List-Unsubscribe header');
    assert.ok(unsub.includes('kai@example.com'), 'unsubscribe targets the reply-to inbox');
    assert.ok(payload.text.includes('1 Example St, Belgrade 11000, RS'), 'text has the postal address');
    assert.ok(payload.html.includes('1 Example St, Belgrade 11000, RS'), 'html has the postal address');
    assert.ok(payload.text.includes('Unsubscribe'), 'text has an unsubscribe line');

    // Replies must reach a monitored inbox, not the send-only From.
    assert.equal(payload.reply_to, 'kai@example.com', 'reply_to');
  } finally {
    globalThis.fetch = origFetch;
    for (const [k, v] of Object.entries(SAVED)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('welcome email omits the postal block and warns when SWR_MAILING_ADDRESS is unset', async () => {
  const SAVED = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    SMTP_HOST: process.env.SMTP_HOST,
    SWR_MAILING_ADDRESS: process.env.SWR_MAILING_ADDRESS,
  };
  process.env.RESEND_API_KEY = 're_abc123';
  delete process.env.SMTP_HOST;
  delete process.env.SWR_MAILING_ADDRESS;
  const email = await importEmail();

  const origFetch = globalThis.fetch;
  const origWrite = process.stdout.write;
  let warned = '';
  let payload = null;
  process.stdout.write = (s) => { warned += s; return true; };
  globalThis.fetch = async (url, opts) => {
    payload = JSON.parse(opts.body);
    return { ok: true, text: async () => '{"id":"r1"}', status: 200 };
  };
  try {
    await email.sendWelcomeEmail({ to: 'x@example.com', appOrigin: 'https://x.test' });
    assert.match(warned, /SWR_MAILING_ADDRESS is unset/, 'must warn loudly when unset');
    assert.ok(payload.text.includes('Unsubscribe'), 'opt-out still present');
  } finally {
    process.stdout.write = origWrite;
    globalThis.fetch = origFetch;
    for (const [k, v] of Object.entries(SAVED)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
