# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | :white_check_mark:  |
| < 0.1.0 | :x:                |

The deployed instance on Vercel is treated as the latest commit on `main`.

## Reporting a Vulnerability

**Please don't open a public GitHub issue for security bugs.** It gives attackers a heads-up before a fix ships.

Instead, email **kai.djuric@gmail.com** with:

1. A short description of the issue
2. Reproduction steps (URL, account state if relevant, browser)
3. Impact (what can an attacker do? auth bypass, XSS, data leak, …)
4. Any known workarounds

You should get an acknowledgement within **72 hours**. Expect a fix or status update within **7 days** for anything that affects logged-in users or production data.

## Scope

This codebase runs entirely client-side:

- **In scope**: XSS via stored songs / library assets / persona names, IndexedDB poisoning, third-party CDN compromise (Google Fonts, Vercel, ElevenLabs), Vite build pipeline tampering, service worker abuse.
- **Out of scope**: server-side attacks (there is no server). Self-XSS (paste a payload into your own browser, get owned — that's on you).

## Hall of Fame

No external reports yet. Be the first.

---

Built on Vite, deployed on Vercel, runs in your browser. No tracking, no telemetry, no upload of your audio or footage to any server.