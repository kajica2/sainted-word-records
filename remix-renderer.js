// Offline Web Audio rendering of remix-planner edit decisions.
// Use the resulting AudioBuffer with existing Audio.loadFile(new File([wav], ...))
// so the existing media clock, analyzer, and visual reactions remain authoritative.
export async function renderRemix(plan, buffers, options = {}) {
  if (!plan || !Array.isArray(plan.events) || !Number.isFinite(plan.duration) || plan.duration <= 0)
    throw new TypeError('Valid remix plan required');
  const contextFactory = options.contextFactory || ((channels, length, sampleRate) => new OfflineAudioContext(channels, length, sampleRate));
  const sampleRate = options.sampleRate ?? 48000;
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new RangeError('Invalid sample rate');
  const channels = options.channels ?? 2;
  if (![1, 2].includes(channels)) throw new RangeError('Only mono/stereo supported');
  const fadeSeconds = options.fadeSeconds ?? 0.04;
  if (!Number.isFinite(fadeSeconds) || fadeSeconds < 0 || fadeSeconds > 0.25) throw new RangeError('Invalid fade duration');
  const ctx = contextFactory(channels, Math.ceil(plan.duration * sampleRate), sampleRate);
  for (let i = 0; i < plan.events.length; i++) {
    const event = plan.events[i];
    const buffer = buffers instanceof Map ? buffers.get(event.sourceId) : buffers?.[event.sourceId];
    if (!buffer || !Number.isFinite(buffer.duration) || buffer.duration <= 0)
      throw new Error('Missing decoded source: ' + event.sourceId);
    if (![event.start, event.duration, event.sourceStart].every(Number.isFinite) ||
        event.start < 0 || event.duration <= 0 || event.sourceStart < 0 ||
        event.start + event.duration > plan.duration + 1e-6 ||
        event.sourceStart + event.duration > buffer.duration + 1e-6)
      throw new RangeError('Invalid event boundaries: ' + i);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    source.connect(gain);
    gain.connect(ctx.destination);
    const start = event.start, end = start + event.duration;
    const fade = Math.min(fadeSeconds, event.duration / 2);
    // Adjacent events meet exactly. Fades avoid clicks, but do not overlap audio.
    if (fade > 0) {
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(1, start + fade);
      gain.gain.setValueAtTime(1, end - fade);
      gain.gain.linearRampToValueAtTime(0, end);
    } else gain.gain.setValueAtTime(1, start);
    source.start(start, event.sourceStart, event.duration);
  }
  return ctx.startRendering();
}
export function encodeWav(buffer) {
  const channels = Math.min(2, buffer.numberOfChannels);
  if (channels < 1 || !Number.isInteger(buffer.sampleRate) || buffer.sampleRate <= 0) throw new TypeError('Invalid audio buffer');
  const length = buffer.length, bytes = 44 + length * channels * 2;
  const out = new ArrayBuffer(bytes), view = new DataView(out);
  const str = (offset, s) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, bytes - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, bytes - 44, true);
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < length; i++) for (let c = 0; c < channels; c++) {
    const x = Math.max(-1, Math.min(1, data[c][i]));
    view.setInt16(offset, x < 0 ? Math.round(x * 32768) : Math.round(x * 32767), true);
    offset += 2;
  }
  return new Blob([out], { type: 'audio/wav' });
}
// Browser integration: caller invokes from a user gesture. No second playback clock.
export async function loadRemixIntoEngine(plan, buffers, options = {}) {
  const audio = globalThis.Audio;
  if (!audio || typeof audio.loadFile !== 'function') throw new Error('Sainted Word audio engine unavailable');
  const rendered = await renderRemix(plan, buffers, options);
  const wav = encodeWav(rendered);
  const file = new File([wav], 'sainted-remix-' + plan.seed + '.wav', { type: 'audio/wav' });
  await audio.loadFile(file);
  return { file, rendered, timeline: plan.events };
}
