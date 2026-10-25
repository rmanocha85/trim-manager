// For physician-directed updates after matching the patient to the exact PHN.
// Uses the app's snapshots, revision check, atomic replacement and readback.
import path from 'node:path';
import os from 'node:os';
import {parseArgs} from 'node:util';
import {RosterStore} from '../roster-storage.mjs';
import {updateHospitalStay} from '../public/hospital.mjs';
import {today} from '../public/patients-core.mjs';
const {values}=parseArgs({options:{roster:{type:'string'},phn:{type:'string'},admitted:{type:'string'},returned:{type:'string'},'stay-id':{type:'string'}}});
if(!values.roster||!path.isAbsolute(values.roster)||!/^\d{10}$/.test(values.phn||'')||!values.admitted)throw new Error('Required: --roster ABSOLUTE_PATH --phn TEN_DIGITS --admitted YYYY-MM-DD. Use --stay-id to edit/return an existing stay; omit --returned for an active admission.');
const store=new RosterStore(values.roster,path.join(process.env.LOCALAPPDATA||os.tmpdir(),'TRIMBilling'),[path.join(path.dirname(values.roster),'hospital-update-backups')]);
const current=await store.load();
const next=updateHospitalStay(current.roster,'phn:'+values.phn,{id:values['stay-id']||null,admittedDate:values.admitted,returnedDate:values.returned||null},today());
await store.save(next,current.etag);
console.log('Hospital dates saved and local readback verified. Load latest changes in TRIM. Drive desktop sync is not verified by this command.');
