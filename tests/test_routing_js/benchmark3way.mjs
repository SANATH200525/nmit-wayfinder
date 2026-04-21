/**
 * benchmark3way.mjs — 3-way comparison: A* vs Bidirectional A* vs D* Lite
 * Run: node tests/test_routing_js/benchmark3way.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { edgeCost, heuristic } from '../../frontend/static/js/routing.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const { NODES, GRAPH } = JSON.parse(
  readFileSync(path.join(__dir, 'graph_data.json'), 'utf8')
);

// ─── Min-Heap (shared) ────────────────────────────────────────────────────────
function makeMinHeap(heapOpsRef) {
  const h = [];
  function push(priority, item) {
    h.push({ priority, item }); heapOpsRef.count++;
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[p].priority <= h[i].priority) break;
      [h[p], h[i]] = [h[i], h[p]]; i = p;
    }
  }
  function pop() {
    const top = h[0]; const last = h.pop(); heapOpsRef.count++;
    if (h.length > 0) {
      h[0] = last; let i = 0;
      while (true) {
        const l = 2*i+1, r = 2*i+2; let s = i;
        if (l < h.length && h[l].priority < h[s].priority) s = l;
        if (r < h.length && h[r].priority < h[s].priority) s = r;
        if (s === i) break;
        [h[i], h[s]] = [h[s], h[i]]; i = s;
      }
    }
    return top;
  }
  return { push, pop, get size() { return h.length; }, _heap: h };
}

// ─── 1. Standard A* ───────────────────────────────────────────────────────────
function aStarInstrumented({ start, goal, graph, nodes, avoidStairs = false, avoidElevators = false, learnedWeights = {} }) {
  let nodesExpanded = 0;
  const heapOpsRef = { count: 0 };
  if (start === goal) return { path: [start], nodesExpanded: 0, heapOps: 0 };
  if (!nodes[start] || !nodes[goal]) return { path: [], nodesExpanded: 0, heapOps: 0 };

  function skip(nid) {
    if (nid === goal) return false;
    if (nodes[nid]?.dead_end) return true;
    if (avoidStairs && nodes[nid]?.type === 'stairs') return true;
    if (avoidElevators && nodes[nid]?.type === 'lift') return true;
    return false;
  }

  const open = makeMinHeap(heapOpsRef);
  open.push(heuristic(start, goal, nodes), start);
  const g = { [start]: 0 };
  const came = {};
  const closed = new Set();

  while (open.size > 0) {
    const { item: curr } = open.pop();
    if (closed.has(curr)) continue;
    closed.add(curr); nodesExpanded++;
    if (curr === goal) {
      const path = [];
      let c = goal;
      while (c !== undefined) { path.push(c); c = came[c]; }
      return { path: path.reverse(), nodesExpanded, heapOps: heapOpsRef.count };
    }
    for (const nbr of (graph[curr] || [])) {
      if (skip(nbr)) continue;
      const ng = g[curr] + edgeCost(curr, nbr, nodes, learnedWeights);
      if (ng < (g[nbr] ?? Infinity)) {
        g[nbr] = ng; came[nbr] = curr;
        open.push(ng + heuristic(nbr, goal, nodes), nbr);
      }
    }
  }
  return { path: [], nodesExpanded, heapOps: heapOpsRef.count };
}

// ─── 2. Bidirectional A* ─────────────────────────────────────────────────────
function biAStarInstrumented({ start, goal, graph, nodes, avoidStairs = false, avoidElevators = false, learnedWeights = {} }) {
  let nodesExpanded = 0;
  const heapOpsRef = { count: 0 };
  if (start === goal) return { path: [start], nodesExpanded: 0, heapOps: 0 };
  if (!nodes[start] || !nodes[goal]) return { path: [], nodesExpanded: 0, heapOps: 0 };

  function skip(nid) {
    if (nid === goal) return false;
    if (nodes[nid]?.dead_end) return true;
    if (avoidStairs && nodes[nid]?.type === 'stairs') return true;
    if (avoidElevators && nodes[nid]?.type === 'lift') return true;
    return false;
  }

  const fwd = makeMinHeap(heapOpsRef), bwd = makeMinHeap(heapOpsRef);
  fwd.push(0, start); bwd.push(0, goal);
  const gF = { [start]: 0 }, gB = { [goal]: 0 };
  const pF = { [start]: null }, pB = { [goal]: null };
  const vF = new Set(), vB = new Set();
  let mu = Infinity, meet = null;

  function expandFwd() {
    if (!fwd.size) return;
    const { item: u } = fwd.pop();
    if (vF.has(u)) return;
    vF.add(u); nodesExpanded++;
    for (const nbr of (graph[u] || [])) {
      if (skip(nbr)) continue;
      const nc = gF[u] + edgeCost(u, nbr, nodes, learnedWeights);
      if (nc < (gF[nbr] ?? Infinity)) {
        gF[nbr] = nc; pF[nbr] = u;
        fwd.push(nc + heuristic(nbr, goal, nodes), nbr);
        if (gB[nbr] !== undefined && nc + gB[nbr] < mu) { mu = nc + gB[nbr]; meet = nbr; }
      }
    }
  }
  function expandBwd() {
    if (!bwd.size) return;
    const { item: u } = bwd.pop();
    if (vB.has(u)) return;
    vB.add(u); nodesExpanded++;
    for (const nbr of (graph[u] || [])) {
      if (skip(nbr)) continue;
      const nc = gB[u] + edgeCost(nbr, u, nodes, learnedWeights);
      if (nc < (gB[nbr] ?? Infinity)) {
        gB[nbr] = nc; pB[nbr] = u;
        bwd.push(nc + heuristic(nbr, start, nodes), nbr);
        if (gF[nbr] !== undefined && gF[nbr] + nc < mu) { mu = gF[nbr] + nc; meet = nbr; }
      }
    }
  }

  while (fwd.size > 0 && bwd.size > 0) {
    const fTop = fwd._heap[0].priority, bTop = bwd._heap[0].priority;
    if (fTop >= mu || bTop >= mu) break;
    expandFwd(); expandBwd();
  }
  if (!meet) return { path: [], nodesExpanded, heapOps: heapOpsRef.count };

  const fp = []; let c = meet;
  while (c !== null) { fp.push(c); c = pF[c] ?? null; }
  fp.reverse();
  const bp = []; c = pB[meet] ?? null;
  while (c !== null) { bp.push(c); c = pB[c] ?? null; }
  return { path: [...fp, ...bp], nodesExpanded, heapOps: heapOpsRef.count };
}

// ─── 3. D* Lite ──────────────────────────────────────────────────────────────
function dStarLiteInstrumented({ start, goal, graph, nodes, avoidStairs = false, avoidElevators = false, learnedWeights = {} }) {
  let nodesExpanded = 0, heapOpsCount = 0;
  if (start === goal) return { path: [start], nodesExpanded: 0, heapOps: 0 };
  if (!nodes[start] || !nodes[goal]) return { path: [], nodesExpanded: 0, heapOps: 0 };

  function skip(nid, target) {
    if (nid === target) return false;
    if (nodes[nid]?.dead_end) return true;
    if (avoidStairs && nodes[nid]?.type === 'stairs') return true;
    if (avoidElevators && nodes[nid]?.type === 'lift') return true;
    return false;
  }

  const INF = Infinity;
  const g = {}, rhs = {};
  const allN = Object.keys(graph);
  for (const n of allN) { g[n] = INF; rhs[n] = INF; }
  rhs[goal] = 0;

  function key(n) { const m = Math.min(g[n], rhs[n]); return [m + heuristic(start, n, nodes), m]; }
  function kLess(a, b) { return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]); }

  const heap = [];
  function hPush(node, k) {
    heap.push({ key: k, node }); heapOpsCount++;
    let i = heap.length - 1;
    while (i > 0) { const p = (i-1)>>1; if (!kLess(heap[i].key, heap[p].key)) break; [heap[i],heap[p]]=[heap[p],heap[i]]; i=p; }
  }
  function hPop() {
    const top = heap[0]; const last = heap.pop(); heapOpsCount++;
    if (heap.length > 0) {
      heap[0] = last; let i = 0;
      while (true) { const l=2*i+1,r=2*i+2; let s=i;
        if (l<heap.length&&kLess(heap[l].key,heap[s].key))s=l;
        if (r<heap.length&&kLess(heap[r].key,heap[s].key))s=r;
        if(s===i)break; [heap[i],heap[s]]=[heap[s],heap[i]]; i=s; }
    }
    return top;
  }

  hPush(goal, key(goal));

  while (heap.length > 0) {
    const sk = key(start); const top = heap[0];
    if (!kLess(top.key, sk) && rhs[start] === g[start]) break;
    const { key: kOld, node: u } = hPop(); nodesExpanded++;
    const kNew = key(u);
    if (kLess(kOld, kNew)) { hPush(u, kNew); }
    else if (g[u] > rhs[u]) {
      g[u] = rhs[u];
      for (const pred of (graph[u]||[])) {
        if (skip(pred, start)) continue;
        const nr = edgeCost(pred, u, nodes, learnedWeights) + g[u];
        if (nr < rhs[pred]) { rhs[pred] = nr; hPush(pred, key(pred)); }
      }
    } else {
      g[u] = INF;
      let br = INF;
      for (const s of (graph[u]||[])) { if (skip(s,goal)) continue; const c=edgeCost(u,s,nodes,learnedWeights)+g[s]; if(c<br)br=c; }
      rhs[u] = br;
      if (rhs[u] !== g[u]) hPush(u, key(u));
      for (const pred of (graph[u]||[])) {
        if (skip(pred,start)) continue;
        let bpr = INF;
        for (const s of (graph[pred]||[])) { if(skip(s,goal))continue; const c=edgeCost(pred,s,nodes,learnedWeights)+g[s]; if(c<bpr)bpr=c; }
        if (bpr !== rhs[pred]) { rhs[pred]=bpr; hPush(pred,key(pred)); }
      }
    }
  }

  if (g[start]===INF && rhs[start]===INF) return { path: [], nodesExpanded, heapOps: heapOpsCount };
  const path=[start]; const vis=new Set([start]); let curr=start;
  while (curr!==goal) {
    let bn=null,bc=INF;
    for (const nbr of (graph[curr]||[])) {
      if(skip(nbr,goal)||vis.has(nbr))continue;
      const cost=edgeCost(curr,nbr,nodes,learnedWeights)+(g[nbr]??INF);
      if(cost<bc){bc=cost;bn=nbr;}
    }
    if(!bn) return { path:[], nodesExpanded, heapOps: heapOpsCount };
    vis.add(bn); path.push(bn); curr=bn;
    if(path.length>allN.length) return { path:[], nodesExpanded, heapOps: heapOpsCount };
  }
  return { path, nodesExpanded, heapOps: heapOpsCount };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function pathCost(p) {
  let c = 0;
  for (let i = 1; i < p.length; i++) c += edgeCost(p[i-1], p[i], NODES);
  return Math.round(c * 100) / 100;
}
function timeFn(fn, iters = 200) {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) fn();
  return Number(process.hrtime.bigint() - t0) / iters / 1000; // µs
}

// ─── Scenarios ────────────────────────────────────────────────────────────────
const SCENARIOS = [
  { label: 'Same-floor (short)',         start: 'MAINENTRANCE-GF', goal: 'TUTORIAL-GF',        flags: {} },
  { label: 'Same-floor (long)',           start: 'MAINENTRANCE-GF', goal: 'RESTROOMS-GF',        flags: {} },
  { label: 'Cross-floor +1',             start: 'MAINENTRANCE-GF', goal: 'SEMINARHALL-1F',      flags: {} },
  { label: 'Cross-floor +2',             start: 'MAINENTRANCE-GF', goal: 'RESEARCHDEPT-2F',     flags: {} },
  { label: 'Cross-floor +3 (max)',       start: 'MAINENTRANCE-GF', goal: 'ROOM1-3F',            flags: {} },
  { label: 'Elevator-only mobility',     start: 'MAINENTRANCE-GF', goal: 'ROOM1-3F',            flags: { avoidStairs: true } },
  { label: 'Stairs-only mobility',       start: 'MAINENTRANCE-GF', goal: 'ROOM1-3F',            flags: { avoidElevators: true } },
  { label: 'Passageway branch',          start: 'MAINENTRANCE-GF', goal: 'STAFFROOM2-1F',       flags: {} },
  { label: 'End-of-corridor (short)',    start: 'MAINENTRANCE-GF', goal: 'PRINCIPALROOM-GF',    flags: {} },
  { label: 'Opposite corner (far-far)', start: 'STAIRSEND-GF',    goal: 'ROOM4-3F',            flags: {} },
];

// ─── Run ──────────────────────────────────────────────────────────────────────
const ITERS = 200;
const results = [];

console.log('\n  3-Way Benchmark: A* vs Bidirectional A* vs D* Lite');
console.log('  Iterations: ' + ITERS + '\n');

for (const sc of SCENARIOS) {
  const args = { start: sc.start, goal: sc.goal, graph: GRAPH, nodes: NODES, ...sc.flags };

  const as  = aStarInstrumented(args);
  const bi  = biAStarInstrumented(args);
  const ds  = dStarLiteInstrumented(args);

  const asTime = timeFn(() => aStarInstrumented(args), ITERS);
  const biTime = timeFn(() => biAStarInstrumented(args), ITERS);
  const dsTime = timeFn(() => dStarLiteInstrumented(args), ITERS);

  results.push({
    label: sc.label,
    asTime:  Math.round(asTime  * 100) / 100,
    biTime:  Math.round(biTime  * 100) / 100,
    dsTime:  Math.round(dsTime  * 100) / 100,
    asNodes:  as.nodesExpanded,
    biNodes:  bi.nodesExpanded,
    dsNodes:  ds.nodesExpanded,
    asHeap:   as.heapOps,
    biHeap:   bi.heapOps,
    dsHeap:   ds.heapOps,
    asLen:    as.path.length,
    biLen:    bi.path.length,
    dsLen:    ds.path.length,
    asCost:   pathCost(as.path),
    biCost:   pathCost(bi.path),
    dsCost:   pathCost(ds.path),
  });
}

console.log(JSON.stringify(results, null, 2));
