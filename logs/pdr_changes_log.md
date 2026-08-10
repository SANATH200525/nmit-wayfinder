# NMIT Wayfinder — PDR Engine & Navigation Changes Log

**Log Created:** 2026-08-10  
**Branch:** `v3-pdr-test`  
**File Location:** `logs/pdr_changes_log.md`  

---

## Executive Summary

This log records all changes made to the Pedestrian Dead Reckoning (PDR) engine, route flow lifecycle, UI markers, auto-rerouting system, test suite, and laptop simulator mode in the `v3-pdr-test` branch.

---

## 1. PDR Engine Core (`frontend/static/js/pdr.js`)

### 1.1 Sensor & Step Detection Fixes
- **Fast-Walking Cadence (`MIN_STEP_INTERVAL_MS`):** Reduced from 380 ms to **300 ms** to support fast walking up to ~200 steps/min without under-counting.
- **Filter Latency Reduction:** Increased magnitude EMA alpha from 0.32 to **0.50** (`(smoothed * 0.5) + (mag * 0.5)`), cutting cascaded filter detection lag from ~130 ms down to ~65 ms.
- **Gravity EMA Baseline & Reorientation Guard:**
  - Seeded `this._gravity` at `{ x: 0, y: 0, z: 9.81 }` (earth gravity) instead of all zeros to prevent initial startup false steps.
  - Added mid-session reorientation guard: computes angle between instantaneous raw acceleration vector and current gravity estimate. If shift > 15°, pauses step registration for `GRAVITY_WARMUP_MS` (1500 ms) while gravity filter resettles.
- **Gravity Double-Subtraction Guard:** Explicitly branched in `_onMotionEvent` between `accelerationIncludingGravity` (runs gravity EMA subtraction) and `acceleration` (already gravity-compensated by OS — skips subtraction).
- **Proportional Intensity Boost:** Replaced linear boost with square-root model `clamp(sqrt(max(0, mag - threshold)) * 0.06, 0, 0.10)` to scale stride length gradually up to +0.10 m cap.

### 1.2 Heading & Orientation Improvements
- **Magnetometer Spike Rejection:** Added single-tick jump guard in `_onOrientEvent`: if `|delta| > 45°` in a single 60 Hz tick, the reading is discarded as magnetic interference (rebar/elevators) rather than blended into the EMA.
- **Compass to SVG Delta Rotation:** Applied `MAP_CORRIDOR_BEARING_DEG = 270` offset in `_compassToSVGDelta()` to rotate magnetic compass bearings into the floorplan SVG coordinate frame.
- **Android Screen Orientation Fix:** Subtracted `window.screen.orientation.angle` in `extractHeading()` for Android `alpha` fallback path so portrait/landscape rotations do not introduce systematic heading errors.

### 1.3 Map-Matching, Calibration & Off-Route Detection
- **Narrowed Snap Radius:** Reduced `PATH_SNAP_RADIUS_UNITS` from 8 (4.1 m) to **3 units (~1.5 m)**, matching corridor half-width so off-corridor excursions are caught instead of masked.
- **Graph-Path Calibration (`_pathDistanceBetween`):** Replaced Euclidean distance with actual summed graph-segment distance along `_pathNodes` between previous and current checkpoints, making step-length calibration accurate on bent/L-shaped corridors.
- **Segment Length Blend Weight:** Scaled calibration blend factor by `_stepsSinceCheckpoint`: short segments (<15 steps) use a gentler `0.35` weight to prevent oscillation, long segments use `0.60`.
- **Soft-Clamp Accumulator:** Derived distance accumulated in `_pdrDistanceSinceCheckpoint` from actual clamped displacement `effectiveDist`, preventing phantom distance accumulation near floorplan boundaries.
- **Heading Mismatch & Wrong-Way Detection:**
  - Computed segment direction angle `a → b` in `_projectOntoPath()`.
  - If user walks > 60° against path segment direction for 2+ steps, set `_isWrongWay = true` and un-snap live pointer from the route line.
  - Exposed `isWrongWay` and `isOffRoute` on `_report()` output.
  - Cleared `_isOffRoute` and `_wrongWayStepCount` on floor changes (`resetToCheckpoint`) and route updates (`setPath`).

### 1.4 Simulator Helper
- **`stepSimulated({ stepLengthM, headingDelta })`**: Added public method on `PDREngine` to allow programmatically triggering steps and turns without physical motion sensors.

---

## 2. Frontend Application & Lifecycle (`frontend/static/js/app.js`)

### 2.1 Route Flow & PDR Lifecycle
- **Path Nodes Transformer (`toPathNodes`):** Mapped `planRoute`/`planAlternate` output (`{ id, x, y, floor }`) into PDR-compatible path array.
- **`setPath` Integration:** Wired `pdrEngine.setPath(toPathNodes(path))` at initial route generation, alternate route activation, and route clearing (`setPath([])`).
- **Auto-Start on Non-iOS Devices:** When `support.permissionRequired` is `false` (Android/Chrome/desktop), skip the consent modal and auto-start `enableRouteSensors()` immediately upon route selection.
- **Stair / Elevator Destination Floor Snap:** Added a secondary `resetToCheckpoint(activeCp.id)` in `advanceCheckpoint()` after floor switching so the live pointer snaps to the destination floor stair/lift landing on the active floor SVG.

### 2.2 Off-Route Visuals & Mid-Walk Auto-Rerouting
- **Off-Route Pointer Class:** `createPDRMarkerGroup()` applies `.off-route` class to SVG group when `update.isOffRoute || update.isWrongWay`.
- **Off-Route Status Panel & Button:** Rendered **"Off Route — Wrong Direction Detected"** warning status card with a **"⚡ Recalculate Route from Live Position"** button.
- **Auto-Rerouting:** Tracked `pdrOffRouteCount`. After 3 consecutive off-route/wrong-way steps, automatically invokes `window.recalculateFromCurrentLocation({ auto: true })` to re-run A* from `update.nearestNode` to `destinationNode` and update SVG path + PDR path nodes dynamically.

### 2.3 PDR Simulator Control Dock
- Added initially for laptop testing without motion sensors; **removed per user request** so production UI remains clean for physical testing on-site.


---

## 3. Styling (`frontend/static/css/style.css`)

- Added `.pdr-user-marker-root.off-route` CSS rules:
  - Amber halo (`rgba(245, 158, 11, 0.25)` fill, `rgba(245, 158, 11, 0.8)` stroke)
  - Amber body & core (`#f59e0b`)
  - Red directional arrow indicator (`#ef4444`)

---

## 4. Test Suite (`tests/test_pdr_js/pdr.test.js`)

- Expanded Node.js test suite to **22 unit tests** covering:
  1. `_pathDistanceBetween`: L-shaped graph distance vs Euclidean shortcut, straight path, null fallback, and calibration step-length stability.
  2. Heading spike rejection (>45° discarded, ≤45° blended, 0/360° wrap).
  3. Gravity source branching (`accelerationIncludingGravity` vs `acceleration`).
  4. Soft-clamp boundary displacement accumulation.
  5. `PATH_SNAP_RADIUS_UNITS === 3` constant check.
  6. Reorientation guard (>15° angle shift).
  7. Blend weight scaling for short (<15 steps) vs long (≥15 steps) segments.
  8. `_isOffRoute` reset on floor change.
  9. Wrong-way mismatch detection (>60° deviation) and `stepSimulated` execution.

---

## 5. Verification Log

- **Automated Test Command:** `node tests/test_pdr_js/pdr.test.js`
- **Result:** `22 passed, 0 failed`
- **Manual Verification:** Tested route generation, laptop simulator control dock, keyboard shortcuts, wrong-way heading flip, amber off-route marker rendering, and mid-walk auto-rerouting.
