import test from 'node:test';import assert from 'node:assert/strict';
import {ServiceLifecycle} from '../service-lifecycle.mjs';
test('on-demand service waits for tab leases, closes after the last tab, and tolerates reloads',()=>{
 let time=0;const s=new ServiceLifecycle({onDemand:true,now:()=>time,startupMs:100,leaseMs:60,graceMs:30});
 assert.equal(s.shouldStop(),false);time=99;assert.equal(s.shouldStop(),false);time=100;assert.equal(s.shouldStop(),true);
 s.heartbeat('synthetic-tab-one');time=150;s.heartbeat('synthetic-tab-two');assert.equal(s.shouldStop(),false);
 s.heartbeat('synthetic-tab-one',true);assert.equal(s.shouldStop(),false);s.heartbeat('synthetic-tab-two',true);time=179;assert.equal(s.shouldStop(),false);
 s.heartbeat('synthetic-tab-one');time=200;assert.equal(s.shouldStop(),false);s.heartbeat('synthetic-tab-one',true);time=230;assert.equal(s.shouldStop(),true);
});
test('crashed tabs expire, active jobs finish before exit, and background mode remains explicit',()=>{
 let time=0;const s=new ServiceLifecycle({onDemand:true,now:()=>time,leaseMs:60,graceMs:30});s.heartbeat('synthetic-tab-one');time=59;assert.equal(s.shouldStop(),false);time=60;assert.equal(s.shouldStop(true),false);assert.equal(s.shouldStop(),true);
 const background=new ServiceLifecycle({now:()=>time});time=1000000;assert.equal(background.shouldStop(),false);background.stopRequested=true;assert.equal(background.shouldStop(true),false);assert.equal(background.shouldStop(),true);
 assert.throws(()=>s.heartbeat('../unsafe'),/identifier/);
});
test('a long sleep gives existing tabs a fresh lease on resume rather than exiting immediately',()=>{
 let time=0;const s=new ServiceLifecycle({onDemand:true,now:()=>time,leaseMs:60,graceMs:30});s.heartbeat('synthetic-tab-one');time=1000;assert.equal(s.shouldStop(),false);time=1059;assert.equal(s.shouldStop(),false);time=1060;assert.equal(s.shouldStop(),true);
});
