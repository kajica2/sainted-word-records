import {readRecords,saveRecords,totals} from './research-core.js';
const $ = id => document.getElementById(id);
let records = readRecords(localStorage);
function render() {
  const counts = totals(records);
  for (const key of Object.keys(counts)) $(key).textContent = counts[key];
  const tbody = $('records'); tbody.replaceChildren();
  records.forEach((r,i) => {
    const tr = document.createElement('tr');
    for (const field of ['segment','frequency','hours','spend','wtp','commitment']) {
      const td = document.createElement('td');
      td.textContent = field === 'commitment' ? (r.commitment ? 'Yes':'No') : String(r[field]);
      tr.append(td);
    }
    const td = document.createElement('td'), btn = document.createElement('button');
    btn.textContent = 'Delete';
    btn.addEventListener('click', () => { if(!confirm('Delete this interview?'))return; records.splice(i,1); persist();});
    td.append(btn);tr.append(td);tbody.append(tr);
  });
}
function persist() {try {saveRecords(localStorage,records); $('notice').textContent='Saved on this device.';render();}catch(e){$('notice').textContent='Storage unavailable: '+e.message;}}
$('form').addEventListener('submit',event=>{
  event.preventDefault(); const form=event.currentTarget, data=new FormData(form);
  const record={segment:data.get('segment'),frequency:Number(data.get('frequency')),hours:Number(data.get('hours')),spend:Number(data.get('spend')),wtp:Number(data.get('wtp')),commitment:data.get('commitment')==='yes',tools:String(data.get('tools')).trim(),pain:String(data.get('pain')).trim()};
  records.push(record);persist();form.reset();
});
$('clear').addEventListener('click',()=>{if(confirm('Permanently delete all locally saved interviews?')){records=[];persist();}});
$('export').addEventListener('click',()=>{
  const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),records},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url;a.download='beatcanvas-interviews.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
render();
