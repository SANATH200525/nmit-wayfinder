/**
 * pdr.js — Pedestrian Dead Reckoning engine for NMIT Wayfinder
 *
 * Architecture (5 layers):
 *   1. Sensor input       — DeviceMotionEvent + DeviceOrientationEvent
 *   2. Step detection     — gravity filter (with warmup guard) → peak detector → dynamic step length
 *   3. Heading anchoring  — magnetic compass → SVG coordinate delta via MAP_CORRIDOR_BEARING_DEG
 *   4. Path projection    — raw PDR position snapped to nearest planned-path segment
 *   5. Checkpoint calibration — stepLengthM self-corrects on every confirmed checkpoint
 *
 * Public API (unchanged from previous version — app.js needs zero changes):
 *   new PDREngine({ startNode, nodes, graph, onPositionUpdate, onFloorChange, sessionId })
 *   engine.start()                   → Promise<{ started, reason?, support, error? }>
 *   engine.stop()
 *   engine.resetToCheckpoint(nodeId) → void
 *   engine.setPath(pathNodes)        → void  ← NEW: call this whenever pathData changes
 *   getPDRSupportState()             → { motionSupported, orientationSupported, permissionRequired }
 *
 * Backward compatibility note:
 *   setPath() is additive — if never called, path projection is simply skipped.
 *   All existing constructor args and callback shapes are preserved exactly.
 */

// ---------------------------------------------------------------------------
// Constants — tweak here, nowhere else
// ---------------------------------------------------------------------------

/**
 * MAP_CORRIDOR_BEARING_DEG
 * The magnetic compass bearing (0–360°) you face when walking from the main
 * entrance toward the far end of the main corridor (into the building, westward).
 * Measured physically at NMIT main entrance: 270° (due west).
 *
 * HOW THIS IS USED:
 *   SVG uses standard screen axes: X increases right, Y increases downward.
 *   Magnetic north (0°) maps to "up" on screen, i.e. negative-Y direction.
 *   When the user faces MAP_CORRIDOR_BEARING_DEG (270°, west), they are moving
 *   in the negative-X direction on the SVG (left across the screen).
 *   The conversion is:
 *     svgAngle = compassHeading - MAP_CORRIDOR_BEARING_DEG + 270  (mod 360)
 *   which rotates the coordinate frame so that the corridor axis is +X.
 *   See _compassToSVGDelta() for the full derivation.
 */
const MAP_CORRIDOR_BEARING_DEG = 270;

/**
 * COORD_TO_METERS
 * One SVG percentage unit equals this many meters on the NMIT floor plan.
 * Carried over from original — do not change without re-surveying.
 */
const COORD_TO_METERS = 0.51;

/**
 * Default step length before any calibration. Typical adult walking gait.
 * NOTE: stepLengthM resets to this default on every new PDREngine instance
 * (i.e. every new route in app.js creates a fresh engine), so calibration
 * does not currently persist across multiple routes within one session.
 * This is accepted behavior for the current single-destination use case.
 */
const DEFAULT_STEP_LENGTH_M = 0.74;

/**
 * Minimum milliseconds between two registered steps. Prevents double-counting.
 * 300 ms corresponds to ~200 steps/min max cadence. Normal walking pace
 * (100–120 spm, 500–600 ms gap) is unaffected either way.
 */
const MIN_STEP_INTERVAL_MS = 300;

/**
 * STEP_ACCEL_THRESHOLD
 * Linear acceleration magnitude (m/s²) that must be crossed to register a step.
 * Calibrated for phone held in hand or pocket, normal walking pace.
 */
const STEP_ACCEL_THRESHOLD = 1.18;

/** Heading smoothing factor. Lower = smoother but slower to respond. */
const HEADING_SMOOTHING = 0.22;

/**
 * GRAVITY_WARMUP_MS
 * Ignore step events for this long after start() to let the gravity EMA settle.
 * At 0.82/0.18 coefficients and ~50Hz sensor rate, filter takes ~500ms to stabilize.
 * 1500ms gives comfortable 3× margin.
 */
const GRAVITY_WARMUP_MS = 1500;

/** Confidence multiplier per step. After ~400 steps with no checkpoint → 0.08 floor. */
const CONFIDENCE_DECAY = 0.988;

/** Hard floor on confidence — below this, always show the drift warning. */
const CONFIDENCE_FLOOR = 0.08;

/** Show "recalibrate" prompt when confidence drops below this. */
const CONFIDENCE_WARN_THRESHOLD = 0.25;

/**
 * PATH_SNAP_RADIUS_UNITS
 * Maximum distance (SVG units) from planned path before projection is skipped.
 * Set to approximately one corridor half-width:
 *   NMIT main corridor ≈ 3.25 m wide → half-width ≈ 1.625 m
 *   1.625 m / COORD_TO_METERS (0.51 m/unit) ≈ 3.2 → rounded to 3
 * At 8 (the old value ≈ 4.1 m) users standing a full metre inside an adjacent
 * room were still silently snapped to the corridor, masking real off-route events.
 * If testing reveals false off-route warnings during normal walking, raise to 4
 * and re-evaluate — do NOT revert to 8.
 */
const PATH_SNAP_RADIUS_UNITS = 3; // ~1.5 m — one corridor half-width

/** Minimum and maximum allowed stepLengthM after calibration adjustment. */
const STEP_LENGTH_MIN_M = 0.45;
const STEP_LENGTH_MAX_M = 1.10;

/** POST /session/pdr at most once per this many ms to avoid flooding. */
const POST_THROTTLE_MS = 2000;

/** POST /session/pdr immediately on these event types regardless of throttle. */
const POST_IMMEDIATE_EVENTS = new Set(['calibration', 'error', 'drift_warning']);

/**
 * PDR_DEBUG
 * Set to true to enable console logging inside _step() for walk-testing.
 * Logs: raw heading, adjusted heading, rawPos pre-snap, final snapped position,
 * path node count, and isOffRoute. Remove or set false before shipping.
 */
const PDR_DEBUG = true;

// ---------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------

/**
 * Clamps a number between min and max (inclusive).
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Normalises a compass bearing to [0, 360).
 * @param {number} value
 * @returns {number}
 */
function normalizeHeading(value) {
  const n = value % 360;
  return n < 0 ? n + 360 : n;
}

/**
 * Returns the shortest angular delta from `from` to `to`, in range [-180, 180].
 * Used for smooth heading interpolation across the 359→0 wrap boundary.
 * @param {number} from
 * @param {number} to
 * @returns {number}
 */
function shortestHeadingDelta(from, to) {
  return ((to - from + 540) % 360) - 180;
}

/**
 * Extracts a normalised compass heading from a DeviceOrientationEvent.
 *
 * Two paths:
 *   - iOS/Safari: event.webkitCompassHeading is magnetic north (0 = north, CW).
 *   - Android/Chrome: event.alpha is device rotation from north (0 = north, CCW),
 *     so we invert it: heading = 360 - alpha.
 *
 * Returns null if neither value is a finite number (sensor not ready yet).
 * @param {DeviceOrientationEvent} event
 * @returns {number|null}
 */
function extractHeading(event) {
  if (typeof event.webkitCompassHeading === 'number' && Number.isFinite(event.webkitCompassHeading)) {
    return normalizeHeading(event.webkitCompassHeading);
  }
  if (typeof event.alpha === 'number' && Number.isFinite(event.alpha)) {
    const screenAngle = (typeof window !== 'undefined' && window.screen && window.screen.orientation && typeof window.screen.orientation.angle === 'number')
      ? window.screen.orientation.angle
      : 0;
    return normalizeHeading(360 - event.alpha - screenAngle);
  }
  return null;
}

/**
 * Finds the closest point on the line segment [a, b] to point p.
 * All arguments and return value are { x, y } objects.
 *
 * MATH:
 *   Project p onto the infinite line through a→b using the scalar parameter t:
 *     t = dot(p - a, b - a) / |b - a|²
 *   Clamp t to [0, 1] to stay on the segment, then return a + t*(b - a).
 *
 * @param {{ x: number, y: number }} p
 * @param {{ x: number, y: number }} a  — segment start
 * @param {{ x: number, y: number }} b  — segment end
 * @returns {{ x: number, y: number }}
 */
function closestPointOnSegment(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;

  // Degenerate segment (a === b): return a.
  if (lenSq < 1e-10) return { x: a.x, y: a.y };

  const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq, 0, 1);
  return { x: a.x + t * abx, y: a.y + t * aby };
}

/**
 * Euclidean distance between two { x, y } points.
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 * @returns {number}
 */
function dist2D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ---------------------------------------------------------------------------
// Sensor permission helper
// ---------------------------------------------------------------------------

/**
 * Requests sensor permission on iOS 13+ (where DeviceMotionEvent.requestPermission exists).
 * On Android/other platforms the API is absent, so permission is implicitly granted.
 *
 * @param {typeof DeviceMotionEvent | typeof DeviceOrientationEvent} sensorEvent
 * @returns {Promise<{ granted: boolean, required: boolean, error?: Error }>}
 */
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

// ---------------------------------------------------------------------------
// Public: support detection
// ---------------------------------------------------------------------------

/**
 * Returns the static sensor support state of the current browser/device.
 * Call this before instantiating PDREngine to decide whether to offer PDR.
 *
 * @returns {{ motionSupported: boolean, orientationSupported: boolean, permissionRequired: boolean }}
 */
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
// PDREngine
// ---------------------------------------------------------------------------

export class PDREngine {
  /**
   * @param {object} opts
   * @param {string}   opts.startNode        — Node ID for initial position
   * @param {object}   opts.nodes            — NODES map: id → { coords, floor, label, ... }
   * @param {object}   opts.graph            — Adjacency list: id → string[]
   * @param {Function} opts.onPositionUpdate — Called with update object on every position change
   * @param {Function} opts.onFloorChange    — Called with { fromFloor, toFloor, transitionNode }
   * @param {string}   opts.sessionId        — Session ID for telemetry POSTs
   */
  constructor({ startNode, nodes, graph, onPositionUpdate, onFloorChange, sessionId }) {
    // ── External references ──────────────────────────────────────────────
    this._nodes = nodes;
    this._graph = graph;
    this._onUpdate = onPositionUpdate;
    this._onFloorChange = onFloorChange;
    this._sessionId = sessionId;

    // ── Public state (readable by app.js) ────────────────────────────────
    // Note: stepLengthM resets to DEFAULT_STEP_LENGTH_M for each new instance.
    const startData = nodes[startNode];
    this.position = { x: startData.coords[0], y: startData.coords[1] };
    this.floor = startData.floor;
    this.heading = 0;
    this.stepLengthM = DEFAULT_STEP_LENGTH_M;
    this.confidence = 1.0;
    this.stepCount = 0;
    this.active = false;

    // ── Gravity EMA filter state ─────────────────────────────────────────
    // Seeded at 9.81 m/s² (earth gravity) on Z axis so warmup convergence
    // starts from a realistic baseline instead of zero.
    this._gravity = { x: 0, y: 0, z: 9.81 };
    this._smoothedMagnitude = 0;
    this._previousMagnitude = 0;
    this._lastStepTime = 0;

    // ── Warmup guard ─────────────────────────────────────────────────────
    // Steps are ignored until this timestamp. Set to future on start().
    this._gravityReadyAt = 0;

    // ── Heading state ────────────────────────────────────────────────────
    this._headingInitialized = false;
    this._lastHeadingReportTime = 0;

    // ── Path projection state ────────────────────────────────────────────
    // Array of { x, y, floor } objects for the current planned path.
    // Segments are only used if both endpoints share the same floor.
    this._pathNodes = [];

    // ── Calibration state ────────────────────────────────────────────────
    // We accumulate the PDR-estimated distance since the last checkpoint
    // so that when the user confirms a checkpoint we can compare it to
    // the known graph distance and correct stepLengthM.
    this._pdrDistanceSinceCheckpoint = 0;  // SVG units
    this._stepsSinceCheckpoint = 0;
    // Node ID of the most recently confirmed checkpoint, used by
    // _pathDistanceBetween() to compute the graph-path reference distance
    // for calibration. Null means no checkpoint has been confirmed yet this
    // session — first calibration falls back to Euclidean distance.
    this._prevCheckpointId = null;

    // ── Telemetry throttle ───────────────────────────────────────────────
    this._lastPostTime = 0;

    // ── Drift warning state ──────────────────────────────────────────────
    // Tracks whether we've already fired a drift warning for the current
    // confidence descent, so we don't spam the backend.
    this._driftWarnFired = false;

    // ── Off-route & wrong-way state ──────────────────────────────────────
    // True when the last step's snap distance exceeded PATH_SNAP_RADIUS_UNITS
    // or when the user walked >60° against the segment direction for 2+ steps.
    this._isOffRoute = false;
    this._wrongWayStepCount = 0;
    this._isWrongWay = false;

    // ── Bound event handlers (stored for removeEventListener) ────────────
    this._motionHandler = this._onMotionEvent.bind(this);
    this._orientHandler = this._onOrientEvent.bind(this);
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Requests sensor permissions and attaches device event listeners.
   * Safe to call multiple times — returns immediately if already active.
   *
   * @returns {Promise<{ started: boolean, reason?: string, support: object, error?: Error }>}
   */
  async start() {
    if (this.active) return { started: true, reason: 'already_active' };

    const support = getPDRSupportState();

    if (!support.motionSupported || !support.orientationSupported) {
      this._postEvent('error', { reason: 'unsupported', support });
      return { started: false, reason: 'unsupported', support };
    }

    const motionPerm = await requestSensorPermission(window.DeviceMotionEvent);
    if (!motionPerm.granted) {
      this._postEvent('error', { reason: 'motion_permission_denied', error: motionPerm.error?.message });
      return { started: false, reason: 'motion_permission_denied', support, error: motionPerm.error };
    }

    const orientPerm = await requestSensorPermission(window.DeviceOrientationEvent);
    if (!orientPerm.granted) {
      this._postEvent('error', { reason: 'orientation_permission_denied', error: orientPerm.error?.message });
      return { started: false, reason: 'orientation_permission_denied', support, error: orientPerm.error };
    }

    window.addEventListener('devicemotion', this._motionHandler, { passive: true });
    window.addEventListener('deviceorientation', this._orientHandler, { passive: true });

    this.active = true;

    // Set the gravity warmup deadline. Steps detected before this are discarded.
    this._gravityReadyAt = Date.now() + GRAVITY_WARMUP_MS;

    this._report();
    return { started: true, support };
  }

  /**
   * Detaches all sensor listeners and marks the engine inactive.
   * Does not reset position — useful for pausing and resuming.
   */
  stop() {
    window.removeEventListener('devicemotion', this._motionHandler);
    window.removeEventListener('deviceorientation', this._orientHandler);
    this.active = false;
  }

  /**
   * Simulates a step manually (useful for laptop testing without physical sensors).
   * @param {object} [opts]
   * @param {number} [opts.stepLengthM=0.74]
   * @param {number} [opts.headingDelta=0] — optional turn angle in degrees
   */
  stepSimulated({ stepLengthM = DEFAULT_STEP_LENGTH_M, headingDelta = 0 } = {}) {
    if (headingDelta !== 0) {
      this.heading = normalizeHeading(this.heading + headingDelta);
    }
    this._step(stepLengthM);
  }

  /**
   * Snaps the engine position to a known graph node.
   * Triggers calibration if enough steps have been taken since the last reset.
   * Resets confidence to 1.0 and resets calibration accumulators.
   *
   * Called by app.js when the user confirms reaching a checkpoint.
   *
   * @param {string} nodeId
   */
  resetToCheckpoint(nodeId) {
    const node = this._nodes[nodeId];
    if (!node) {
      this._postEvent('error', { reason: 'unknown_node', nodeId });
      return;
    }

    const realPos = { x: node.coords[0], y: node.coords[1] };

    // ── Layer 5: Calibration ────────────────────────────────────────────
    // Only calibrate if we've walked at least 5 steps — fewer steps produce
    // noisy correction factors that hurt more than they help.
    if (this._stepsSinceCheckpoint >= 5 && this._pdrDistanceSinceCheckpoint > 0.5) {
      const pdrEstimatedDistM = this._pdrDistanceSinceCheckpoint * COORD_TO_METERS;

      // FIX 1: Use graph-path distance instead of Euclidean snap-distance.
      // Euclidean (old) measures a straight line from current PDR dot to the
      // checkpoint node — always shorter than the walked path on bent corridors,
      // and corrupted by heading error. Graph-path distance sums node-to-node
      // segment lengths along the planned route, which equals the real walked
      // distance regardless of PDR heading accuracy.
      const realDistUnits = this._pathDistanceBetween(this._prevCheckpointId, nodeId);
      const realDistM = realDistUnits * COORD_TO_METERS;

      // Correction factor: how wrong were we, proportionally?
      // e.g. PDR said 10m but real distance was 12m → factor = 1.2 → increase stepLengthM
      // Blend factor scales with segment length: short segments (<15 steps) get
      // a gentler correction (0.35) to avoid oscillation from noisy short-distance estimates.
      if (realDistM > 0.3) {
        const rawFactor = realDistM / pdrEstimatedDistM;
        const blendWeight = this._stepsSinceCheckpoint < 15 ? 0.35 : 0.6;
        const blendedFactor = 1.0 + (rawFactor - 1.0) * blendWeight;
        const newStepLength = clamp(
          this.stepLengthM * blendedFactor,
          STEP_LENGTH_MIN_M,
          STEP_LENGTH_MAX_M
        );

        this._postEvent('calibration', {
          previousStepLengthM: this.stepLengthM,
          newStepLengthM: newStepLength,
          pdrEstimatedDistM,
          realDistM,
          correctionFactor: rawFactor,
          stepsSinceCheckpoint: this._stepsSinceCheckpoint,
          atNode: nodeId,
        });

        this.stepLengthM = newStepLength;
      }
    }

    // ── Snap position ───────────────────────────────────────────────────
    const previousFloor = this.floor;
    this.position = { x: realPos.x, y: realPos.y };
    this.floor = node.floor;
    this.confidence = 1.0;
    this._driftWarnFired = false;

    // ── Reset accumulators ──────────────────────────────────────────────
    this._pdrDistanceSinceCheckpoint = 0;
    this._stepsSinceCheckpoint = 0;
    this._isOffRoute = false; // clear stale off-route flag from previous floor
    this._wrongWayStepCount = 0;
    this._isWrongWay = false;

    // ── Advance calibration anchor ──────────────────────────────────────
    // Must be set AFTER calibration above reads _prevCheckpointId.
    this._prevCheckpointId = nodeId;

    // ── Floor change notification ───────────────────────────────────────
    if (previousFloor !== this.floor && this._onFloorChange) {
      this._onFloorChange({ fromFloor: previousFloor, toFloor: this.floor, transitionNode: nodeId });
    }

    this._report();
  }

  /**
   * Updates the planned path that PDR uses for position projection (Layer 4).
   * Should be called whenever app.js computes a new pathData array.
   *
   * Each element of pathNodes must have: { id, coords: [x, y], floor }
   * (This is the same shape as NMIT Wayfinder's existing pathData array.)
   *
   * If never called, path projection is silently skipped — the engine degrades
   * gracefully to the old free-floating behaviour.
   *
   * @param {Array<{ id: string, coords: [number, number], floor: number }>} pathNodes
   */
  setPath(pathNodes) {
    if (!Array.isArray(pathNodes)) {
      this._pathNodes = [];
      return;
    }
    // Normalise to { x, y, floor } for internal use.
    this._pathNodes = pathNodes.map(n => ({
      id: n.id,
      x: n.coords[0],
      y: n.coords[1],
      floor: n.floor,
    }));
    this._wrongWayStepCount = 0;
    this._isWrongWay = false;
    this._isOffRoute = false;
  }

  // ── Private: calibration helper ─────────────────────────────────────────

  /**
   * Computes the planned-path distance (in SVG units) between two node IDs
   * by summing consecutive node-to-node segment lengths along this._pathNodes.
   *
   * This gives the actual walked distance along the route, independent of PDR
   * heading accuracy, making calibration correct even on bent corridors.
   *
   * ALGORITHM:
   *   Walk this._pathNodes in order. Once fromNodeId is found (or fromNodeId is
   *   null, meaning start of path), accumulate dist2D between each consecutive
   *   pair until toNodeId is reached.
   *
   * FALLBACK:
   *   If either node ID is not found in this._pathNodes (e.g. path not yet set,
   *   or first checkpoint of session where _prevCheckpointId is null), falls back
   *   to the Euclidean distance from this.position to the target node.
   *
   * @param {string|null} fromNodeId  — previous checkpoint node ID (null = session start)
   * @param {string}      toNodeId    — current checkpoint node ID
   * @returns {number} distance in SVG coordinate units
   */
  _pathDistanceBetween(fromNodeId, toNodeId) {
    // Fallback: no path set, or first checkpoint of session.
    if (this._pathNodes.length < 2 || fromNodeId === null) {
      const toNode = this._nodes[toNodeId];
      if (!toNode) return 0;
      return dist2D(this.position, { x: toNode.coords[0], y: toNode.coords[1] });
    }

    let accumulating = false;
    let totalDist = 0;

    for (let i = 0; i < this._pathNodes.length - 1; i++) {
      const a = this._pathNodes[i];
      const b = this._pathNodes[i + 1];

      // Start accumulating the moment we pass fromNodeId.
      if (!accumulating && a.id === fromNodeId) {
        accumulating = true;
      }

      if (accumulating) {
        totalDist += dist2D(a, b);
        // Stop once the segment ends at toNodeId.
        if (b.id === toNodeId) return totalDist;
      }
    }

    // toNodeId not found beyond fromNodeId — path may not cover this segment.
    // Fallback to Euclidean so calibration still fires rather than producing zero.
    const toNode = this._nodes[toNodeId];
    if (!toNode) return 0;
    return dist2D(this.position, { x: toNode.coords[0], y: toNode.coords[1] });
  }

  // ── Private: sensor event handlers ──────────────────────────────────────

  /**
   * Handles DeviceMotionEvent.
   *
   * Pipeline:
   *   raw accelerometer → gravity EMA → linear acceleration magnitude
   *   → smoothed magnitude → threshold crossing → step registration
   *
   * GRAVITY EMA (exponential moving average):
   *   gravity_new = 0.82 * gravity_old + 0.18 * raw
   *   Linear acceleration = raw - gravity_estimate
   *   The 0.82/0.18 split gives a time constant of ~500ms at 50Hz.
   *   The warmup guard (GRAVITY_WARMUP_MS) prevents false steps during this
   *   settling period.
   *
   * MAGNITUDE SMOOTHING:
   *   A second EMA (0.68/0.32) smooths the magnitude signal to suppress
   *   single-sample noise spikes that would false-trigger the threshold.
   *
   * STEP REGISTRATION:
   *   A step is counted on a rising-edge threshold crossing
   *   (smoothedMag crosses STEP_ACCEL_THRESHOLD from below) provided
   *   MIN_STEP_INTERVAL_MS has elapsed since the last step.
   *
   * INTENSITY BOOST:
   *   Larger steps (heavier footfalls) produce larger magnitude peaks.
   *   A small boost proportional to the excess above threshold is added
   *   to the step length for those steps.
   *
   * @param {DeviceMotionEvent} event
   */
  _onMotionEvent(event) {
    // FIX 3: Distinguish accelerationIncludingGravity from acceleration.
    // event.acceleration is already gravity-compensated by the OS/browser.
    // If we fall through to it and still run the gravity-EMA subtraction,
    // we subtract gravity a second time → near-zero linear signal → step
    // detector stops firing silently on some Android devices.
    const includingGravity = event.accelerationIncludingGravity;
    const usingIncludingGravity = !!(includingGravity && Number.isFinite(includingGravity.x));
    const source = usingIncludingGravity ? includingGravity : event.acceleration;
    if (!source) return;

    const x = Number.isFinite(source.x) ? source.x : 0;
    const y = Number.isFinite(source.y) ? source.y : 0;
    const z = Number.isFinite(source.z) ? source.z : 0;

    let linX, linY, linZ;
    if (usingIncludingGravity) {
      const oldGx = this._gravity.x;
      const oldGy = this._gravity.y;
      const oldGz = this._gravity.z;

      // Raw accel-with-gravity: run gravity EMA to isolate linear component.
      this._gravity.x = (this._gravity.x * 0.82) + (x * 0.18);
      this._gravity.y = (this._gravity.y * 0.82) + (y * 0.18);
      this._gravity.z = (this._gravity.z * 0.82) + (z * 0.18);

      // Reorientation guard: compare instantaneous raw gravity vector against
      // the estimated gravity vector before update. If angle > 15°, phone was reoriented mid-session.
      const magRaw = Math.sqrt(x * x + y * y + z * z);
      const magOld = Math.sqrt(oldGx * oldGx + oldGy * oldGy + oldGz * oldGz);
      if (magRaw > 0.1 && magOld > 0.1) {
        const dot = x * oldGx + y * oldGy + z * oldGz;
        const cosTheta = clamp(dot / (magRaw * magOld), -1, 1);
        const angleDeg = (Math.acos(cosTheta) * 180) / Math.PI;
        if (angleDeg > 15) {
          this._gravityReadyAt = Date.now() + GRAVITY_WARMUP_MS;
        }
      }

      linX = x - this._gravity.x;
      linY = y - this._gravity.y;
      linZ = z - this._gravity.z;
    } else {
      // event.acceleration is OS-gravity-compensated — do NOT subtract again.
      linX = x;
      linY = y;
      linZ = z;
    }

    // Compute linear acceleration magnitude
    const magnitude = Math.sqrt(linX * linX + linY * linY + linZ * linZ);

    // Smooth the magnitude signal. Using α=0.5 (was 0.32) trades a small amount of
    // noise smoothing for reduced detection latency (~65 ms, down from ~130 ms) at fast cadence.
    this._smoothedMagnitude = (this._smoothedMagnitude * 0.5) + (magnitude * 0.5);

    const now = Date.now();

    // Rising-edge threshold crossing + debounce + warmup guard
    const crossedThreshold =
      this._smoothedMagnitude >= STEP_ACCEL_THRESHOLD &&
      this._previousMagnitude < STEP_ACCEL_THRESHOLD;

    const debounceOk = (now - this._lastStepTime) >= MIN_STEP_INTERVAL_MS;
    const warmupDone = now >= this._gravityReadyAt;

    if (crossedThreshold && debounceOk && warmupDone) {
      // Intensity boost: square-root scaling scales gradually for vigorous steps.
      // Capped at +0.10m (down from 0.18m) to prevent outlier events from corrupting position.
      const intensityBoost = clamp(
        Math.sqrt(Math.max(0, this._smoothedMagnitude - STEP_ACCEL_THRESHOLD)) * 0.06,
        0,
        0.10
      );
      this._lastStepTime = now;
      this._step(clamp(this.stepLengthM + intensityBoost, STEP_LENGTH_MIN_M, STEP_LENGTH_MAX_M));
    }

    this._previousMagnitude = this._smoothedMagnitude;
  }

  /**
   * Handles DeviceOrientationEvent.
   *
   * Extracts the heading (normalised to [0, 360)) and applies EMA smoothing.
   * Heading is only sent to _report() on significant change (>1.5°) or every 160ms,
   * to avoid flooding the UI callback at 60fps.
   *
   * @param {DeviceOrientationEvent} event
   */
  _onOrientEvent(event) {
    const rawHeading = extractHeading(event);
    if (rawHeading === null) return;

    if (!this._headingInitialized) {
      this.heading = rawHeading;
      this._headingInitialized = true;
      this._report();
      return;
    }

    // Interpolate toward the new heading via the shortest arc.
    const delta = shortestHeadingDelta(this.heading, rawHeading);

    // FIX 2: Heading spike rejection.
    // A human turning at a fast walk produces at most ~90°/s. DeviceOrientationEvent
    // fires at ~60 Hz (one tick ≈ 16 ms), so the maximum real angular change per
    // tick is ~90/60 ≈ 1.5°. A jump larger than 45° in a single tick cannot be a
    // real turn — it is magnetic interference (rebar, elevator motors, conduits).
    // Discard it entirely rather than blending it into the EMA, which would inject
    // an immediate ~10° heading error (45° × HEADING_SMOOTHING=0.22) even at low α.
    if (Math.abs(delta) > 45) return;

    this.heading = normalizeHeading(this.heading + delta * HEADING_SMOOTHING);

    const now = Date.now();
    if (Math.abs(delta) >= 1.5 || (now - this._lastHeadingReportTime) > 160) {
      this._lastHeadingReportTime = now;
      this._report();
    }
  }

  // ── Private: step logic ──────────────────────────────────────────────────

  /**
   * Registers one step, updates position, applies path projection,
   * decays confidence, and fires telemetry.
   *
   * LAYER 3 — Heading → SVG delta:
   *   _compassToSVGDelta() converts the magnetic heading to (Δx, Δy) in SVG units.
   *   See that method for the coordinate derivation.
   *
   * LAYER 4 — Path projection:
   *   After computing the raw new position, _projectOntoPath() snaps it to
   *   the nearest same-floor path segment if within PATH_SNAP_RADIUS_UNITS.
   *
   * @param {number} stepLengthM — effective step length for this step
   */
  _step(stepLengthM) {
    const deltaUnits = stepLengthM / COORD_TO_METERS;
    const rawHeading = this.heading;
    const { dx, dy, adjustedHeading } = this._compassToSVGDelta(rawHeading, deltaUnits);

    // FIX 4: Compute actual displacement after boundary clamping so that steps
    // taken while pinned at the SVG edge [0,100] do not phantom-accumulate in
    // _pdrDistanceSinceCheckpoint, which would corrupt the next calibration.
    const newX = this.position.x + dx;
    const newY = this.position.y + dy;
    const clampedX = clamp(newX, 0, 100);
    const clampedY = clamp(newY, 0, 100);
    // Effective displacement is what the dot actually moved, not the intended step.
    const effectiveDX = clampedX - this.position.x;
    const effectiveDY = clampedY - this.position.y;
    const effectiveDist = Math.sqrt(effectiveDX * effectiveDX + effectiveDY * effectiveDY);

    const clampedPos = { x: clampedX, y: clampedY };

    // Layer 4: project onto planned path; result now exposes snap distance
    const { point: snapped, distance: snapDist, snapped: wasSnapped } = this._projectOntoPath(clampedPos);
    this.position = snapped;

    // Update off-route flag: true when we could not snap to the path
    this._isOffRoute = !wasSnapped && this._pathNodes.length >= 2;

    if (PDR_DEBUG) {
      console.log(
        '[PDR _step]',
        'rawHeading:', rawHeading.toFixed(1),
        'adjustedHeading:', adjustedHeading.toFixed(1),
        'clampedPos:', `(${clampedX.toFixed(2)}, ${clampedY.toFixed(2)})`,
        'snapped:', `(${snapped.x.toFixed(2)}, ${snapped.y.toFixed(2)})`,
        'snapDist:', snapDist.toFixed(2),
        'pathNodes:', this._pathNodes.length,
        'isOffRoute:', this._isOffRoute,
      );
    }

    // Accumulate only the effective (clamped) displacement — not the raw step length.
    // If the position was pinned at the boundary, effectiveDist < deltaUnits and
    // the phantom distance is not counted.
    this._pdrDistanceSinceCheckpoint += effectiveDist;
    this._stepsSinceCheckpoint += 1;

    // Confidence decay
    this.stepCount += 1;
    this.confidence = Math.max(CONFIDENCE_FLOOR, this.confidence * CONFIDENCE_DECAY);

    // Drift warning — fire once when crossing the threshold, not on every step
    if (this.confidence < CONFIDENCE_WARN_THRESHOLD && !this._driftWarnFired) {
      this._driftWarnFired = true;
      this._postEvent('drift_warning', {
        confidence: this.confidence,
        stepCount: this.stepCount,
        floor: this.floor,
      });
    }

    this._report();
  }

  // ── Private: coordinate math ─────────────────────────────────────────────

  /**
   * Converts a magnetic compass heading + step distance to an SVG (Δx, Δy).
   *
   * DERIVATION:
   *   SVG axes: X increases right (east-ish), Y increases downward (south-ish).
   *   In standard math/compass convention:
   *     heading 0°   → north → in SVG: -Y direction (up the screen)
   *     heading 90°  → east  → in SVG: +X direction (right)
   *     heading 180° → south → in SVG: +Y direction (down)
   *     heading 270° → west  → in SVG: -X direction (left)
   *
   *   So in SVG coordinates:
   *     Δx = distance * sin(heading_radians)
   *     Δy = distance * (-cos(heading_radians))   ← note the negation because Y is inverted
   *
   *   MAP_CORRIDOR_BEARING_DEG offset:
   *     The NMIT floorplan is NOT drawn north-up — the SVG viewBox (0 0 100 100)
   *     has no rotation transform and the main corridor runs left-to-right (+X),
   *     but physically faces west (270° magnetic). Subtracting MAP_CORRIDOR_BEARING_DEG
   *     rotates the magnetic heading into the SVG map frame so that the corridor
   *     axis aligns with +X.
   *
   * @param {number} headingDeg  — magnetic compass heading, [0, 360)
   * @param {number} distUnits   — distance to travel in SVG coordinate units
   * @returns {{ dx: number, dy: number, adjustedHeading: number }}
   */
  _compassToSVGDelta(headingDeg, distUnits) {
    // Rotate magnetic heading into SVG map frame (floorplan is not north-up).
    const adjustedHeading = normalizeHeading(headingDeg - MAP_CORRIDOR_BEARING_DEG);
    const rad = (adjustedHeading * Math.PI) / 180;
    return {
      dx: distUnits * Math.sin(rad),
      dy: distUnits * (-Math.cos(rad)),
      adjustedHeading,
    };
  }

  /**
   * Projects `rawPos` onto the nearest same-floor segment of the planned path.
   *
   * ALGORITHM:
   *   For each consecutive pair of path nodes on the current floor, find the
   *   closest point on that segment to rawPos. Take the overall minimum.
   *   If the minimum distance exceeds PATH_SNAP_RADIUS_UNITS (user may be off
   *   route or path is not set), rawPos is returned unchanged.
   *
   * WHY THIS HELPS:
   *   The heading sensor drifts slightly over time. Without snapping, a 5°
   *   heading error over a 20m corridor produces a ~1.7m lateral displacement,
   *   moving the dot through a wall. Snapping keeps the dot on the corridor
   *   even under moderate heading drift.
   *
   * @param {{ x: number, y: number }} rawPos
   * @returns {{ point: { x: number, y: number }, distance: number, snapped: boolean }}
   */
  _projectOntoPath(rawPos) {
    if (this._pathNodes.length < 2) {
      return { point: rawPos, distance: Infinity, snapped: false };
    }

    let bestDist = Infinity;
    let bestPoint = rawPos;
    let bestSegmentHeadingMismatch = false;

    const adjustedHeading = normalizeHeading(this.heading - MAP_CORRIDOR_BEARING_DEG);

    for (let i = 0; i < this._pathNodes.length - 1; i++) {
      const a = this._pathNodes[i];
      const b = this._pathNodes[i + 1];

      // Only project onto segments on the current floor.
      if (a.floor !== this.floor || b.floor !== this.floor) continue;

      const candidate = closestPointOnSegment(rawPos, a, b);
      const d = dist2D(rawPos, candidate);

      if (d < bestDist) {
        bestDist = d;
        bestPoint = candidate;

        // Heading mismatch check against segment direction (a -> b)
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        if (Math.abs(abx) > 1e-4 || Math.abs(aby) > 1e-4) {
          const segHeading = normalizeHeading((Math.atan2(abx, -aby) * 180) / Math.PI);
          const angleDelta = Math.abs(shortestHeadingDelta(adjustedHeading, segHeading));
          bestSegmentHeadingMismatch = angleDelta > 60;
        } else {
          bestSegmentHeadingMismatch = false;
        }
      }
    }

    if (bestSegmentHeadingMismatch) {
      this._wrongWayStepCount++;
    } else {
      this._wrongWayStepCount = Math.max(0, this._wrongWayStepCount - 1);
    }

    this._isWrongWay = this._wrongWayStepCount >= 2;

    // Snap only if within PATH_SNAP_RADIUS_UNITS AND not walking wrong way
    const snapped = bestDist <= PATH_SNAP_RADIUS_UNITS && !this._isWrongWay;
    return { point: snapped ? bestPoint : rawPos, distance: bestDist, snapped };
  }

  // ── Private: reporting ───────────────────────────────────────────────────

  /**
   * Computes the nearest graph node to the current position (same floor only)
   * and fires _onUpdate + _postObservation.
   *
   * _nearestNode() is O(n) over all nodes on the current floor.
   * With 53 nodes this is negligible, but it is only called from _step()
   * and _onOrientEvent() (not on every accelerometer sample), so ~60 calls/sec max.
   */
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
      // Extra fields available to app.js if it wants them
      stepLengthM: this.stepLengthM,
      driftWarning: this.confidence < CONFIDENCE_WARN_THRESHOLD,
      // isOffRoute: true when the last step could not snap or user walking wrong direction
      isOffRoute: this._isOffRoute || this._isWrongWay,
      isWrongWay: this._isWrongWay,
    };

    if (this._onUpdate) this._onUpdate(update);
    this._postObservation(update);
  }

  /**
   * Finds the nearest graph node on the current floor to this.position.
   * @returns {{ id: string|null, distM: number }}
   */
  _nearestNode() {
    let best = { id: null, distM: Infinity };
    for (const [id, data] of Object.entries(this._nodes)) {
      if (data.floor !== this.floor) continue;
      const dx = (data.coords[0] - this.position.x) * COORD_TO_METERS;
      const dy = (data.coords[1] - this.position.y) * COORD_TO_METERS;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < best.distM) best = { id, distM: d };
    }
    return best;
  }

  // ── Private: telemetry ───────────────────────────────────────────────────

  /**
   * Throttled best-effort POST to /session/pdr.
   * Uses the existing PDRObservationPayload shape — no backend changes needed.
   * Never throws: telemetry failure must never affect navigation.
   *
   * @param {object} update — the same object passed to _onUpdate
   */
  async _postObservation(update) {
    if (!this._sessionId) return;

    const now = Date.now();
    if ((now - this._lastPostTime) < POST_THROTTLE_MS) return;
    this._lastPostTime = now;

    try {
      await fetch('/session/pdr', {
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
          heading: update.heading,
          step_count: update.stepCount,
          step_length_m: this.stepLengthM,
        }),
      });
    } catch {
      // Best-effort only — silence all telemetry errors.
    }
  }

  /**
   * Immediately POSTs a structured event (calibration, error, drift_warning)
   * bypassing the throttle. These events are infrequent and important.
   *
   * @param {string} eventType
   * @param {object} payload
   */
  async _postEvent(eventType, payload) {
    if (!this._sessionId) return;
    if (!POST_IMMEDIATE_EVENTS.has(eventType)) return;

    try {
      await fetch('/session/pdr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: this._sessionId,
          timestamp: new Date().toISOString(),
          event_type: eventType,
          floor: this.floor,
          estimated_x: this.position.x,
          estimated_y: this.position.y,
          confidence: this.confidence,
          step_length_m: this.stepLengthM,
          ...payload,
        }),
      });
    } catch {
      // Best-effort only.
    }
  }
}

// ---------------------------------------------------------------------------
// Test-only exports
// Exporting module-internal constants so the Node.js test suite can assert
// their values without a DOM.  No logic is changed here.
// ---------------------------------------------------------------------------
export { PATH_SNAP_RADIUS_UNITS };