// R01/R02/R04/R09: this input is a deliberately public projection, not an
// inventory adapter that serializes every environment or private record.
// Publication is a reviewed Git change in 0.1. Runtime grants cannot be inferred
// from any graph edge. Stage labels are independent from deployment status.
const idPattern = /^[a-z][a-z0-9-]{0,63}$/;
const stages = new Set(['research', 'development', 'production', 'unverified']);
export function publicProjection(input) {
  if (input.schemaVersion !== '1.0' || !idPattern.test(input.orgId) ||
      !idPattern.test(input.authorityId) || !Number.isFinite(Date.parse(input.updatedAt))) {
    throw new Error('Invalid public catalogue authority or version');
  }
  if (!Array.isArray(input.projects) || input.projects.length > 10000) {
    throw new Error('Catalogue size invalid');
  }
  const seen = new Set();
  const projects = input.projects.map(p => {
    if (!idPattern.test(p.id) || seen.has(p.id) || typeof p.name !== 'string' ||
        p.name.length > 120 || !stages.has(p.stage) || typeof p.source !== 'string') {
      throw new Error('Invalid public project');
    }
    seen.add(p.id);
    if (p.quote !== null && (typeof p.quote !== 'string' || p.quote.length > 2000)) {
      throw new Error('Invalid quote');
    }
    if (p.url !== null) {
      const url = new URL(p.url);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid public URL');
    }
    if (p.originId !== null && !idPattern.test(p.originId)) throw new Error('Invalid seed reference');
    // Field allowlist is intentional: secret/debug/claim/grant fields are dropped.
    return { id: p.id, name: p.name, stage: p.stage, quote: p.quote,
      source: p.source, url: p.url, originId: p.originId };
  });
  const relationships = input.relationships.map(r => {
    if (!seen.has(r.source) || !seen.has(r.target) || !idPattern.test(r.type)) {
      throw new Error('Relationship has an unpublished endpoint');
    }
    return { source: r.source, target: r.target, type: r.type };
  });
  if (projects.some(p => p.originId && !seen.has(p.originId))) throw new Error('Unpublished origin');
  return { schemaVersion: '1.0', authorityId: input.authorityId,
    orgId: input.orgId, updatedAt: input.updatedAt, projects, relationships };
}

export function catalogueService(snapshot) {
  const byId = new Map(snapshot.projects.map(p => [p.id, p]));
  const neighbors = new Map(snapshot.projects.map(p => [p.id, []]));
  for (const edge of snapshot.relationships) {
    neighbors.get(edge.source).push(edge.target);
    neighbors.get(edge.target).push(edge.source);
  }
  return {
    snapshot,
    get(id) { return byId.get(id) ?? null; },
    list({ query = '', stage = '', limit = 100, offset = 0 } = {}) {
      const q = query.toLowerCase();
      const all = snapshot.projects.filter(p => (!stage || p.stage === stage) &&
        `${p.id} ${p.name} ${p.quote ?? ''}`.toLowerCase().includes(q));
      return { items: all.slice(offset, offset + limit), total: all.length, limit, offset };
    },
    graph({ root, depth = 2, limit = 100 }) {
      // R08: bounded breadth-first traversal with visited IDs handles cycles.
      // This runs only over published data. Future private traversal must filter
      // nodes AND edges before computing counts or following neighbors.
      if (!byId.has(root)) return null;
      const visited = new Set([root]);
      let frontier = [root];
      let truncated = false;
      for (let hop = 0; hop < depth && frontier.length; hop++) {
        const next = [];
        for (const id of frontier) for (const other of neighbors.get(id)) {
          if (visited.has(other)) continue;
          if (visited.size >= limit) { truncated = true; continue; }
          visited.add(other); next.push(other);
        }
        frontier = next;
      }
      return { root, depth, truncated, nodes: [...visited].map(id => byId.get(id)),
        edges: snapshot.relationships.filter(e => visited.has(e.source) && visited.has(e.target)) };
    },
  };
}
