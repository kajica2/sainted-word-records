// Pure, testable adapter around the existing browser-global SWR AudioAnalysisV2.
const MAX_BYTES = 100 * 1024 * 1024;
export function validateAudio(file) {
  if (!file) return {ok:false,error:'Select an audio file.'};
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_BYTES) return {ok:false,error:'Audio must be between 1 byte and 100 MB.'};
  const ext = String(file.name || '').split('.').pop().toLowerCase();
  if (!['mp3','wav','ogg','m4a','aac','flac'].includes(ext) || (file.type && !file.type.startsWith('audio/') && file.type !== 'application/ogg')) return {ok:false,error:'Unsupported audio format.'};
  return {ok:true};
}
export function summarizeAnalysis(result) {
  if (!result || typeof result !== 'object') throw new Error('Invalid analyzer result');
  const bpm = Number(result.bpm);
  const duration = Number(result.duration);
  const confidence = Number(result.confidence);
  return {
    bpm: Number.isFinite(bpm) && bpm >= 60 && bpm <= 180 ? Math.round(bpm) : 0,
    key: typeof result.key === 'string' && result.key ? result.key + (result.scale ? ' ' + result.scale : '') : null,
    duration: Number.isFinite(duration) && duration >= 0 ? duration.toFixed(1) + 's' : 'Unknown',
    onsets: Array.isArray(result.onsets) || ArrayBuffer.isView(result.onsets) ? result.onsets.length : 0,
    confidence: Number.isFinite(confidence) ? Math.round(Math.max(0,Math.min(1,confidence))*100) + '%' : 'Unknown',
  };
}
