// This endpoint is in the same Google project as the TRIM web OAuth client.
export const RENEWAL_ORIGIN = 'https://trim-drive-renewal-1078252705311.northamerica-northeast1.run.app';
const APP_ORIGIN = 'https://rmanocha85.github.io';
const KEY = 'trim:hosted-billing-session';
const CLIENT = '1078252705311-p24iq4gls53251o1o95hb2fbtb7uv53n.apps.googleusercontent.com';
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));

export function hostedBilling(location = globalThis.location) {
  return location?.origin === APP_ORIGIN && location.pathname.startsWith('/trim-manager/');
}

async function post(path, binding, body = {}) {
  let response;
  try {
    response = await fetch(RENEWAL_ORIGIN+path, {method:'POST', mode:'cors', credentials:'include',
      redirect:'error', cache:'no-store', signal:AbortSignal.timeout(20000),
      headers:{'Content-Type':'application/json','X-TRIM-Binding':binding}, body:JSON.stringify(body)});
  } catch {
    throw Error('Cannot reach Drive renewal. Your local work is retained. Retry when connected.');
  }
  const data = await response.json();
  if (!response.ok) throw Object.assign(Error(data.error || 'Could not renew Drive access.'), {status:response.status});
  return data;
}
export class HostedBillingAccess {
  async authorize({hint, selectAccount = false} = {}) {
    const popup = window.open('about:blank','_blank','popup,width=530,height=680');
    if (!popup) throw Error('Allow the Google sign-in popup for TRIM, then connect again.');
    popup.opener = null;
    const state = random(), verifier = random(), binding = random();
    const channel = new BroadcastChannel('trim-billing-auth:'+state);
    try {
      const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
      const params = new URLSearchParams({client_id:CLIENT, response_type:'code', access_type:'offline',
        scope:'https://www.googleapis.com/auth/drive.file', include_granted_scopes:'false',
        redirect_uri:APP_ORIGIN+'/trim-manager/public/drive-authorized.html',
        code_challenge_method:'S256', code_challenge:challenge, state, prompt:selectAccount?'select_account consent':'consent'});
      if (hint && !selectAccount) params.set('login_hint',hint);
      const code = await new Promise((resolve,reject)=>{
        const timer = setTimeout(()=>finish(null,'Google connection timed out. Connect again.'),180000);
        // Google may sever the WindowProxy using COOP. Receive the result on the same-origin channel.
        function finish(value, error) { clearTimeout(timer); error ? reject(Error(error)) : resolve(value); }
        channel.onmessage = ({data})=>{
          if (data?.state !== state) return;
          if (data.error || !data.code) finish(null,'Google connection was cancelled.');
          else finish(data.code);
        };
        try { popup.location.replace('https://accounts.google.com/o/oauth2/v2/auth?'+params); }
        catch { finish(null,'Google sign-in could not open.'); }
      });
      const result = await post('/exchange',binding,{code, verifier});
      // Confirm Chrome accepted the partitioned cookie before promising a renewable session.
      const renewed = await post('/renew',binding);
      if (result.email !== renewed.email) throw Error('Billing account changed. Reconnect.');
      localStorage.setItem(KEY,binding);
      return renewed;
    } finally { channel.close(); popup.close(); }
  }
  get saved() { return Boolean(localStorage.getItem(KEY)); }
  async renew() {
    const binding = localStorage.getItem(KEY);
    if (!binding) throw Object.assign(Error('Connect your TRIM billing account.'), {status:401});
    try { return await post('/renew',binding); }
    catch (error) {
      if (error.status === 401 && localStorage.getItem(KEY) === binding) localStorage.removeItem(KEY);
      throw error;
    }
  }
  async lock() {
    const binding = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    if (binding) {
      // Removing the binding locks this device even when offline. The server enforces session expiry.
      try { await post('/logout',binding); } catch {}
    }
  }
}
