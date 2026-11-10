import {validateBackgroundVideo,videoTimeAtAudio,stripOffsets,DEFAULT_MOTION,VIDEO_STRIP_COUNT} from './video-layer-core.js';
const player=document.getElementById('player');
const input=document.getElementById('background-video');
const status=document.getElementById('background-video-status');
const video=document.createElement('video');
video.muted=true;video.defaultMuted=true;video.loop=true;video.playsInline=true;video.preload='auto';
let url=null,token=0,ready=false;
export function hasBackgroundVideo(){return ready&&video.readyState>=2&&video.videoWidth>0;}
export function syncBackgroundVideo(force=false){
 if(!hasBackgroundVideo())return;
 const at=videoTimeAtAudio(player.currentTime||0,video.duration);
 if(force || Math.abs(video.currentTime-at)>.13){try{video.currentTime=at;}catch{}}
 if(player.paused||player.ended){video.pause();}
 else if(video.paused)video.play().catch(()=>{});
}
input.addEventListener('change',async()=>{
 const id=++token;
 const file=input.files?.[0];
 if(!file){ready=false;video.pause();video.removeAttribute('src');video.load();if(url)URL.revokeObjectURL(url);url=null;status.textContent='No background video selected.';return;}
 const result=validateBackgroundVideo(file);
 if(!result.ok){input.value='';status.textContent=result.error;return;}
 ready=false;video.pause();
 if(url)URL.revokeObjectURL(url);
 url=URL.createObjectURL(file);
 video.src=url;video.load();status.textContent='Loading background video locally…';
 try{
  await new Promise((resolve,reject)=>{
   const done=()=>{video.removeEventListener('loadeddata',ok);video.removeEventListener('error',fail);};
   const ok=()=>{done();resolve();};const fail=()=>{done();reject(Error('Video decoder could not open this file.'));};
   video.addEventListener('loadeddata',ok,{once:true});
   video.addEventListener('error',fail,{once:true});
  });
  if(id!==token)return;
  ready=true;syncBackgroundVideo(true);
  status.textContent='Video ready · 7 animated strips · original video audio muted.';
 }catch(error){if(id===token){ready=false;status.textContent=error.message;}}
});
player.addEventListener('play',()=>syncBackgroundVideo(true));
player.addEventListener('pause',()=>syncBackgroundVideo(true));
player.addEventListener('seeked',()=>syncBackgroundVideo(true));
player.addEventListener('timeupdate',()=>syncBackgroundVideo());
window.addEventListener('pagehide',()=>{video.pause();if(url)URL.revokeObjectURL(url);});
export function drawVideoStrips(ctx,w,h,time,energy){
 ctx.fillStyle='#101923';ctx.fillRect(0,0,w,h);
 const offsets=stripOffsets(VIDEO_STRIP_COUNT,DEFAULT_MOTION,time,energy);
 const stripeW=w/VIDEO_STRIP_COUNT;
 for(let i=0;i<VIDEO_STRIP_COUNT;i++){
  const x=i*stripeW,shift=offsets[i]*w;
  if(hasBackgroundVideo()){
   const scale=Math.max(w/video.videoWidth,h/video.videoHeight)*1.12;
   const iw=video.videoWidth*scale,ih=video.videoHeight*scale;
   ctx.save();ctx.beginPath();ctx.rect(x,0,stripeW+.5,h);ctx.clip();
   ctx.drawImage(video,(w-iw)/2+shift,(h-ih)/2,iw,ih);
   ctx.restore();
  }else{
   ctx.fillStyle=i%2?'#264d59':'#102b39';
   ctx.fillRect(x,0,stripeW+.5,h);
  }
  ctx.fillStyle='rgba(0,0,0,'+(i%2?.18:.04)+')';ctx.fillRect(x,0,stripeW+.5,h);
 }
}
