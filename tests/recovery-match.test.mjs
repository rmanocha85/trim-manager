import test from 'node:test';
import assert from 'node:assert/strict';
import {blankLedger,upsertEntry,sameBillingContent} from '../public/core.mjs';
const p={key:'roster:synthetic',id:'synthetic',name:'SYNTHETIC',panel:true};
const source=()=>upsertEntry(blankLedger('same-dataset'),p,'2026-09-22',[{code:'14077',units:1,start:'18:30',end:'18:40'}]);
test('already-saved draft matches despite root save metadata and object key order',()=>{const a=source(),b=structuredClone(a);b.revision++;b.updatedAt='2026-10-06T00:00:00Z';const reordered=Object.fromEntries(Object.entries(b).reverse());assert.equal(sameBillingContent(a,reordered),true);assert.equal(a.revision,0);});
test('real billing differences are never treated as an acknowledged save',()=>{for(const change of [b=>b.entries[0].items[0].end='18:41',b=>b.entries[0].items[0].reason='changed',b=>b.entries[0].updatedAt='different',b=>b.entries=[],b=>b.settings.parallel=false,b=>b.datasetId='another',b=>b.baselines[p.key]={date:'2026-09-01'},b=>b.patients[p.key].name='different',b=>b.historicalBillings=[],b=>b.imports=[],b=>b.localWriter='different']){const a=source(),b=structuredClone(a);change(b);assert.equal(sameBillingContent(a,b),false);}});
