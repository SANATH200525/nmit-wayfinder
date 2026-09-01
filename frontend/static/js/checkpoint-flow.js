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
