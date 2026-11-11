// Each local app tab has an independent lease; closing one cannot stop another.
export function keepLaptopService({api,onUnavailable=()=>{}}){
 const id=crypto.randomUUID();let disposed=false,pending=false;
 const send=async release=>{if(pending&&!release)return;pending=true;try{await api('/api/service/heartbeat',{method:'POST',body:JSON.stringify({id,release}),keepalive:release});}catch{if(!release&&!disposed)onUnavailable();}finally{pending=false;}};
 const heartbeat=()=>{if(!disposed)void send(false);};
 const close=()=>{void send(true);};
 const reopen=()=>heartbeat();
 heartbeat();const timer=setInterval(heartbeat,15000);
 window.addEventListener('pagehide',close);window.addEventListener('pageshow',reopen);window.addEventListener('focus',reopen);window.addEventListener('online',reopen);document.addEventListener('visibilitychange',reopen);
 return ()=>{disposed=true;clearInterval(timer);window.removeEventListener('pagehide',close);window.removeEventListener('pageshow',reopen);window.removeEventListener('focus',reopen);window.removeEventListener('online',reopen);document.removeEventListener('visibilitychange',reopen);close();};
}
