// api/bookings/index.js — artist booking request handler.
//
//   POST /api/bookings
//   Body: {
//     artistName, contactEmail, contactName,
//     eventType, eventDate, venueName, venueCity,
//     labelRef, budget, referralSource, message
//   }
//   -> { ok, bookingId, checkoutUrl }   (when Stripe deposit is required)
//   -> { ok, bookingId }                (when Stripe is not configured)
//
// Flow:
//   1. Validate required fields.
//   2. Create a Stripe Checkout Session for a refundable booking deposit.
//      Amount: configurable via BOOKING_DEPOSIT_CENTS (default €50).
//      capture_method: 'manual' so the hold can be released if declined.
//   3. Record the pending booking in localStorage/KV for now (extend to
//      api/_lib/db.js when a schema exists).
//   4. Email the booking details to SWR (via the existing email transport).
//   5. Return { bookingId, checkoutUrl } so the client can redirect to Stripe.
//      After payment, the client shows a confirmation page.
//
//   On success: buyer is redirected back to /bookings?confirmed=<bookingId>
//   On skip/no Stripe: confirmed immediately (dev mode).

import { readJsonBody, sendJson, setCors, appOrigin } from '../_lib/http.js';
import { getStripe, stripeConfigured } from '../_lib/stripe.js';

// ---- Config ------------------------------------------------------------

const DEPOSIT_CENTS = parseInt(process.env.BOOKING_DEPOSIT_CENTS || '5000', 10);
const DEPOSIT_EUR = (DEPOSIT_CENTS / 100).toFixed(0);
const FROM_EMAIL = process.env.SWR_FROM_EMAIL || 'SWR <noreply@saintedwordrecords.com>';
const BOOKING_TARGET_EMAIL = process.env.SWR_BOOKING_EMAIL || 'bookings@saintedwordrecords.com';
const APP_ORIGIN = process.env.SWR_APP_ORIGIN || 'https://sainted-word-records.vercel.app';

// ---- Validation -------------------------------------------------------

const REQUIRED = [
  'artistName', 'contactEmail', 'contactName',
  'eventType', 'eventDate', 'venueName', 'venueCity',
];

const EVENT_TYPES = [
  'club-night', 'festival', 'private-event',
  'livestream', 'recording-session', 'workshop',
  'other',
];

function validate(body) {
  const errors = [];
  for (const f of REQUIRED) {
    if (!body || !String(body[f] || '').trim()) {
      errors.push(`missing: ${f}`);
    }
  }
  if (body?.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.contactEmail)) {
    errors.push('invalid: contactEmail');
  }
  if (body?.eventType && !EVENT_TYPES.includes(body.eventType)) {
    errors.push('invalid: eventType');
  }
  const future = new Date(body?.eventDate);
  if (body?.eventDate && isNaN(future.getTime())) {
    errors.push('invalid: eventDate');
  }
  return errors;
}

// ---- Email notification -----------------------------------------------

async function sendBookingNotification({ booking, stripeSessionId }) {
  const { contactName, contactEmail, artistName, eventType, eventDate,
          venueName, venueCity, labelRef, budget, referralSource, message } = booking;

  const eventTypeLabels = {
    'club-night': 'Club night', festival: 'Festival', 'private-event': 'Private event',
    livestream: 'Livestream', 'recording-session': 'Recording session',
    workshop: 'Workshop', other: 'Other',
  };

  const text = [
    `New booking request — Sainted Word Records`,
    ``,
    `Artist / act:      ${artistName}`,
    `Contact:           ${contactName} <${contactEmail}>`,
    `Event type:        ${eventTypeLabels[eventType] || eventType}`,
    `Date:              ${eventDate}`,
    `Venue:             ${venueName}, ${venueCity}`,
    labelRef ? `Label interest:    ${labelRef}` : null,
    budget ? `Budget range:      ${budget}` : null,
    referralSource ? `Heard from:       ${referralSource}` : null,
    ``,
    `Message:`,
    message || '(none)',
    ``,
    `Deposit status:    ${stripeSessionId ? `Stripe session ${stripeSessionId} (${DEPOSIT_EUR} EUR hold)` : 'Stripe not configured — no deposit taken'}`,
    `Booking ID:        ${booking.bookingId}`,
    ``,
    `→ ${APP_ORIGIN}/bookings/admin?id=${booking.bookingId}`,
  ].filter(Boolean).join('\n');

  const html = `
<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: -apple-system, sans-serif; background: #050308; color: #f5e9ff; padding: 32px; }
  .card { background: #11091a; border: 1px solid #2a1d3a; border-radius: 12px; padding: 24px; max-width: 600px; }
  .row { display: flex; gap: 16px; padding: 8px 0; border-bottom: 1px solid #2a1d3a; }
  .row:last-child { border-bottom: none; }
  .label { color: #9a8aaa; min-width: 140px; font-size: 12px; }
  .value { color: #f5e9ff; font-size: 13px; }
  .badge { display: inline-block; background: #ff3d92; color: #fff; font-size: 11px; padding: 2px 8px; border-radius: 999px; }
  h2 { margin: 0 0 20px; font-size: 18px; }
</style>
</head>
<body>
  <div class="card">
    <h2>New booking request <span class="badge">${DEPOSIT_EUR} EUR deposit</span></h2>
    ${[['Artist / act', artistName], ['Contact', `${contactName} <${contactEmail}>`], ['Event type', eventTypeLabels[eventType] || eventType], ['Date', eventDate], ['Venue', `${venueName}, ${venueCity}`], ...(labelRef ? [['Label interest', labelRef]] : []), ...(budget ? [['Budget', budget]] : []), ...(referralSource ? [['Referral', referralSource]] : [])].map(([k,v]) => `<div class="row"><span class="label">${k}</span><span class="value">${v}</span></div>`).join('')}
    <div class="row" style="flex-direction:column;gap:4px;padding-top:16px">
      <span class="label">Message</span>
      <span class="value" style="white-space:pre-wrap">${(message || '(none)').replace(/</g,'&lt;')}</span>
    </div>
    <div class="row" style="margin-top:16px">
      <span class="label">Booking ID</span>
      <span class="value" style="font-family:monospace">${booking.bookingId}</span>
    </div>
    <div class="row">
      <span class="label">Deposit</span>
      <span class="value">${stripeSessionId ? `Stripe session ${stripeSessionId} — ${DEPOSIT_EUR} EUR hold (manual capture)` : 'Not configured — no deposit taken'}</span>
    </div>
    <div class="row">
      <span class="label">Admin</span>
      <span class="value"><a href="${APP_ORIGIN}/bookings/admin?id=${booking.bookingId}" style="color:#00e5ff">Review this booking →</a></span>
    </div>
  </div>
</body>
</html>`;

  return deliverEmail({ to: BOOKING_TARGET_EMAIL, subject: `Booking: ${artistName} — ${eventTypeLabels[eventType] || eventType}, ${venueCity} ${eventDate}`, text, html });
}

async function deliverEmail({ to, subject, text, html }) {
  // Use the same transport pattern as api/_lib/email.js
  if (process.env.SMTP_HOST) return smtpDeliver({ to, subject, text, html });
  if (process.env.RESEND_API_KEY) return resendDeliver({ to, subject, text, html });
  // Dev fallback
  process.stdout.write(`\n[booking-email] to=${to}\n[booking-email] subject=${subject}\n${text}\n`);
  return { ok: true, transport: 'stdout' };
}

async function smtpDeliver(msg) {
  const nodemailer = (await import('nodemailer')).default;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  try {
    await transporter.sendMail({ from: FROM_EMAIL, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
    return { ok: true, transport: 'smtp' };
  } catch (e) {
    return { ok: false, transport: 'smtp', error: e.message };
  }
}

async function resendDeliver(msg) {
  const apiKey = process.env.RESEND_API_KEY;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`resend ${r.status}: ${await r.text()}`);
    return { ok: true, transport: 'resend' };
  } catch (e) {
    return { ok: false, transport: 'resend', error: e.message };
  }
}

// ---- Stripe checkout session -------------------------------------------

async function createDepositSession({ booking, origin }) {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'eur',
        product_data: {
          name: 'Booking deposit — Sainted Word Records',
          description: `Refundable deposit to secure booking: ${booking.artistName} — ${booking.venueName}, ${booking.venueCity} on ${booking.eventDate}`,
          images: ['https://sainted-word-records.vercel.app/press/og-card.png'],
        },
        unit_amount: DEPOSIT_CENTS,
      },
      quantity: 1,
    }],
    mode: 'payment',
    // manual capture — we only charge if the booking is confirmed
    payment_intent_data: { capture_method: 'manual' },
    success_url: `${origin}/bookings?confirmed=${booking.bookingId}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/bookings?cancelled=1`,
    metadata: { bookingId: booking.bookingId, artistName: booking.artistName },
    customer_email: booking.contactEmail,
  });
  return session;
}

// ---- Booking ID generation --------------------------------------------

function makeBookingId() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SWR-BOOK-${ts}-${rand}`;
}

// ---- Handler ----------------------------------------------------------

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  const body = await readJsonBody(req, { maxBytes: 32_000 });
  if (!body || body.__error) return sendJson(res, 400, { error: 'invalid_body' });

  const errors = validate(body);
  if (errors.length) return sendJson(res, 400, { error: 'validation_failed', details: errors });

  const origin = appOrigin(req) || APP_ORIGIN;
  const bookingId = makeBookingId();

  const booking = {
    bookingId,
    artistName:     String(body.artistName).trim(),
    contactName:    String(body.contactName).trim(),
    contactEmail:   String(body.contactEmail).trim().toLowerCase(),
    eventType:     String(body.eventType).trim(),
    eventDate:      String(body.eventDate).trim(),
    venueName:      String(body.venueName).trim(),
    venueCity:      String(body.venueCity).trim(),
    labelRef:       String(body.labelRef || '').trim(),
    budget:         String(body.budget || '').trim(),
    referralSource: String(body.referralSource || '').trim(),
    message:        String(body.message || '').trim(),
    status:         'pending',
    createdAt:      new Date().toISOString(),
  };

  let stripeSessionId = null;
  let checkoutUrl = null;

  if (stripeConfigured()) {
    try {
      const session = await createDepositSession({ booking, origin });
      stripeSessionId = session.id;
      checkoutUrl = session.url;
      booking.stripeSessionId = stripeSessionId;
    } catch (e) {
      console.error('[bookings] Stripe session error:', e.message);
      return sendJson(res, 502, { error: 'payment_setup_failed', message: e.message });
    }
  }

  // Log the booking (extend to KV/DB when schema exists)
  console.log('[bookings] new booking:', JSON.stringify(booking));

  // Send notification email to SWR
  await sendBookingNotification({ booking, stripeSessionId });

  if (checkoutUrl) {
    return sendJson(res, 200, { ok: true, bookingId, checkoutUrl });
  } else {
    // No Stripe — confirm immediately (dev mode)
    return sendJson(res, 200, { ok: true, bookingId });
  }
}
