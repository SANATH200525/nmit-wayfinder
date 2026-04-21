/**
 * routing.js — Pure ES module, zero DOM, zero fetch, no side effects.
 * Owned by: Person B (Algorithm)
 * Testable in Node.js: import { planRoute } from './routing.js'
 */

// ---------------------------------------------------------------------------
// Cost constants — mirror Python values exactly
// ---------------------------------------------------------------------------
const STAIRS_L_COST = 180;  // straight stairs per floor
const STAIRS_R_COST = 150;  // curved stairs per floor
const LIFT_COST = 120;  // lift per floor

// ---------------------------------------------------------------------------
// edgeCost — planar Euclidean + vertical penalty, optional learned weights
// ---------------------------------------------------------------------------
export function edgeCost(nodeA, nodeB, nodes, learnedWeights = {}) {
  const [x1, y1] = nodes[nodeA].coords;
  const [x2, y2] = nodes[nodeB].coords;
  const f1 = nodes[nodeA].floor;
  const f2 = nodes[nodeB].floor;
  const base = Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);

  let cost = base;
  if (f1 !== f2) {
    const floorDelta = Math.abs(f1 - f2);
    const aType = nodes[nodeA].type;
    const bType = nodes[nodeB].type;
    const aKind = nodes[nodeA].stairs_kind;
    const bKind = nodes[nodeB].stairs_kind;
    if ((aType === 'stairs' && aKind === 'curved') || (bType === 'stairs' && bKind === 'curved')) {
      cost = base + STAIRS_R_COST * floorDelta;
    } else if (aType === 'stairs' || bType === 'stairs') {
      cost = base + STAIRS_L_COST * floorDelta;
    } else if (aType === 'lift' || bType === 'lift') {
      cost = base + LIFT_COST * floorDelta;
    } else {
      cost = base + STAIRS_L_COST * floorDelta;
    }
  }

  // Apply learned weight if provided (server fetches, passes in)
  const key = `${nodeA}->${nodeB}`;
  const keyRev = `${nodeB}->${nodeA}`;
  const w = learnedWeights[key] ?? learnedWeights[keyRev] ?? 1.0;
  const clampedW = Math.max(0.7, Math.min(1.5, w));
  return cost * clampedW;
}

// ---------------------------------------------------------------------------
// heuristic — planar + min vertical penalty
// ---------------------------------------------------------------------------
export function heuristic(nodeA, nodeB, nodes) {
  const [x1, y1] = nodes[nodeA].coords;
  const [x2, y2] = nodes[nodeB].coords;
  const f1 = nodes[nodeA].floor;
  const f2 = nodes[nodeB].floor;
  const planar = Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
  const verticalPenalty = Math.min(STAIRS_L_COST, LIFT_COST) * Math.abs(f1 - f2);
  return planar + verticalPenalty;
}

// ---------------------------------------------------------------------------
// MinHeap — simple binary min-heap for A* frontier
// ---------------------------------------------------------------------------
class MinHeap {
  constructor() { this._heap = []; }
  push(priority, item) {
    this._heap.push({ priority, item });
    this._bubbleUp(this._heap.length - 1);
  }
  pop() {
    const top = this._heap[0];
    const last = this._heap.pop();
    if (this._heap.length > 0) {
      this._heap[0] = last;
      this._sinkDown(0);
    }
    return top;
  }
  get size() { return this._heap.length; }
  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._heap[parent].priority <= this._heap[i].priority) break;
      [this._heap[parent], this._heap[i]] = [this._heap[i], this._heap[parent]];
      i = parent;
    }
  }
  _sinkDown(i) {
    const n = this._heap.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this._heap[l].priority < this._heap[smallest].priority) smallest = l;
      if (r < n && this._heap[r].priority < this._heap[smallest].priority) smallest = r;
      if (smallest === i) break;
      [this._heap[smallest], this._heap[i]] = [this._heap[i], this._heap[smallest]];
      i = smallest;
    }
  }
}

// ---------------------------------------------------------------------------
// dStarLite — Koenig & Likhachev 2002 (static-graph variant)
//
// Searches backward from goal → start, maintaining:
//   g[n]   = best known cost from n to goal (infinity until updated)
//   rhs[n] = one-step lookahead: min over successors s of (edgeCost(n,s) + g[s])
//            rhs[goal] = 0 is the seed.
//
// A node is "locally consistent" when g[n] === rhs[n].
// The open list is a min-heap keyed by calculateKey(n).
// We process until start is locally consistent, then reconstruct
// the path greedily forward: always step to the neighbour minimising
// edgeCost(curr→nbr) + g[nbr].
//
// On a fully known static graph this yields the same optimal path as A*
// while expanding nodes from the goal outward (opposite search direction
// from forward A*, different from bidirectional A*'s two-frontier approach).
// ---------------------------------------------------------------------------
export function dStarLite({
  start, goal, graph, nodes,
  avoidStairs = false, avoidElevators = false,
  learnedWeights = {}
}) {
  if (start === goal) return [start];
  if (!nodes[start] || !nodes[goal]) return [];

  // ── helpers ────────────────────────────────────────────────────────────
  function shouldSkip(nid, target) {
    // Always allow the explicit target (start or goal) through
    if (nid === target) return false;
    if (nodes[nid]?.dead_end) return true;
    if (avoidStairs && nodes[nid]?.type === 'stairs') return true;
    if (avoidElevators && nodes[nid]?.type === 'lift') return true;
    return false;
  }

  // D* Lite key: [min(g,rhs) + h(start,n),  min(g,rhs)]
  // Using the start-to-n heuristic as the admissible estimate.
  function calculateKey(n) {
    const minVal = Math.min(g[n], rhs[n]);
    return [minVal + heuristic(start, n, nodes), minVal];
  }

  function keyLess(a, b) {
    return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  }

  // ── state ──────────────────────────────────────────────────────────────
  const INF = Infinity;
  const g   = {};   // g[n]   = cost-to-reach-goal from n
  const rhs = {};   // rhs[n] = one-step lookahead
  const allNodes = Object.keys(graph);
  for (const n of allNodes) { g[n] = INF; rhs[n] = INF; }

  // Seed: goal costs 0 to reach itself
  rhs[goal] = 0;

  // Open list: min-heap of { priority: [k1,k2], item: nodeId }
  // We extend MinHeap's push to accept a two-element key array.
  // Build a dedicated heap using the same MinHeap but with a
  // comparator that respects lexicographic key ordering.
  const openSet = new Map(); // nodeId → key currently in heap (for lazy deletion)

  // We use a priority queue backed by a plain array + re-heapify
  // approach with lazy deletion (standard D* Lite practice).
  const heap = []; // elements: { key: [k1,k2], node }

  function heapPush(node, key) {
    heap.push({ key, node });
    // bubble up
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!keyLess(heap[i].key, heap[parent].key)) break;
      [heap[i], heap[parent]] = [heap[parent], heap[i]];
      i = parent;
    }
  }

  function heapPop() {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      // sink down
      let i = 0;
      while (true) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let smallest = i;
        if (l < heap.length && keyLess(heap[l].key, heap[smallest].key)) smallest = l;
        if (r < heap.length && keyLess(heap[r].key, heap[smallest].key)) smallest = r;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    return top;
  }

  function heapTop() { return heap.length > 0 ? heap[0] : null; }

  // Insert goal into open list
  const goalKey = calculateKey(goal);
  heapPush(goal, goalKey);
  openSet.set(goal, goalKey);

  // ── main loop ──────────────────────────────────────────────────────────
  function computeShortestPath() {
    while (heap.length > 0) {
      const startKey = calculateKey(start);
      const topEl = heapTop();
      if (!topEl) break;

      // Stop when start is locally consistent AND its key ≥ top of heap
      if (!keyLess(topEl.key, startKey) && rhs[start] === g[start]) break;

      const { key: kOld, node: u } = heapPop();
      openSet.delete(u);

      const kNew = calculateKey(u);

      if (keyLess(kOld, kNew)) {
        // Key is outdated (lazy update) — re-insert with correct key
        heapPush(u, kNew);
        openSet.set(u, kNew);
      } else if (g[u] > rhs[u]) {
        // Overconsistent: lower g to rhs
        g[u] = rhs[u];
        // Update all predecessors (neighbours in undirected graph = same set)
        for (const pred of (graph[u] || [])) {
          if (shouldSkip(pred, start)) continue;
          const newRhs = edgeCost(pred, u, nodes, learnedWeights) + g[u];
          if (newRhs < rhs[pred]) {
            rhs[pred] = newRhs;
            const predKey = calculateKey(pred);
            heapPush(pred, predKey);
            openSet.set(pred, predKey);
          }
        }
      } else {
        // Underconsistent: raise g to infinity and reprocess
        g[u] = INF;
        // Reprocess u itself
        const rhsU = INF; // will be recomputed below
        let bestRhs = INF;
        for (const succ of (graph[u] || [])) {
          if (shouldSkip(succ, goal)) continue;
          const c = edgeCost(u, succ, nodes, learnedWeights) + g[succ];
          if (c < bestRhs) bestRhs = c;
        }
        rhs[u] = bestRhs;
        if (rhs[u] !== g[u]) {
          heapPush(u, calculateKey(u));
          openSet.set(u, calculateKey(u));
        }
        // Update predecessors
        for (const pred of (graph[u] || [])) {
          if (shouldSkip(pred, start)) continue;
          let bestPredRhs = INF;
          for (const s of (graph[pred] || [])) {
            if (shouldSkip(s, goal)) continue;
            const c = edgeCost(pred, s, nodes, learnedWeights) + g[s];
            if (c < bestPredRhs) bestPredRhs = c;
          }
          if (bestPredRhs !== rhs[pred]) {
            rhs[pred] = bestPredRhs;
            const predKey = calculateKey(pred);
            heapPush(pred, predKey);
            openSet.set(pred, predKey);
          }
        }
      }
    }
  }

  computeShortestPath();

  // ── path reconstruction ────────────────────────────────────────────────
  // If start is unreachable, g[start] stays INF
  if (g[start] === INF && rhs[start] === INF) return [];

  // Greedy forward descent: from start, always move to the neighbour n
  // that minimises edgeCost(curr→n) + g[n]
  const path = [start];
  const visited = new Set([start]);
  let curr = start;

  while (curr !== goal) {
    let bestNbr = null;
    let bestCost = INF;
    for (const nbr of (graph[curr] || [])) {
      if (shouldSkip(nbr, goal)) continue;
      if (visited.has(nbr)) continue;
      const cost = edgeCost(curr, nbr, nodes, learnedWeights) + (g[nbr] ?? INF);
      if (cost < bestCost) {
        bestCost = cost;
        bestNbr = nbr;
      }
    }
    if (bestNbr === null) return []; // no path to goal
    visited.add(bestNbr);
    path.push(bestNbr);
    curr = bestNbr;
    if (path.length > allNodes.length) return []; // cycle guard
  }

  return path;
}

// ---------------------------------------------------------------------------
// MULTI-STOP PLANNER
// ---------------------------------------------------------------------------
export function planRoute({ startNode, endNode, stops=[], avoidStairs=false, 
                            avoidElevators=false, nodes, graph, learnedWeights={} }) {
  const waypoints = [startNode, ...stops, endNode];
  const fullPath = [];
  const segBoundaries = new Set(waypoints.slice(1));

  for (let i = 0; i < waypoints.length - 1; i++) {
    const segStart = waypoints[i], segEnd = waypoints[i+1];
    if (segStart === segEnd) continue;
    const seg = dStarLite({ 
      start: segStart, goal: segEnd, graph, nodes, 
      avoidStairs, avoidElevators, learnedWeights 
    });
    if (!seg.length) return []; // one segment failed → whole route fails
    const slice = fullPath.length ? seg.slice(1) : seg;
    fullPath.push(...slice);
  }

  // Annotate with coordinates and segment index
  let segIdx = 0;
  return fullPath.map((id, idx) => {
    if (idx > 0 && segBoundaries.has(id)) segIdx++;
    return {
      id,
      x: nodes[id].coords[0],
      y: nodes[id].coords[1],
      floor: nodes[id].floor,
      type: nodes[id].type ?? null,
      segment: segIdx,
    };
  });
}

// ---------------------------------------------------------------------------
// planAlternate — returns a second-best path by penalising the primary route's
// edges, forcing the algorithm to explore a different corridor.
// ---------------------------------------------------------------------------
export function planAlternate({ startNode, endNode, stops=[], avoidStairs=false,
                                avoidElevators=false, nodes, graph,
                                learnedWeights={}, primaryPath=[] }) {
  // Build a penalty map from the primary path edges so dStarLite
  // naturally avoids them (weight ×4 makes them very unattractive).
  const penaltyWeights = { ...learnedWeights };
  for (let i = 0; i < primaryPath.length - 1; i++) {
    const a = primaryPath[i].id, b = primaryPath[i + 1].id;
    const key = `${a}->${b}`, keyR = `${b}->${a}`;
    penaltyWeights[key]  = (penaltyWeights[key]  ?? 1.0) * 4;
    penaltyWeights[keyR] = (penaltyWeights[keyR] ?? 1.0) * 4;
  }
  return planRoute({ startNode, endNode, stops, avoidStairs, avoidElevators,
                     nodes, graph, learnedWeights: penaltyWeights });
}


export function buildDirections(path, nodes) {
  if (!path || path.length === 0) return [];

  const FLOOR_NAMES = { 1: 'Ground Floor', 2: 'First Floor', 3: 'Second Floor', 4: 'Third Floor' };
  const COORD_TO_METERS = 0.5;
  const directions = [];

  const nodeLabel = (id) => nodes[id]?.label || id;
  const isWaypoint = (id) => nodes[id]?.is_waypoint || id.includes('HALLWAY') || id.includes('PASSAGEWAY');
  const isTransit = (id) => nodes[id]?.type === 'stairs' || nodes[id]?.type === 'lift';

  function heading(a, b) {
    return (Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 360) % 360;
  }
  function turnDir(prevH, newH) {
    let diff = ((newH - prevH) + 360) % 360;
    if (diff > 180) diff -= 360;
    if (Math.abs(diff) < 25) return 'straight';
    return diff > 0 ? 'right' : 'left';
  }
  function distM(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y) * COORD_TO_METERS;
  }

  directions.push({
    text: `[START] You are at ${nodeLabel(path[0].id)} on the ${FLOOR_NAMES[path[0].floor]}. Face the main corridor and begin your route.`,
    floor: path[0].floor,
    type: 'start'
  });

  let i = 1;
  let prevHeading = null;

  while (i < path.length) {
    const prev = path[i - 1];
    const curr = path[i];

    // Floor transition
    if (curr.floor !== prev.floor) {
      const isLift = nodes[curr.id]?.type === 'lift';
      const isStairs = nodes[curr.id]?.type === 'stairs';
      const isCurved = isStairs && nodes[curr.id]?.stairs_kind === 'curved';
      if (isLift || isStairs) {
        let j = i;
        while (j < path.length && path[j].floor !== prev.floor &&
          (isLift ? nodes[path[j].id]?.type === 'lift' : nodes[path[j].id]?.type === 'stairs')) { j++; }
        const exitFloor = path[Math.min(j, path.length - 1) - 1]?.floor ?? curr.floor;
        const goingUp = exitFloor > prev.floor;
        const tag = isLift ? '[LIFT]' : '[STAIRS]';
        let text;
        if (isLift) text = `${tag} Enter the lift and go ${goingUp ? 'up' : 'down'} to the ${FLOOR_NAMES[exitFloor]}.`;
        else if (isCurved) text = `${tag} Take the curved staircase ${goingUp ? 'up' : 'down'} to the ${FLOOR_NAMES[exitFloor]}.`;
        else text = `${tag} Take the main stairs ${goingUp ? 'up' : 'down'} to the ${FLOOR_NAMES[exitFloor]}.`;
        directions.push({ text, floor: prev.floor, type: isLift ? 'lift' : 'stairs' });
        prevHeading = null;
        i = j;
        continue;
      }
    }

    // Corridor segment
    if (isWaypoint(curr.id)) {
      let j = i;
      let totalDist = 0;
      while (j < path.length && isWaypoint(path[j].id) && path[j].floor === prev.floor) {
        totalDist += distM(path[j - 1], path[j]);
        j++;
      }
      const distStr = totalDist > 1 ? `about ${Math.round(totalDist)}m` : 'a short distance';
      const corridorH = heading(prev, path[Math.min(j - 1, path.length - 1)]);
      let turnText = '';
      if (prevHeading !== null) {
        const turn = turnDir(prevHeading, corridorH);
        if (turn === 'left') turnText = 'Take a left. ';
        else if (turn === 'right') turnText = 'Take a right. ';
      }
      const floorCtx = ` on the ${FLOOR_NAMES[prev.floor]}`;
      const nodeAtEnd = j < path.length ? path[j] : null;
      const endLabel = nodeAtEnd && !isWaypoint(nodeAtEnd.id) && !isTransit(nodeAtEnd.id)
        ? nodeLabel(nodeAtEnd.id) : null;
      const instruction = endLabel
        ? `${turnText}Walk ${distStr} along the corridor${floorCtx} towards ${endLabel}.`
        : `${turnText}Walk ${distStr} along the corridor${floorCtx}.`;
      directions.push({ text: `[WALK] ${instruction}`, floor: prev.floor, type: 'walk' });
      prevHeading = corridorH;
      i = endLabel ? j + 1 : j;
      continue;
    }

    // Direct room-to-room
    if (!isTransit(curr.id)) {
      const h = heading(prev, curr);
      const dist = distM(prev, curr);
      const turn = prevHeading !== null ? turnDir(prevHeading, h) : null;
      const distLabel = Math.round(dist) > 0 ? ` (about ${Math.round(dist)}m)` : '';
      let instruction;
      if (turn === 'left') instruction = `Take a left and head to ${nodeLabel(curr.id)}${distLabel}.`;
      else if (turn === 'right') instruction = `Take a right and head to ${nodeLabel(curr.id)}${distLabel}.`;
      else instruction = `Go straight ahead to ${nodeLabel(curr.id)}${distLabel}.`;
      directions.push({ text: `[GO] ${instruction}`, floor: curr.floor, type: 'go' });
      prevHeading = h;
      i++;
      continue;
    }
    i++;
  }

  directions.push({
    text: `[ARRIVED] You have arrived at your destination: ${nodeLabel(path[path.length - 1].id)} on the ${FLOOR_NAMES[path[path.length - 1].floor]}.`,
    floor: path[path.length - 1].floor,
    type: 'arrived'
  });

  return directions;
}
