# NMIT Wayfinder — PDR Improvement Action Plan (Revised)

This document evaluates each proposed PDR enhancement against the **actual codebase**, rates its impact and risk, and recommends an implementation order.

---

## Assessment Summary

| # | Feature | Verdict | Impact | Risk | Effort |
|---|---------|---------|--------|------|--------|
| 1 | Anisotropic Floor Plan Scaling | **DO IT** | 🔴 Critical | Low | ~2 hrs |
| 2 | Gyroscope + Compass Sensor Fusion | **SKIP** | Medium | High | ~4 hrs |
| 3 | Weinberg Stride Model | **SKIP** | Low | Medium | ~3 hrs |
| 4 | Corridor Bearing Snapping | **DO IT** | 🟡 High | Low | ~1 hr |
| 5 | Proximity Auto-Checkpoint | **DO IT** (with caveats) | 🟡 High | Medium | ~2 hrs |

---

## 1. Anisotropic Floor Plan Scaling — ✅ DO IT (Priority 1)

### Why This Is Critical

This is the **single biggest source of positioning error** in the current system and it has nothing to do with sensors. Every distance calculation in the app is wrong by a constant factor along one axis.

**What's broken right now:**
- `COORD_TO_METERS = 0.51` is used as a single scalar in `pdr.js` (lines 55, 474, 483, 813, 1038–1039), `app.js` (line 16, 1590), `routing.js` (line 283, 301), and `metrics.js` (line 94).
- Your building is rectangular — the X span and Y span of the floor plan represent different physical distances. Using a single scalar means:
  - Walking north/south covers more or fewer real meters per SVG unit than walking east/west.
  - The step projection formula `deltaUnits = stepLengthM / COORD_TO_METERS` applies the same meters-to-units conversion regardless of direction — a step heading north gets the wrong magnitude.
  - The calibration system (`_pathDistanceBetween`) computes graph distances using isotropic `dist2D`, so it compares apples to oranges when the path has both X and Y components.
  - Turn angle calculation in `routing.js` `heading()` is skewed — a 45° physical turn doesn't map to a 45° SVG angle.

### What Changes

#### Files touched (6 locations across 4 files):

**`pdr.js`** — the core of the fix:
- Replace `COORD_TO_METERS` with `METERS_PER_UNIT_X` and `METERS_PER_UNIT_Y`.
- `_compassToSVGDelta()` (line 902): split the single `distUnits` into axis-specific deltas:
  ```javascript
  dx = (stepLengthM * Math.sin(rad)) / METERS_PER_UNIT_X;
  dy = -(stepLengthM * Math.cos(rad)) / METERS_PER_UNIT_Y;
  ```
- `_step()` (line 813): remove `deltaUnits = stepLengthM / COORD_TO_METERS` — distance conversion moves into `_compassToSVGDelta`.
- `resetToCheckpoint()` calibration (lines 474, 483): use anisotropic distance for both PDR and graph comparisons.
- `_nearestNode()` (lines 1038–1039): use per-axis scaling.
- `_pathDistanceBetween()` → `dist2D()` (line 612): use anisotropic Euclidean.

**`routing.js`** — `distM()` (line 300) and `edgeCost()`:
- Use per-axis scaling for physical distance.

**`app.js`** — `calculateMetrics()` (line 1590):
- Replace `distance * COORD_TO_METERS` with anisotropic computation.

**`metrics.js`** — line 94:
- Same fix.

### Prerequisite: Building Dimensions Needed

I need two real-world measurements to compute the constants:
1. **X-axis**: A known horizontal distance on the floor plan (e.g., "from the west staircase wall to the main entrance is approximately __ meters").
2. **Y-axis**: A known vertical distance on the floor plan (e.g., "from the main corridor centerline to the outer wall of IT Lab 1 is approximately __ meters").

With the SVG coordinate deltas between those reference points, I'll compute exact `METERS_PER_UNIT_X` and `METERS_PER_UNIT_Y` values.

---

## 2. Gyroscope + Compass Sensor Fusion — ❌ SKIP

### Why I Recommend Skipping This

**The current heading pipeline is already solid.** Looking at the actual code:
- Line 785: `45°` spike rejection catches magnetic interference.
- Line 787: EMA smoothing (`α = 0.22`) with shortest-arc wrapping handles normal turns.
- Lines 414–416: `deviceorientationabsolute` is preferred over relative orientation on Android.
- Lines 763–766: `_headingIsRelative` flag warns the UI when absolute heading isn't available.

**The risks of adding gyroscope fusion outweigh the benefits:**
1. **`rotationRate` availability is inconsistent** — many budget Android phones report `null` or zeros for gyroscope data through the browser API, even when the hardware exists. You'd need a runtime fallback, which adds complexity for no gain on those devices.
2. **Gyroscope integration drift** — even with α = 0.95, pure gyro integration drifts ~1–3°/minute. Over a 5-minute navigation session, that's 5–15° of uncorrected heading error that the compass correction at α = 0.05 is too slow to fix. Getting the blend right requires device-specific tuning.
3. **The building corridors are straight** — the route snapping system already constrains heading to the corridor axis. Micro-jitter in compass heading between checkpoints is corrected by path snapping (line 960–977), making sensor fusion redundant for your use case.
4. **Testing difficulty** — you can't unit-test gyroscope fusion without mock sensor streams at 60Hz with realistic noise profiles. The current compass-only path is simple and testable.

**When it WOULD matter:** If the building had many diagonal corridors or open-plan areas without clear corridor constraints, sensor fusion would help. NMIT's floor plan is predominantly orthogonal corridors, so snapping does the heavy lifting.

---

## 3. Weinberg Dynamic Stride Model — ❌ SKIP

### Why I Recommend Skipping This

**The current stride model already self-corrects:**
- Lines 473–510: Checkpoint calibration adjusts `stepLengthM` by comparing PDR-estimated distance to known graph distance.
- Lines 726–732: Intensity boost already scales step length with footfall force (`√(excess) × 0.06`, capped at `+0.10m`).
- Lines 491: Blend weight is 0.35 for short segments, 0.6 for long — this is conservative and stable.

**The Weinberg model (K · ⁴√(a_max − a_min)) has practical issues in a browser context:**
1. **You need a per-step acceleration window** — tracking a_max and a_min within each step cycle requires buffering accelerometer samples between consecutive step detections and resetting per step. The current code doesn't buffer raw samples — it fires once on the rising-edge crossing. Adding a ring buffer adds complexity and memory pressure on low-end phones.
2. **The calibration constant K varies by person, shoe type, and floor surface** — it needs per-user calibration anyway, which is exactly what the existing checkpoint calibration already provides.
3. **Diminishing returns** — the existing intensity boost already captures the same signal (bigger footfall → longer step) with a simpler model. The checkpoint calibration then corrects any remaining bias. Weinberg would be marginally more accurate on long straight stretches between checkpoints, but your checkpoint spacing is ~15–30m, so calibration fires frequently enough.

**When it WOULD matter:** If checkpoints were spaced 100m+ apart, the between-checkpoint stride accuracy would matter more. At your checkpoint density, the self-correcting calibration is sufficient.

---

## 4. Corridor Geometric Bearing Snapping — ✅ DO IT (Priority 2)

### Why This Is Worth Doing

This is a **cheap, low-risk, high-polish improvement** that makes the navigation arrow look dramatically better to the user.

**Current behavior:** When the user walks straight down a corridor, the direction arrow oscillates ±10–15° due to natural hand sway. The position dot is already snapped to the corridor, but the arrow still jitters.

**Proposed behavior:** When position is snapped to a route segment, blend the display heading toward the segment's geometric bearing.

### What Changes

**`pdr.js`** only — add ~20 lines:
- After `_projectOntoPath()` returns a snapped result, compute the bearing of the segment the dot was snapped to.
- If the PDR heading is within 25° of the segment bearing, blend toward it: `displayHeading = pdrHeading + 0.4 * shortestArc(pdrHeading, segmentBearing)`.
- Store `displayHeading` separately from `this.heading` — the raw compass heading must remain unmodified for step projection. Only the heading reported in `_report()` uses the display version.

This is purely cosmetic — it affects the arrow the user sees, not the actual step projection. Zero risk of breaking positioning.

---

## 5. Proximity-Based Auto-Checkpoint — ✅ DO IT (Priority 3)

### Why This Is Worth Doing

**Reducing screen interaction during walking is a real usability win.** Currently the user must look at and tap the phone at every checkpoint. With corridor checkpoints added, that's potentially 3–5 taps per floor.

### What Changes

**`app.js`** — inside the `onPositionUpdate` callback:
- Compute physical distance from current PDR position to the next checkpoint in the `checkpoints[]` array.
- Track a `_proximityTimer`: when distance ≤ 1.8m, start a 1.5s countdown. If the user stays within range for 1.5s, auto-advance.
- On auto-advance: call `resetToCheckpoint()`, show a subtle toast "Reached [checkpoint name] ✓" with a 5-second "Undo" button.
- On undo: revert checkpoint index and re-snap to previous position.

### Caveats

**This interacts with the anisotropic scaling fix.** The proximity distance calculation must use the corrected anisotropic distance, not isotropic `dist2D`. Implement Feature 1 first.

**Auto-checkpoint should NOT fire for floor transitions** (stairs/lift checkpoints). The user must still manually confirm floor changes because PDR cannot verify vertical movement. Add a guard: `if (nextCheckpoint involves floor change) → require manual tap`.

---

## Implementation Order

```
Feature 1 (Anisotropic) ──→ Feature 4 (Bearing Snap) ──→ Feature 5 (Auto-Checkpoint)
         ↑
  Needs building dimensions
  from user first
```

---

## Execution Checklist

- [ ] **Step 0**: User provides physical building dimensions (X-axis meters, Y-axis meters).
- [ ] **Step 1**: Implement anisotropic scaling in `pdr.js`, `routing.js`, `app.js`, `metrics.js`.
- [ ] **Step 2**: Update `dist2D()` and `_nearestNode()` to use per-axis scaling.
- [ ] **Step 3**: Update unit tests (`pdr.test.js`, `routing.test.js`) with anisotropic assertions.
- [ ] **Step 4**: Add corridor bearing snapping to `_step()` → `_report()` pipeline.
- [ ] **Step 5**: Add proximity auto-checkpoint logic to `app.js` with floor-transition guard.
- [ ] **Step 6**: Run full test suite (`pytest`, `node routing.test.js`, `node pdr.test.js`).
- [ ] **Step 7**: Side-by-side deploy comparison with `v3-pdr-test` branch.
