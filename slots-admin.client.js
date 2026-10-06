// slots-admin.client.js — the /slots-admin operator surface.
//
// Minimal vanilla admin for the server-side video-slot ledger. The heavy
// lifting is server-side (api/slots/grant.js); this page is just the form +
// a per-browser record of what this operator has granted (the server ledger
// is the source of truth — this list is convenience only).
//
// Global-script IIFE, matching the *.client.js convention: exactly one
// UPPER_CASE global, window.SWR_SLOTS_ADMIN.

(function () {
  'use strict';

  const RECENT_KEY = 'swr.slotsAdmin.recent';
  const MAX_RECENT = 50;

  const form = document.getElementById('grant-form');
  const emailInput = document.getElementById('email');
  const slotsSelect = document.getElementById('slots');
  const noteInput = document.getElementById('note');
  const grantBtn = document.getElementById('grant-btn');
  const out = document.getElementById('grant-out');

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function showOut(html, kind) {
    out.hidden = false;
    out.innerHTML = '<span class="' + kind + '">' + html + '</span>';
  }

  function readRecent() {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (_) { return []; }
  }

  function saveRecent(list) {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT))); } catch (_) { /* noop */ }
  }

  function renderRecent() {
    const list = readRecent();
    const table = document.getElementById('recent-table');
    const wrap = document.getElementById('recent-wrap');
    const tbody = table.querySelector('tbody');
    wrap.hidden = list.length > 0;
    table.hidden = list.length === 0;
    tbody.innerHTML = list.map((g) => `
      <tr>
        <td>${escapeHtml(new Date(g.createdAt).toLocaleString())}</td>
        <td class="mono">${escapeHtml(g.email)}</td>
        <td>${Number(g.slots)}</td>
        <td>${escapeHtml(g.note || '')}</td>
        <td>${Number(g.totalSlots)}</td>
      </tr>
    `).join('');
  }

  function friendlyError(res) {
    if (!res) return 'grant failed';
    const err = res.error || ('HTTP ' + (res.status || '?'));
    if (err === 'unauthorized') return 'unauthorized — sign in first: /auth/login';
    if (err === 'forbidden') return 'forbidden — this email is not in SWR_ADMIN_EMAILS';
    if (err === 'admin_disabled') return 'admin_disabled — SWR_ADMIN_EMAILS env is not configured on the server';
    if (err === 'rate_limited') return 'rate_limited — try again in a minute';
    if (err === 'invalid_email') return 'invalid_email — check the address';
    if (err === 'invalid_slots') return 'invalid_slots — must be 10, 30 or 50';
    if (err === 'method_not_allowed') return 'method_not_allowed — the server does not accept this request';
    return String(err);
  }

  function onGrant(e) {
    e.preventDefault();
    const email = emailInput.value.trim();
    const slots = Number(slotsSelect.value);
    const note = noteInput.value.trim();
    if (!email) { showOut('email required', 'err'); return; }

    grantBtn.disabled = true;
    showOut('granting ' + slots + ' slots to ' + escapeHtml(email) + '…', 'ok');
    fetch('/api/slots/grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, slots: slots, note: note || null }),
    })
      .then(async (res) => {
        let json = null;
        try { json = await res.json(); } catch (_) { /* non-JSON */ }
        const body = json || {};
        if (!res.ok) throw Object.assign(new Error(friendlyError(body)), { status: res.status });
        const entry = {
          email: body.user && body.user.email || email,
          slots: slots,
          note: body.grant && body.grant.note || null,
          totalSlots: body.state && body.state.totalSlots || slots,
          createdAt: body.grant && body.grant.createdAt || new Date().toISOString(),
        };
        const list = [entry].concat(readRecent());
        saveRecent(list);
        renderRecent();
        const state = body.state || {};
        showOut(
          '✓ granted ' + slots + ' slots to ' + escapeHtml(entry.email) +
          ' — now ' + Number(state.totalSlots) + ' total, ' +
          Number(state.registered) + ' registered, ' +
          (Number(state.totalSlots) - Number(state.registered)) + ' free.',
          'ok'
        );
      })
      .catch((err) => {
        showOut('✗ ' + escapeHtml(err.message), 'err');
      })
      .finally(() => { grantBtn.disabled = false; });
  }

  form.addEventListener('submit', onGrant);
  renderRecent();

  window.SWR_SLOTS_ADMIN = { onGrant, renderRecent };
})();