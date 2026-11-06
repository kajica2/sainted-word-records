// Pure helpers for the Remix Studio. No browser / DOM dependencies.
export const MAX_LOOPS = 8;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_LOOP_SECONDS = 180;

// Stable input energy estimate. Probe a bounded number of samples, including
// sparse clips. Scale RMS into 0..1 for the planner's relative contour.
export function measureLoopEnergy(buffer) {
  if (!buffer || !Number.isFinite(buffer.duration) || buffer.duration <= 0 ||
      !Number.isInteger(buffer.numberOfChannels) || buffer.numberOfChannels < 1 ||
      typeof buffer.getChannelData !== 'function') {
    throw new TypeError('A decoded AudioBuffer is required');
  }
  let squares = 0, count = 0;
  for (let channel = 0; channel < Math.min(buffer.numberOfChannels, 2); channel++) {
    const samples = buffer.getChannelData(channel);
    if (!samples.length) continue;
    const step = Math.max(1, Math.ceil(samples.length / 16000));
    for (let i = 0; i < samples.length; i += step) {
      const x = Number.isFinite(samples[i]) ? samples[i] : 0;
      squares += x * x;
      count++;
    }
  }
  return Math.max(0, Math.min(1, Math.sqrt(squares / Math.max(1, count)) * 2.4));
}

export function validateLoopFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) throw new Error('Choose at least one audio file');
  if (list.length > MAX_LOOPS) throw new Error('Choose up to 8 loops at a time');
  for (const file of list) {
    if (!file || !Number.isFinite(file.size) || file.size <= 0 ||
        file.size > MAX_FILE_BYTES) throw new Error('Each loop must be 1 byte to 50 MB');
    const name = String(file.name || '');
    if (!(String(file.type || '').startsWith('audio/') ||
          /\.(wav|mp3|m4a|aac|aif|aiff|flac|ogg|opus|webm)$/i.test(name))) {
      throw new Error('Unsupported audio file: ' + name);
    }
  }
  return list;
}

export function describeLoop(id, buffer) {
  if (!Number.isFinite(buffer?.duration) || buffer.duration <= 0 || buffer.duration > MAX_LOOP_SECONDS)
    throw new RangeError('Decoded loop must be between 0 and 180 seconds');
  return { id: String(id), duration: buffer.duration, energy: measureLoopEnergy(buffer) };
}
