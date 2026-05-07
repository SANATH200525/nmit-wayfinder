# Backend Flow

## Framework Structure
The backend is built with **FastAPI** using a highly modular router structure. The application is initialized in `backend/app.py`, which mounts static files, configures CORS/Middleware, and includes various API routers.

## Route Handling Flow
Requests enter `app.py`, pass through middlewares (such as cache-control headers), and are delegated to the appropriate router in the `backend/routers/` directory:
- `navigation.py`: Handles core telemetry sync (session start, checkpoints, PDR observations) and serves the base index UI.
- `feedback.py`: Processes end-of-route user feedback and rating data.
- `stats.py`: Aggregates usage statistics and metrics for the admin dashboard.
- `admin.py`: Serves the admin UI and processes FAQ updates.
- `pwa.py`: Manages PWA specific endpoints like manifest generation or service worker hooks.

## Authentication Flow
The system utilizes HTTP Basic Auth for administrative routes.
- **Implementation:** `backend/auth.py`
- **Method:** `require_admin` dependency uses `secrets.compare_digest` against hardcoded credentials (`admin` / `nmitwayfinder`).
- **Scope:** Applied only to endpoints under `/admin` and debug routes. Normal user telemetry endpoints are public.

## Validation Flow
Data validation is handled entirely by **Pydantic** models defined in `backend/models.py`.
- Enums are used for categorical data (e.g., `MobilityMode`).
- `Field` validations enforce constraints (e.g., feedback rating `ge=1, le=5`, non-empty strings, maximum list lengths).
- Custom `@field_validator` methods ensure strict cleanup (e.g., stripping whitespace from text inputs).

## Error Handling Strategy
- **Validation Errors:** Handled automatically by FastAPI (returns `422 Unprocessable Entity`).
- **Database Errors:** Caught via standard `try...except` blocks.
  - Integrity errors (e.g., duplicate `session_id`) raise `HTTPException(409)`.
  - Non-fatal telemetry insertion failures are explicitly swallowed (`pass`) to prevent failing the background client requests.

## Database & Repositories
The application uses raw SQLite with `sqlite3` without an ORM.
- Connection injection is handled via the `get_db()` dependency.
- The database is initialized via `init_db()` which ensures all tables exist and seeds default FAQ data.
- WAL (Write-Ahead Logging) is enabled for better concurrency during telemetry inserts.
