# NMIT Wayfinder

An intelligent indoor navigation PWA for NITTE School of Management (NMIT), Bangalore. Uses the A* pathfinding algorithm with adaptive edge weights learned from user feedback (reinforcement learning).

## Features
- A* pathfinding across 4 floors (Ground, First, Second, Third)
- Visual SVG path overlay on real floor plan images
- Turn-by-turn natural language directions
- Wheelchair / elevator-only routing mode
- Stairs-only routing mode
- Performance metrics (distance, estimated time, floor changes)
- Post-navigation feedback with 1-5 star rating
- RL-based edge weight adaptation (routes improve over time with feedback)
- PWA — installable, works offline for cached floor maps
- Mobile responsive with touch pan/zoom and pinch-to-zoom
- PDR (Pedestrian Dead Reckoning) architecture stub for future implementation

## Project Structure
- `app.py` — Flask backend, graph data, A* search, feedback/stats endpoints
- `templates/index.html` — Jinja2 frontend shell with mobility controls, metrics, directions, and PWA hooks
- `static/script.js` — map rendering, pan/zoom, directions, metrics, feedback client logic, touch + pinch support
- `static/style.css` — glassmorphic UI styling, markers, responsive layout, modals
- `static/floor1.png` … `floor4.png` — floor plan images (Ground to Third)
- `static/manifest.json`, `static/service-worker.js`, `static/icon-192.png`, `static/icon-512.png` — PWA assets
- `requirements.txt` — Python dependencies
- `test_app.py` — unit tests for routing, mobility modes, and A*

## Getting Started
1) Create a virtual environment and install deps: `pip install -r requirements.txt`
2) Run the app: `flask run` (or `python app.py`) and open http://127.0.0.1:5000
3) For offline install, open in Chrome/Edge and “Install app”.

## Testing
Run `python -m pytest -q` (or `pytest`) to execute the backend route and A* tests in `test_app.py`.
