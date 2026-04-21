/**
 * benchmark.mjs — Head-to-head: Bidirectional A* vs D* Lite
 *
 * Temporarily re-implements Bidirectional A* inline so both algorithms
 * can be benchmarked against the live graph without touching routing.js.
 *
 * Metrics collected per route pair:
 *   - execution time (µs, 100-run average using process.hrtime.bigint)
 *   - nodes expanded / heap operations
 *   - path length (nodes)
 *   - path cost (weighted sum)
 *   - memory proxy (heap object count)
 *
 * Run: node tests/test_routing_js/benchmark.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { edgeCost, heuristic, dStarLite } from '../../frontend/static/js/routing.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const { NODES, GRAPH } = JSON.parse(
  readFileSync(path.join(__dir, 'graph_data.json'), 'utf8')
);

// ─── Re-implement Bidirectional A* with instrumentation ───────────────────────
function bidirectionalAStarInstrumented({ start, goal, graph, nodes, avoidStairs = false, avoidElevators = false, learnedWeights = {} }) {
  let nodesExpanded = 0, heapOps = 0;

  if (start === goal) return { path: [start], nodesExpanded: 0, heapOps: 0 };
  if (!nodes[start] || !nodes[goal]) return { path: [], nodesExpanded: 0, heapOps: 0 };

  class MinHeap {
    constructor() { this._heap = []; }
    push(priority, item) {
      this._heap.push({ priority, item });
      this._bubbleUp(this._heap.length - 1);
      heapOps++;
    }
    pop() {
      const top = this._heap[0];
      const last = this._heap.pop();
      if (this._heap.length > 0) { this._heap[0] = last; this._sinkDown(0); }
      heapOps++;
      return top;
    }
    get size() { return this._heap.length; }
    _bubbleUp(i) {
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (this._heap[p].priority <= this._heap[i].priority) break;
        [this._heap[p], this._heap[i]] = [this._heap[i], this._heap[p]]; i = p;
      }
    }
    _sinkDown(i) {
      const n = this._heap.length;
      while (true) {
        let s = i; const l = 2*i+1, r = 2*i+2;
        if (l < n && this._heap[l].priority < this._heap[s].priority) s = l;
        if (r < n && this._heap[r].priority < this._heap[s].priority) s = r;
        if (s === i) break;
        [this._heap[s], this._heap[i]] = [this._heap[i], this._heap[s]]; i = s;
      }
    }
  }

  const fwd = new MinHeap(), bwd = new MinHeap();
  fwd.push(0, start); bwd.push(0, goal);
  const gF = { [start]: 0 }, gB = { [goal]: 0 };
  const parentF = { [start]: null }, parentB = { [goal]: null };
  const fwdV = new Set(), bwdV = new Set();
  let mu = Infinity, meetingNode = null;

  function skip(nid) {
    if (nid === goal) return false;
    if (nodes[nid]?.dead_end) return true;
    if (avoidStairs && nodes[nid]?.type === 'stairs') return true;
    if (avoidElevators && nodes[nid]?.type === 'lift') return true;
    return false;
  }

  function expandFwd() {
    if (!fwd.size) return;
    const { item: curr } = fwd.pop();
    if (fwdV.has(curr)) return;
    fwdV.add(curr); nodesExpanded++;
    for (const nbr of (graph[curr] || [])) {
      if (skip(nbr)) continue;
      const nc = gF[curr] + edgeCost(curr, nbr, nodes, learnedWeights);
      if (nc < (gF[nbr] ?? Infinity)) {
        gF[nbr] = nc; parentF[nbr] = curr;
        fwd.push(nc + heuristic(nbr, goal, nodes), nbr);
        if (gB[nbr] !== undefined) { const c = nc + gB[nbr]; if (c < mu) { mu = c; meetingNode = nbr; } }
      }
    }
  }

  function expandBwd() {
    if (!bwd.size) return;
    const { item: curr } = bwd.pop();
    if (bwdV.has(curr)) return;
    bwdV.add(curr); nodesExpanded++;
    for (const nbr of (graph[curr] || [])) {
      if (skip(nbr)) continue;
      const nc = gB[curr] + edgeCost(nbr, curr, nodes, learnedWeights);
      if (nc < (gB[nbr] ?? Infinity)) {
        gB[nbr] = nc; parentB[nbr] = curr;
        bwd.push(nc + heuristic(nbr, start, nodes), nbr);
        if (gF[nbr] !== undefined) { const c = gF[nbr] + nc; if (c < mu) { mu = c; meetingNode = nbr; } }
      }
    }
  }

  while (fwd.size > 0 && bwd.size > 0) {
    const fTop = fwd._heap[0].priority, bTop = bwd._heap[0].priority;
    if (fTop >= mu || bTop >= mu) break;
    if (fwd.size > 0) expandFwd();
    if (bwd.size > 0) expandBwd();
  }

  if (!meetingNode) return { path: [], nodesExpanded, heapOps };
  const fwdPath = []; let cur = meetingNode;
  while (cur !== null) { fwdPath.push(cur); cur = parentF[cur] ?? null; }
  fwdPath.reverse();
  const bwdPath = []; cur = parentB[meetingNode] ?? null;
  while (cur !== null) { bwdPath.push(cur); cur = parentB[cur] ?? null; }
  return { path: [...fwdPath, ...bwdPath], nodesExpanded, heapOps };
}

// ─── D* Lite with instrumentation ────────────────────────────────────────────
function dStarLiteInstrumented({ start, goal, graph, nodes, avoidStairs = false, avoidElevators = false, learnedWeights = {} }) {
  let nodesExpanded = 0, heapOps = 0;

  if (start === goal) return { path: [start], nodesExpanded: 0, heapOps: 0 };
  if (!nodes[start] || !nodes[goal]) return { path: [], nodesExpanded: 0, heapOps: 0 };

  function shouldSkip(nid, target) {
    if (nid === target) return false;
    if (nodes[nid]?.dead_end) return true;
    if (avoidStairs && nodes[nid]?.type === 'stairs') return true;
    if (avoidElevators && nodes[nid]?.type === 'lift') return true;
    return false;
  }

  const INF = Infinity;
  const g = {}, rhs = {};
  const allNodes = Object.keys(graph);
  for (const n of allNodes) { g[n] = INF; rhs[n] = INF; }
  rhs[goal] = 0;

  function calculateKey(n) {
    const minVal = Math.min(g[n], rhs[n]);
    return [minVal + heuristic(start, n, nodes), minVal];
  }
  function keyLess(a, b) { return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]); }

  const heap = [];
  function heapPush(node, key) {
    heap.push({ key, node });
    heapOps++;
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!keyLess(heap[i].key, heap[p].key)) break;
      [heap[i], heap[p]] = [heap[p], heap[i]]; i = p;
    }
  }
  function heapPop() {
    const top = heap[0]; const last = heap.pop(); heapOps++;
    if (heap.length > 0) {
      heap[0] = last; let i = 0;
      while (true) {
        const l = 2*i+1, r = 2*i+2; let s = i;
        if (l < heap.length && keyLess(heap[l].key, heap[s].key)) s = l;
        if (r < heap.length && keyLess(heap[r].key, heap[s].key)) s = r;
        if (s === i) break;
        [heap[i], heap[s]] = [heap[s], heap[i]]; i = s;
      }
    }
    return top;
  }

  heapPush(goal, calculateKey(goal));

  function computeShortestPath() {
    while (heap.length > 0) {
      const startKey = calculateKey(start);
      const topEl = heap[0];
      if (!topEl) break;
      if (!keyLess(topEl.key, startKey) && rhs[start] === g[start]) break;
      const { key: kOld, node: u } = heapPop();
      nodesExpanded++;
      const kNew = calculateKey(u);
      if (keyLess(kOld, kNew)) {
        heapPush(u, kNew);
      } else if (g[u] > rhs[u]) {
        g[u] = rhs[u];
        for (const pred of (graph[u] || [])) {
          if (shouldSkip(pred, start)) continue;
          const newRhs = edgeCost(pred, u, nodes, learnedWeights) + g[u];
          if (newRhs < rhs[pred]) { rhs[pred] = newRhs; heapPush(pred, calculateKey(pred)); }
        }
      } else {
        g[u] = INF;
        let bestRhs = INF;
        for (const succ of (graph[u] || [])) {
          if (shouldSkip(succ, goal)) continue;
          const c = edgeCost(u, succ, nodes, learnedWeights) + g[succ];
          if (c < bestRhs) bestRhs = c;
        }
        rhs[u] = bestRhs;
        if (rhs[u] !== g[u]) heapPush(u, calculateKey(u));
        for (const pred of (graph[u] || [])) {
          if (shouldSkip(pred, start)) continue;
          let bpr = INF;
          for (const s of (graph[pred] || [])) {
            if (shouldSkip(s, goal)) continue;
            const c = edgeCost(pred, s, nodes, learnedWeights) + g[s];
            if (c < bpr) bpr = c;
          }
          if (bpr !== rhs[pred]) { rhs[pred] = bpr; heapPush(pred, calculateKey(pred)); }
        }
      }
    }
  }

  computeShortestPath();
  if (g[start] === INF && rhs[start] === INF) return { path: [], nodesExpanded, heapOps };

  const path = [start]; const visited = new Set([start]); let curr = start;
  while (curr !== goal) {
    let bestNbr = null, bestCost = INF;
    for (const nbr of (graph[curr] || [])) {
      if (shouldSkip(nbr, goal)) continue;
      if (visited.has(nbr)) continue;
      const cost = edgeCost(curr, nbr, nodes, learnedWeights) + (g[nbr] ?? INF);
      if (cost < bestCost) { bestCost = cost; bestNbr = nbr; }
    }
    if (!bestNbr) return { path: [], nodesExpanded, heapOps };
    visited.add(bestNbr); path.push(bestNbr); curr = bestNbr;
    if (path.length > allNodes.length) return { path: [], nodesExpanded, heapOps };
  }
  return { path, nodesExpanded, heapOps };
}

// ─── Benchmark helpers ────────────────────────────────────────────────────────
function pathCost(path, nodes, learnedWeights = {}) {
  let c = 0;
  for (let i = 1; i < path.length; i++) c += edgeCost(path[i-1], path[i], nodes, learnedWeights);
  return c;
}

function timeFn(fn, iters = 100) {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) fn();
  const t1 = process.hrtime.bigint();
  return Number(t1 - t0) / iters / 1000; // µs per call
}

// ─── Test scenarios ──────────────────────────────────────────────────────────
const SCENARIOS = [
  { label: 'Same-floor (short)',         start: 'MAINENTRANCE-GF',  goal: 'TUTORIAL-GF',          flags: {} },
  { label: 'Same-floor (long)',           start: 'MAINENTRANCE-GF',  goal: 'RESTROOMS-GF',          flags: {} },
  { label: 'Cross-floor +1 (lift pref)', start: 'MAINENTRANCE-GF',  goal: 'SEMINARHALL-1F',        flags: {} },
  { label: 'Cross-floor +2',             start: 'MAINENTRANCE-GF',  goal: 'RESEARCHDEPT-2F',       flags: {} },
  { label: 'Cross-floor +3 (max)',       start: 'MAINENTRANCE-GF',  goal: 'ROOM1-3F',              flags: {} },
  { label: 'Elevator-only mobility',     start: 'MAINENTRANCE-GF',  goal: 'ROOM1-3F',              flags: { avoidStairs: true } },
  { label: 'Stairs-only mobility',       start: 'MAINENTRANCE-GF',  goal: 'ROOM1-3F',              flags: { avoidElevators: true } },
  { label: 'Passageway branch',          start: 'MAINENTRANCE-GF',  goal: 'STAFFROOM2-1F',         flags: {} },
  { label: 'End-of-corridor reach',      start: 'MAINENTRANCE-GF',  goal: 'PRINCIPALROOM-GF',      flags: {} },
  { label: 'Opposite corner (far-far)',  start: 'STAIRSEND-GF',     goal: 'ROOM4-3F',              flags: {} },
];

// ─── Run ──────────────────────────────────────────────────────────────────────
const ITERS = 200;
const results = [];

console.log('\n  Benchmarking D* Lite vs Bidirectional A*');
console.log('  Iterations per scenario: ' + ITERS + '\n');

for (const sc of SCENARIOS) {
  const { start, goal, flags } = sc;
  const args = { start, goal, graph: GRAPH, nodes: NODES, ...flags };

  const biSingle = bidirectionalAStarInstrumented(args);
  const dsSingle = dStarLiteInstrumented(args);

  const biTime = timeFn(() => bidirectionalAStarInstrumented(args), ITERS);
  const dsTime = timeFn(() => dStarLiteInstrumented(args), ITERS);

  const biCost = pathCost(biSingle.path, NODES);
  const dsCost = pathCost(dsSingle.path, NODES);

  results.push({
    label: sc.label,
    biTime, dsTime,
    biNodes: biSingle.nodesExpanded,
    dsNodes: dsSingle.nodesExpanded,
    biHeap: biSingle.heapOps,
    dsHeap: dsSingle.heapOps,
    biLen: biSingle.path.length,
    dsLen: dsSingle.path.length,
    biCost: Math.round(biCost * 100) / 100,
    dsCost: Math.round(dsCost * 100) / 100,
    biPath: biSingle.path,
    dsPath: dsSingle.path,
  });
}

// Print summary table to stdout for capture
console.log(JSON.stringify(results, null, 2));
