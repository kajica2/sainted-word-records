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
