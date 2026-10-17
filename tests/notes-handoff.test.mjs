import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {prepareHandoff,writeHandoffRun} from 'file:///C:/Users/rmano/My%20Drive/02.%20TRIM/TRIM%20AI/Skills/trim-routine-billing/scripts/prepare-handoff.mjs';
const h=()=>({app:'trim-meditech-handoff',schema:1,serviceDate:'2026-10-12',patients:[1,2].map(n=>({key:'phn:'+String(n).padStart(10,'0'),phn:String(n).padStart(10,'0'),id:'test-'+n,name:'SYNTHETIC '+n,unit:n===1?'Cedar':'Cherry',room:String(n),assessment:'Exact reviewed note '+n,reviewedAt:'2026-10-12T18:00:00Z',noteVersion:4}))});
test('skill handoff uses exact reviewed text and optional unit subset without billing input',()=>{
  const input=h(),q=prepareHandoff(input,{units:['cedar']});assert.equal(q.patients.length,1);assert.equal(q.patients[0].assessment,input.patients[0].assessment);assert.equal(q.patients[0].status,'queued');assert.ok(!JSON.stringify(q).includes('billing'));assert.throws(()=>prepareHandoff(input,{date:'2026-10-11'}),/date/);assert.throws(()=>prepareHandoff(input,{units:['Absent']}),/absent/);delete input.patients[0].reviewedAt;assert.throws(()=>prepareHandoff(input),/validation/);
});
test('repeat handoff reuses checkpoint, changed overlap refuses duplicate, separate units permitted',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'trim-handoff-test-'));try{const q=prepareHandoff(h(),{units:['Cedar']}),first=writeHandoffRun(q,dir);assert.equal(first.created,true);const second=writeHandoffRun(q,dir);assert.equal(second.created,false);assert.equal(second.runFile,first.runFile);const changed=h();changed.patients[0].assessment='New reviewed text';assert.throws(()=>writeHandoffRun(prepareHandoff(changed),dir),/Overlapping/);assert.equal(JSON.parse(await readFile(first.runFile,'utf8')).patients[0].assessment,'Exact reviewed note 1');assert.equal(writeHandoffRun(prepareHandoff(h(),{units:['Cherry']}),dir).created,true);}finally{await rm(dir,{recursive:true,force:true});}
});
