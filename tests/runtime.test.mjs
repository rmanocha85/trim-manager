import test from 'node:test';
import assert from 'node:assert/strict';
import {laptopRuntime,LAPTOP_URL} from '../public/runtime.mjs';
import {DriveAdapter} from '../public/adapters.mjs';
import {sameRosterContent} from '../public/patients-core.mjs';
test('Notes runs only at the local service entry points, never a hosted or static preview path',()=>{
 for(const url of ['https://rmanocha85.github.io/trim-manager/public/','http://127.0.0.1:1234/trim-manager/public/','https://localhost.example/','https://example.com/'])assert.equal(laptopRuntime(new URL(url)),false);
 for(const url of ['http://127.0.0.1:4317/','http://localhost:4317/index.html'])assert.equal(laptopRuntime(new URL(url)),true);
});
test('cloud-to-laptop link selects direct Drive connection and Notes without transferring records',()=>{const u=new URL(LAPTOP_URL);assert.equal(u.searchParams.get('connection'),'cloud');assert.equal(u.searchParams.get('section'),'notes');assert.equal([...u.searchParams].length,2);});
test('an isolated Drive roster can never be used as its billing target',()=>assert.throws(()=>new DriveAdapter('test-roster',{rosterId:'test-roster'}),/never/));
test('connection switching compares complete roster content including unknown fields',()=>{
 const a={patients:[],units:[],extra:{kept:1},removedPatients:[]},b={extra:{kept:1},units:[],patients:[],otherPatients:[],billingDates:[]};
 assert.equal(sameRosterContent(a,b),true);b.extra.kept=2;assert.equal(sameRosterContent(a,b),false);
});
