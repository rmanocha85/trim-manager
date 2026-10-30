import {writeFile,rename,mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {profileDisplay} from './public/profile-display.mjs';
export async function refreshProfileDisplay(notes,root){
 const loaded=await notes.load('patient-context.json'),patients={};
 for(const c of Object.values(loaded.data?.patients||{})){const phn=String(c.patient?.phn||'').replace(/\D/g,'');if(/^\d{10}$/.test(phn))patients[phn]=profileDisplay(c);}
 const data={app:'trim-patient-display',schema:1,datasetId:loaded.data?.datasetId||'',patients};
 const file=path.join(root,'patient-display.json'),text=JSON.stringify(data,null,2)+'\n';
 let old;try{old=await readFile(file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
 if(old!==text){await mkdir(root,{recursive:true});await writeFile(file+'.tmp',text);await rename(file+'.tmp',file);}
 return data;
}
