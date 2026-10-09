// R08/R09: only public revision notifications. No private cursor, event count,
// durable financial log or payment guarantee is exposed by this pilot.
// One bounded connection registry; cancel/abort/drain remove it deterministically.
export function publicEvents({ revision, maxClients = 64, heartbeatMs = 20000, lifetimeMs = 240000 }) {
  const clients = new Set();
  const encoder = new TextEncoder();
  function response(signal) {
    if (clients.size >= maxClients) return new Response('Stream capacity reached', { status: 429, headers: { 'Retry-After': '30' } });
    let close;
    const stream = new ReadableStream({
      start(controller) {
        let closed = false;
        const emit = bytes => {
          if (closed) return;
          if (controller.desiredSize <= 0) return close();
          controller.enqueue(encoder.encode(bytes));
        };
        close = () => {
          if (closed) return;
          closed = true; clearInterval(heartbeat); clearTimeout(lifetime);
          clients.delete(close); signal?.removeEventListener('abort', close);
          try { controller.close(); } catch { /* Already cancelled by caller. */ }
        };
        const heartbeat = setInterval(() => emit(': heartbeat\n\n'), heartbeatMs);
        const lifetime = setTimeout(close, lifetimeMs);
        clients.add(close); signal?.addEventListener('abort', close, { once: true });
        emit(`retry: 3000\nid: ${revision}\nevent: revision\ndata: ${JSON.stringify({ revision })}\n\n`);
        if (signal?.aborted) close();
      },
      cancel() { close?.(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
  }
  return { response, close() { for (const stop of [...clients]) stop(); }, get size() { return clients.size; } };
}
