import test from 'node:test';
import assert from 'node:assert/strict';
import {nurseMessages,messageName,NURSING_FLOORS,individualNurseText} from '../public/nurse-messages.mjs';
const activeIssue={status:'active',description:'Respiratory symptoms'};
const person=(id,unit,extra={})=>({id,phn:String(id).padStart(10,'0'),name:'Example, Person '+id,unit,activeIssue,...extra});
test('confirmed nursing groups include Hatzic on floor 2 despite old metadata',()=>{
 const roster={patients:Object.keys(NURSING_FLOORS).map((u,i)=>person(i+1,u.toLowerCase())),units:Object.keys(NURSING_FLOORS).map(u=>({id:u.toLowerCase(),name:u,floor:1}))};
 const result=nurseMessages(roster);assert.equal(result.total,8);assert.equal(result.groups[0].rows.length,4);assert.equal(result.groups[1].rows.length,4);assert.equal(result.unassigned.length,0);
 assert.match(result.groups[1].text,/HATZIC, Floor 2/);assert.match(result.groups[0].text,/STAVE, Floor 3/);
 assert.doesNotMatch(JSON.stringify(result),/000000000/);assert.match(result.groups[0].text,/Person 1 Example/);assert.match(result.groups[0].text,/Respiratory symptoms - Could you provide a clinical update\?/);
});
test('active only, scope selection and duplicates across collections',()=>{
 const p=person(1,'cedar'),roster={patients:[p,p,person(2,'ADP',{activeIssue:null}),person(3,'fern',{activeIssue:{status:'resolved',description:'done'}})],otherPatients:[{...p,id:'duplicate'},person(4,'stave')]};
 assert.equal(nurseMessages(roster).total,2);assert.equal(nurseMessages(roster,'patients').total,1);assert.equal(nurseMessages(roster,'otherPatients').total,2);
 assert.equal(nurseMessages({patients:[]}).groups[0].text,'');
});
test('unknown and conflicting locations are visible and excluded from both drafts',()=>{
 const p=person(1,'cedar');const result=nurseMessages({patients:[p,person(2,'ADP'),person(3,''),person(4,'hatzic')],otherPatients:[{...p,unit:'fern'}],units:[{id:'hatzic',name:'CEDAR'}]});
 assert.equal(result.total,4);assert.equal(result.unassigned.length,4);assert.equal(result.groups.flatMap(g=>g.rows).length,0);
 assert.match(result.unassigned[0].reason,/Conflicting/);
});
test('name formatting preserves spelling and punctuation',()=>{
 assert.equal(messageName('Example, Morgan'),'Morgan Example');assert.equal(messageName("D’Arcy-Smith, Élodie Jane"),'Élodie Jane D’Arcy-Smith');assert.equal(messageName('Single Name'),'Single Name');
});
test('individual draft copies the active issue verbatim and excludes resolved issues',()=>{
 const patient=person(1,'cedar',{name:'Example, Morgan',activeIssue:{status:'active',description:'Influenza A — cough <improving>'}});
 assert.equal(individualNurseText(patient),'Morgan Example - Influenza A — cough <improving> - Could you provide a clinical update?');
 patient.activeIssue.status='resolved';assert.equal(individualNurseText(patient),'Morgan Example - Could you provide a clinical update?');
});
