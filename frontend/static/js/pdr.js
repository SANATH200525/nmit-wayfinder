/**
 * PDREngine — Pedestrian Dead Reckoning
 *
 * How it will work (next sprint):
 *   DeviceOrientationEvent → heading (magnetic north)
 *   DeviceMotionEvent      → accelerometer → step detection → stepLength estimate
 *   Each step: new position = old position + stepLength * [sin(heading), -cos(heading)]
 *   Coordinates: % space (0-100) matching the NODES coordinate system
 *   1 coordinate unit = COORD_TO_METERS (0.5m)
 *
 * This sprint: class skeleton + integration hooks only.
 */

export class PDREngine {
  // ─── Constructor ───────────────────────────────────────────────
  constructor({ startNode, nodes, graph, onPositionUpdate, 
                onFloorChange, sessionId }) {
    /**
     * @param startNode       string — node ID of confirmed start position
     * @param nodes           object — NODES from graph-data.js
     * @param graph           object — GRAPH adjacency list
     * @param onPositionUpdate fn({ x, y, floor, nearestNode, distanceM, confidence })
     * @param onFloorChange   fn({ fromFloor, toFloor, transitionNode })
     * @param sessionId       string — for /session/pdr POST
     */
    this._nodes = nodes;
    this._graph = graph;
    this._onUpdate = onPositionUpdate;
    this._onFloorChange = onFloorChange;
    this._sessionId = sessionId;
    this._lastPostTime = 0;

    const startData = nodes[startNode];
    this.position = { x: startData.coords[0], y: startData.coords[1] };
    this.floor = startData.floor;
    this.heading = 0;         // degrees clockwise from north
    this.stepLengthM = 0.75;  // default 75cm per step
    this.confidence = 1.0;    // 1.0 = certain (just confirmed checkpoint)
    this.stepCount = 0;
    this.active = false;

    // Sensor listener references (stored so stop() can removeEventListener)
    this._motionHandler    = this._onMotionEvent.bind(this);
    this._orientHandler    = this._onOrientEvent.bind(this);
  }

  // ─── Lifecycle ─────────────────────────────────────────────────
  async start() {
    if (this.active) return;

    // iOS 13+ requires explicit permission for motion/orientation
    if (typeof DeviceMotionEvent?.requestPermission === 'function') {
      const perm = await DeviceMotionEvent.requestPermission();
      if (perm !== 'granted') {
        console.warn('[PDR] Motion permission denied — PDR inactive');
        return;
      }
    }

    // TODO Sprint PDR-1: wire DeviceMotionEvent for step detection
    // window.addEventListener('devicemotion', this._motionHandler);

    // TODO Sprint PDR-1: wire DeviceOrientationEvent for heading
    // window.addEventListener('deviceorientation', this._orientHandler);

    this.active = true;
    console.log('[PDR] Engine started — sensors stubbed, awaiting Sprint PDR-1');
    this._report(); // Report initial known position immediately
  }

  stop() {
    window.removeEventListener('devicemotion', this._motionHandler);
    window.removeEventListener('deviceorientation', this._orientHandler);
    this.active = false;
    console.log('[PDR] Engine stopped');
  }

  // ─── Checkpoint reset (called by onCheckpointReached in app.js) ─
  resetToCheckpoint(nodeId) {
    const node = this._nodes[nodeId];
    if (!node) { console.warn(`[PDR] Unknown checkpoint node: ${nodeId}`); return; }
    const prevFloor = this.floor;
    this.position   = { x: node.coords[0], y: node.coords[1] };
    this.floor      = node.floor;
    this.confidence = 1.0;  // full reset — we know exactly where we are
    this.stepCount  = 0;
    if (prevFloor !== this.floor && this._onFloorChange) {
      this._onFloorChange({ fromFloor: prevFloor, toFloor: this.floor, transitionNode: nodeId });
    }
    console.log(`[PDR] Position snapped to ${nodeId} — confidence reset to 1.0`);
    this._report();
  }

  // ─── Internal: sensor handlers (stubs) ─────────────────────────
  _onMotionEvent(event) {
    // TODO Sprint PDR-1: 
    //   1. Extract event.accelerationIncludingGravity.{x,y,z}
    //   2. Detect step peaks via threshold on vertical acceleration
    //   3. Estimate step length via Weinberg formula or fixed average
    //   4. Call this._step(estimatedStepLengthM)
  }

  _onOrientEvent(event) {
    // TODO Sprint PDR-1:
    //   1. event.webkitCompassHeading (iOS) or 360 - event.alpha (Android)
    //   2. Apply low-pass filter to smooth jitter
    //   3. this.heading = filteredHeading
  }

  // ─── Internal: position update ─────────────────────────────────
  _step(stepLengthM = this.stepLengthM) {
    const rad = (this.heading * Math.PI) / 180;
    // 1 metre = 1/0.5 = 2 coordinate units (COORD_TO_METERS = 0.5)
    const delta = stepLengthM / 0.5;
    this.position.x +=  delta * Math.sin(rad);
    this.position.y += -delta * Math.cos(rad); // y increases downward in image space
    this.stepCount++;
    // Confidence decays with each unconfirmed step
    this.confidence = Math.max(0.05, this.confidence * 0.99);
    this._report();
  }

  _report() {
    const nearest = this._nearestNode();
    const update = {
      x:           this.position.x,
      y:           this.position.y,
      floor:       this.floor,
      nearestNode: nearest.id,
      distanceM:   nearest.distM,
      confidence:  this.confidence,
    };
    if (this._onUpdate) this._onUpdate(update);
    // Background-report to backend (fire and forget)
    this._postObservation(update);
  }

  _nearestNode() {
    let best = { id: null, distM: Infinity };
    for (const [id, data] of Object.entries(this._nodes)) {
      if (data.floor !== this.floor) continue;
      const dx = (data.coords[0] - this.position.x) * 0.5;
      const dy = (data.coords[1] - this.position.y) * 0.5;
      const d  = Math.sqrt(dx*dx + dy*dy);
      if (d < best.distM) best = { id, distM: d };
    }
    return best;
  }

  async _postObservation(update) {
    const now = Date.now();
    if (now - this._lastPostTime < 2000) return;
    this._lastPostTime = now;
    // Don't await — fire and forget
    try {
      fetch('/session/pdr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id:            this._sessionId,
          timestamp:             new Date().toISOString(),
          estimated_x:           update.x,
          estimated_y:           update.y,
          floor:                 update.floor,
          nearest_node:          update.nearestNode,
          distance_to_nearest_m: update.distanceM,
          confidence:            update.confidence,
        }),
      });
    } catch { /* offline — PDR observations are not queued, they are lossy */ }
  }
}

// ─── PDR UI overlay (confidence indicator) ────────────────────────────────
// Called from app.js when PDR is active
export function renderPDRConfidence(confidence) {
  let bar = document.getElementById('pdr-confidence-bar');
  if (!bar) return; // element added to index.html by Person C
  bar.style.width = `${Math.round(confidence * 100)}%`;
  bar.style.background = confidence > 0.7 ? '#10b981'
                       : confidence > 0.4 ? '#f59e0b'
                       : '#ef4444';
  const label = document.getElementById('pdr-confidence-label');
  if (label) label.textContent = `PDR: ${Math.round(confidence * 100)}%`;
}

// ─── Integration point for app.js ─────────────────────────────────────────
// In app.js, after planRoute() returns a path:
//
//   import { PDREngine, renderPDRConfidence } from './pdr.js';
//
//   window._pdrEngine = new PDREngine({
//     startNode: formStartNode,
//     nodes: NODES,
//     graph: GRAPH,
//     sessionId,
//     onPositionUpdate: (update) => {
//       renderPDRConfidence(update.confidence);
//       // TODO Sprint PDR-2: draw live position dot on map SVG
//     },
//     onFloorChange: ({ toFloor }) => switchFloor(toFloor),
//   });
//   await window._pdrEngine.start();
//
// In onCheckpointReached() in app.js, add:
//   if (window._pdrEngine) {
//     window._pdrEngine.resetToCheckpoint(currentCheckpointNodeId);
//   }
