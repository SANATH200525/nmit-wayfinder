const COORD_TO_METERS = 0.51;
const DEFAULT_STEP_LENGTH_M = 0.74;
const MIN_STEP_INTERVAL_MS = 450;
const STEP_ACCEL_THRESHOLD = 1.45;
const HEADING_SMOOTHING = 0.22;
const OFF_ROUTE_ANGLE_THRESHOLD = 50;  // degrees
const OFF_ROUTE_COUNTER_THRESHOLD = 5; // consecutive bad steps before flagging

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

// ---------------------------------------------------------------------------
// Helpers for 1D path interpolation
// ---------------------------------------------------------------------------

/**
 * Build a cumulative arc-length array (in metres) over the route polyline.
 * Each entry is the total distance from the start to that path node.
 */
function buildPathDistances(path) {
  const dists = [0];
  for (let i = 1; i < path.length; i++) {
    const dx = (path[i].x - path[i - 1].x) * COORD_TO_METERS;
    const dy = (path[i].y - path[i - 1].y) * COORD_TO_METERS;
    dists.push(dists[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  return dists;
}

/**
 * Given a cumulative distance along the route, return the interpolated
 * {x, y, floor} and the compass bearing of the current segment.
 */
function interpolateAlongPath(path, cumDists, distM) {
  const totalM = cumDists[cumDists.length - 1];
  const clampedDist = clamp(distM, 0, totalM);

  // Find the segment that contains clampedDist
  let seg = cumDists.length - 2;
  for (let i = 0; i < cumDists.length - 1; i++) {
    if (clampedDist <= cumDists[i + 1]) {
      seg = i;
      break;
    }
  }

  const segLen = cumDists[seg + 1] - cumDists[seg];
  const t = segLen > 0 ? (clampedDist - cumDists[seg]) / segLen : 0;

  const a = path[seg];
  const b = path[seg + 1];
  const x = a.x + t * (b.x - a.x);
  const y = a.y + t * (b.y - a.y);
  const floor = t < 0.5 ? a.floor : b.floor;

  // Bearing of this segment in degrees (north-up, clockwise)
  const dxPx = b.x - a.x;
  const dyPx = b.y - a.y;
  // SVG y increases downward; atan2(dx, -dy) gives compass bearing
  const bearingRad = Math.atan2(dxPx, -dyPx);
  const bearing = normalizeHeading((bearingRad * 180) / Math.PI);

  return { x, y, floor, bearing };
}

/**
 * Return the cumulative distance (metres) from the start of the route to
 * the first occurrence of nodeId in the path array.
 */
function distanceToNode(path, cumDists, nodeId) {
  const idx = path.findIndex(p => p.id === nodeId);
  if (idx < 0) return 0;
  return cumDists[idx];
}

// ---------------------------------------------------------------------------
// PDREngine
// ---------------------------------------------------------------------------
export class PDREngine {
  constructor({ startNode, nodes, graph, onPositionUpdate, onFloorChange, sessionId, path = [] }) {
    this._nodes = nodes;
    this._graph = graph;
    this._onUpdate = onPositionUpdate;
    this._onFloorChange = onFloorChange;
    this._sessionId = sessionId;
    this._lastPostTime = 0;
    this._lastHeadingReportTime = 0;

    // 1-D path-snapping state
    this._path = path;
    this._cumDists = path.length > 1 ? buildPathDistances(path) : [0];
    this._pathDistanceM = 0;

    // Off-route detection
    this.offRouteCounter = 0;
    this.isOffRoute = false;

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

    // Snap the 1-D cursor to the exact arc-length position of this checkpoint
    this._pathDistanceM = distanceToNode(this._path, this._cumDists, nodeId);

    this.position = { x: node.coords[0], y: node.coords[1] };
    this.floor = node.floor;
    this.confidence = 1.0;
    this.offRouteCounter = 0;
    this.isOffRoute = false;

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

    // Track compass heading for UI rotation display only; no X/Y math here
    const delta = shortestHeadingDelta(this.heading, rawHeading);
    this.heading = normalizeHeading(this.heading + (delta * HEADING_SMOOTHING));

    const now = Date.now();
    if (Math.abs(delta) >= 1.5 || (now - this._lastHeadingReportTime) > 160) {
      this._lastHeadingReportTime = now;
      this._report();
    }
  }

  _step(stepLengthM = this.stepLengthM) {
    // 1-D path snapping: advance the cursor along the route polyline
    this._pathDistanceM += stepLengthM;

    if (this._path.length > 1) {
      const { x, y, floor, bearing } = interpolateAlongPath(
        this._path, this._cumDists, this._pathDistanceM
      );

      const previousFloor = this.floor;
      this.position.x = x;
      this.position.y = y;
      this.floor = floor;

      if (previousFloor !== floor && this._onFloorChange) {
        this._onFloorChange({ fromFloor: previousFloor, toFloor: floor });
      }

      // Off-route detection: compare physical compass to required segment bearing
      if (this._headingInitialized) {
        const angleDiff = Math.abs(shortestHeadingDelta(this.heading, bearing));
        if (angleDiff > OFF_ROUTE_ANGLE_THRESHOLD) {
          this.offRouteCounter++;
          if (this.offRouteCounter >= OFF_ROUTE_COUNTER_THRESHOLD) {
            this.isOffRoute = true;
          }
        } else {
          this.offRouteCounter = 0;
          this.isOffRoute = false;
        }
      }
    }

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
      isOffRoute: this.isOffRoute,
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
