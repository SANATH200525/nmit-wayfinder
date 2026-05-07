# Frontend Flow

## Frontend Architecture
The frontend is built using **Vanilla JavaScript** injected into **Jinja2** templates. It relies heavily on standard DOM APIs rather than a heavy component framework like React or Vue. It is structured as a Progressive Web App (PWA) with a Service Worker managing the offline cache.

## Component Hierarchy (Logical)
While not using a framework, the codebase is separated into logical modules in the `static/js/` directory:
- `app.js`: Main entry point, orchestrates UI initialization and event listeners.
- `routing.js`: Contains the Bidirectional A* pathfinding algorithm and turn-by-turn direction generation.
- `pdr.js`: (Pedestrian Dead Reckoning) Manages the `DeviceOrientation` and `DeviceMotion` event listeners to calculate step counts and compass headings.
- `graph-data.js`: The static representation of the physical space (nodes, edges, floors).
- `metrics.js`: Handles queuing and background synchronization of telemetry data.
- `db-helper.js`: Utility wrapper for offline-first actions (IndexedDB).

## State Management
State is managed globally in memory via JavaScript variables attached to the window or within module scopes. 
- **Offline Data:** PWA service workers cache assets (`v14` cache). 
- **Telemetry Queueing:** Data is queued locally if the device is offline and synced when connectivity is restored via `metrics.js` or standard background sync APIs.

## Routing (Client-Side)
Unlike traditional web apps, "routing" here means physical pathfinding, not URL routing. The URL generally remains at `/` while the UI updates dynamically by toggling CSS visibility classes (e.g., showing/hiding bottom sheets, changing floor images).

## API Interaction Patterns
- Fetch API is used for all backend communication.
- Telemetry endpoints (`/session/start`, `/session/checkpoint`, `/session/pdr`) are called asynchronously.
- Failures on telemetry endpoints are gracefully ignored by the frontend to not interrupt the user's physical navigation.

## Rendering Strategy
- **Map:** Floor plans are standard `<img src="floorX.png">` tags.
- **Path Overlay:** Dynamic `<svg>` elements are laid over the floor plans. `routing.js` calculates coordinate pixels and draws `<polyline>` segments.
- **UI:** Bottom-sheet navigation elements, modals, and the FAQ chatbot are built with CSS transitions and triggered via JavaScript class toggling.
