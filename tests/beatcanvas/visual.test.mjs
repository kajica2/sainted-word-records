import test from 'node:test';
import assert from 'node:assert/strict';
import {VISUAL_STYLES,EXPORT_SECONDS,visualState,validateImages,imageSequenceIndex} from '../../beatcanvas/visual-core.js';
test('three supported distinct styles and bounded preview export',()=>{
  assert.deepEqual(VISUAL_STYLES,['dark-pulse','organic-motion','minimal-type']);
  assert.equal(EXPORT_SECONDS,15);
});
test('visual pulse follows estimated beats',()=>{
  const down=visualState({time:1,bpm:120,style:'organic-motion'});
  const off=visualState({time:1.25,bpm:120,style:'organic-motion'});
  assert.ok(down.pulse>off.pulse);
  assert.equal(down.style,'organic-motion');
});
test('unavailable tempo and energy remain bounded',()=>{
  for(const bpm of [0,NaN,-4,400]){
    const state=visualState({time:-1,bpm,energy:8,style:'untrusted'});
    assert.ok(state.intensity>=0&&state.intensity<=1);
    assert.equal(state.style,'dark-pulse');
  }
});

test('image sequencing advances after four beats and loops deterministically',()=>{
  assert.equal(imageSequenceIndex(0,120,3),0);
  assert.equal(imageSequenceIndex(1.99,120,3),0);
  assert.equal(imageSequenceIndex(2,120,3),1);
  assert.equal(imageSequenceIndex(6,120,3),0);
  assert.equal(imageSequenceIndex(5,120,0),-1);
  assert.equal(imageSequenceIndex(-100,120,3),0);
});
test('image validation rejects unsafe file shapes and oversized batches',()=>{
  const photo={type:'image/png',size:1024};
  assert.equal(validateImages([photo]).ok,true);
  assert.equal(validateImages(Array(13).fill(photo)).ok,false);
  assert.equal(validateImages([{type:'image/svg+xml',size:100}]).ok,false);
  assert.equal(validateImages([{type:'image/png',size:13*1024*1024}]).ok,false);
});
