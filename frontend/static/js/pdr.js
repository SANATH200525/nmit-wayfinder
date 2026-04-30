const COORD_TO_METERS = 0.5;
const DEFAULT_STEP_LENGTH_M = 0.72;
const MIN_STEP_INTERVAL_MS = 380;
const STEP_ACCEL_THRESHOLD = 1.18;
const HEADING_SMOOTHING = 0.22;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHeading(value) {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function shortestHeadingDelta(from, to) {
  return ((to - from + 540) % 360) - 180;
}

function extractHeading(event) {
  if (typeof event.webkitCompassHeading === 'number' && Number.isFinite(event.webkitCompassHeading)) {
    return normalizeHeading(event.webkitCompassHeading);
  }
  if (typeof event.alpha === 'number' && Number.isFinite(event.alpha)) {
    return normalizeHeading(360 - event.alpha);
  }
  return null;
}

async function requestSensorPermission(sensorEvent) {
  if (typeof sensorEvent?.requestPermission !== 'function') {
    return { granted: true, required: false };
  }
  try {
    const result = await sensorEvent.requestPermission();
    return { granted: result === 'granted', required: true };
  } catch (error) {
    return { granted: false, required: true, error };
  }
}

export function getPDRSupportState() {
  const hasWindow = typeof window !== 'undefined';
  const motionEvent = hasWindow ? window.DeviceMotionEvent : undefined;
  const orientationEvent = hasWindow ? window.DeviceOrientationEvent : undefined;

  return {
    motionSupported: typeof motionEvent !== 'undefined',
    orientationSupported: typeof orientationEvent !== 'undefined',
    permissionRequired:
      typeof motionEvent?.requestPermission === 'function' ||
      typeof orientationEvent?.requestPermission === 'function',
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

    const startData = nodes[startNode];
    this.position = { x: startData.coords[0], y: startData.coords[1] };
    this.floor = startData.floor;
    this.heading = 0;
    this.stepLengthM = DEFAULT_STEP_LENGTH_M;
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
    if (this.active) return { started: true, reason: 'already_active' };

    const support = getPDRSupportState();
    if (!support.motionSupported || !support.orientationSupported) {
      return { started: false, reason: 'unsupported', support };
    }

    const motionPerm = await requestSensorPermission(window.DeviceMotionEvent);
    if (!motionPerm.granted) {
      return { started: false, reason: 'motion_permission_denied', support, error: motionPerm.error };
    }

    const orientationPerm = await requestSensorPermission(window.DeviceOrientationEvent);
    if (!orientationPerm.granted) {
      return { started: false, reason: 'orientation_permission_denied', support, error: orientationPerm.error };
    }

    window.addEventListener('devicemotion', this._motionHandler, { passive: true });
    window.addEventListener('deviceorientation', this._orientHandler, { passive: true });

    this.active = true;
    this._report();
    return { started: true, support };
  }

  stop() {
    window.removeEventListener('devicemotion', this._motionHandler);
    window.removeEventListener('deviceorientation', this._orientHandler);
    this.active = false;
  }

  resetToCheckpoint(nodeId) {
    const node = this._nodes[nodeId];
    if (!node) return;
    const previousFloor = this.floor;
    this.position = { x: node.coords[0], y: node.coords[1] };
    this.floor = node.floor;
    this.confidence = 1.0;
    if (previousFloor !== this.floor && this._onFloorChange) {
      this._onFloorChange({ fromFloor: previousFloor, toFloor: this.floor, transitionNode: nodeId });
    }
    this._report();
  }

  _onMotionEvent(event) {
    const source = event.accelerationIncludingGravity || event.acceleration;
    if (!source) return;

    const x = Number.isFinite(source.x) ? source.x : 0;
    const y = Number.isFinite(source.y) ? source.y : 0;
    const z = Number.isFinite(source.z) ? source.z : 0;

    this._gravity.x = (this._gravity.x * 0.82) + (x * 0.18);
    this._gravity.y = (this._gravity.y * 0.82) + (y * 0.18);
    this._gravity.z = (this._gravity.z * 0.82) + (z * 0.18);

    const linearX = x - this._gravity.x;
    const linearY = y - this._gravity.y;
    const linearZ = z - this._gravity.z;
    const magnitude = Math.sqrt((linearX ** 2) + (linearY ** 2) + (linearZ ** 2));
    this._smoothedMagnitude = (this._smoothedMagnitude * 0.68) + (magnitude * 0.32);

    const now = Date.now();
    const crossedThreshold =
      this._smoothedMagnitude >= STEP_ACCEL_THRESHOLD &&
      this._previousMagnitude < STEP_ACCEL_THRESHOLD;

    if (crossedThreshold && (now - this._lastStepTime) >= MIN_STEP_INTERVAL_MS) {
      const intensityBoost = clamp((this._smoothedMagnitude - STEP_ACCEL_THRESHOLD) * 0.08, 0, 0.18);
      this._lastStepTime = now;
      this._step(clamp(this.stepLengthM + intensityBoost, 0.55, 0.9));
    }

    this._previousMagnitude = this._smoothedMagnitude;
  }

  _onOrientEvent(event) {
    const rawHeading = extractHeading(event);
    if (rawHeading === null) return;

    if (!this._headingInitialized) {
      this.heading = rawHeading;
      this._headingInitialized = true;
      this._report();
      return;
    }

    const delta = shortestHeadingDelta(this.heading, rawHeading);
    this.heading = normalizeHeading(this.heading + (delta * HEADING_SMOOTHING));

    const now = Date.now();
    if (Math.abs(delta) >= 1.5 || (now - this._lastHeadingReportTime) > 160) {
      this._lastHeadingReportTime = now;
      this._report();
    }
  }

  _step(stepLengthM = this.stepLengthM) {
    const radians = (this.heading * Math.PI) / 180;
    const delta = stepLengthM / COORD_TO_METERS;
    this.position.x = clamp(this.position.x + (delta * Math.sin(radians)), 0, 100);
    this.position.y = clamp(this.position.y - (delta * Math.cos(radians)), 0, 100);
    this.stepCount += 1;
    this.confidence = Math.max(0.08, this.confidence * 0.988);
    this._report();
  }

  _report() {
    const nearest = this._nearestNode();
    const update = {
      x: this.position.x,
      y: this.position.y,
      floor: this.floor,
      nearestNode: nearest.id,
      distanceM: nearest.distM,
      confidence: this.confidence,
      heading: this.heading,
      stepCount: this.stepCount,
      active: this.active,
    };
    if (this._onUpdate) this._onUpdate(update);
    this._postObservation(update);
  }

  _nearestNode() {
    let best = { id: null, distM: Infinity };
    for (const [id, data] of Object.entries(this._nodes)) {
      if (data.floor !== this.floor) continue;
      const dx = (data.coords[0] - this.position.x) * COORD_TO_METERS;
      const dy = (data.coords[1] - this.position.y) * COORD_TO_METERS;
      const distance = Math.sqrt((dx ** 2) + (dy ** 2));
      if (distance < best.distM) best = { id, distM: distance };
    }
    return best;
  }

  async _postObservation(update) {
    if (!this._sessionId) return;
    const now = Date.now();
    if ((now - this._lastPostTime) < 2000) return;
    this._lastPostTime = now;

    try {
      fetch('/session/pdr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: this._sessionId,
          timestamp: new Date().toISOString(),
          estimated_x: update.x,
          estimated_y: update.y,
          floor: update.floor,
          nearest_node: update.nearestNode,
          distance_to_nearest_m: update.distanceM,
          confidence: update.confidence,
        }),
      });
    } catch {
      // Best-effort telemetry only.
    }
  }
}
