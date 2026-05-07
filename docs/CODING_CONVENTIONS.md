# Coding Conventions

## Naming Conventions
- **Python (Backend):** PEP 8 standard. `snake_case` for variables and functions. `PascalCase` for Pydantic models (e.g., `SessionStartPayload`).
- **JavaScript (Frontend):** `camelCase` for variables and functions. `kebab-case` for file names (e.g., `db-helper.js`).
- **CSS / IDs:** `kebab-case` used heavily for DOM element IDs and classes.

## Folder Structure Conventions
- `/backend`: Contains all Python code, logically split into `routers/` (API endpoints) and `graph/` (data layer).
- `/frontend/static`: Contains all public assets. JS files are logically separated by feature (e.g., `pdr.js`, `routing.js`).
- `/frontend/templates`: Contains the Jinja2 HTML shells.

## API Conventions
- **Public API:** Base URLs (e.g., `/session/start`, `/feedback`).
- **Admin API:** Prefixed with `/admin`.
- **Response Format:** Mostly JSON `{ "status": "ok" }` for successful mutations.
- **Error Handling:** FastAPIs built-in HTTPExceptions are used. A `409 Conflict` is returned for idempotency/duplicate insertions. `422 Unprocessable Entity` for payload validation failures.

## Typing Conventions
- Backend is strictly typed using standard Python type hints (`int`, `str`, `list[str]`) combined with Pydantic `Field` validations.

## Error Handling Patterns (Frontend)
- **Silent Failures for Telemetry:** In offline-first apps, failing to upload a telemetry point shouldn't block the UI. Fetch errors in background syncs are caught and stored locally via IndexedDB without alerting the user.
