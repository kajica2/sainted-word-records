import {waveformPeaks,playbackPosition} from './waveform-core.js';
const canvas=document.getElementById('waveform');
const ctx=canvas.getContext('2d');
const player=document.getElementById('player');
const status=document.getElementById('wave-status');
const colors=['#009ac8','#e03c92'];
let peaks=[],duration=0,frame=0;
const W=canvas.width,H=canvas.height;
const timelineWidth=W*2; // 2x canvas width makes the waveform scroll beneath a fixed center playhead.
export function clearWaveform(){
  peaks=[];duration=0;render(0);status.textContent='Upload a song to display the waveform.';
}
export function loadWaveform(buffer){
  peaks=waveformPeaks(buffer,timelineWidth);
  duration=Number.isFinite(buffer.duration)?buffer.duration:0;
  render(0);
  status.textContent='Cyan: left channel · Magenta: right channel · Center line: playback position';
}
function render(time){
  ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
  const center=W/2, half=H/2;
  ctx.fillStyle='#dbe6ed';ctx.fillRect(0,half,W,1);
  if(!peaks.length)return;
  const scroll=playbackPosition(time,duration)*(timelineWidth-1);
  for(let c=0;c<2;c++){
    const arr=peaks[c],mid=c===0?H*.25:H*.75,amplitude=H*.20;
    ctx.fillStyle=colors[c];
    for(let x=0;x<W;x++){
      const idx=Math.floor(scroll+x-center);
      if(idx<0||idx>=arr.length)continue;
      const h=Math.max(1,arr[idx]*amplitude);
      ctx.fillRect(x,mid-h,1,h*2);
    }
  }
}
function tick(){
  render(player.currentTime||0);
  if(!player.paused&&!player.ended)frame=requestAnimationFrame(tick);
  else frame=0;
}
player.addEventListener('play',()=>{if(!frame)frame=requestAnimationFrame(tick);});
player.addEventListener('pause',()=>{if(frame)cancelAnimationFrame(frame);frame=0;render(player.currentTime||0);});
player.addEventListener('seeked',()=>render(player.currentTime||0));
player.addEventListener('timeupdate',()=>{if(!frame)render(player.currentTime||0);});
canvas.addEventListener('click',event=>{
  if(!peaks.length||!duration)return;
  const bounds=canvas.getBoundingClientRect();
  const x=(event.clientX-bounds.left)*W/bounds.width;
  const current=playbackPosition(player.currentTime,duration)*(timelineWidth-1);
  const desired=Math.max(0,Math.min(timelineWidth-1,current+(x-W/2)));
  player.currentTime=desired/(timelineWidth-1)*duration;
  render(player.currentTime);
});
clearWaveform();
