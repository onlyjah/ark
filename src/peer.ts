import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Store, requireThat, digest } from './store.ts';

// Jah Noah [Q010]: "Independent sites need to be connected right from the start"
// Engineering: a deliberately enrolled service credential receives explicit resource grants.
export async function replicate(s: Store, peersFile: string, peerName: string, resourceId: string, revisionId?: string) {
  const peers = JSON.parse(readFileSync(peersFile,'utf8'));
  const peer = peers[peerName];
  requireThat(peer && typeof peer.url==='string' && typeof peer.token==='string' && typeof peer.node_id==='string',400,'peer is not configured');
  const base = new URL(peer.url);
  requireThat(base.protocol==='https:' || (base.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(base.hostname)),400,'HTTPS required except loopback');
  requireThat(!base.username && !base.password && !base.search && !base.hash && base.pathname==='/',400,'peer URL must be an origin');
  requireThat(/^[0-9a-f-]{36}$/.test(resourceId),400,'invalid resource ID');
  const endpoint = new URL(`/v1/resources/${resourceId}/replica`, base);
  if (revisionId) endpoint.searchParams.set('revision',revisionId);
  const response = await fetch(endpoint, {headers:{authorization:`Bearer ${peer.token}`},redirect:'error',signal:AbortSignal.timeout(10000)});
  requireThat(response.ok, response.status, 'peer refused replica access');
  let size=0; const chunks: Buffer[]=[];
  requireThat(response.body,502,'peer returned empty body');
  for await (const chunk of response.body!) {
    size+=chunk.length; requireThat(size<=1500000,413,'peer response exceeds pilot bound'); chunks.push(Buffer.from(chunk));
  }
  const envelope=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  requireThat(envelope.protocol===1 && envelope.node_id===peer.node_id && envelope.resource_id===resourceId,502,'unexpected peer identity or resource');
  const revision=envelope.revision;
  requireThat(revision && revision.resource_id===resourceId && typeof revision.id==='string' && (!revisionId || revision.id===revisionId),502,'unexpected revision');
  requireThat(typeof envelope.content_base64==='string',502,'missing content');
  const bytes=Buffer.from(envelope.content_base64,'base64');
  requireThat(bytes.length<=1048576 && revision.size===bytes.length && digest(bytes)===revision.digest,502,'replica integrity failure');
  const hash=s.put(bytes);
  // Jah Noah [Q005]: "we have the file backed up across these different places"
  // Engineering: this is a recovery copy, never a new authoritative resource or automatic publication.
  return s.atomic(() => {
    const old=s.one('SELECT * FROM replicas WHERE source_node_id=? AND source_resource_id=? AND source_revision_id=?',peer.node_id,resourceId,revision.id);
    if (old) { requireThat(old.digest===hash,502,'peer changed immutable revision'); return old; }
    const id=randomUUID();
    s.run('INSERT INTO replicas VALUES(?,?,?,?,?,?,?)',id,peer.node_id,resourceId,revision.id,hash,bytes.length,Date.now());
    return s.one('SELECT * FROM replicas WHERE id=?',id);
  });
}
