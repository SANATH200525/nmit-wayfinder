# File Map

## Root Directory
- `requirements.txt`: Python dependencies.
- `readme.md`: Main project description.
- `feedback.db`: Local SQLite database file (generated at runtime).
- `/docs/`: Project documentation.

## `/backend`
- `app.py`: **Entry point**. Initializes FastAPI, mounts static files, configures database.
- `db.py`: Database connection factory and initialization script (`init_db`).
- `models.py`: Pydantic schemas for request validation.
- `auth.py`: Basic Auth dependency and hardcoded credentials.
- `middleware.py`: Custom ASGI middleware (cache control).

### `/backend/routers`
- `navigation.py`: Core telemetry endpoints and `/` index rendering.
- `admin.py`: Serves `/admin` and handles FAQ mutations.
- `feedback.py`: Receives and validates end-of-route user feedback.
- `stats.py`: Dashboard metric aggregators.
- `pwa.py`: Web manifest and PWA specific endpoints.

### `/backend/graph`
- `nodes.py`: Coordinate mapping and metadata for physical waypoints.
- `edges.py`: Connections between nodes, defining walking paths.
- `weights.py`: Default algorithmic cost calculations.

## `/frontend/templates`
- `index.html`: Main user-facing application shell.
- `admin.html`: Dashboard shell for administrators.

## `/frontend/static`
- `manifest.json` / `service-worker.js`: PWA configuration and offline caching logic.
- `floor1.png` - `floor4.png`: The visual map backgrounds.

### `/frontend/static/js`
- `app.js` / `script.js`: Main UI initialization and DOM event handlers.
- `routing.js`: Client-side A* pathfinding.
- `pdr.js`: Sensor integration (compass/accelerometer) for live tracking.
- `graph-data.js`: Serialized graph injected into the client.
- `metrics.js`: Offline telemetry queuing logic.
- `db-helper.js`: IndexedDB wrapper for local storage.
