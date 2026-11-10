import test from 'node:test';
import assert from 'node:assert/strict';
import {VISUAL_STYLES,EXPORT_SECONDS,visualState} from '../../beatcanvas/visual-core.js';
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
