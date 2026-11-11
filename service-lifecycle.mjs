// Track open laptop app tabs, including background/minimized tabs. No patient data.
export class ServiceLifecycle {
 constructor({onDemand=false,now=()=>Date.now(),leaseMs=180000,graceMs=30000,startupMs=120000}={}){Object.assign(this,{onDemand,now,leaseMs,graceMs,startupMs});this.startedAt=now();this.lastClientAt=now();this.clients=new Map();this.seenClient=false;this.stopRequested=false;this.lastCheckAt=now();}
 heartbeat(id,release=false){if(typeof id!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(id))throw new Error('Invalid laptop tab identifier.');if(release){if(this.clients.delete(id))this.lastClientAt=this.now();}else{this.clients.set(id,this.now());this.lastClientAt=this.now();this.seenClient=true;}}
 count(){const now=this.now();for(const [id,at] of this.clients)if(now-at>=this.leaseMs)this.clients.delete(id);return this.clients.size;}
 shouldStop(busy=false){const now=this.now();if(this.onDemand&&this.seenClient&&now-this.lastCheckAt>this.leaseMs){this.lastClientAt=now;for(const id of this.clients.keys())this.clients.set(id,now);}this.lastCheckAt=now;if(busy)return false;if(this.stopRequested)return true;if(!this.onDemand||this.count())return false;return this.seenClient?this.now()-this.lastClientAt>=this.graceMs:this.now()-this.startedAt>=this.startupMs;}
 status(){return {mode:this.onDemand?'on-demand':'background',openTabs:this.count(),idleStopSeconds:this.onDemand?this.graceMs/1000:null};}
}
