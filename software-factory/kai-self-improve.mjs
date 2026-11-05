#!/usr/bin/env node
// Deterministic self-improvement cycle. No API keys, model calls, writes to source or merges.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.env.KAI_QA_OUTPUT || 'qa-results';
const cfg = JSON.parse(readFileSync(new URL('../qa/swarm.config.json', import.meta.url), 'utf8'));
if (cfg.maxConcurrentAgents !== 2 || cfg.maxDailyApiUsd !== 2 || cfg.allowMerge || cfg.allowProductionDeploy) throw new Error('Unsafe KAI SWARM policy');
mkdirSync(root, {recursive:true});
const reportPath=join(root,'report.json');
const queuePath=join(root,'dispatch.json');
const priorPath=process.env.KAI_PREVIOUS_IMPROVEMENT || '';
const report=existsSync(reportPath)?JSON.parse(readFileSync(reportPath,'utf8')):{findings:[],evidence:[]};
const dispatch=existsSync(queuePath)?JSON.parse(readFileSync(queuePath,'utf8')):{lanes:[[],[]]};
const prior=priorPath && existsSync(priorPath)?JSON.parse(readFileSync(priorPath,'utf8')):null;
const signals=(report.findings||[]).map(x=>({key:[x.mission,x.target,x.description].join('|'),mission:x.mission,severity:x.severity,target:x.target,description:x.description}));
const previous=new Set((prior?.signals||[]).map(x=>x.key));
const recurring=signals.filter(x=>previous.has(x.key));
const candidates=[];
if (process.env.KAI_CI_RESULT==='failure') candidates.push({id:'ci-failure-diagnosis',score:100,mission:'regression',action:'Investigate failed existing CI step using its detailed runner log and reproduce locally before a code fix',evidence:'KAI_CI_RESULT=failure',automaticFix:false});
for(const s of signals) candidates.push({id:'qa-'+s.key,score:(s.severity==='high'?85:s.severity==='medium'?55:15)+(previous.has(s.key)?10:0),mission:s.mission,action:'Reproduce and investigate: '+s.description,evidence:s.target,automaticFix:false});
if(!candidates.length)candidates.push({id:'expand-verification',score:20,mission:'regression',action:'Review captured screenshots and add a focused non-flaky assertion for the weakest verified surface',evidence:'No automated findings',automaticFix:false});
candidates.sort((a,b)=>b.score-a.score);
const output={schema:'kai-swarm/improvement-v1',timestamp:new Date().toISOString(),policy:{maxAgents:2,maxDailyModelUsd:2,modelCalls:0,mode:'review-only',mergeAllowed:false},baseline:{qaFindings:signals.length,recurringFindings:recurring.length,ciResult:process.env.KAI_CI_RESULT||'unknown'},signals,proposals:candidates.slice(0,5),nextCycleInput:'Save this report as a retained artifact and set KAI_PREVIOUS_IMPROVEMENT to compare against it'};
writeFileSync(join(root,'improvement.json'),JSON.stringify(output,null,2));
writeFileSync(join(root,'IMPROVEMENT_REVIEW.md'),['# KAI SWARM self-improvement review','', 'Current CI status: '+output.baseline.ciResult,'QA findings: '+signals.length,'Recurring findings (when previous report supplied): '+recurring.length,'','## Ranked proposals',...output.proposals.map((p,i)=>(i+1)+'. **'+p.mission+'** (score '+p.score+'): '+p.action),'','## Approval gate','No fixes are applied. A reviewer selects a proposal, validates evidence, and authorizes implementation on a separate branch. Do not merge automatically.','','## Limits','Two concurrent workers maximum; zero paid model calls in this cycle; model budget $2/day is configured but external provider billing is not enforced.'].join('\n'));
console.log(JSON.stringify({proposals:output.proposals.length,qaFindings:signals.length,ci:output.baseline.ciResult}));
