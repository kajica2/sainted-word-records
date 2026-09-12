// scripts/merge-persona-demo.mjs — Add ?id= detection to personas.html.
// When a persona ID is provided in the URL (e.g., /personas?id=indie-musician),
// the personas page will load persona-runtime.client.js and display that persona.
//
// This avoids the need for a separate persona-demo.html file (which has been
// marked as archived in site-map.json).
//
// Usage:
//   node scripts/merge-persona-demo.mjs [--dry-run] [--verbose]

import fs from 'node:fs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

const PERSONAS_HTML = 'personas.html';

if (!fs.existsSync(PERSONAS_HTML)) {
  console.error(`✗ ${PERSONAS_HTML} not found`);
  process.exit(1);
}

let html = fs.readFileSync(PERSONAS_HTML, 'utf8');

// Check if the detection script is already present
if (html.includes('persona-demo-handler')) {
  console.log(`⊘ ${PERSONAS_HTML} (persona-demo handler already present)`);
  process.exit(0);
}

// Detection script to inject before </body>
const DETECTION_SCRIPT = `
<script>
// personas.html ?id= detection: when a persona ID is provided, dynamically
// load persona-runtime.client.js and show that persona's demo. This replaces
// the separate persona-demo.html page (merged 2026-09-12).
(function() {
  const params = new URLSearchParams(window.location.search);
  const personaId = params.get('id');
  if (!personaId) return;

  // Show a banner indicating demo mode
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:var(--accent);color:white;padding:12px 20px;font-family:var(--font-mono);font-size:12px;letter-spacing:0.08em;text-transform:uppercase;z-index:9999;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,0.2);';
  banner.innerHTML = 'Persona demo: <strong>' + personaId + '</strong> · <a href="/personas" style="color:white;text-decoration:underline;">← back to all personas</a>';
  document.body.appendChild(banner);

  // Load persona-runtime.client.js
  const script = document.createElement('script');
  script.src = '/persona-runtime.client.js';
  script.defer = true;
  script.onload = () => {
    if (window.SWR_PERSONA && window.SWR_PERSONA.apply) {
      window.SWR_PERSONA.apply(personaId);
    }
  };
  document.head.appendChild(script);
})();
</script>
`;

const beforeScript = '<script>\nclass ThemeToggle extends HTMLElement {';
if (html.includes(beforeScript)) {
  html = html.replace(beforeScript, DETECTION_SCRIPT + '\n' + beforeScript);
} else {
  // Fallback: inject before </body>
  html = html.replace('</body>', DETECTION_SCRIPT + '</body>');
}

if (DRY_RUN) {
  console.log(`[dry-run] Would add persona-demo detection to ${PERSONAS_HTML}`);
  process.exit(0);
}

fs.writeFileSync(PERSONAS_HTML, html);
console.log(`✓ ${PERSONAS_HTML} updated with persona-demo detection`);
if (VERBOSE) console.log(`  Added ?id= query parameter handler`);
