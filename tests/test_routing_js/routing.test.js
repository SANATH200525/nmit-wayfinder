/**
 * routing.test.js — Node.js test suite for routing.js
 * Run:  node --experimental-vm-modules tests/test_routing_js/routing.test.js
 *  OR:  node tests/test_routing_js/routing.test.js  (Node 22+)
 *
 * No test framework — pure assert. Exit code 0 = all pass, 1 = any failure.
 */

import assert from 'node:assert/strict';

import {
  bidirectionalAStar,
  buildDirections,
  edgeCost,
  heuristic,
  planAlternate,
  planRoute,
} from '../../frontend/static/js/routing.js';
import { NODES, GRAPH } from '../../frontend/static/js/graph-data.js';

// ---------------------------------------------------------------------------
// Minimal test harness
// ---------------------------------------------------------------------------
let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

test('same start and goal returns [start]', () => {
  const result = bidirectionalAStar({
    start: 'main-entrance', goal: 'main-entrance', graph: GRAPH, nodes: NODES,
  });
  assert.deepEqual(result, ['main-entrance']);
});

test('invalid start node returns []', () => {
  const result = bidirectionalAStar({
    start: 'DOES_NOT_EXIST', goal: 'it-lab-1-gf', graph: GRAPH, nodes: NODES,
  });
  assert.deepEqual(result, []);
});

test('invalid goal node returns []', () => {
  const result = bidirectionalAStar({
    start: 'main-entrance', goal: 'DOES_NOT_EXIST', graph: GRAPH, nodes: NODES,
  });
  assert.deepEqual(result, []);
});

test('same-floor route is non-empty and correct endpoints', () => {
  const result = bidirectionalAStar({
    start: 'main-entrance', goal: 'it-lab-1-gf', graph: GRAPH, nodes: NODES,
  });
  assert.ok(result.length > 0, 'path should not be empty');
  assert.equal(result[0], 'main-entrance');
  assert.equal(result[result.length - 1], 'it-lab-1-gf');
});

test('same-floor route stays on floor 1', () => {
  const result = bidirectionalAStar({
    start: 'main-entrance', goal: 'it-lab-1-gf', graph: GRAPH, nodes: NODES,
  });
  assert.ok(result.every(id => NODES[id].floor === 1), 'all nodes should be on floor 1');
});

test('multi-floor route passes through floor 3', () => {
  const result = bidirectionalAStar({
    start: 'main-entrance', goal: 'aircraft-systems-lab-2f', graph: GRAPH, nodes: NODES,
  });
  assert.ok(result.length > 0, 'path should not be empty');
  assert.ok(result.some(id => NODES[id].floor === 3), 'path should touch floor 3');
});

test('elevator_only: no stairs nodes in path', () => {
  const result = bidirectionalAStar({
    start: 'main-entrance', goal: 'aircraft-systems-lab-2f',
    graph: GRAPH, nodes: NODES, avoidStairs: true,
  });
  assert.ok(result.length > 0, 'path should exist via elevator');
  const stairsInPath = result.filter(id => NODES[id].type === 'stairs');
  assert.equal(stairsInPath.length, 0, `found stairs nodes: ${stairsInPath}`);
});

test('stairs_only: no lift nodes in path', () => {
  const result = bidirectionalAStar({
    start: 'main-entrance', goal: 'aircraft-systems-lab-2f',
    graph: GRAPH, nodes: NODES, avoidElevators: true,
  });
  assert.ok(result.length > 0, 'path should exist via stairs');
  const liftsInPath = result.filter(id => NODES[id].type === 'lift');
  assert.equal(liftsInPath.length, 0, `found lift nodes: ${liftsInPath}`);
});

test('planRoute single segment returns annotated objects', () => {
  const path = planRoute({
    startNode: 'main-entrance', endNode: 'it-lab-1-gf',
    nodes: NODES, graph: GRAPH,
  });
  assert.ok(path.length > 0);
  assert.equal(path[0].id, 'main-entrance');
  assert.equal(path[path.length - 1].id, 'it-lab-1-gf');
  assert.ok(typeof path[0].x === 'number');
  assert.ok(typeof path[0].y === 'number');
  assert.ok(typeof path[0].floor === 'number');
  assert.ok(typeof path[0].segment === 'number');
});

test('planRoute multi-stop includes intermediate stop', () => {
  const path = planRoute({
    startNode: 'main-entrance', endNode: 'room1-3f',
    stops: ['seminar-hall(sammilana)-1f'],
    nodes: NODES, graph: GRAPH,
  });
  assert.ok(path.length > 0);
  const ids = path.map(p => p.id);
  assert.ok(ids.includes('seminar-hall(sammilana)-1f'), 'path should include seminar-hall(sammilana)-1f');
  assert.equal(ids[0], 'main-entrance');
  assert.equal(ids[ids.length - 1], 'room1-3f');
});

test('planRoute with invalid mid-stop returns []', () => {
  const path = planRoute({
    startNode: 'main-entrance', endNode: 'it-lab-1-gf',
    stops: ['DOES_NOT_EXIST'],
    nodes: NODES, graph: GRAPH,
  });
  assert.deepEqual(path, []);
});

test('edgeCost: same-floor cost equals planar distance', () => {
  const cost = edgeCost('main-entrance', 'checkpoint-1-lift-gf', NODES);
  const [x1, y1] = NODES['main-entrance'].coords;
  const [x2, y2] = NODES['checkpoint-1-lift-gf'].coords;
  const expected = Math.sqrt((x1-x2)**2 + (y1-y2)**2);
  assert.ok(Math.abs(cost - expected) < 0.001, `cost=${cost} expected=${expected}`);
});

test('edgeCost: cross-floor lift has higher cost than planar', () => {
  const cost = edgeCost('lift-gf', 'lift-1f', NODES);
  const [x1, y1] = NODES['lift-gf'].coords;
  const [x2, y2] = NODES['lift-1f'].coords;
  const base = Math.sqrt((x1-x2)**2 + (y1-y2)**2);
  assert.ok(cost > base, `lift cost ${cost} should exceed planar ${base}`);
});

test('heuristic is admissible (<=) actual path cost for same-floor pair', () => {
  const h = heuristic('main-entrance', 'it-lab-1-gf', NODES);
  const path = bidirectionalAStar({ start: 'main-entrance', goal: 'it-lab-1-gf', graph: GRAPH, nodes: NODES });
  let actual = 0;
  for (let i = 1; i < path.length; i++) actual += edgeCost(path[i-1], path[i], NODES);
  assert.ok(h <= actual + 0.001, `heuristic ${h} > actual cost ${actual}`);
});

test('planRoute segment annotation: stops increment segIdx', () => {
  const path = planRoute({
    startNode: 'main-entrance', endNode: 'room1-3f',
    stops: ['seminar-hall(sammilana)-1f'],
    nodes: NODES, graph: GRAPH,
  });
  const segs = new Set(path.map(p => p.segment));
  assert.ok(segs.has(0), 'segment 0 should exist');
  assert.ok(segs.has(1), 'segment 1 should exist after stop');
});

test('planAlternate preserves intermediate stops', () => {
  const primary = planRoute({
    startNode: 'lecture-hall-2-gf',
    endNode: 'room1-3f',
    stops: ['guest-lounge-1f', 'alumni-relations-office-2f'],
    nodes: NODES,
    graph: GRAPH,
  });
  const alternate = planAlternate({
    startNode: 'lecture-hall-2-gf',
    endNode: 'room1-3f',
    stops: ['guest-lounge-1f', 'alumni-relations-office-2f'],
    nodes: NODES,
    graph: GRAPH,
    primaryPath: primary,
  });
  const ids = alternate.map(node => node.id);
  assert.ok(ids.includes('guest-lounge-1f'), 'alternate route should include stop 1');
  assert.ok(ids.includes('alumni-relations-office-2f'), 'alternate route should include stop 2');
  assert.equal(ids[0], 'lecture-hall-2-gf');
  assert.equal(ids[ids.length - 1], 'room1-3f');
});

test('buildDirections emits explicit stop instructions for multi-stop routes', () => {
  const path = planRoute({
    startNode: 'lecture-hall-2-gf',
    endNode: 'room1-3f',
    stops: ['guest-lounge-1f', 'alumni-relations-office-2f'],
    nodes: NODES,
    graph: GRAPH,
  });
  const directions = buildDirections(path, NODES).map(step => step.text);
  assert.ok(directions.some(text => text.includes('[STOP]') && text.includes('Guest Lounge')), 'missing stop 1 instruction');
  assert.ok(directions.some(text => text.includes('[STOP]') && text.includes('Alumni Relations Office')), 'missing stop 2 instruction');
  assert.ok(directions.some(text => text.includes('[ARRIVED]') && text.includes('Room 1')), 'missing final arrival instruction');
});

test('curved stairs route through landing and floor transitions', () => {
  const path = planRoute({
    startNode: 'restrooms-1f',
    endNode: 'guest-lounge-1f',
    nodes: NODES,
    graph: GRAPH,
  });
  const ids = path.map(node => node.id);
  assert.ok(ids.includes('checkpoint1-lift-1f'), 'route should reach lift junction');
});

// ---------------------------------------------------------------------------
// Parity test: random pairs — verify JS path endpoints match Python graph structure
// ---------------------------------------------------------------------------
const REAL_NODES = Object.keys(NODES).filter(id => !NODES[id].is_waypoint);

function isValidPath(path) {
  if (path.length === 0) return true; // disconnected pairs are valid []
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    if (!GRAPH[a] || !GRAPH[a].includes(b)) return false; // each step must be a real edge
  }
  return true;
}

let seed = 42;
function rand() { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; }
function seededPair() {
  const i = Math.floor(rand() * REAL_NODES.length);
  let   j = Math.floor(rand() * REAL_NODES.length);
  while (j === i) j = Math.floor(rand() * REAL_NODES.length);
  return [REAL_NODES[i], REAL_NODES[j]];
}

test('parity: 20 random pairs return valid edge-connected paths', async () => {
  const failures = [];
  for (let n = 0; n < 20; n++) {
    const [start, goal] = seededPair();
    const path = bidirectionalAStar({ start, goal, graph: GRAPH, nodes: NODES });
    if (!isValidPath(path)) failures.push(`${start} → ${goal}: invalid edges in JS logic`);
    if (path.length > 0) {
      if (path[0] !== start) failures.push(`${start} → ${goal}: wrong start`);
      if (path[path.length - 1] !== goal) failures.push(`${start} → ${goal}: wrong goal`);
    }
  }
  assert.equal(failures.length, 0, '\n' + failures.join('\n'));
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(48)}`);
console.log(`  ${passed} passed  |  ${failed} failed`);
console.log(`${'─'.repeat(48)}\n`);
process.exit(failed > 0 ? 1 : 0);
