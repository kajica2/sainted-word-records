// Deterministic, dependency-free animation parameters; no file or network access.
export const VISUAL_STYLES = Object.freeze(['dark-pulse', 'organic-motion', 'minimal-type']);
export const EXPORT_SECONDS = 15;
export function visualState({time=0,bpm=0,energy=0,style='dark-pulse'}={}) {
  const speed = Number.isFinite(bpm) && bpm > 0 ? bpm / 60 : 0.6;
  const position = Math.max(0,Number(time)||0) * speed;
  const beat = position % 1;
  const pulse = Math.pow(1-beat,4);
  const amount = Math.max(0,Math.min(1,Number(energy)||0));
  return {beat, pulse, amount, intensity:Math.min(1,pulse*0.55+amount*0.8),style:VISUAL_STYLES.includes(style)?style:'dark-pulse'};
}

export const BEATS_PER_IMAGE = 4;
export const MAX_IMAGES = 12;
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export function validateImages(files) {
  const selected=Array.from(files||[]);
  if(selected.length>MAX_IMAGES) return {ok:false,error:'Choose up to 12 images.'};
  if(selected.some(f=>!f || !['image/png','image/jpeg','image/webp'].includes(f.type) ||
    !Number.isFinite(f.size) || f.size<1 || f.size>MAX_IMAGE_BYTES)) {
    return {ok:false,error:'Only PNG/JPEG/WebP images up to 12 MB each are supported.'};
  }
  return {ok:true};
}
export function imageSequenceIndex(time,bpm,count) {
  if(!Number.isInteger(count) || count<=0)return -1;
  const t=Math.max(0,Number.isFinite(time)?time:0);
  const tempo=Number.isFinite(bpm)&&bpm>0?bpm:90;
  return Math.floor(t*tempo/(60*BEATS_PER_IMAGE))%count;
}
