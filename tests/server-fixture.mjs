// Tests can never fall back to the production Drive files or real AI credentials.
import {createServer as server} from '../server.mjs';
import os from 'node:os';
import path from 'node:path';
export function createServer(options={}){
 const temp=path.resolve(os.tmpdir()),fallback=path.join(temp,'trim-no-live-data');
 const config={rosterPath:path.join(fallback,'roster.json'),billingPath:path.join(fallback,'billing.json'),...options};
 for(const key of ['rosterPath','billingPath','notesPath','lockPath'])if(config[key]&&!path.resolve(config[key]).startsWith(temp+path.sep))throw new Error('Tests must use temporary data paths.');
 return server(config);
}
