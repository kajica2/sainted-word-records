// BeatCanvas: real short MP3, browser playback, export smoke on built site.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import puppeteer from 'puppeteer';
const ROOT=resolve('dist');
const TYPES={'.html':'text/html','.js':'text/javascript','.css':'text/css','.mp3':'audio/mpeg','.png':'image/png'};
const server=createServer(async(req,res)=>{
  const rel=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=resolve(ROOT,'.'+rel);
  if(file!==ROOT && !file.startsWith(ROOT+sep)){res.writeHead(403).end();return;}
  try{const f=(await stat(file)).isDirectory()?resolve(file,'index.html'):file;
    const body=await readFile(f);res.writeHead(200,{'Content-Type':TYPES[extname(f)]||'application/octet-stream'}).end(body);
  }catch{res.writeHead(404).end('not found');}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const base='http://127.0.0.1:'+server.address().port;
let browser;
try{
  browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/beatcanvas/',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{
    window.__clip=null;
    HTMLAnchorElement.prototype.click=function(){
      if(this.download?.endsWith('.webm')){
        const href=this.href;
        window.__clip=fetch(href).then(r=>r.blob()).then(async b=>({size:b.size,type:b.type,head:Array.from(new Uint8Array(await b.slice(0,4).arrayBuffer()))}));
      }
    };
  });
  await page.$eval('#song',(el,url)=>{
    // browser fetch from same-origin, then real File, dispatched through the real input handler
    fetch(url).then(r=>{if(!r.ok)throw Error('fixture unavailable');return r.blob()}).then(b=>{
      const dt=new DataTransfer();dt.items.add(new File([b],'pulse.mp3',{type:'audio/mpeg'}));
      el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));
    }).catch(e=>window.__fixtureError=e.message);
  },base+'/audios/pulse.mp3');
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Analysis completed')||document.getElementById('status').textContent.includes('failed')||window.__fixtureError,{timeout:60000});
  const status=await page.$eval('#status',e=>e.textContent);
  assert.match(status,/Analysis completed/, 'MP3 failed to analyze: '+status);
  assert.equal(await page.$eval('#record',e=>e.disabled),false);
  const wave=await page.evaluate(()=>{
    const canvas=document.getElementById('waveform');
    const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let colorPixels=0;
    for(let i=0;i<pixels.length;i+=4){
      const r=pixels[i],g=pixels[i+1],b=pixels[i+2];
      if((b>r+25&&b>g)||(r>g+40&&b>g+20)) colorPixels++;
    }
    const line=document.querySelector('.wave-playhead');
    return {colorPixels,lineWidth:getComputedStyle(line).width,status:document.getElementById('wave-status').textContent};
  });
  assert.ok(wave.colorPixels>20,'waveform missing cyan/magenta peaks');
  assert.equal(wave.lineWidth,'1px','playback line should be exactly 1 CSS pixel');
  assert.match(wave.status,/Cyan.*Magenta/,'waveform was not populated by audio analysis');
  await page.select('#visual-style','organic-motion');
  await page.select('#director-mode','kinetic');
  await page.click('#record');
  await page.waitForFunction(()=>!!window.__clip||document.getElementById('render-status').textContent.includes('failed'),{timeout:45000});
  const clip=await page.evaluate(async()=>window.__clip?await window.__clip:null);
  assert.ok(clip&&clip.size>3000,'WebM download absent or too small');
  assert.deepEqual(clip.head,[26,69,223,163],'invalid WebM EBML signature');
  assert.equal(errors.length,0,'page exceptions: '+errors.join('; '));
  console.log('BeatCanvas MP3 smoke PASS',JSON.stringify({fixture:'audios/pulse.mp3',analysis:status,clipBytes:clip.size,mime:clip.type}));
}finally{if(browser)await browser.close();await new Promise(ok=>server.close(ok));}
