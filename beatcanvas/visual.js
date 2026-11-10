import {visualState, VISUAL_STYLES, EXPORT_SECONDS, validateImages, imageSequenceIndex, directorScene, DIRECTOR_MODES} from './visual-core.js';
const $ = id => document.getElementById(id);
const canvas=$('visual'), ctx=canvas.getContext('2d');
const player=$('player'), style=$('visual-style'), status=$('render-status'), record=$('record');
let audioContext=null,analyser=null,meter=null,output=null,source=null,recording=null,mediaURL=null,bpm=0;
let images=[];
let imageLoadToken=0;
const assetInput=$('visual-assets'), assetStatus=$('asset-status');
const director=$('director-mode'), sceneStatus=$('scene-status');
assetInput.addEventListener('change',async()=>{
  const token=++imageLoadToken;
  const files=Array.from(assetInput.files||[]);
  const validation=validateImages(files);
  if(!validation.ok){assetStatus.textContent=validation.error;assetInput.value='';return;}
  assetStatus.textContent='Decoding '+files.length+' image(s) locally…';
  const next=[];
  try{
    for(const file of files){
      const bitmap=await createImageBitmap(file);
      if(token!==imageLoadToken){bitmap.close();next.forEach(b=>b.close());return;}
      next.push(bitmap);
    }
    images.forEach(b=>b.close());images=next;
    assetStatus.textContent=images.length?images.length+' images loaded; switching every 4 beats.':'No image assets loaded; procedural visuals only.';
  }catch(e){
    next.forEach(b=>b.close());
    assetStatus.textContent='Could not decode selected image(s). Previous set retained.';
  }
});
window.addEventListener('pagehide',()=>{images.forEach(b=>b.close());images=[];});
export function setBpm(value){bpm=Number(value)||0;}
export function resetAudio(){
  if(recording && recording.state!=='inactive') recording.stop();
  player.pause();
}
async function connect(){
  if(audioContext){await audioContext.resume();return;}
  const AudioCtx=window.AudioContext||window.webkitAudioContext;
  if(!AudioCtx) throw Error('Web Audio unavailable');
  audioContext=new AudioCtx();
  source=audioContext.createMediaElementSource(player);
  analyser=audioContext.createAnalyser();
  analyser.fftSize=2048;
  meter=new Uint8Array(analyser.frequencyBinCount);
  output=audioContext.createMediaStreamDestination();
  source.connect(analyser);
  analyser.connect(audioContext.destination);
  analyser.connect(output);
  await audioContext.resume();
}
function draw(t, energy){
  const state=visualState({time:t,bpm,energy,style:style.value});
  const w=canvas.width,h=canvas.height, cx=w/2,cy=h/2;
  ctx.fillStyle='#050a14';ctx.fillRect(0,0,w,h);
  const scene=directorScene(t,bpm,images.length,director.value);
  const imageIndex=scene.index;
  if(images.length) sceneStatus.textContent='Image '+(imageIndex+1)+' of '+images.length+' · '+scene.beatsPerScene+' beats per scene';
  if(imageIndex>=0){
    const img=images[imageIndex];
    const scale=Math.max(w/img.width,h/img.height);
    const iw=img.width*scale,ih=img.height*scale;
    ctx.drawImage(img,(w-iw)/2,(h-ih)/2,iw,ih);
    // Subtle fade at the start of each scene, deterministic when seeking.
    const entry=Math.min(1,scene.progress*8);
    ctx.fillStyle='rgba(5,10,20,'+(0.22*(1-entry))+')';ctx.fillRect(0,0,w,h);
    ctx.fillStyle='rgba(3,8,18,.52)';ctx.fillRect(0,0,w,h);
  }
  if(state.style==='dark-pulse'){
    const glow=ctx.createRadialGradient(cx,cy,0,cx,cy,w*.7);
    glow.addColorStop(0,'rgba(88,240,205,'+(0.12+state.intensity*.65)+')');glow.addColorStop(1,'rgba(5,10,20,.40)');
    ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
    for(let i=0;i<24;i++){const a=i*Math.PI/12+t*.13,r=w*(.14+.19*state.pulse+.05*state.amount);ctx.strokeStyle='rgba(125,245,218,'+(.13+.6*state.intensity)+')';ctx.lineWidth=2+state.amount*10;ctx.beginPath();ctx.arc(cx+Math.cos(a)*r,cy+Math.sin(a)*r,30+state.intensity*125,0,Math.PI*2);ctx.stroke();}
  }else if(state.style==='organic-motion'){
    for(let i=0;i<11;i++){ctx.beginPath();ctx.strokeStyle='hsla('+(175+i*14)+',80%,65%,'+(.15+.5*state.intensity)+')';ctx.lineWidth=3+state.amount*18;for(let j=0;j<55;j++){const x=j*w/54,y=cy+Math.sin(j*.18+i*.48+t*.8)*w*(.08+.04*state.amount)+Math.cos(j*.045+t*.3+i)*w*.13;(j?ctx.lineTo(x,y):ctx.moveTo(x,y));}ctx.stroke();}
  }else{
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold '+Math.round(w*(.15+state.intensity*.05))+'px system-ui';ctx.fillStyle='#e6f8f3';ctx.fillText('BEAT',cx,cy-65);
    ctx.fillStyle='#7eead2';ctx.fillRect(w*.18,cy+60,w*.64*state.intensity,12);
    ctx.font='24px system-ui';ctx.fillText('CANVAS',cx,cy+125);
  }
  ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.font='24px system-ui';ctx.fillStyle='#bbd9df';ctx.fillText('SAINTED WORD RECORDS',cx,h-60);
}
function tick(){
  let energy=0;
  if(analyser && !player.paused){
    analyser.getByteFrequencyData(meter);
    const count=Math.min(100,meter.length);
    for(let i=0;i<count;i++)energy+=meter[i]/255/count;
  }
  draw(player.currentTime||0,energy);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
player.addEventListener('play',()=>connect().catch(e=>status.textContent=e.message));
style.addEventListener('change',()=>{if(!VISUAL_STYLES.includes(style.value))style.value=VISUAL_STYLES[0];});
director.addEventListener('change',()=>{if(!DIRECTOR_MODES.includes(director.value))director.value='steady';});
record.addEventListener('click',async()=>{
  if(recording||!player.src)return;
  if(!canvas.captureStream||!window.MediaRecorder){status.textContent='Recording is unsupported in this browser.';return;}
  const mime=['video/webm;codecs=vp8,opus','video/webm'].find(v=>MediaRecorder.isTypeSupported(v));
  if(!mime){status.textContent='WebM recording is unsupported in this browser.';return;}
  try{
    await connect();
    player.pause();player.currentTime=0;
    const stream=canvas.captureStream(30);
    for(const track of output.stream.getAudioTracks())stream.addTrack(track);
    const chunks=[];
    const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:3500000});
    recording=recorder;
    record.disabled=true;
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onerror=()=>{status.textContent='Recorder error; retry with a shorter track.';};
    recorder.onstop=()=>{
      stream.getTracks().filter(t=>t.kind==='video').forEach(t=>t.stop());
      if(mediaURL)URL.revokeObjectURL(mediaURL);
      if(chunks.length){mediaURL=URL.createObjectURL(new Blob(chunks,{type:mime}));const a=document.createElement('a');a.href=mediaURL;a.download='beatcanvas-preview.webm';a.click();status.textContent='WebM preview downloaded. Check its audio sync before sharing.';}
      else status.textContent='Recording produced no video data.';
      recording=null;record.disabled=false;
    };
    recorder.start(250);await player.play();
    status.textContent='Recording up to '+EXPORT_SECONDS+' seconds. Keep this tab visible.';
    const finish=()=>{if(recorder.state!=='inactive'){recorder.stop();player.pause();}};
    const started=player.currentTime;
    const onTime=()=>{if(player.currentTime-started>=EXPORT_SECONDS-0.05){player.removeEventListener('timeupdate',onTime);finish();}};
    player.addEventListener('timeupdate',onTime);
    recorder.addEventListener('stop',()=>player.removeEventListener('timeupdate',onTime),{once:true});
    player.addEventListener('ended',finish,{once:true});
  }catch(e){status.textContent='Recording failed: '+e.message;record.disabled=false;recording=null;}
});
export function hasRecorder(){return !!recording;}
