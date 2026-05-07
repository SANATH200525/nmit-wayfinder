# Known Issues & Technical Debt

## Architectural Risks
- **SQLite Concurrency:** While WAL mode helps, SQLite running on a single disk cannot easily be distributed if the system needs to scale horizontally across multiple instances. 
- **In-Memory Graph State:** The entire graph data is loaded into memory on the client side (`graph-data.js`). While currently small (a few hundred kilobytes), massive expansions to the map could increase initial load times and memory footprint on low-end mobile devices.

## Security Concerns
- **Hardcoded Credentials:** The admin credentials (`ADMIN_USERNAME` and `ADMIN_PASSWORD`) are hardcoded in `backend/auth.py`. These should be extracted to `.env` variables immediately before production deployment.
- **Lack of Payload Encryption:** Telemetry endpoints accept raw JSON data. While there's no personal identifiable information (PII), malicious users could potentially spoof PDR or checkpoint requests to manipulate heatmaps or edge weights if they bypass CORS or write automated scripts.

## Large Files & Refactoring Opportunities
- `app.js` / `script.js` (Frontend): Often large and handles many disparate UI concerns. Extracting DOM manipulation into smaller utility classes would improve maintainability.
- `navigation.py`: Contains complex A* debug logic mixed with routing.

## Missing Validation
- While the backend validates the *format* of incoming feedback and telemetry (e.g., tags length, types), it cannot guarantee the *authenticity* of the data (e.g., checking if a user actually physically walked the path before submitting feedback).
