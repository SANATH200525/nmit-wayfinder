/**
 * pdr.test.js — Node.js test suite for the five PDR audit fixes
 *
 * Run:
 *   node tests/test_pdr_js/pdr.test.js
 *
 * No test framework — pure assert/strict (same convention as routing.test.js).
 * Exit 0 = all pass, 1 = any failure.
 *
 * HOW THIS WORKS WITHOUT A BROWSER
 * ---------------------------------
 * pdr.js references several browser-only globals (fetch, window, addEventListener).
 * We stub the bare minimum at the top of this file so the module can be imported
 * in Node without errors. None of the stubs affect the logic under test.
 *
 * PDR FIX COVERAGE:
 *   TEST 1 — _pathDistanceBetween: graph-path distance, not Euclidean shortcut
 *   TEST 2 — Heading spike rejection: >45 per tick is discarded
 *   TEST 3 — Gravity double-subtraction guard: accelerationIncludingGravity
 *             vs acceleration source branching
 *   TEST 4 — Soft-clamp accumulator: effectiveDist, not deltaUnits
 *   TEST 5 — PATH_SNAP_RADIUS_UNITS === 3 (corridor half-width)
 *
 * NO changes were made to pdr.js logic for this test. PATH_SNAP_RADIUS_UNITS
 * was re-exported (added to the export list at the bottom of pdr.js).
 */

// ---------------------------------------------------------------------------
// Browser API stubs — must come before the import of pdr.js
// ---------------------------------------------------------------------------

// fetch: _postObservation / _postEvent check this._sessionId first and return
// early when it is null (which all test engines use). Stub for safety.
globalThis.fetch = () => Promise.resolve({ ok: true });

// window: getPDRSupportState() reads window.DeviceMotionEvent.
globalThis.window = {
  DeviceMotionEvent: undefined,
  DeviceOrientationEvent: undefined,
  addEventListener: () => {},
  removeEventListener: () => {},
};

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { PDREngine, PATH_SNAP_RADIUS_UNITS } from '../../frontend/static/js/pdr.js';

// ---------------------------------------------------------------------------
// Minimal test harness (identical to routing.test.js)
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
// Shared helpers
// ---------------------------------------------------------------------------

function makeNodes(list) {
  const nodes = {};
  for (const { id, x, y, floor } of list) {
    nodes[id] = { coords: [x, y], floor, label: id };
  }
  return nodes;
}

function makeEngine(nodes, startNodeId) {
  return new PDREngine({
    startNode: startNodeId,
    nodes,
    graph: {},
    onPositionUpdate: () => {},
    onFloorChange: () => {},
    sessionId: null,
  });
}

// ============================================================================
// TEST 1 — Graph-distance calibration (_pathDistanceBetween / resetToCheckpoint)
// ============================================================================
console.log('\n── TEST 1: _pathDistanceBetween uses summed graph distance, not Euclidean ──');

test('L-shaped path A(0,0)->B(10,0)->C(10,10): graph dist = 20, not 14.14', () => {
  const nodes = makeNodes([
    { id: 'A', x: 0,  y: 0,  floor: 1 },
    { id: 'B', x: 10, y: 0,  floor: 1 },
    { id: 'C', x: 10, y: 10, floor: 1 },
  ]);
  const engine = makeEngine(nodes, 'A');
  engine.setPath([
    { id: 'A', coords: [0,  0],  floor: 1 },
    { id: 'B', coords: [10, 0],  floor: 1 },
    { id: 'C', coords: [10, 10], floor: 1 },
  ]);

  const graphDist = engine._pathDistanceBetween('A', 'C');
  const euclidean = Math.sqrt(200); // ~14.14

  assert.ok(Math.abs(graphDist - 20) < 1e-9, `expected 20, got ${graphDist}`);
  assert.ok(graphDist > euclidean + 1,
    `graph dist (${graphDist.toFixed(2)}) should exceed Euclidean (${euclidean.toFixed(2)})`);
});

test('straight path A(0,0)->B(15,0): graph dist equals Euclidean', () => {
  const nodes = makeNodes([
    { id: 'A', x: 0,  y: 0, floor: 1 },
    { id: 'B', x: 15, y: 0, floor: 1 },
  ]);
  const engine = makeEngine(nodes, 'A');
  engine.setPath([
    { id: 'A', coords: [0,  0], floor: 1 },
    { id: 'B', coords: [15, 0], floor: 1 },
  ]);
  const d = engine._pathDistanceBetween('A', 'B');
  assert.ok(Math.abs(d - 15) < 1e-9, `expected 15, got ${d}`);
});

test('null fromNodeId falls back to Euclidean from current position', () => {
  const nodes = makeNodes([
    { id: 'A', x: 0, y: 0, floor: 1 },
    { id: 'B', x: 6, y: 8, floor: 1 }, // dist from (0,0) = 10
  ]);
  const engine = makeEngine(nodes, 'A');
  engine.setPath([
    { id: 'A', coords: [0, 0], floor: 1 },
    { id: 'B', coords: [6, 8], floor: 1 },
  ]);
  const d = engine._pathDistanceBetween(null, 'B');
  assert.ok(Math.abs(d - 10) < 1e-9, `expected Euclidean 10, got ${d}`);
});

test('resetToCheckpoint advances _prevCheckpointId correctly', () => {
  const nodes = makeNodes([
    { id: 'A', x: 0,  y: 0,  floor: 1 },
    { id: 'B', x: 10, y: 0,  floor: 1 },
    { id: 'C', x: 10, y: 10, floor: 1 },
  ]);
  const engine = makeEngine(nodes, 'A');
  engine.setPath([
    { id: 'A', coords: [0,  0],  floor: 1 },
    { id: 'B', coords: [10, 0],  floor: 1 },
    { id: 'C', coords: [10, 10], floor: 1 },
  ]);

  assert.equal(engine._prevCheckpointId, null);
  engine.resetToCheckpoint('B');
  assert.equal(engine._prevCheckpointId, 'B');
  engine.resetToCheckpoint('C');
  assert.equal(engine._prevCheckpointId, 'C');
});

test('calibration with graph dist=PDR dist: stepLengthM unchanged (ratio 1.0)', () => {
  const nodes = makeNodes([
    { id: 'A', x: 0,  y: 0,  floor: 1 },
    { id: 'B', x: 10, y: 0,  floor: 1 },
    { id: 'C', x: 10, y: 10, floor: 1 },
  ]);
  const engine = makeEngine(nodes, 'A');
  engine.setPath([
    { id: 'A', coords: [0,  0],  floor: 1 },
    { id: 'B', coords: [10, 0],  floor: 1 },
    { id: 'C', coords: [10, 10], floor: 1 },
  ]);

  engine._prevCheckpointId = 'A';
  // PDR says it walked exactly 20 SVG units (same as graph dist A->C)
  engine._pdrDistanceSinceCheckpoint = 20;
  engine._stepsSinceCheckpoint = 20; // satisfies >= 5 guard

  const stepBefore = engine.stepLengthM;
  engine.resetToCheckpoint('C');
  const stepAfter = engine.stepLengthM;

  assert.ok(Math.abs(stepAfter - stepBefore) < 1e-9,
    `stepLengthM should be unchanged when ratio=1.0; was ${stepBefore.toFixed(4)}, now ${stepAfter.toFixed(4)}`);
});

// ============================================================================
// TEST 2 — Heading spike rejection (_onOrientEvent)
// ============================================================================
console.log('\n── TEST 2: Heading spike rejection ──');

// Android path: heading = 360 - alpha
function makeOrientEvent(targetHeading) {
  return { alpha: 360 - targetHeading, webkitCompassHeading: null };
}

test('spike >45 degrees: heading does not change', () => {
  const nodes = makeNodes([{ id: 'S', x: 50, y: 50, floor: 1 }]);
  const engine = makeEngine(nodes, 'S');
  engine._headingInitialized = true;
  engine.heading = 90;

  engine._onOrientEvent(makeOrientEvent(180)); // delta = +90, rejected

  assert.equal(engine.heading, 90,
    `heading should stay 90 after 90-degree spike, got ${engine.heading.toFixed(2)}`);
});

test('spike at exactly 45 degrees: accepted and blended (boundary is strict >)', () => {
  const nodes = makeNodes([{ id: 'S', x: 50, y: 50, floor: 1 }]);
  const engine = makeEngine(nodes, 'S');
  engine._headingInitialized = true;
  engine.heading = 90;

  engine._onOrientEvent(makeOrientEvent(135)); // delta = 45, NOT > 45 -> accepted
  const expected = 90 + 45 * 0.22;
  assert.ok(Math.abs(engine.heading - expected) < 0.01,
    `expected ${expected.toFixed(2)}, got ${engine.heading.toFixed(2)}`);
});

test('normal turn 10 degrees: blended into EMA', () => {
  const nodes = makeNodes([{ id: 'S', x: 50, y: 50, floor: 1 }]);
  const engine = makeEngine(nodes, 'S');
  engine._headingInitialized = true;
  engine.heading = 90;

  engine._onOrientEvent(makeOrientEvent(100)); // delta = 10
  const expected = 90 + 10 * 0.22;
  assert.ok(Math.abs(engine.heading - expected) < 0.01,
    `expected ${expected.toFixed(2)}, got ${engine.heading.toFixed(2)}`);
});

test('spike across 0/360 wrap is also rejected', () => {
  const nodes = makeNodes([{ id: 'S', x: 50, y: 50, floor: 1 }]);
  const engine = makeEngine(nodes, 'S');
  engine._headingInitialized = true;
  engine.heading = 10;

  // 320 from 10 -> shortestDelta = -50 -> |50| > 45 -> rejected
  engine._onOrientEvent(makeOrientEvent(320));
  assert.equal(engine.heading, 10,
    `heading should stay 10 after wrap-around spike, got ${engine.heading.toFixed(2)}`);
});

// ============================================================================
// TEST 3 — Gravity double-subtraction guard (_onMotionEvent)
// ============================================================================
console.log('\n── TEST 3: Gravity source branching (no double-subtraction) ──');

function fireMotionEvents(engine, event, n) {
  for (let i = 0; i < n; i++) engine._onMotionEvent(event);
  return engine._smoothedMagnitude;
}

test('acceleration-only source: smoothedMagnitude stays non-zero (no double-subtraction)', () => {
  const nodes = makeNodes([{ id: 'S', x: 50, y: 50, floor: 1 }]);
  const engine = makeEngine(nodes, 'S');

  const fakeMotion = {
    accelerationIncludingGravity: null,
    acceleration: { x: 1.5, y: 0.5, z: 1.2 }, // magnitude ~1.97 m/s^2
  };

  const smoothed = fireMotionEvents(engine, fakeMotion, 30);

  assert.ok(smoothed > 1.0,
    `magnitude should be >1.0; got ${smoothed.toFixed(4)}`);
});

test('acceleration-only source: gravity EMA stays at {0,0,0} (not updated)', () => {
  const nodes = makeNodes([{ id: 'S', x: 50, y: 50, floor: 1 }]);
  const engine = makeEngine(nodes, 'S');

  const fakeMotion = {
    accelerationIncludingGravity: null,
    acceleration: { x: 2.0, y: 1.0, z: 0.5 },
  };

  fireMotionEvents(engine, fakeMotion, 20);
  assert.deepEqual(engine._gravity, { x: 0, y: 0, z: 9.81 },
    'gravity EMA must stay at initial seeded vector {0,0,9.81} when using pre-compensated source');
});

test('accelerationIncludingGravity path: gravity EMA IS updated (regression check)', () => {
  const nodes = makeNodes([{ id: 'S', x: 50, y: 50, floor: 1 }]);
  const engine = makeEngine(nodes, 'S');

  const fakeMotion = {
    accelerationIncludingGravity: { x: 0.1, y: 0.2, z: -9.7 },
    acceleration: null,
  };

  fireMotionEvents(engine, fakeMotion, 50);

  assert.ok(engine._gravity.z < -5,
    `gravity EMA z should converge below -5; got ${engine._gravity.z.toFixed(4)}`);
});

test('accelerationIncludingGravity path: static phone yields near-zero linear magnitude', () => {
  const nodes = makeNodes([{ id: 'S', x: 50, y: 50, floor: 1 }]);
  const engine = makeEngine(nodes, 'S');

  const fakeMotion = {
    accelerationIncludingGravity: { x: 0, y: 0, z: -9.8 },
    acceleration: null,
  };

  const smoothed = fireMotionEvents(engine, fakeMotion, 200);
  assert.ok(smoothed < 0.5,
    `static phone magnitude should approach 0 after convergence; got ${smoothed.toFixed(4)}`);
});

// ============================================================================
// TEST 4 — Soft-clamp accumulator (_step)
// ============================================================================
console.log('\n── TEST 4: Soft-clamp accumulator (_step uses effectiveDist) ──');

function makeStepEngine(startX, headingDeg) {
  const nodes = makeNodes([{ id: 'S', x: startX, y: 50, floor: 1 }]);
  const engine = makeEngine(nodes, 'S');
  engine.heading = headingDeg;
  engine._headingInitialized = true;
  engine._gravityReadyAt = 0; // disable warmup guard
  return engine;
}

// With the coordinate frame fix, the standard formula applies directly:
// heading 90° (east) → dx = sin(90°)=+1 (east, +X direction).
// heading 0° (north) → dy = -cos(0°)=-1 (up, -Y direction), no X movement.
// Tests use heading=90 to push the dot eastward toward the x=100 boundary.

test('_step at boundary: position.x clamped to 100', () => {
  const engine = makeStepEngine(99, 90); // heading 90 (east) -> dx = +dist -> hits x=100
  engine._step(0.74);
  assert.ok(engine.position.x <= 100,
    `x should be <=100; got ${engine.position.x.toFixed(4)}`);
});

test('_step at boundary: _pdrDistanceSinceCheckpoint << deltaUnits when clamped', () => {
  const COORD_TO_METERS = 0.51;
  const stepLengthM = 0.74;
  const deltaUnits = stepLengthM / COORD_TO_METERS; // ~1.45

  // x=99.9, heading=90 (east): raw step pushes x to ~101.35, clamped to 100, effectiveDX≈0.1
  const engine = makeStepEngine(99.9, 90);
  engine._pdrDistanceSinceCheckpoint = 0;
  engine._step(stepLengthM);

  const accumulated = engine._pdrDistanceSinceCheckpoint;

  assert.ok(accumulated < deltaUnits * 0.5,
    `accumulated (${accumulated.toFixed(4)}) should be << deltaUnits (${deltaUnits.toFixed(4)}) when clamped`);
  assert.ok(accumulated >= 0, 'accumulated must not be negative');
});

test('_step mid-map (no clamping): accumulation equals deltaUnits exactly', () => {
  const COORD_TO_METERS = 0.51;
  const stepLengthM = 0.74;
  const deltaUnits = stepLengthM / COORD_TO_METERS;

  const engine = makeStepEngine(50, 90); // heading 90 (east), well inside boundary
  engine._pdrDistanceSinceCheckpoint = 0;
  engine._step(stepLengthM);

  const accumulated = engine._pdrDistanceSinceCheckpoint;
  assert.ok(Math.abs(accumulated - deltaUnits) < 1e-9,
    `expected ${deltaUnits.toFixed(4)}, got ${accumulated.toFixed(4)}`);
});

// ============================================================================
// TEST 5 — PATH_SNAP_RADIUS_UNITS constant sanity check
// ============================================================================
console.log('\n── TEST 5: PATH_SNAP_RADIUS_UNITS constant ──');

test('PATH_SNAP_RADIUS_UNITS === 3', () => {
  assert.equal(PATH_SNAP_RADIUS_UNITS, 3,
    `expected 3, got ${PATH_SNAP_RADIUS_UNITS} — may have been accidentally reverted`);
});

test('PATH_SNAP_RADIUS_UNITS * COORD_TO_METERS is between 1 and 2 m', () => {
  const COORD_TO_METERS = 0.51;
  const radiusM = PATH_SNAP_RADIUS_UNITS * COORD_TO_METERS;
  assert.ok(radiusM >= 1.0 && radiusM <= 2.0,
    `snap radius should be 1-2 m; got ${radiusM.toFixed(2)} m`);
});

// ============================================================================
// TEST 6 — Batch 2 fixes (reorientation guard, blend scaling, screen angle, offRoute reset)
// ============================================================================
console.log('\n── TEST 6: Batch 2 fixes (reorientation, blend scaling, screen angle, offRoute reset) ──');

test('reorientation >15° shifts warmup guard into the future', () => {
  const nodes = makeNodes([{ id: 'S', x: 50, y: 50, floor: 1 }]);
  const engine = makeEngine(nodes, 'S');

  // Initial gravity is (0, 0, 9.81). Provide a sudden orientation flip (9.81, 0, 0)
  const reorientEvent = {
    accelerationIncludingGravity: { x: 9.81, y: 0, z: 0 },
    acceleration: null,
  };

  const readyBefore = engine._gravityReadyAt;
  engine._onMotionEvent(reorientEvent);
  const readyAfter = engine._gravityReadyAt;

  assert.ok(readyAfter > readyBefore,
    `reorientation should push _gravityReadyAt into future; was ${readyBefore}, now ${readyAfter}`);
});

test('blend weight is 0.35 for short segments (<15 steps) and 0.6 for long segments (>=15 steps)', () => {
  const nodes = makeNodes([
    { id: 'A', x: 0,  y: 0,  floor: 1 },
    { id: 'B', x: 10, y: 0,  floor: 1 },
    { id: 'C', x: 20, y: 0,  floor: 1 },
  ]);
  const engine = makeEngine(nodes, 'A');
  engine.setPath([
    { id: 'A', coords: [0,  0], floor: 1 },
    { id: 'B', coords: [10, 0], floor: 1 },
    { id: 'C', coords: [20, 0], floor: 1 },
  ]);

  // Short segment (< 15 steps): 10 steps, PDR estimated 8 units vs real 10 units
  engine._prevCheckpointId = 'A';
  engine._pdrDistanceSinceCheckpoint = 8; // pdr estimated 8
  engine._stepsSinceCheckpoint = 10;     // 10 steps < 15
  engine.stepLengthM = 0.74;

  engine.resetToCheckpoint('B');
  // rawFactor = 10 / 8 = 1.25. blendWeight = 0.35. blendedFactor = 1 + 0.25*0.35 = 1.0875.
  // newStepLength = 0.74 * 1.0875 = 0.80475
  const shortResult = engine.stepLengthM;

  // Long segment (>= 15 steps): 20 steps, PDR estimated 8 units vs real 10 units
  engine._prevCheckpointId = 'B';
  engine._pdrDistanceSinceCheckpoint = 8;
  engine._stepsSinceCheckpoint = 20;     // 20 steps >= 15
  engine.stepLengthM = 0.74;

  engine.resetToCheckpoint('C');
  // rawFactor = 10 / 8 = 1.25. blendWeight = 0.60. blendedFactor = 1 + 0.25*0.60 = 1.15.
  // newStepLength = 0.74 * 1.15 = 0.851
  const longResult = engine.stepLengthM;

  assert.ok(shortResult < longResult,
    `short segment correction (${shortResult.toFixed(4)}) should be gentler than long segment correction (${longResult.toFixed(4)})`);
});

test('resetToCheckpoint resets _isOffRoute to false', () => {
  const nodes = makeNodes([{ id: 'S', x: 50, y: 50, floor: 1 }]);
  const engine = makeEngine(nodes, 'S');
  engine._isOffRoute = true;
  engine.resetToCheckpoint('S');
  assert.equal(engine._isOffRoute, false, 'resetToCheckpoint should reset _isOffRoute to false');
});

// ============================================================================
// TEST 7 — Option A: Wrong-way detection & stepSimulated
// ============================================================================
console.log('\n── TEST 7: Option A (wrong-way detection & stepSimulated) ──');

test('walking 180° opposite route segment triggers isWrongWay after 2 steps', () => {
  const nodes = makeNodes([
    { id: 'A', x: 0,  y: 50, floor: 1 },
    { id: 'B', x: 50, y: 50, floor: 1 }, // segment A->B moves in +X direction (heading=360°/0° north raw -> adjusted=90° East)
  ]);
  const engine = makeEngine(nodes, 'A');
  engine.setPath([
    { id: 'A', coords: [0,  50], floor: 1 },
    { id: 'B', coords: [50, 50], floor: 1 },
  ]);

  // Heading 0° raw = 90° adjusted (East = aligned with segment A->B).
  // Simulate step facing 180° raw (heading 180° = West = 180° opposite segment)
  engine.heading = 180;
  engine._headingInitialized = true;
  engine._gravityReadyAt = 0;

  // Step 1 wrong direction
  engine.stepSimulated({ stepLengthM: 0.74 });
  assert.equal(engine._isWrongWay, false, '1 step wrong way shouldn’t trip flag yet');

  // Step 2 wrong direction
  engine.stepSimulated({ stepLengthM: 0.74 });
  assert.equal(engine._isWrongWay, true, '2 consecutive steps wrong way must trigger _isWrongWay: true');
});

// ============================================================================
// Summary
// ============================================================================
console.log(`\n${'─'.repeat(55)}`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('  Some tests failed.');
  process.exit(1);
} else {
  console.log('  All tests passed.');
}

