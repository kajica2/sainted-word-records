import test from 'node:test';
import assert from 'node:assert/strict';
import {waveformPeaks,playbackPosition} from '../../beatcanvas/waveform-core.js';
test('stereo waveform peaks track channels independently',()=>{
  const channels=[Float32Array.from([0,.2,-.6,0]),Float32Array.from([-.3,.1,.8,0])];
  const audio={numberOfChannels:2,length:4,getChannelData:i=>channels[i]};
  const [cyan,magenta]=waveformPeaks(audio,2);
  assert.ok(Math.abs(cyan[0]-.2)<.001);
  assert.ok(Math.abs(cyan[1]-.6)<.001);
  assert.ok(Math.abs(magenta[0]-.3)<.001);
  assert.ok(Math.abs(magenta[1]-.8)<.001);
});
test('mono audio fills two colors without inventing independent content',()=>{
  const one=Float32Array.from([0,.5,-1,0]);
  const data=waveformPeaks({numberOfChannels:1,length:one.length,getChannelData:()=>one},4);
  assert.equal(data.length,2);
  assert.deepEqual(Array.from(data[0]),Array.from(data[1]));
});
test('seek position clamps to track bounds',()=>{
  assert.equal(playbackPosition(-8,10),0);
  assert.equal(playbackPosition(5,10),.5);
  assert.equal(playbackPosition(18,10),1);
  assert.equal(playbackPosition(5,0),0);
  assert.equal(playbackPosition(NaN,10),0);
});
test('empty or invalid buffers do not render',()=>assert.deepEqual(waveformPeaks(null),[]));
