# Usability Audit: Nielsen's 10 Heuristics Fix Plan

**Reference Implementation:** `auth/login.html` (score 89.4 holistic)

---

## Summary

| Page | Violations Found | Priority |
|------|------------------|----------|
| index.html | 7 | HIGH |
| for-creators.html | 7 | HIGH |
| landing.html | 8 | HIGH |
| engine.html | 4 | MEDIUM |

---

## Reference Implementation Patterns (from auth/login.html)

The login page demonstrates these good practices:
- **H1**: Clear status messages (`.auth-status.err`, `.auth-status.ok`) with live regions
- **H3**: Skip link (`<a class="auth-skip" href="/engine/">Skip →</a>`) for user control
- **H9**: Error messages inline with form (`<div class="auth-status" id="err"></div>`)
- **H2**: Clear, conversational copy matching user mental models
- **H5**: Input focus states, required attribute, placeholder text
- **H7**: No password to remember - passwordless magic link (reduces recall burden)

---

## Page-by-Page Findings

### 1. index.html (new redesign)

| Heuristic | Line | Issue | Fix |
|-----------|------|-------|-----|
| H1: Visibility | N/A | No loading states, progress indicators, or status feedback on hero video or flip carousel | Add loading="lazy" to all images; add skeleton/spinner for video; add flip progress indicator |
| H3: User Control | 448-450 | Flip carousel has no keyboard navigation (Enter/Space only), no pause control | Add `tabindex="0"`, keyboard handlers (arrow keys), pause/play button |
| H4: Consistency | 382 | Nav lacks `aria-current` for current page indicator | Add `aria-current="page"` to active nav link |
| H5: Error Prevention | N/A | No form validation visible; no input constraints shown | Add inline validation hints for any future forms |
| H9: Error Recovery | N/A | No error states defined in CSS; no error handling patterns | Add `.error`, `.is-error` states |
| H10: Help | N/A | No tooltips on icon-only buttons; no contextual help | Add `title` attributes or help icons |
| H6: Recognition | 448-450 | Flip carousel position unclear (only "1/3" text, no visual progress bar) | Add visual progress dots/bar |

**Files to edit:** `index.html`

---

### 2. for-creators.html (new upsell page)

| Heuristic | Line | Issue | Fix |
|-----------|------|-------|-----|
| H1: Visibility | N/A | No loading states for images; no async feedback | Add loading="lazy" to images; add status for any async actions |
| H3: User Control | N/A | Creator cards have no hover/focus keyboard support beyond native | Add visible focus rings, keyboard navigation for card grids |
| H4: Consistency | 89 | Nav has `.is-active` class but no `aria-current="page"` | Add `aria-current="page"` to active nav link |
| H5: Error Prevention | N/A | No input validation states; no error CSS classes | Add `.error`, `.invalid` states |
| H9: Error Recovery | N/A | No error message containers; no recovery paths | Add error containers with `.auth-status` pattern |
| H6: Recognition | N/A | Creator benefit cards lack clear visual hierarchy; benefit labels unclear | Add section headers, clearer card structure |
| H10: Help | N/A | No help text for "Get started" CTA; no tooltips | Add explanatory copy or help icons |

**Files to edit:** `for-creators.html`

---

### 3. landing.html (existing)

| Heuristic | Line | Issue | Fix |
|-----------|------|-------|-----|
| H1: Visibility | 2162-2165 | Theme toggle button has no loading/state feedback; "loading" state in `data-state` not connected | Wire up `aria-live` region for state changes |
| H3: User Control | 1079-1080 | Drag-and-drop zone has no keyboard alternative; no clear way to cancel | Add keyboard file picker fallback, cancel button |
| H4: Consistency | N/A | Mix of old `.nav` class and new patterns; inconsistent with index.html redesign | Standardize to index.html patterns |
| H5: Error Prevention | N/A | No input validation; file upload accepts anything | Add file type/size validation with clear error messages |
| H9: Error Recovery | N/A | No error containers; `alert()` used (line 6146 in engine.html pattern) | Replace `alert()` with inline error display |
| H6: Recall | N/A | User must remember what file types are supported; not shown until after drop | Show accepted formats inline |
| H10: Help | N/A | No contextual help; help page linked but not shown inline | Add inline help tooltips |
| H2: Match | N/A | "Drop files" uses technical language; non-technical users may not understand | Use "Add your music and videos" copy |

**Files to edit:** `landing.html`

---

### 4. engine.html (core app) ✅ MOST COMPLIANT

| Heuristic | Line | Issue | Fix |
|-----------|------|-------|-----|
| H1: Visibility | 2725 | `#status-pill` shows "idle" but no `aria-live` region for screen readers | Add `aria-live="polite"` to status display |
| H3: User Control | N/A | Transport row overflow scroll hidden in narrow viewports (comment at line 108-120) | Already fixed with responsive grid - verify works |
| H9: Error Recovery | 1827 | `.pt-error` class exists but only 14px tall; not prominent enough | Increase error message size, add icon |
| H10: Help | N/A | Keyboard shortcuts exist (e.g., Shift+←) but no help overlay shown by default | Add "Press ? for shortcuts" hint in UI |

**Files to edit:** `engine.html` (minor fixes)

---

## Prioritized Fix Plan

### P0 - Critical (Affects Core Flows)

1. **index.html: Add loading states to hero video**
   ```html
   <!-- Add before video -->
   <div class="hero__loader" aria-label="Loading demo">Loading...</div>
   ```

2. **index.html: Add flip carousel keyboard navigation**
   ```js
   // Add to flip.js
   document.addEventListener('keydown', (e) => {
     if (e.key === 'ArrowLeft') flipPrev();
     if (e.key === 'ArrowRight') flipNext();
   });
   ```

3. **landing.html: Add keyboard fallback for file drop**
   ```html
   <!-- Add click-to-browse button -->
   <button type="button" onclick="document.getElementById('file-input').click()">
     or click to browse
   </button>
   <input type="file" id="file-input" hidden />
   ```

4. **engine.html: Add aria-live to status pill**
   ```html
   <span class="pill" id="status-pill" aria-live="polite">idle</span>
   ```

### P1 - High (Significant Usability Impact)

5. **All pages: Add aria-current to active nav**
   ```html
   <a href="/engine" aria-current="page">Engine</a>
   ```

6. **All pages: Add error state CSS**
   ```css
   .error-message {
     color: var(--warn);
     font-size: 0.85rem;
     min-height: 18px;
   }
   ```

7. **landing.html: Show accepted file types inline**
   ```html
   <p>Accepted: MP3, WAV, MP4, MOV (max 500MB)</p>
   ```

8. **index.html: Add visual progress indicator to flip carousel**
   ```html
   <div class="flip__progress">
     <span class="is-active"></span><span></span><span></span>
   </div>
   ```

### P2 - Medium (Polish)

9. **index.html: Add tooltips to icon buttons**
10. **for-creators.html: Standardize nav with aria-current**
11. **landing.html: Replace technical "Drop files" with user-friendly copy**
12. **engine.html: Add keyboard shortcut hint (? for help)**

---

## Implementation Notes

- The `auth/login.html` serves as the canonical reference for error handling patterns (`.auth-status.err`, `.auth-status.ok`)
- The flip carousel in index.html should mirror the keyboard accessibility of engine.html's version picker (lines 2719-2724)
- Use CSS custom properties from `/lib/design-tokens.css` for consistent theming
- All interactive elements should have visible focus states (see engine.html line 373-379 for good example)
