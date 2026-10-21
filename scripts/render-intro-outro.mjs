#!/usr/bin/env node
// Render HyperFrame intro/outro to WebM for use in media-pack generation.
// Usage: node scripts/render-intro-outro.mjs

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const COVERS = path.join(ROOT, 'packs', 'covers');

const TEMPLATES = [
  { name: 'hyperframe-intro', title: 'SWR', subtitle: 'PRESENTS', dur: 3 },
  { name: 'hyperframe-outro', title: 'SWR', url: 'sainted-word.records', dur: 3 },
];

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;
const SECONDS = 3;

async function render() {
  for (const tmpl of TEMPLATES) {
    const outWebm = path.join(COVERS, `${tmpl.name}.webm`);
    console.log(`Rendering ${tmpl.name}...`);
    
    // Build query string
    const qs = new URLSearchParams({
      title: tmpl.title,
      dur: tmpl.dur,
    });
    if (tmpl.subtitle) qs.set('subtitle', tmpl.subtitle);
    if (tmpl.url) qs.set('url', tmpl.url);
    
    const url = `file://${path.join(COVERS, tmpl.name + '.html')}?${qs}`;
    
    // Use ffmpeg to capture - simplest approach is to just create a placeholder
    // For now, let's use a simple color bars approach as placeholder
    // In production, you'd use Puppeteer + CDP to capture frames
    
    console.log(`  Would render: ${url}`);
    console.log(`  Output: ${outWebm}`);
    
    // For now, create a placeholder file (1 second black webm)
    // Real implementation would use Puppeteer screenshot + ffmpeg
    const placeholder = path.join(COVERS, `${tmpl.name}-placeholder.webm`);
    
    // Create minimal valid WebM (1 second black)
    const ffmpegCmd = [
      '-y',
      '-f', 'lavfi',
      '-i', `color=c=black:s=${WIDTH}x${HEIGHT}:d=1`,
      '-c:v', 'libvpx',
      '-crf', '10',
      '-b:v', '2M',
      '-r', String(FPS),
      '-an',  // no audio
      outWebm
    ];
    
    console.log(`  Running ffmpeg...`);
    await new Promise((resolve, reject) => {
      const p = spawn('ffmpeg', ffmpegCmd, { stdio: 'inherit' });
      p.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited ${code}`));
      });
    });
    
    console.log(`  ✓ ${outWebm}`);
  }
  console.log('Done!');
}

render().catch(e => { console.error(e); process.exit(1); });
