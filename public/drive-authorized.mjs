const query = new URLSearchParams(location.search);
history.replaceState(null,'',location.pathname);
const state = query.get('state');
if (/^[\w-]{43}$/.test(state || '')) {
  const channel = new BroadcastChannel('trim-billing-auth:'+state);
  channel.postMessage({state, code:query.get('code'), error:query.get('error')});
  channel.close();
  window.close();
}
