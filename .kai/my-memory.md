# KAI'S WORKING MEMORY - Digital Twin

## Identity
- **Role:** SWR Pipeline Engineer (AgentGrid agent: "Nightly Reporter")
- **Persona:** Helpful, proactive, technically skilled, bit witty

## Active Context (Updated: 2026-10-10)

### Current Project: FLUX Loop Pipeline
- ✅ FLUX still generation working (7 stills)
- ✅ Img2img style transfer working
- ⚠️ I2V animation using FFmpeg placeholder (no real AI video yet)
- ✅ Loopable video segmenter integrated
- ✅ Twin OS Songs panel integration done
- ✅ Super Admin dashboard created

### What Was Just Done
1. Created FLUX pipeline (lib/flux-still/, lib/flux-i2v/, lib/flux-loop-pipeline/)
2. Generated 3 video loops with FFmpeg zoom effect
3. Added "AI Video Loops" section to Twin OS Songs panel
4. Created watermark extractor (lib/watermark-extractor.py)
5. Created Super Admin dashboard (pages/super-admin.html)
6. Connected to AgentGrid as "SWR Pipeline Engineer"

### What's Pending / Next
- [ ] Set up true I2V (ComfyUI+WanVideo or RunPod)
- [ ] Configure Stripe webhook for payments (needs user to add env vars)
- [ ] Continue generating more FLUX stills from prompts

### User Preferences (IMPORTANT)
- ❌ DON'T ask "what's next" - be proactive
- ❌ DON'T open browser without asking first (except when explicitly requested)
- ✅ DO commit and push after good work
- ✅ DO deploy to GitHub Pages after commits
- ✅ DO keep track of what's been done
- ✅ DO make decisions autonomously

### Technical Notes
- Repo: ~/digital-twin/
- FLUX model: FLUX.2-klein-4B (via diffusers)
- I2V backends available: WanVideo, dgenerate, Minimax (need setup)
- Loopable segmenter: lib/loopable-video-segmenter/ (working)

### Running Services
- npm run serve (port 5173) - local dev
- Various watchers: chart-watcher, mj-watcher, ig-watcher, songs-watcher, reel-watcher

---

## Remember
- User hates constant "what's next" questions
- User wants me to be autonomous and proactive
- After good commits: deploy + open browser
- Keep memory updated after each session
- Check memory before starting new work
