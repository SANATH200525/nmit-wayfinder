# NMIT Wayfinder — End-to-End Project Knowledge

> Reading this file top-to-bottom gives you a complete mental model of the system.

---

## 1. What the Project Is

**NMIT Wayfinder** is an indoor navigation Progressive Web App (PWA) for the NITTE School of Management building, Bangalore.

A visitor:
1. Selects where they are (start room) and where they want to go (destination).
2. Gets a visual route drawn on a real floor plan image.
3. Sees step-by-step turn directions (e.g. "walk 12 m, turn left").
4. Optionally uses the **live PDR pointer** — a dot that moves on the map as they physically walk, powered only by the phone's accelerometer and compass (no GPS, no beacons).
5. Confirms checkpoints at key junctions. The app tracks their progress and adapts.

---

## 2. High-Level Architecture

```
Browser (PWA)                           Python Backend (FastAPI)
┌────────────────────────────┐          ┌────────────────────────────────┐
│  index.html (Jinja2 shell) │  HTTP    │  backend/app.py  (entrypoint)  │
│  app.js     (UI logic)     │◄────────►│  backend/routers/              │
│  routing.js (A* in JS)     │          │    navigation.py               │
│  pdr.js     (sensor engine)│          │    feedback.py                 │
│  metrics.js (analytics)    │          │    stats.py                    │
│  graph-data.js (nodes)     │          │    admin.py                    │
│  service-worker.js (PWA)   │          │    pwa.py                      │
│  style.css                 │          │  backend/db.py    (SQLite)     │
└────────────────────────────┘          │  backend/models.py (Pydantic)  │
                                        └────────────────────────────────┘
                                                    │
                                             feedback.db (SQLite)
```

**Key design principle:** All routing logic runs **client-side** in JavaScript. The server only stores analytics, session data, and feedback. The map never needs a server round-trip after initial load.

---

## 3. Project File Map

```
final_project/
├── backend/
│   ├── app.py            — FastAPI app factory, router registration, DB init
│   ├── db.py             — SQLite connection + init_db() (creates all tables)
│   ├── models.py         — Pydantic request/response models with validation
│   ├── auth.py           — HTTP Basic Auth for admin routes
│   ├── middleware.py     — Cache-Control header injection
│   ├── utils.py          — Jinja2 template loader
│   └── routers/
│       ├── navigation.py — GET /, POST /session/start|checkpoint|pdr
│       ├── feedback.py   — POST /feedback, GET /feedback/{id}
│       ├── stats.py      — GET /stats, GET /metrics
│       ├── admin.py      — GET/POST /admin (FAQ, edge weights, dashboard)
│       └── pwa.py        — GET /manifest.json, GET /service-worker.js
│
├── frontend/static/
│   ├── js/
│   │   ├── app.js        — Main UI controller (~2650 lines)
│   │   ├── routing.js    — Client-side A* pathfinding + directions
│   │   ├── pdr.js        — Pedestrian Dead Reckoning engine (5-layer pipeline)
│   │   ├── graph-data.js — Node coordinates + adjacency list for all 4 floors
│   │   ├── metrics.js    — Session/checkpoint/feedback telemetry POSTs
│   │   └── db-helper.js  — IndexedDB wrapper for offline queue
│   ├── css/style.css     — All UI styling (dark mode, glassmorphism)
│   ├── floor1–4.png      — Real building floor plan photos
│   ├── manifest.json     — PWA metadata (name, icons, display mode)
│   └── service-worker.js — Offline caching + Background Sync
│
├── frontend/templates/
│   ├── index.html        — Jinja2 HTML shell (all UI markup, no logic)
│   └── admin.html        — Admin dashboard template
│
├── tests/
│   ├── test_api.py            — pytest: API endpoint tests
│   └── test_pdr_js/
│       └── pdr.test.js        — Node.js: 22 unit tests for pdr.js
│
├── knowledge/
│   └── PROJECT_KNOWLEDGE.md  — This file
│
├── feedback.db           — SQLite database (runtime only, not committed)
├── requirements.txt      — Python deps (fastapi, uvicorn, jinja2, etc.)
├── package.json          — Node.js: only used to run pdr.test.js
└── .gitignore            — Excludes venv, __pycache__, *.db, uvicorn logs
```

---

## 4. Backend Deep-Dive

### 4.1 Starting the server

```bash
python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000 --reload
```

`app.py` wires everything: CORS middleware, cache-control middleware, static file mount at `/static`, five routers, `init_db()`, and `validate_graph(build_graph())` at startup.

### 4.2 Database schema (`feedback.db`)

| Table | Purpose |
|---|---|
| `feedback` | User ratings (1–5), comments, tags per route |
| `edge_weights` | Per-edge cost multipliers (learned from feedback) |
| `faq` | Admin-managed keyword → answer pairs for the FAQ chatbot |
| `route_sessions` | One row per navigation session (start, end, path, distance) |
| `pdr_observations` | Throttled PDR telemetry rows (x, y, floor, confidence) |
| `route_accuracy_log` | Checkpoint confirmation events (accuracy metrics) |

### 4.3 Reinforcement learning (edge weights)

When a user rates a route ≤ 2 stars, `feedback.py` increases the cost multiplier for each edge on that route by 0.1 (capped at 1.5×). High ratings decrease it toward 1.0. Weights are loaded by JS at page load via `GET /stats` and applied in `edgeCost()` in `routing.js`.

### 4.4 `GET /debug/astar` — Admin-only parity endpoint

Runs a server-side A* for dev/parity testing.
**⚠️ Known difference:** its hardcoded costs (150, 180) do **NOT** match `routing.js` constants (STAIRS_R=75, STAIRS_L=85, LIFT=120). Admin-gated, dev tool only.

---

## 5. Frontend Deep-Dive

### 5.1 graph-data.js

Exports:
- `NODES` — Object keyed by node ID: `{ label, floor, coords: [x, y], type, ... }`
- `GRAPH` — Adjacency list: `{ nodeId: [neighborId, ...] }`

All coordinates are **SVG percentage units (0–100)**. Mapping to meters:
```
1 SVG unit = COORD_TO_METERS = 0.51 m
```
This constant appears in `app.js`, `pdr.js`, and `metrics.js` — **all must agree on 0.51**.

### 5.2 routing.js — Client-side A*

**`planRoute({ startNode, endNode, nodes, graph, mobilityMode, learnedWeights })`**
Returns `[{ id, x, y, floor }, ...]` — the shortest path.

Algorithm: Bidirectional A* with binary min-heaps (Pohl 1971 stopping criterion).
- Edge cost = Euclidean SVG distance + vertical penalty (stair/lift type-aware)
- Heuristic = planar distance + min vertical penalty

**`planAlternate`** — Same but adds large penalty to edges on the primary path.
**`buildDirections(path, nodes)`** — Converts path to turn-by-turn text.
**`mobilityMode = "elevator_only"`** — Stair nodes treated as walls.

### 5.3 app.js — UI Controller

**Key state variables:**

| Variable | Purpose |
|---|---|
| `pathData` | Current primary route array |
| `checkpoints` | Junction+destination nodes to confirm |
| `currentCheckpointIdx` | Index into `checkpoints[]` |
| `pdrEngine` | Active `PDREngine` instance (null when not navigating) |
| `pdrLiveState` | Last `update` from `onPositionUpdate` |
| `currentSessionId` | UUID for current navigation session |
| `AUTO_REROUTE_ENABLED` | `false` — auto-reroute disabled (manual ⚡ button remains) |

**Key functions:**

- `initRoute()` — Plans route, draws SVG path, builds checkpoints, creates PDREngine
- `advanceCheckpoint()` — Confirms checkpoint, advances nav, calls `pdrEngine.resetToCheckpoint()`
- `preparePDRForRoute(startNode, sessionId, path)` — Creates engine, wires callbacks
- `renderPDRMarkers()` — Redraws live dot on active floor SVG
- `createPDRMarkerGroup(update)` — Builds SVG group. Arrow `rotate(update.heading)` — compass heading applied directly (north-up SVG, no adjustment needed)
- `renderPDRStatus(state)` — Updates status card (live / off-route / heading-unreliable / unavailable)

### 5.4 pdr.js — PDR Engine

**5-layer pipeline:**

```
Layer 1: Sensor Input
  DeviceMotion + (deviceorientationabsolute preferred over deviceorientation)
  iOS 13+: requestPermission() inside user-gesture modal

Layer 2: Step Detection
  - accelerationIncludingGravity (raw) OR acceleration (OS-compensated, no double-subtract)
  - Gravity EMA: α=0.18 → magnitude EMA: α=0.50
  - Rising edge > 1.18 m/s² + 300 ms debounce + 1500 ms warmup guard
  - Reorientation guard: >15° gravity shift restarts warmup
  - Intensity boost: sqrt(excess)*0.06, cap 0.10 m

Layer 3: Heading
  - iOS: webkitCompassHeading (always absolute, CW from north)
  - Android: 360 - event.alpha - screenAngle (CCW→CW)
  - Spike rejection: >45° single-tick delta discarded
  - EMA blend: α=0.22 via shortest arc
  - _headingIsRelative flag → headingReliable in update object

Layer 4: Position Update
  _compassToSVGDelta(headingDeg, distUnits):
    dx = dist * sin(heading)     ← east/west
    dy = dist * (-cos(heading))  ← north/south (SVG Y inverted)
  MAP_CORRIDOR_BEARING_DEG = 270 is DOCUMENTARY ONLY — not subtracted

  _projectOntoPath(rawPos):
    - Snap to nearest same-floor path segment if within 3 SVG units
    - Heading mismatch >60° for 2+ steps → _isWrongWay = true, un-snap

Layer 5: Checkpoint Calibration
  resetToCheckpoint(nodeId):
    - Graph-path distance (sum of segments) / PDR estimated distance
    - Blend factor: 0.35 (<15 steps) or 0.60 (≥15 steps)
    - Clamp stepLengthM to [0.45, 1.10 m]
```

**Key constants:**

| Constant | Value | Meaning |
|---|---|---|
| `COORD_TO_METERS` | 0.51 | 1 SVG unit = 0.51 m |
| `DEFAULT_STEP_LENGTH_M` | 0.74 | Initial stride length |
| `MIN_STEP_INTERVAL_MS` | 300 | ~200 spm max cadence debounce |
| `STEP_ACCEL_THRESHOLD` | 1.18 | m/s² threshold for step |
| `HEADING_SMOOTHING` | 0.22 | EMA alpha for heading |
| `GRAVITY_WARMUP_MS` | 1500 | Startup discard window |
| `PATH_SNAP_RADIUS_UNITS` | 3 | ~1.5 m corridor half-width |
| `PDR_DEBUG` | false | Set true locally for step logging |

---

## 6. Data Flow: Route Request → Map Display

```
User picks start + destination
  → initRoute() → planRoute(NODES, GRAPH)
  → pathData: [{ id, x, y, floor }, ...]
  → makeOrthogonalPath() → SVG polyline
  → drawPath() → animated SVG overlay on floor plan
  → buildDirections() → turn-by-turn text panel
  → buildCheckpoints() → checkpoints[]
  → preparePDRForRoute() → PDREngine created, setPath() called
  → startSession() → POST /session/start
  → PDREngine.start() → sensors registered
```

---

## 7. Data Flow: User Walking → Live Dot

```
DeviceOrientationAbsolute event
  → extractHeading() → compass bearing (0–360°, CW, north=0)
  → spike rejection → EMA blend → this.heading updated
  → _report() → onPositionUpdate(update)

DeviceMotion event
  → gravity EMA → magnitude EMA → threshold crossing
  → _step(stepLengthM + intensityBoost)
    → dx = dist*sin(heading), dy = dist*(-cos(heading))
    → clamp [0, 100]
    → _projectOntoPath() → snap + wrong-way check
    → _report() → onPositionUpdate(update)

onPositionUpdate(update):
  → pdrLiveState = update
  → renderPDRMarkers() → dot at (x, y), arrow rotate(heading)
  → headingReliable===false → "Heading Unreliable" warn card
  → isOffRoute/isWrongWay → amber "Off Route" card
  → else → "Live" green card
  → throttled POST /session/pdr (every 2 s)
```

---

## 8. Known Issues and Limitations

| # | Issue | Status |
|---|---|---|
| 1 | `debug/astar` has different cost constants from `routing.js` | Documented — dev tool only |
| 2 | Auto-reroute disabled (`AUTO_REROUTE_ENABLED = false`) | Intentional — pending field validation |
| 3 | PDR requires phone to face direction of travel | Fundamental PDR limitation |
| 4 | Older Android without `deviceorientationabsolute` gets relative heading | UI warning via `headingReliable: false` |
| 5 | `stepLengthM` resets on every new route (not persistent) | Accepted for single-destination use case |
| 6 | Background Sync not available on iOS Safari | Data queued in IndexedDB, flushed on Android |

---

## 9. Admin Panel

URL: `/admin` — Credentials: `admin` / `nmitwayfinder`

- **Feedback stats** — Ratings, recent submissions, tag breakdown
- **Edge weights** — Current multipliers from RL; reset button
- **FAQ management** — Add/edit/delete chatbot Q&A pairs
- **Metrics** — Session counts, PDR stats, checkpoint confirmation rate

---

## 10. Running Locally

```bash
# Python setup
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt

# Start server
python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000 --reload

# Access
# Desktop:  http://localhost:8000
# Mobile:   http://<your-local-IP>:8000   (for PDR sensor testing)
# Admin:    http://localhost:8000/admin

# Tests
pytest tests/                           # Python API tests
node tests/test_pdr_js/pdr.test.js      # JS PDR unit tests (22 cases)
```

---

## 11. Key Design Decisions

| Decision | Rationale |
|---|---|
| Client-side A* routing | Zero server round-trips; works fully offline after first load |
| North-up SVG + standard sin/cos | Floor plan is north-up; `dx=sin(h), dy=-cos(h)` is correct with no frame rotation |
| `deviceorientationabsolute` preferred | Gives magnetic-north-referenced alpha; plain `deviceorientation` zeros alpha at listener start, causing per-device inconsistency |
| Path snap radius = 3 SVG units | ~1.5 m ≈ one corridor half-width; keeps dot on corridor without masking real off-route events |
| Graph-path calibration | Sums node-to-node segment lengths (not Euclidean) — accurate on bent corridors regardless of heading error |
| SQLite (not PostgreSQL) | Single-user, read-heavy; simpler deployment; no concurrent write pressure |
