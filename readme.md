# NMIT Wayfinder

An intelligent indoor navigation PWA for NITTE School of Management (NMIT), Bangalore. Uses a Bidirectional A* pathfinding algorithm with adaptive edge weights learned from user feedback, and features a live Pedestrian Dead Reckoning (PDR) pointer.

## Features
- Bidirectional A* pathfinding across 4 floors (Ground, First, Second, Third)
- Multi-stop routing with explicit turn-by-turn logic
- Live Pedestrian Dead Reckoning (PDR) motion pointer via device sensors
- Visual SVG path overlay on real floor plan images
- Turn-by-turn natural language directions with contextual landmarks
- Wheelchair / elevator-only routing mode
- Performance metrics (distance, estimated time, floor changes)
- Post-navigation feedback with 1-5 star rating & specific issue tagging
- RL-based edge weight adaptation (routes improve over time with feedback)
- PWA — installable, works offline for cached floor maps
- Mobile responsive layout with interactive bottom-sheet navigation
- FAQ chatbot backed by admin-managed Q&A pairs

## Project Structure
- `app.py` — FastAPI backend, graph data, A* search parity tests, feedback/stats/FAQ/admin endpoints
- `templates/index.html` — Jinja2 frontend shell with mobility controls, metrics, directions, and PWA hooks
- `templates/admin.html` — Admin dashboard (feedback stats, edge weights, FAQ management)
- `static/js/routing.js` — Client-side bidirectional A* pathfinding and direction generation
- `static/js/pdr.js` — Accelerometer and compass sensor integration for live step tracking
- `static/js/graph-data.js` — Node coordinates, floor metadata, and edge connections
- `static/style.css` — Modern UI styling, dark mode, glassmorphism, responsive layout, modals
- `static/floor1.png` to `floor4.png` — Floor plan images (Ground to Third)
- `static/manifest.json`, `static/service-worker.js` — PWA assets (v14 caching)

## Getting Started
1. Create a virtual environment: `python -m venv venv`
2. Activate it: `venv\Scripts\activate` (Windows) or `source venv/bin/activate` (Mac/Linux)
3. Install deps: `pip install -r requirements.txt`
4. Run the app: `python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000 --reload`
5. Open `http://localhost:8000` (or your local IP on a mobile device for PDR testing)
6. Admin panel: visit `/admin` (Credentials: `admin` / `nmitwayfinder`)

## Testing
Run `pytest tests/` to execute the backend route and A* parity tests. Tests run on an isolated SQLite database to prevent corrupting local feedback data.