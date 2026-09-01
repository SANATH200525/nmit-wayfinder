import assert from 'node:assert/strict';
import {
  getCheckpointAdvancePlan,
  getCheckpointMarkersForFloor,
  getStartTransitionCheckpoints,
} from '../frontend/static/js/checkpoint-flow.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (error) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${error.message}`);
    failed++;
  }
}

const firstFloorRoute = [
  { id: 'STAIRS-GF', floor: 1 },
  { id: 'STAIRS-FF', floor: 2 },
  { id: 'FIRST-FLOOR-CHECKPOINT', floor: 2 },
  { id: 'DESTINATION-FF', floor: 2 },
];

console.log('\n── Checkpoint floor-transition flow ──');

test('first-floor confirmation consumes the stair landing and targets the next checkpoint', () => {
  const plan = getCheckpointAdvancePlan({
    checkpoints: firstFloorRoute,
    currentIndex: 0,
    arrivalConfirmed: true,
  });

  assert.equal(plan.anchorIndex, 1, 'pointer must remain anchored at the first-floor landing');
  assert.equal(plan.nextActiveIndex, 2, 'next button target must be the first real first-floor checkpoint');
  assert.deepEqual(plan.confirmedIndices, [0, 1], 'both sides of the stairs are confirmed together');
});

test('the same rule applies to every lift or stair floor transition', () => {
  const route = [
    { id: 'LIFT-FF', floor: 2 },
    { id: 'LIFT-SF', floor: 3 },
    { id: 'SECOND-FLOOR-CHECKPOINT', floor: 3 },
  ];
  const plan = getCheckpointAdvancePlan({ checkpoints: route, currentIndex: 0, arrivalConfirmed: true });

  assert.equal(plan.anchorIndex, 1);
  assert.equal(plan.nextActiveIndex, 2);
  assert.equal(plan.isFloorTransition, true);
});

test('arrival at a floor-transition destination keeps Finish Navigation active', () => {
  const route = [
    { id: 'STAIRS-GF', floor: 1 },
    { id: 'STAIRS-FF', floor: 2 },
  ];
  const plan = getCheckpointAdvancePlan({ checkpoints: route, currentIndex: 0, arrivalConfirmed: true });

  assert.equal(plan.anchorIndex, 1);
  assert.equal(plan.nextActiveIndex, 1, 'the final landing remains selected so the UI shows Finish Navigation');
});

test('ordinary same-floor checkpoints still advance one checkpoint at a time', () => {
  const plan = getCheckpointAdvancePlan({ checkpoints: firstFloorRoute, currentIndex: 2 });

  assert.equal(plan.anchorIndex, 2);
  assert.equal(plan.nextActiveIndex, 3);
  assert.deepEqual(plan.confirmedIndices, [2]);
});

test('every checkpoint on a floor is returned for purple marker rendering', () => {
  const markers = getCheckpointMarkersForFloor(firstFloorRoute, 2);
  assert.deepEqual(markers.map(marker => marker.id), [
    'STAIRS-FF',
    'FIRST-FLOOR-CHECKPOINT',
    'DESTINATION-FF',
  ]);
});

test('a route starting at stairs registers the departure and arrival as its first checkpoints', () => {
  const route = [
    { id: 'STAIRS-GF', floor: 1 },
    { id: 'STAIRS-FF', floor: 2 },
    { id: 'FIRST-FLOOR-CHECKPOINT', floor: 2 },
  ];
  const initial = getStartTransitionCheckpoints(route, id => id.startsWith('STAIRS') ? 'stairs' : 'room');
  assert.deepEqual(initial.map(checkpoint => checkpoint.id), ['STAIRS-GF', 'STAIRS-FF']);

  const plan = getCheckpointAdvancePlan({ checkpoints: [...initial, route[2]], currentIndex: 0, arrivalConfirmed: true });
  assert.equal(plan.nextActiveIndex, 2, 'confirmation must move on to the first real checkpoint');
});

test('a route starting at a lift receives the same immediate floor-confirmation pair', () => {
  const route = [
    { id: 'LIFT-FF', floor: 2 },
    { id: 'LIFT-SF', floor: 3 },
  ];
  const initial = getStartTransitionCheckpoints(route, () => 'lift');
  assert.deepEqual(initial.map(checkpoint => checkpoint.id), ['LIFT-FF', 'LIFT-SF']);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
