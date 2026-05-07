export function getPDRSupportState() {
  return {
    motionSupported: false,
    orientationSupported: false,
    permissionRequired: false,
  };
}

export class PDREngine {
  constructor({ startNode, nodes, graph, onPositionUpdate, onFloorChange, sessionId }) {
    this._nodes = nodes;
    this._graph = graph;
    this._onUpdate = onPositionUpdate;
    this._onFloorChange = onFloorChange;
    this._sessionId = sessionId;
    this._lastPostTime = 0;
    this._lastHeadingReportTime = 0;

    const startData = nodes && startNode ? nodes[startNode] : null;
    this.position = startData ? { x: startData.coords[0], y: startData.coords[1] } : { x: 0, y: 0 };
    this.floor = startData ? startData.floor : 1;
    this.heading = 0;
    this.stepLengthM = 0.74; // DEFAULT_STEP_LENGTH_M
    this.confidence = 1.0;
    this.stepCount = 0;
    this.active = false;

    this._gravity = { x: 0, y: 0, z: 0 };
    this._smoothedMagnitude = 0;
    this._previousMagnitude = 0;
    this._lastStepTime = 0;
    this._headingInitialized = false;

    this._motionHandler = this._onMotionEvent.bind(this);
    this._orientHandler = this._onOrientEvent.bind(this);
  }

  async start() {
    return { started: false, reason: 'unsupported', support: getPDRSupportState() };
  }

  stop() {
    this.active = false;
  }

  resetToCheckpoint(nodeId) {
    // No-op
  }

  _onMotionEvent(event) {
    // No-op
  }

  _onOrientEvent(event) {
    // No-op
  }

  _step(stepLengthM = this.stepLengthM) {
    // No-op
  }

  _report() {
    // No-op
  }

  _nearestNode() {
    return { id: null, distM: Infinity };
  }

  async _postObservation(update) {
    // No-op
  }
}
