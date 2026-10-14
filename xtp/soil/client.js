// Browser and native webview bridge. IDs identify a client; they grant no access.
// Tokens stay in memory and are exchanged only with the configured provider view.
export function createSoilClient(config, options = {}) {
  const host = options.host || window, send = options.send || fetch;
  const origin = new URL(config.app_url).origin;
  const id = options.clientId || host.crypto.randomUUID();
  let token = null, session = null, pending = null, disposed = false, generation = 0;
  const clearPending = () => {
    if (!pending) return;
    host.clearTimeout(pending.timer); host.removeEventListener('message', pending.listener);
    const old = pending; pending = null; old.cleanup?.(); return old;
  };
  const cancel = () => { generation++; const old = clearPending(); old?.reject(new Error('SO/IL view closed')); };
  async function verify(candidate, epoch) {
    const response = await send('/app/api/soil/session', { cache: 'no-store', credentials: 'same-origin',
      headers: { authorization: 'Bearer ' + candidate, 'x-soil-client-id': id } });
    if (!response.ok) throw new Error('SO/IL session could not be verified');
    const value = await response.json();
    if (value.protocol !== 'soil.session.v1' || value.verified !== true || value.client?.id !== id ||
        typeof value.id !== 'string' || value.expires_at <= Date.now()) throw new Error('SO/IL session binding mismatch');
    if (disposed || epoch !== generation) throw new Error('SO/IL client closed');
    token = candidate; session = Object.freeze(value); return session;
  }
  function connect(view, signal) {
    if (disposed || !view) return Promise.reject(new Error('SO/IL view unavailable'));
    cancel(); const epoch = generation, requestId = host.crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => cancel();
      const finish = () => { signal?.removeEventListener('abort', abort); clearPending(); };
      const listener = async event => {
        const data = event.data;
        if (event.origin !== origin || event.source !== view || data?.type !== 'soil:session' ||
            data.protocol !== 1 || data.request_id !== requestId) return;
        if (typeof data.token !== 'string' || data.token.length > 16384) { finish(); reject(new Error('Invalid SO/IL session')); return; }
        finish();
        try { resolve(await verify(data.token, epoch)); } catch (error) { reject(error); }
      };
      pending = { reject, listener, cleanup: () => signal?.removeEventListener('abort', abort), timer: host.setTimeout(() => { finish(); reject(new Error('SO/IL login timed out')); }, 60000) };
      host.addEventListener('message', listener); signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      view.postMessage({ type: 'soil:connect', protocol: 1, request_id: requestId, audience: config.audience, client: { id } }, origin);
    });
  }
  return Object.freeze({ client: Object.freeze({ id }), connect, cancel,
    get session() { return session; },
    async headers() {
      if (!token || !session || session.expires_at <= Date.now()) { token = null; session = null; throw new Error('Sign in with SO/IL again'); }
      return { authorization: 'Bearer ' + token, 'x-soil-client-id': id };
    },
    dispose() { disposed = true; cancel(); token = null; session = null; }
  });
}
