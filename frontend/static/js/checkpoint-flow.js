/**
 * Checkpoint progression rules, separated from the DOM so floor-transition
 * behaviour can be tested independently of the UI.
 */

/**
 * Builds the next checkpoint state after the user confirms one checkpoint.
 *
 * A floor confirmation means the user has reached both sides of a vertical
 * transition: the departure stairs/lift and the arrival landing. The landing
 * remains the PDR anchor, while the next ordinary checkpoint becomes active.
 */
export function getCheckpointAdvancePlan({ checkpoints, currentIndex, arrivalConfirmed = false }) {
  const reached = checkpoints?.[currentIndex];
  const arrivalIndex = currentIndex + 1;
  const arrival = checkpoints?.[arrivalIndex];
  if (!reached || !arrival) return null;

  const isFloorTransition = reached.floor !== arrival.floor;
  const consumesArrival = Boolean(arrivalConfirmed && isFloorTransition);
  const anchorIndex = consumesArrival ? arrivalIndex : currentIndex;
  const visualProgressIndex = anchorIndex;
  const nextActiveIndex = consumesArrival && arrivalIndex < checkpoints.length - 1
    ? arrivalIndex + 1
    : arrivalIndex;

  return {
    reachedIndex: currentIndex,
    arrivalIndex,
    anchorIndex,
    visualProgressIndex,
    nextActiveIndex,
    isFloorTransition,
    confirmedIndices: consumesArrival ? [currentIndex, arrivalIndex] : [currentIndex],
  };
}

/** Returns every checkpoint that belongs on a given floor map. */
export function getCheckpointMarkersForFloor(checkpoints, floor) {
  if (!Array.isArray(checkpoints)) return [];
  return checkpoints.filter(checkpoint => checkpoint?.floor === floor);
}

/**
 * Returns the initial stair/lift transition pair when a route starts directly
 * at a vertical node. The ordinary checkpoint scan begins at index 1, so this
 * explicit check preserves the otherwise skipped index 0 → 1 floor change.
 */
export function getStartTransitionCheckpoints(logicalPath, getNodeType) {
  const start = logicalPath?.[0];
  const arrival = logicalPath?.[1];
  if (!start || !arrival || start.floor === arrival.floor) return [];

  const type = getNodeType?.(start.id);
  return type === 'stairs' || type === 'lift' ? [start, arrival] : [];
}
