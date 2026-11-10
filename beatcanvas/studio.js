import { validateAudio, summarizeAnalysis } from './studio-core.js';
import {setBpm,resetAudio} from './visual.js';
const $ = id => document.getElementById(id);
let audioURL = null;
let context = null;
$('song').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  resetAudio();
  $('record').disabled = true;
  setBpm(0);
  if (audioURL) { URL.revokeObjectURL(audioURL); audioURL = null; }
  $('player').hidden = true;
  ['bpm','key','duration','onsets'].forEach(id => $(id).textContent = '—');
  $('confidence').textContent = '';
  if (!file) { $('status').textContent = 'No audio selected.'; return; }
  const result = validateAudio(file);
  if (!result.ok) { $('status').textContent = result.error; return; }
  if (!window.AudioAnalysisV2?.analyzeBuffer) { $('status').textContent = 'The SWR audio analyzer is unavailable.'; return; }
  $('status').textContent = 'Decoding and analyzing locally…';
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('Web Audio is unsupported in this browser.');
    if (context) await context.close();
    context = new Ctx();
    const pcm = await context.decodeAudioData(await file.arrayBuffer());
    const data = summarizeAnalysis(window.AudioAnalysisV2.analyzeBuffer(pcm));
    $('bpm').textContent = data.bpm ? String(data.bpm) : 'Unclear';
    setBpm(data.bpm);
    $('key').textContent = data.key || 'Unclear';
    $('duration').textContent = data.duration;
    $('onsets').textContent = String(data.onsets);
    $('confidence').textContent = 'Key confidence: ' + data.confidence;
    audioURL = URL.createObjectURL(file);
    $('player').src = audioURL;
    $('player').hidden = false;
    $('record').disabled = false;
    $('status').textContent = 'Analysis completed. Estimates may be unreliable for free-tempo music.';
  } catch (err) {
    $('status').textContent = 'Analysis failed: ' + (err?.message || 'Unsupported audio file');
  }
});
window.addEventListener('pagehide', () => { if (audioURL) URL.revokeObjectURL(audioURL); if (context) context.close().catch(()=>{}); });
