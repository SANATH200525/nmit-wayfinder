# NMIT Wayfinder

An indoor navigation PWA for NITTE School of Management (NMIT), Bangalore. Uses client-side Bidirectional A* pathfinding with adaptive edge weights learned from user feedback, and a live Pedestrian Dead Reckoning (PDR) motion pointer powered entirely by the phone's accelerometer and compass — no GPS, no beacons.

---

## Features

- **Client-side A\*** routing across 4 floors (Ground → Third), including multi-stop
- **Live PDR motion pointer** — dot tracks your position as you walk using accelerometer + `deviceorientationabsolute`
- **Wrong-way detection** — pointer un-snaps and amber card appears if you walk opposite the route
- **Heading reliability flag** — if the device returns non-absolute compass data, the UI warns the user
- **Checkpoint calibration** — step length auto-calibrates at each confirmed waypoint using graph-path distance
- **Visual SVG path overlay** on real floor plan images
- **Turn-by-turn directions** with natural language + contextual landmarks
- **Wheelchair / elevator-only** routing mode
- **Post-navigation feedback** — 1–5 star rating with specific issue tags
- **RL edge weight adaptation** — routes improve over time from low-rating feedback
- **FAQ chatbot** backed by admin-managed keyword/answer pairs
- **PWA** — installable, works offline for cached maps, Background Sync for telemetry

---

## Project Structure

```
backend/
  app.py          — FastAPI entrypoint; mounts all routers
  db.py           — SQLite schema init (feedback, sessions, PDR, FAQ, edge_weights)
  models.py       — Pydantic models with validation
  routers/
    navigation.py — GET /, POST /session/start|checkpoint|pdr
    feedback.py   — POST /feedback
    stats.py      — GET /stats, GET /metrics
    admin.py      — Admin dashboard (FAQ, edge weights)
    pwa.py        — manifest.json, service-worker.js

frontend/
  templates/index.html   — Jinja2 HTML shell (all markup)
  templates/admin.html   — Admin dashboard
  static/js/
    app.js         — UI controller: routing, map, PDR integration
    routing.js     — Client-side A* + direction builder (zero DOM)
    pdr.js         — 5-layer PDR engine (step detection → position → snap → calibration)
    graph-data.js  — Node coordinates + edge adjacency list for all 4 floors
    metrics.js     — Session/checkpoint/feedback telemetry
    db-helper.js   — IndexedDB wrapper for offline queue
  static/css/style.css   — UI styling (dark mode, glassmorphism)
  static/floor1–4.png    — Floor plan photos
  static/manifest.json   — PWA manifest
  static/service-worker.js

knowledge/
  PROJECT_KNOWLEDGE.md  — End-to-end architecture and data flow documentation

tests/
  test_api.py              — pytest: API endpoint and DB tests
  test_pdr_js/pdr.test.js  — Node.js: 22 unit tests for pdr.js engine
```

---

## Getting Started

```bash
# 1. Create and activate virtual environment
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # Mac / Linux

# 2. Install dependencies
pip install -r requirements.txt

# 3. Start the server
python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000 --reload

# 4. Open in browser
#    Desktop testing:  http://localhost:8000
#    Mobile PDR test:  http://<your-local-IP>:8000
#    Admin panel:      http://localhost:8000/admin  (admin / nmitwayfinder)
```

---

## Testing

```bash
# Python API tests (uses isolated SQLite — does not touch feedback.db)
pytest tests/

# JavaScript PDR unit tests (Node.js, no browser needed)
node tests/test_pdr_js/pdr.test.js
```

---

## PDR Notes

- The live dot tracks **where the phone is pointing** (compass heading), not where you physically move. Hold the phone facing the direction you're walking.
- The app prefers `deviceorientationabsolute` on Android (absolute magnetic-north heading). Plain `deviceorientation` on older devices gives relative alpha — the UI will show a "Heading Unreliable" warning in that case.
- On iOS, sensor access requires a permission prompt — tap **Enable Sensors** when the prompt appears before starting navigation.
- `PDR_DEBUG` in `pdr.js` is `false` by default. Set it to `true` locally to log step events to the console during walk-testing.

---

## For Deeper Understanding

Read [`knowledge/PROJECT_KNOWLEDGE.md`](knowledge/PROJECT_KNOWLEDGE.md) for a complete end-to-end walkthrough of every layer — data flow, pipeline internals, constants, known issues, and design decisions.