import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAudio, summarizeAnalysis } from '../../beatcanvas/studio-core.js';
import { TARGETS, totals, validRecord, readRecords, saveRecords, STORAGE_KEY } from '../../beatcanvas/research-core.js';
const record = {segment:'musicians',frequency:5,hours:3,spend:20,wtp:12,commitment:false,tools:'CapCut',pain:'Takes too long'};
test('audio upload validation',()=>{
  assert.equal(validateAudio(null).ok,false);
  assert.equal(validateAudio({name:'bad.exe',type:'application/octet-stream',size:100}).ok,false);
  assert.equal(validateAudio({name:'song.wav',type:'audio/wav',size:1024}).ok,true);
  assert.equal(validateAudio({name:'huge.mp3',type:'audio/mpeg',size:101*1024*1024}).ok,false);
});
test('analysis summary preserves uncertainty',()=>{
  assert.equal(summarizeAnalysis({bpm:0,duration:12.36,onsets:[],confidence:0}).bpm,0);
  assert.equal(summarizeAnalysis({bpm:105.4,key:'C',scale:'minor',duration:10,onsets:[1,2],confidence:0.5}).bpm,105);
});
test('research records validated and counted',()=>{
  assert.deepEqual(TARGETS,{musicians:10,educators:5,creators:5});
  assert.equal(validRecord(record),true);
  assert.equal(validRecord({...record,frequency:-1}),false);
  assert.equal(totals([record,{...record,segment:'creators'}]).creators,1);
});
test('local persistence, malformed data and clearing',()=>{
  const memory=new Map();
  const storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)};
  saveRecords(storage,[record]);
  assert.deepEqual(readRecords(storage),[record]);
  assert.ok(memory.has(STORAGE_KEY));
  memory.set(STORAGE_KEY,'{broken');
  assert.deepEqual(readRecords(storage),[]);
  saveRecords(storage,[]);
  assert.deepEqual(readRecords(storage),[]);
});
