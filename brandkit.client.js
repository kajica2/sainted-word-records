// brandkit.client.js — Local profile + brandkit (logo, colors, fonts).
//
// Storage:    localStorage["swr.profile"] = { name, email, brandkit, updatedAt }
// Apply:      write CSS vars on :root + inject Google Font <link> + show logo chip
// Editor:     openBrandkitPanel() — 4-card layout (Cover / Logo / Colors / Typography)
// Auth seam:  window.SWR_Auth.getProfile() / setProfile() — replace localStorage
//             with a real provider (Clerk / Supabase / Lemon Squeezy) here.
//
// Idempotent: safe to load before or after index_app.html has booted.

(function () {
  if (window.SWR_Brandkit) return;

  const STORAGE_KEY = 'swr.profile';

  // ---- Curated font list. Google Fonts only, no upload (upload = later). ----
  const FONT_CATALOG = [
    { id: 'sans',   label: 'System Sans',  css: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif', google: null },
    { id: 'mono',   label: 'System Mono',  css: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',       google: null },
    { id: 'inter',  label: 'Inter',        css: '"Inter", sans-serif',       google: 'Inter:wght@400;500;600;700' },
    { id: 'manrope',label: 'Manrope',      css: '"Manrope", sans-serif',     google: 'Manrope:wght@400;500;600;700' },
    { id: 'space',  label: 'Space Grotesk',css: '"Space Grotesk", sans-serif', google: 'Space+Grotesk:wght@400;500;700' },
    { id: 'jet',    label: 'JetBrains Mono',css:'"JetBrains Mono", monospace', google: 'JetBrains+Mono:wght@400;500;700' },
    { id: 'play',   label: 'Playfair Display', css: '"Playfair Display", serif', google: 'Playfair+Display:wght@400;700' },
    { id: 'bebas',  label: 'Bebas Neue',   css: '"Bebas Neue", sans-serif',  google: 'Bebas+Neue' },
    { id: 'momo',   label: 'Momo Trust Display', css: '"Momo Trust Display", sans-serif', google: null, external: 'https://fonts.cdnfonts.com/css/momo-trust-display' },
  ];

  const DEFAULT_BRANDKIT = {
    logoDataUrl: null,    // uploaded logo (data URL, kept small)
    logoName: null,       // original filename
    brandName: '',        // displayed on cover + exports
    palette: {
      primary:  '#ff3d92',
      secondary:'#00e5ff',
      accent:   '#ffd24a',
      bg:       '#0a0410',
      fg:       '#f5e9ff',
    },
    font: 'sans',         // id from FONT_CATALOG
  };

  // ===========================================================================
  // Auth seam — localStorage today, replace with real provider later
  // ===========================================================================
  function readProfile() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { name: null, email: null, brandkit: clone(DEFAULT_BRANDKIT) };
      const p = JSON.parse(raw);
      // Merge in defaults so older profiles stay forward-compatible
      p.brandkit = Object.assign(clone(DEFAULT_BRANDKIT), p.brandkit || {});
      p.brandkit.palette = Object.assign(clone(DEFAULT_BRANDKIT.palette), p.brandkit.palette || {});
      return p;
    } catch (e) {
      return { name: null, email: null, brandkit: clone(DEFAULT_BRANDKIT) };
    }
  }
  function writeProfile(patch) {
    const cur = readProfile();
    const next = Object.assign({}, cur, patch, { updatedAt: new Date().toISOString() });
    if (patch.brandkit) {
      next.brandkit = Object.assign(clone(cur.brandkit), patch.brandkit);
      if (patch.brandkit.palette) {
        next.brandkit.palette = Object.assign(clone(cur.brandkit.palette), patch.brandkit.palette);
      }
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (e) {}
    return next;
  }
  function clearProfile() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  // ===========================================================================
  // Apply — write CSS vars, inject font <link>, expose logo
  // ===========================================================================
  function applyBrandkit(brandkit) {
    const b = brandkit || DEFAULT_BRANDKIT;
    const root = document.documentElement.style;
    root.setProperty('--accent',   b.palette.primary);
    root.setProperty('--accent-2', b.palette.secondary);
    root.setProperty('--accent-3', b.palette.accent);
    root.setProperty('--bg-0',     b.palette.bg);
    root.setProperty('--fg',       b.palette.fg);

    // Compute readable bg-1/bg-2/line/line-2/muted/dim from bg + fg
    const derived = deriveNeutrals(b.palette.bg, b.palette.fg);
    root.setProperty('--bg-1',     derived.bg1);
    root.setProperty('--bg-2',     derived.bg2);
    root.setProperty('--panel',    derived.panel);
    root.setProperty('--panel-2',  derived.panel2);
    root.setProperty('--line',     derived.line);
    root.setProperty('--line-2',   derived.line2);
    root.setProperty('--muted',    derived.muted);
    root.setProperty('--dim',      derived.dim);

    // Font: inject <link> if Google Font requested
    const fontEntry = FONT_CATALOG.find((f) => f.id === b.font) || FONT_CATALOG[0];
    root.setProperty('--font-sans', fontEntry.css);
    if (fontEntry.google) {
      ensureGoogleFontLink(fontEntry.google);
    } else if (fontEntry.external) {
      ensureExternalFontLink(fontEntry.external);
    }

    // Repaint brand chip if present
    const chip = document.getElementById('brandkit-chip');
    if (chip) renderChip(chip);
  }

  function deriveNeutrals(bgHex, fgHex) {
    // Mix bg toward black for deeper surfaces, toward white for raised, toward fg for borders
    const bg = hexToRgb(bgHex);
    const fg = hexToRgb(fgHex);
    return {
      bg1:    mix(bg, [0, 0, 0], 0.35),  // closer to black
      bg2:    mix(bg, [0, 0, 0], 0.55),
      panel:  mix(bg, [0, 0, 0], 0.25),
      panel2: mix(bg, fg, 0.04),
      line:   mix(bg, fg, 0.10),
      line2:  mix(bg, fg, 0.18),
      muted:  mix(bg, fg, 0.45),
      dim:    mix(bg, fg, 0.25),
    };
  }
  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return [10, 4, 16];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    const r = Math.round(a[0] * (1 - t) + b[0] * t);
    const g = Math.round(a[1] * (1 - t) + b[1] * t);
    const bl = Math.round(a[2] * (1 - t) + b[2] * t);
    return '#' + [r, g, bl].map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  function rgbToHex([r, g, b]) { return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join(''); }

  const _loadedFonts = new Set();
  function ensureGoogleFontLink(familyParam) {
    if (_loadedFonts.has(familyParam)) return;
    _loadedFonts.add(familyParam);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + familyParam + '&display=swap';
    document.head.appendChild(link);
  }
  const _externalFonts = new Set();
  function ensureExternalFontLink(href) {
    if (_externalFonts.has(href)) return;
    _externalFonts.add(href);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  // ===========================================================================
  // Editor panel — 4-card layout (Cover / Logo / Colors / Typography)
  // ===========================================================================
  function openBrandkitPanel() {
    if (document.getElementById('brandkit-panel')) {
      // Toggle off
      closeBrandkitPanel();
      return;
    }
    const profile = readProfile();
    const panel = buildPanel(profile);
    document.body.appendChild(panel);
    // Animate in
    requestAnimationFrame(() => panel.classList.add('open'));
    // Esc to close
    document.addEventListener('keydown', escClose);
  }
  function closeBrandkitPanel() {
    const p = document.getElementById('brandkit-panel');
    if (!p) return;
    p.classList.remove('open');
    setTimeout(() => p.remove(), 160);
    document.removeEventListener('keydown', escClose);
  }
  function escClose(e) { if (e.key === 'Escape') closeBrandkitPanel(); }

  function buildPanel(profile) {
    const b = profile.brandkit;
    const panel = document.createElement('div');
    panel.id = 'brandkit-panel';
    panel.className = 'bk-panel';
    panel.innerHTML = `
      <div class="bk-backdrop"></div>
      <div class="bk-dialog" role="dialog" aria-label="Brand kit editor">
        <div class="bk-head">
          <div>
            <div class="bk-title">Brand kit</div>
            <div class="bk-sub">Local profile · <span id="bk-profile-name">${escapeHtml(profile.name || 'Guest')}</span></div>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="bk-btn ghost" id="bk-reset" title="Reset to SWR defaults">Reset</button>
            <button class="bk-btn ghost" id="bk-close" title="Close (esc)">✕</button>
          </div>
        </div>

        <div class="bk-cards">
          <!-- COVER -->
          <section class="bk-card" id="bk-card-cover">
            <div class="bk-card-label">Cover</div>
            <div class="bk-cover" id="bk-cover-preview">
              <div class="bk-cover-logo" id="bk-cover-logo"></div>
              <div class="bk-cover-name" id="bk-cover-name">${escapeHtml(b.brandName || profile.name || 'YOUR BRAND')}</div>
            </div>
            <label class="bk-field">
              <span>Brand name</span>
              <input type="text" id="bk-brandname" maxlength="48" placeholder="e.g. RADIAL" value="${escapeHtml(b.brandName || '')}" />
            </label>
          </section>

          <!-- LOGO -->
          <section class="bk-card" id="bk-card-logo">
            <div class="bk-card-label">Logo</div>
            <div class="bk-logo-row">
              <div class="bk-logo-swatch bk-logo-light" id="bk-logo-light">${logoHtml(b.logoDataUrl)}</div>
              <div class="bk-logo-swatch bk-logo-dark" id="bk-logo-dark">${logoHtml(b.logoDataUrl)}</div>
              <div class="bk-logo-swatch bk-logo-accent" id="bk-logo-accent">${logoHtml(b.logoDataUrl)}</div>
            </div>
            <div class="bk-logo-actions">
              <label class="bk-upload">
                <input type="file" id="bk-logo-input" accept="image/png,image/jpeg,image/svg+xml" />
                <span>Upload logo (PNG / JPG / SVG)</span>
              </label>
              <button class="bk-btn ghost" id="bk-logo-clear" ${b.logoDataUrl ? '' : 'disabled'}>Clear</button>
            </div>
            <div class="bk-hint">Stored as a data URL in your local profile. Keep it under ~200 KB.</div>
          </section>

          <!-- COLORS -->
          <section class="bk-card" id="bk-card-colors">
            <div class="bk-card-label">Colors</div>
            <div class="bk-swatches">
              ${colorField('primary',   'Primary',   b.palette.primary)}
              ${colorField('secondary', 'Secondary', b.palette.secondary)}
              ${colorField('accent',    'Accent',    b.palette.accent)}
              ${colorField('bg',        'Background',b.palette.bg)}
              ${colorField('fg',        'Text',      b.palette.fg)}
            </div>
          </section>

          <!-- TYPOGRAPHY -->
          <section class="bk-card" id="bk-card-type">
            <div class="bk-card-label">Typography</div>
            <label class="bk-field">
              <span>UI font</span>
              <select id="bk-font">
                ${FONT_CATALOG.map((f) =>
                  `<option value="${f.id}" ${f.id === b.font ? 'selected' : ''}>${escapeHtml(f.label)}</option>`
                ).join('')}
              </select>
            </label>
            <div class="bk-type-preview" id="bk-type-preview">
              <div class="bk-type-aa">Aa</div>
              <div class="bk-type-name">${escapeHtml((FONT_CATALOG.find((f) => f.id === b.font) || FONT_CATALOG[0]).label)}</div>
              <div class="bk-type-glyphs">ABCDEFGHIJKLMNOPQRSTUVWXYZ<br/>abcdefghijklmnopqrstuvwxyz<br/>0123456789</div>
            </div>
          </section>
        </div>

        <div class="bk-foot">
          <div class="bk-foot-note">Saved to <code>localStorage["swr.profile"]</code>. Sign-out clears it.</div>
          <div style="display:flex; gap:8px;">
            <button class="bk-btn ghost" id="bk-logout" title="Clear local profile and go back to /login.html">Sign out</button>
            <button class="bk-btn primary" id="bk-save">Save & apply</button>
          </div>
        </div>
      </div>
    `;

    // ---- Wire interactions ----
    panel.querySelector('#bk-close').addEventListener('click', closeBrandkitPanel);
    panel.querySelector('.bk-backdrop').addEventListener('click', closeBrandkitPanel);

    panel.querySelector('#bk-reset').addEventListener('click', () => {
      if (!confirm('Reset brand kit to Sainted Word defaults?')) return;
      writeProfile({ brandkit: clone(DEFAULT_BRANDKIT) });
      closeBrandkitPanel();
      openBrandkitPanel();   // re-render with defaults
    });

    // Brand name (live preview, no save until "Save & apply")
    const nameInput = panel.querySelector('#bk-brandname');
    nameInput.addEventListener('input', () => {
      panel.querySelector('#bk-cover-name').textContent = nameInput.value.trim() || profile.name || 'YOUR BRAND';
    });

    // Logo upload
    const logoInput = panel.querySelector('#bk-logo-input');
    logoInput.addEventListener('change', () => {
      const file = logoInput.files && logoInput.files[0];
      if (!file) return;
      if (file.size > 300 * 1024) {
        alert('Logo is over 300 KB. Use a smaller PNG or SVG (try saving without the alpha channel).');
        logoInput.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        // Stash temporarily on the panel so the user can review before saving
        panel._pendingLogo = { dataUrl: reader.result, name: file.name };
        ['bk-logo-light', 'bk-logo-dark', 'bk-logo-accent', 'bk-cover-logo'].forEach((id) => {
          const el = panel.querySelector('#' + id);
          if (el) el.innerHTML = `<img src="${reader.result}" alt="logo" />`;
        });
        panel.querySelector('#bk-logo-clear').disabled = false;
      };
      reader.readAsDataURL(file);
    });

    panel.querySelector('#bk-logo-clear').addEventListener('click', () => {
      panel._pendingLogo = { dataUrl: null, name: null };
      ['bk-logo-light', 'bk-logo-dark', 'bk-logo-accent', 'bk-cover-logo'].forEach((id) => {
        const el = panel.querySelector('#' + id);
        if (el) el.innerHTML = '';
      });
      panel.querySelector('#bk-logo-clear').disabled = true;
    });

    // Color pickers (live preview via apply)
    ['primary', 'secondary', 'accent', 'bg', 'fg'].forEach((key) => {
      const input = panel.querySelector('#bk-color-' + key);
      input.addEventListener('input', () => {
        const newPalette = Object.assign({}, b.palette, { [key]: input.value });
        applyBrandkit(Object.assign({}, b, { palette: newPalette }));
        // Update cover bg/fg to mirror the pickers live
        const cover = panel.querySelector('#bk-cover-preview');
        if (key === 'bg') cover.style.background = input.value;
        if (key === 'fg') cover.style.color = input.value;
        if (key === 'primary') panel.querySelector('.bk-card-label').style.color = input.value;
      });
    });

    // Font picker
    const fontSel = panel.querySelector('#bk-font');
    fontSel.addEventListener('change', () => {
      const newB = Object.assign({}, b, { font: fontSel.value });
      applyBrandkit(newB);
      // Re-render the type preview with the new font applied
      const fontEntry = FONT_CATALOG.find((f) => f.id === fontSel.value) || FONT_CATALOG[0];
      panel.querySelector('#bk-type-preview').style.fontFamily = fontEntry.css;
      panel.querySelector('.bk-type-name').textContent = fontEntry.label;
    });

    // Save
    panel.querySelector('#bk-save').addEventListener('click', () => {
      const next = {
        brandkit: {
          brandName: nameInput.value.trim(),
          logoDataUrl: panel._pendingLogo ? panel._pendingLogo.dataUrl : b.logoDataUrl,
          logoName:    panel._pendingLogo ? panel._pendingLogo.name    : b.logoName,
          palette: {
            primary:   panel.querySelector('#bk-color-primary').value,
            secondary: panel.querySelector('#bk-color-secondary').value,
            accent:    panel.querySelector('#bk-color-accent').value,
            bg:        panel.querySelector('#bk-color-bg').value,
            fg:        panel.querySelector('#bk-color-fg').value,
          },
          font: fontSel.value,
        },
      };
      writeProfile(next);
      applyBrandkit(readProfile().brandkit);
      flash('Brand kit saved');
      closeBrandkitPanel();
    });

    // Sign out
    panel.querySelector('#bk-logout').addEventListener('click', () => {
      if (!confirm('Sign out and clear your local brand kit?')) return;
      clearProfile();
      // Same dev/prod dispatch as the login redirect: probe to find the studio,
      // then go to its sibling login.html
      probeStudio().then((studioPath) => {
        // studioPath is e.g. './index.html' or './index_app.html';
        // derive directory and append 'login.html'
        const dir = studioPath.substring(0, studioPath.lastIndexOf('/') + 1);
        window.location.href = dir + 'login.html';
      });
    });

    return panel;
  }

  function colorField(key, label, value) {
    return `
      <label class="bk-color">
        <span>${label}</span>
        <div class="bk-color-row">
          <input type="color" id="bk-color-${key}" value="${escapeAttr(value)}" />
          <input type="text"  id="bk-color-${key}-hex" value="${escapeAttr(value)}" maxlength="7" />
        </div>
      </label>
    `;
  }
  function logoHtml(dataUrl) {
    if (!dataUrl) return '';
    return `<img src="${dataUrl}" alt="logo" />`;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function flash(msg) {
    if (typeof window.setStatus === 'function') {
      window.setStatus('brandkit: ' + msg, 'ok');
    }
  }

  // ===========================================================================
  // Studio URL probe — used by login.html and by the logout flow.
  // The studio is now served at /engine/ in production and /engine.html in dev.
  // ===========================================================================
  async function probeStudio() {
    // The studio lives at /engine (prod) or /engine.html (dev). Try both.
    const candidates = ['/engine', '/engine.html', './engine.html', 'engine.html'];
    for (const path of candidates) {
      try {
        const url = new URL(path, location.href).toString();
        const r = await fetch(url, { method: 'GET', cache: 'no-store' });
        if (!r.ok) continue;
        const text = await r.text();
        if (text.includes('id="transport"')) return url;
      } catch (e) {}
    }
    // Fallback to /engine (most likely production URL)
    return new URL('/engine', location.href).toString();
  }

  // ===========================================================================
  // Header chip — visible in the studio topbar, click to open editor
  // ===========================================================================
  function renderChip(chip) {
    const profile = readProfile();
    const b = profile.brandkit;
    const initial = (b.brandName || profile.name || '?').trim().charAt(0).toUpperCase() || '?';
    if (b.logoDataUrl) {
      chip.innerHTML = `<img class="bk-chip-logo" src="${b.logoDataUrl}" alt="" /><span class="bk-chip-text">${escapeHtml(b.brandName || profile.name || 'Brand')}</span>`;
    } else {
      chip.innerHTML = `<span class="bk-chip-initial">${initial}</span><span class="bk-chip-text">${escapeHtml(b.brandName || profile.name || 'Brand')}</span>`;
    }
  }
  function mountChip() {
    if (document.getElementById('brandkit-chip')) return;
    const chip = document.createElement('button');
    chip.id = 'brandkit-chip';
    chip.className = 'bk-chip';
    chip.title = 'Open brand kit';
    chip.addEventListener('click', openBrandkitPanel);
    // Insert at the very left of the transport header (before the existing brand text)
    const transport = document.getElementById('transport');
    if (transport && transport.firstChild) {
      transport.insertBefore(chip, transport.firstChild);
    } else if (transport) {
      transport.appendChild(chip);
    }
    renderChip(chip);
  }

  // ===========================================================================
  // Exposed API
  // ===========================================================================
  window.SWR_Brandkit = {
    FONT_CATALOG,
    DEFAULT_BRANDKIT,
    readProfile,
    writeProfile,
    clearProfile,
    applyBrandkit,
    openBrandkitPanel,
    closeBrandkitPanel,
    mountChip,
    probeStudio,
  };
  // Alias for symmetry with the auth-seam naming convention above
  window.SWR_Auth = { getProfile: readProfile, setProfile: writeProfile, clearProfile };
})();
