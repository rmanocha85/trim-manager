// Explicit workflow writes only. Input JSON is private; no identities in console output.
import {readFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {MaidStore} from '../maid-storage.mjs';
const args=process.argv.slice(2),get=k=>args[args.indexOf(k)+1];
const file=args.includes('--roster')?get('--roster'):path.join(os.homedir(),'My Drive','00. MAID','MAID AI','maid-roster.json');
const store=new MaidStore(file);
if(args.includes('--inspect')){const data=await store.load();console.log(JSON.stringify({etag:data.etag,patients:data.roster.patients.length}));}
else{
 if(!args.includes('--request'))throw new Error('Use --inspect or --request PRIVATE_REQUEST_JSON.');
 const request=JSON.parse(await readFile(get('--request'),'utf8'));
 const saved=await store.mutate(request.action,request.expectedEtag);
 console.log(JSON.stringify({saved:true,etag:saved.etag,patients:saved.roster.patients.length}));
}
