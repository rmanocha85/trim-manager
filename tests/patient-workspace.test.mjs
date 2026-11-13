import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';
import {ageOn,newPatient,demographicsHTML} from '../public/patient-identity.mjs';
import {profileDisplay,setProfileDisplay} from '../public/profile-display.mjs?v=20261113-history1';
import {DocumentIntake} from '../intake-local.mjs';
import {LocalNotesStore} from '../notes-local.mjs';
import {contextRecord} from '../public/notes-core.mjs';
import {checkManifest} from '../public/intake-core.mjs';
const phn='0000000001',key='phn:'+phn;
test('current age and fourteen-day new label handle birthday and date boundaries',()=>{
 assert.equal(ageOn('1940-10-31','2026-10-30'),85);assert.equal(ageOn('1940-10-31','2026-10-31'),86);assert.equal(ageOn('1940-02-30'),null);assert.equal(ageOn('2099-01-01'),null);
 const p={newPanelPatient:true,panelAddedDate:'2026-10-01'};assert.equal(newPatient(p,'2026-10-14'),true);assert.equal(newPatient(p,'2026-10-15'),false);assert.equal(newPatient({...p,newPanelPatient:false},'2026-10-02'),false);
});
test('profile projection reads exact wording, distinguishes C2, and flags proposed or conflicting orders',()=>{
 assert.equal(profileDisplay({summaryMarkdown:'## MOST\n- MOST CPR C2 retained.'}).mostStatus,'CPR C2');
 assert.equal(profileDisplay({summaryMarkdown:'- MOST DNR M2 retained.'}).mostStatus,'DNACPR M2');
 assert.equal(profileDisplay({summaryMarkdown:'- MOST M2 confirmed with son.'}).mostStatus,'DNACPR M2');
 assert.equal(profileDisplay({summaryMarkdown:'- MOST M2, possible future M1 discussed.'}).mostStatus,'DNACPR M2');
 assert.equal(profileDisplay({summaryMarkdown:'- DNACPR M1 narrative.\n- DNACPR M2 field; reconciliation pending.'}).mostStatus,'');
 setProfileDisplay({patients:{[phn]:{dateOfBirth:'1940-10-31',mostStatus:'M2',mostEvidence:'MOST M2 confirmed.'}}});const h=demographicsHTML({phn},'2026-10-30');assert.match(h,/85 y/);assert.match(h,/>DNACPR M2</);setProfileDisplay(null);
});
// Automatic intake coverage lives in automatic-intake.test.mjs.
 test('physician confirmation controls the current designation and retains earlier discussions',()=>{
 const summaryMarkdown='MOST M2 retained after discussion of possible M1.';
 const context={summaryMarkdown,currentMost:{designation:'M2',source:'physician',confirmedOn:'2026-10-30'}};
 const display=profileDisplay(context);assert.equal(display.mostStatus,'DNACPR M2');assert.match(display.mostEvidence,/Physician confirmed DNACPR M2 on 2026-10-30/);assert.ok(display.mostEvidence.includes(summaryMarkdown));
 for(const currentMost of [{...context.currentMost,source:'AI'},{...context.currentMost,confirmedOn:''},{...context.currentMost,designation:'unknown'}])assert.equal(profileDisplay({...context,currentMost}).mostStatus,'DNACPR M2');
 setProfileDisplay({patients:{[phn]:display}});const html=demographicsHTML({phn});assert.match(html,/>DNACPR M2<\/span>/);assert.doesNotMatch(html,/>[^<]*(?:MOST|✚)/);setProfileDisplay(null);
 });
