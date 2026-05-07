# State Management

## Global vs Local State
Because the frontend is built without React/Vue, state management relies on Vanilla JavaScript features:
1. **In-Memory State (`window` object):** Used for volatile navigation state (current step, currently selected start/end nodes, active floor view).
2. **Local Storage:** Used for user preferences (e.g., `dark_mode`, `mobility_preference`).
3. **IndexedDB:** Used for queueing asynchronous telemetry requests when the device is offline.

## Offline-First & Cache Strategy
The core of the PWA's state management is its caching strategy via the **Service Worker**.
- **Static Assets:** `graph-data.js` (nodes, edges), floor map images, and core JS/CSS are aggressively cached using a Cache-First strategy.
- **Cache Versioning:** The cache is explicitly versioned (e.g., `v14`). Updates to the manifest or Service Worker trigger a purge of old caches.

## Async State Handling
- Telemetry modules (`metrics.js`) attempt to `fetch()` the backend. 
- If the fetch fails (due to network unavailability), the payload is saved to IndexedDB.
- When the `online` event fires on the `window`, or upon subsequent application loads, a background process loops through IndexedDB and replays the queued POST requests to the backend.
