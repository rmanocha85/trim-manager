import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';

export const APP_ORIGIN = 'https://rmanocha85.github.io';
export const REDIRECT = APP_ORIGIN + '/trim-manager/public/drive-authorized.html';
export const CLIENT = '1078252705311-p24iq4gls53251o1o95hb2fbtb7uv53n.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const COOKIE = '__Host-trim-billing';
const ATTRS = '; Path=/; Secure; HttpOnly; SameSite=None; Partitioned';
const TTL = 30 * 86400;
const opaque = /^[\w-]{43}$/;
const digest = value => createHash('sha256').update(value).digest('hex');
class Failure extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
async function readJson(req) {
  let input = '';
  for await (const chunk of req) {
    input += chunk;
    if (input.length > 8192) throw new Failure(413, 'Request too large.');
  }
  try { return JSON.parse(input); } catch { throw new Failure(400, 'Invalid request.'); }
}

// The store contains OAuth grants only. Billing records travel directly from Chrome to Drive.
export function handler({store, clientSecret, ownerEmail, googleFetch = fetch, now = Date.now}) {
  if (!clientSecret || !ownerEmail) throw Error('Configure the Google client secret and billing account email.');
  async function googleToken(fields) {
    const response = await googleFetch('https://oauth2.googleapis.com/token', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      body: new URLSearchParams({client_id:CLIENT, client_secret:clientSecret, ...fields})
    });
    const data = await response.json();
    if (!response.ok) {
      if (data.error === 'invalid_grant') throw new Failure(401, 'Google access needs to be authorized again.');
      throw new Failure(503, 'Google renewal is temporarily unavailable. Retry when connected.');
    }
    if (!data.access_token || !(Number(data.expires_in) > 0)) throw new Failure(502, 'Invalid token response.');
    if (data.scope && (data.scope.trim() !== SCOPE)) throw new Failure(403, 'Unexpected Google permissions.');
    return data;
  }
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Origin');
    res.setHeader('X-Content-Type-Options','nosniff');
    const send = (status, body) => {
      res.writeHead(status, {'Content-Type':'application/json'});
      res.end(JSON.stringify(body));
    };
    try {
      if (req.headers.origin !== APP_ORIGIN) throw new Failure(403, 'Unknown app origin.');
      res.setHeader('Access-Control-Allow-Origin', APP_ORIGIN);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      if (!['/exchange','/renew','/logout'].includes(req.url)) throw new Failure(404, 'Unknown route.');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods','POST');
        res.setHeader('Access-Control-Allow-Headers','Content-Type, X-TRIM-Binding');
        res.writeHead(204); return res.end();
      }
      const binding = req.headers['x-trim-binding'];
      if (req.method !== 'POST' || req.headers['content-type'] !== 'application/json' || typeof binding !== 'string' || !opaque.test(binding))
        throw new Failure(400, 'Invalid request.');
      const body = await readJson(req);
      const cookie = (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
      const id = cookie && opaque.test(cookie) ? digest(cookie) : null;
      const valid = grant => grant && grant.expiresAt.getTime() > now() &&
        grant.email === ownerEmail.toLowerCase() && timingSafeEqual(Buffer.from(grant.bindingHash,'hex'), Buffer.from(digest(binding),'hex'));
      if (req.url === '/exchange') {
        if (!body || typeof body.code !== 'string' || !body.code || !opaque.test(body.verifier || '')) throw new Failure(400,'Invalid authorization.');
        const token = await googleToken({grant_type:'authorization_code', code:body.code, code_verifier:body.verifier, redirect_uri:REDIRECT});
        if (!token.refresh_token) throw new Failure(401,'Google did not grant offline billing access. Connect again.');
        const about = await googleFetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
          headers:{Authorization:'Bearer '+token.access_token}, signal:AbortSignal.timeout(15000)
        });
        if (!about.ok) throw new Failure(503, 'Could not verify the billing account.');
        const email = String((await about.json()).user?.emailAddress || '').toLowerCase();
        if (email !== ownerEmail.toLowerCase()) throw new Failure(403,'Choose the authorized TRIM billing account.');
        const handle = randomBytes(32).toString('base64url');
        await store.create(digest(handle), {refreshToken:token.refresh_token, bindingHash:digest(binding), email, expiresAt:new Date(now()+TTL*1000)});
        res.setHeader('Set-Cookie', COOKIE+'='+handle+ATTRS+'; Max-Age='+TTL);
        return send(200, {access_token:token.access_token, expires_in:token.expires_in, email});
      }
      const grant = id && await store.get(id);
      if (!valid(grant)) throw new Failure(401, 'Connect your TRIM billing account again.');
      if (req.url === '/logout') {
        await store.remove(id);
        res.setHeader('Set-Cookie', COOKIE+'='+ATTRS+'; Max-Age=0');
        return send(200,{locked:true});
      }
      let token;
      try { token = await googleToken({grant_type:'refresh_token', refresh_token:grant.refreshToken}); }
      catch (e) { if (e.status === 401) await store.remove(id); throw e; }
      if (token.refresh_token && token.refresh_token !== grant.refreshToken) await store.rotate(id, grant.refreshToken, token.refresh_token);
      return send(200, {access_token:token.access_token, expires_in:token.expires_in, email:grant.email});
    } catch (err) {
      send(err instanceof Failure ? err.status : 503, {error:err instanceof Failure ? err.message : 'Drive renewal is temporarily unavailable.'});
    }
  };
}
