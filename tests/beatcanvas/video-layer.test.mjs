import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBackgroundVideo,videoTimeAtAudio,stripOffsets,VIDEO_STRIP_COUNT,DEFAULT_MOTION} from '../../beatcanvas/video-layer-core.js';
test('video upload accepts MP4 WebM MOV only up to 150MB',()=>{
 assert.equal(validateBackgroundVideo({type:'video/mp4',size:1200}).ok,true);
 assert.equal(validateBackgroundVideo({type:'video/webm',size:1200}).ok,true);
 assert.equal(validateBackgroundVideo({type:'video/quicktime',size:1200}).ok,true);
 for(const file of [null,{type:'video/mp4',size:0},{type:'image/png',size:100},{type:'video/mp4',size:151*1024*1024}])assert.equal(validateBackgroundVideo(file).ok,false);
});
test('video background loops on master audio clock',()=>{
 assert.equal(videoTimeAtAudio(4.5,3),1.5);
 assert.equal(videoTimeAtAudio(-4,3),0);
 assert.equal(videoTimeAtAudio(6,3),0);
 assert.equal(videoTimeAtAudio(6,0),0);
});
test('35 percent stripe motion is stable and bounded',()=>{
 assert.equal(DEFAULT_MOTION,.35);
 assert.equal(VIDEO_STRIP_COUNT,7);
 const first=stripOffsets(7,.35,5,.7);
 assert.deepEqual(first,stripOffsets(7,.35,5,.7));
 assert.equal(first.length,7);
 assert.ok(first.every(x=>Number.isFinite(x)&&Math.abs(x)<.04));
});
