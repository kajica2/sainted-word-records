#!/usr/bin/env node
// KAI Dev Swarm Phase 1: offline deterministic dispatch; NO model calls.
// Two-worker ceiling, $2/day planned budget, no autonomous writes/deploys.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const config=JSON.parse(readFileSync(new URL('../qa/swarm.config.json',import.meta.url),'utf8'));
if(config.maxConcurrentAgents!==2 || config.maxDailyApiUsd!==2 || config.allowMerge || config.allowProductionDeploy) throw new Error('KAI policy mismatch');
const source=process.argv[2] || 'qa-results/report.json';
const destination=process.argv[3] || 'qa-results';
mkdirSync(destination,{recursive:true});
if(!existsSync(source)){console.error('Missing QA report: '+source);process.exit(2);}
const report=JSON.parse(readFileSync(source,'utf8'));
if(report.schema!=='kai-swarm/phase1'||!Array.isArray(report.findings))throw new Error('Unsupported report schema');
const order={high:0,medium:1,low:2,info:3};
const priority=new Map();
for(const finding of report.findings){
 const mission=['visual','api','regression','security','creative'].includes(finding.mission)?finding.mission:'regression';
 const key=mission+'|'+finding.target+'|'+finding.description;
 if(!priority.has(key))priority.set(key,{mission,target:finding.target,description:finding.description,severity:finding.severity,sourceIds:[finding.id]});
 else priority.get(key).sourceIds.push(finding.id);
}
const items=[...priority.values()].sort((a,b)=>(order[a.severity]??4)-(order[b.severity]??4));
const lanes=[[],[]];
items.forEach((x,i)=>lanes[i%2].push({...x,owner:'SWR-Check',state:'review_required',canMutateRepo:false}));
const dispatch={schema:'kai-swarm/dispatch-v1',createdAt:new Date().toISOString(),source,policy:{concurrentWorkers:2,modelApiDailyUsd:2,modelCallsMade:0,allowedAutomation:'read_only',productionMerge:false},lanes,counts:{findings:report.findings.length,deduplicatedTasks:items.length}};
writeFileSync(join(destination,'dispatch.json'),JSON.stringify(dispatch,null,2));
const rows=items.map((t,i)=>'| '+(i+1)+' | '+t.severity+' | '+t.mission+' | '+t.target+' | '+t.description.replaceAll('|','/').replaceAll('\n',' ').slice(0,140)+' |');
writeFileSync(join(destination,'DEV_SWARM_QUEUE.md'),['# KAI Dev Swarm — deterministic task queue','','Mode: read-only triage, two lanes. No model calls or repo mutations.','','| # | Severity | Mission | Target | Finding |','|---|---|---|---|---|',...rows,'','## Handoff','Review the queue and existing CI logs. When budget enforcement is available, use software-factory/swr-agent.mjs for independent review. No automatic changes, baseline updates, secrets or merges.'].join('\n'));
console.log(JSON.stringify(dispatch.counts));
