export const TARGETS = Object.freeze({musicians:10,educators:5,creators:5});
export const STORAGE_KEY = 'beatcanvas.research.v1';
export function validRecord(r) {
  return r && Object.hasOwn(TARGETS,r.segment) &&
    ['frequency','hours','spend','wtp'].every(k=>Number.isFinite(r[k]) && r[k]>=0 && r[k]<=100000) &&
    typeof r.tools==='string' && r.tools.trim().length>0 && r.tools.length<=200 &&
    typeof r.pain==='string' && r.pain.trim().length>0 && r.pain.length<=2000 &&
    typeof r.commitment==='boolean';
}
export function totals(rows) {
  const counts = {musicians:0,educators:0,creators:0};
  for (const r of rows) if (validRecord(r)) counts[r.segment]++;
  return counts;
}
export function readRecords(storage) {
  try { const value = JSON.parse(storage.getItem(STORAGE_KEY) || '[]'); return Array.isArray(value) ? value.filter(validRecord).slice(0,500) : []; } catch {return [];}
}
export function saveRecords(storage, rows) {
  if (!Array.isArray(rows) || rows.length>500 || !rows.every(validRecord)) throw new Error('Invalid research records');
  storage.setItem(STORAGE_KEY,JSON.stringify(rows));
}
