/**
 * routing.js — Pure ES module, zero DOM, zero fetch, no side effects.
 * Owned by: Person B (Algorithm)
 * Testable in Node.js: import { planRoute } from './routing.js'
 */

// ---------------------------------------------------------------------------
// Cost constants — mirror Python values exactly
// ---------------------------------------------------------------------------
const STAIRS_L_COST = 85;   // straight stairs per floor (7.67 units @ 0.51 m/unit + effort)
const STAIRS_R_COST = 75;   // curved stairs per floor
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
// bidirectionalAStar — Pohl 1971 stopping criterion
// ---------------------------------------------------------------------------
export function bidirectionalAStar({
  start, goal, graph, nodes, 
  avoidStairs = false, avoidElevators = false,
  learnedWeights = {}
}) {
  if (start === goal) return [start];
  if (!nodes[start] || !nodes[goal]) return [];

  const fwd = new MinHeap();
  const bwd = new MinHeap();
  fwd.push(0, start);
  bwd.push(0, goal);

  const gF = { [start]: 0 };
  const gB = { [goal]: 0 };
  const parentF = { [start]: null };
  const parentB = { [goal]: null };
  const fwdVisited = new Set();
  const bwdVisited = new Set();

  let mu = Infinity;
  let meetingNode = null;

  function shouldSkip(nid) {
    if (nid === goal) return false;
    if (nodes[nid]?.dead_end) return true;
    if (avoidStairs && nodes[nid]?.type === 'stairs') return true;
    if (avoidElevators && nodes[nid]?.type === 'lift') return true;
    return false;
  }

  function expandFwd() {
    if (fwd.size === 0) return;
    const { item: curr } = fwd.pop();
    if (fwdVisited.has(curr)) return;
    fwdVisited.add(curr);

    for (const nbr of (graph[curr] || [])) {
      if (shouldSkip(nbr)) continue;
      const newCost = gF[curr] + edgeCost(curr, nbr, nodes, learnedWeights);
      if (newCost < (gF[nbr] ?? Infinity)) {
        gF[nbr] = newCost;
        parentF[nbr] = curr;
        fwd.push(newCost + heuristic(nbr, goal, nodes), nbr);
        
        if (gB[nbr] !== undefined) {
          const candidate = newCost + gB[nbr];
          if (candidate < mu) {
            mu = candidate;
            meetingNode = nbr;
          }
        }
      }
    }
  }

  function expandBwd() {
    if (bwd.size === 0) return;
    const { item: curr } = bwd.pop();
    if (bwdVisited.has(curr)) return;
    bwdVisited.add(curr);

    for (const nbr of (graph[curr] || [])) {
      if (shouldSkip(nbr)) continue;
      // We go backward, so cost is from nbr to curr
      const newCost = gB[curr] + edgeCost(nbr, curr, nodes, learnedWeights);
      if (newCost < (gB[nbr] ?? Infinity)) {
        gB[nbr] = newCost;
        parentB[nbr] = curr;
        bwd.push(newCost + heuristic(nbr, start, nodes), nbr);
        
        if (gF[nbr] !== undefined) {
          const candidate = gF[nbr] + newCost;
          if (candidate < mu) {
            mu = candidate;
            meetingNode = nbr;
          }
        }
      }
    }
  }

  while (fwd.size > 0 && bwd.size > 0) {
    const fTop = fwd._heap[0].priority;
    const bTop = bwd._heap[0].priority;

    if (fTop >= mu || bTop >= mu) {
      break;
    }

    if (fwd.size > 0) expandFwd();
    if (bwd.size > 0) expandBwd();
  }

  if (!meetingNode) return [];

  // Path reconstruction
  const fwdPath = [];
  let cur = meetingNode;
  while (cur !== null) {
    fwdPath.push(cur);
    cur = parentF[cur] ?? null;
  }
  fwdPath.reverse();

  const bwdPath = [];
  cur = parentB[meetingNode] ?? null;
  while (cur !== null) {
    bwdPath.push(cur);
    cur = parentB[cur] ?? null;
  }

  return [...fwdPath, ...bwdPath];
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
    const seg = bidirectionalAStar({ 
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
  // Build a penalty map from the primary path edges so bidirectionalAStar
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
  const lastSegment = Math.max(...path.map(node => node.segment ?? 0));

  function heading(a, b) {
    return (Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 360) % 360;
  }
  function turnDir(prevH, newH) {
    let diff = ((newH - prevH) + 360) % 360;
    if (diff > 180) diff -= 360;
    if (Math.abs(diff) < 30) return 'straight';
    return diff > 0 ? 'right' : 'left';
  }
  function distM(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y) * COORD_TO_METERS;
  }

  // Start step
  directions.push({
    text: `[START] You are at ${nodeLabel(path[0].id)} on the ${FLOOR_NAMES[path[0].floor]}. Face the main corridor and begin your route.`,
    action: `Start at ${nodeLabel(path[0].id)}`,
    detail: `${FLOOR_NAMES[path[0].floor]} · Face main corridor`,
    icon: 'start',
    type: 'start',
    floor: path[0].floor,
    landmark: nodeLabel(path[0].id),
  });

  let i = 1;
  let prevHeading = null;
  let arrivedAtDestination = false;

  function pushBoundaryArrival(node) {
    if (!node || (node.segment ?? 0) === 0) return false;
    const isFinalStop = (node.segment ?? 0) >= lastSegment;
    const floorLabel = FLOOR_NAMES[node.floor];
    if (isFinalStop) {
      directions.push({
        text: `[ARRIVED] You have arrived at your destination: ${nodeLabel(node.id)} on the ${floorLabel}.`,
        action: `Arrived at destination`,
        detail: `${nodeLabel(node.id)} · ${floorLabel}`,
        icon: 'arrived',
        type: 'arrived',
        floor: node.floor,
        landmark: nodeLabel(node.id),
      });
      arrivedAtDestination = true;
    } else {
      directions.push({
        text: `[STOP] You have reached stop ${node.segment}: ${nodeLabel(node.id)} on the ${floorLabel}.`,
        action: `Reached Stop ${node.segment}`,
        detail: `${nodeLabel(node.id)} · ${floorLabel}`,
        icon: 'straight',
        type: 'stop',
        floor: node.floor,
        landmark: nodeLabel(node.id),
      });
    }
    prevHeading = null;
    return true;
  }

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
        let text, action, detail;
        if (isLift) {
          text = `${tag} Enter the lift and go ${goingUp ? 'up' : 'down'} to the ${FLOOR_NAMES[exitFloor]}.`;
          action = `Take lift ${goingUp ? 'up' : 'down'} to ${FLOOR_NAMES[exitFloor]}`;
          detail = `From ${FLOOR_NAMES[prev.floor]} to ${FLOOR_NAMES[exitFloor]}`;
        } else if (isCurved) {
          text = `${tag} Take the curved staircase ${goingUp ? 'up' : 'down'} to the ${FLOOR_NAMES[exitFloor]}.`;
          action = `Take curved stairs ${goingUp ? 'up' : 'down'}`;
          detail = `Proceed to ${FLOOR_NAMES[exitFloor]}`;
        } else {
          text = `${tag} Take the main stairs ${goingUp ? 'up' : 'down'} to the ${FLOOR_NAMES[exitFloor]}.`;
          action = `Take stairs ${goingUp ? 'up' : 'down'} to ${FLOOR_NAMES[exitFloor]}`;
          detail = `From ${FLOOR_NAMES[prev.floor]} to ${FLOOR_NAMES[exitFloor]}`;
        }
        directions.push({
          text,
          action,
          detail,
          icon: isLift ? 'lift' : 'stairs',
          type: isLift ? 'lift' : 'stairs',
          floor: prev.floor,
          isTransition: true,
          targetFloor: exitFloor,
        });
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
      const roundedM = Math.round(totalDist);
      const distStr = roundedM > 1 ? `${roundedM}m` : 'a short distance';
      const corridorH = heading(prev, path[Math.min(j - 1, path.length - 1)]);
      let turn = 'straight';
      let turnAction = 'Continue straight';
      if (prevHeading !== null) {
        const t = turnDir(prevHeading, corridorH);
        if (t === 'left') {
          turn = 'left';
          turnAction = 'Turn left';
        } else if (t === 'right') {
          turn = 'right';
          turnAction = 'Turn right';
        }
      }
      const floorCtx = ` on the ${FLOOR_NAMES[prev.floor]}`;
      const nodeAtEnd = j < path.length ? path[j] : null;
      const endLabel = nodeAtEnd && !isWaypoint(nodeAtEnd.id) && !isTransit(nodeAtEnd.id)
        ? nodeLabel(nodeAtEnd.id) : null;
      const turnPrefix = turn === 'left' ? 'Take a left. ' : turn === 'right' ? 'Take a right. ' : '';
      const instruction = endLabel
        ? `${turnPrefix}Walk about ${distStr} along the corridor${floorCtx} towards ${endLabel}.`
        : `${turnPrefix}Walk about ${distStr} along the corridor${floorCtx}.`;
      
      const detail = endLabel
        ? `Walk ${distStr} towards ${endLabel}`
        : `Walk ${distStr} along corridor · ${FLOOR_NAMES[prev.floor]}`;

      directions.push({
        text: `[WALK] ${instruction}`,
        action: turnAction,
        detail,
        icon: turn === 'left' ? 'turn-left' : turn === 'right' ? 'turn-right' : 'walk',
        type: turn === 'left' ? 'turn-left' : turn === 'right' ? 'turn-right' : 'walk',
        floor: prev.floor,
        distanceM: roundedM,
        landmark: endLabel || null,
      });
      prevHeading = corridorH;
      if (nodeAtEnd && !isTransit(nodeAtEnd.id)) {
        pushBoundaryArrival(nodeAtEnd);
      }
      i = endLabel ? j + 1 : j;
      continue;
    }

    // Direct room-to-room
    if (!isTransit(curr.id)) {
      const h = heading(prev, curr);
      const dist = distM(prev, curr);
      const roundedM = Math.round(dist);
      const distLabel = roundedM > 0 ? ` (about ${roundedM}m)` : '';
      const turn = prevHeading !== null ? turnDir(prevHeading, h) : 'straight';
      let turnAction = 'Continue straight';
      let icon = 'straight';
      let instruction;
      if (turn === 'left') {
        turnAction = 'Turn left';
        icon = 'turn-left';
        instruction = `Take a left and head to ${nodeLabel(curr.id)}${distLabel}.`;
      } else if (turn === 'right') {
        turnAction = 'Turn right';
        icon = 'turn-right';
        instruction = `Take a right and head to ${nodeLabel(curr.id)}${distLabel}.`;
      } else {
        instruction = `Go straight ahead to ${nodeLabel(curr.id)}${distLabel}.`;
      }
      directions.push({
        text: `[GO] ${instruction}`,
        action: turnAction,
        detail: roundedM > 0 ? `Head ${roundedM}m to ${nodeLabel(curr.id)}` : `Head to ${nodeLabel(curr.id)}`,
        icon,
        type: 'go',
        floor: curr.floor,
        distanceM: roundedM,
        landmark: nodeLabel(curr.id),
      });
      prevHeading = h;
      pushBoundaryArrival(curr);
      i++;
      continue;
    }
    i++;
  }

  if (!arrivedAtDestination) {
    directions.push({
      text: `[ARRIVED] You have arrived at your destination: ${nodeLabel(path[path.length - 1].id)} on the ${FLOOR_NAMES[path[path.length - 1].floor]}.`,
      action: `Arrived at destination`,
      detail: `${nodeLabel(path[path.length - 1].id)} · ${FLOOR_NAMES[path[path.length - 1].floor]}`,
      icon: 'arrived',
      type: 'arrived',
      floor: path[path.length - 1].floor,
      landmark: nodeLabel(path[path.length - 1].id),
    });
  }

  return directions;
}
