// Recovery stays encrypted at rest. Same-origin scripts can use the key; this is
// not a substitute for device security, CSP, or an authenticated application.
let database;
async function db(){if(database)return database;database=await new Promise((resolve,reject)=>{const r=indexedDB.open('trim-billing-recovery-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('vault');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return database;}
async function get(k){const d=await db();return new Promise((resolve,reject)=>{const r=d.transaction('vault').objectStore('vault').get(k);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function set(k,v){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('vault','readwrite');tx.objectStore('vault').put(v,k);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Recovery transaction aborted.'));});}
let keyPromise;
async function key(){return keyPromise??= (async()=>{let k=await get('key');if(!k){k=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);await set('key',k);}return k;})();}
export async function saveRecovery(id,value){const iv=crypto.getRandomValues(new Uint8Array(12));const bytes=new TextEncoder().encode(JSON.stringify(value));const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(),bytes);await set(`draft:${id}`,{iv,data});}
export async function loadRecovery(id){const v=await get(`draft:${id}`);if(!v)return null;return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:v.iv},await key(),v.data)));}
