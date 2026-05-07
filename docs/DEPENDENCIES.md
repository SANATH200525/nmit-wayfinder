# Dependencies

## Backend (Python)
- **FastAPI**: High-performance asynchronous web framework used for all API endpoints.
- **Uvicorn**: ASGI server used to run the FastAPI application.
- **Jinja2**: Templating engine for rendering the `index.html` and `admin.html` pages.
- **Pydantic**: Data validation and settings management (used for validating incoming JSON payloads).
- **SQLite3**: Standard library database engine, used with WAL mode for data persistence.

## Frontend (JavaScript)
- **No Heavy Frameworks**: The frontend uses Vanilla JavaScript to ensure maximum performance and minimal battery drain during continuous sensor tracking.
- **Tailwind CSS (inferred)**: Utilized for responsive layout and UI styling components (bottom sheets, modals).
- **Service Workers**: Native browser API for offline PWA capabilities.
- **DeviceOrientation & DeviceMotion APIs**: Native browser APIs required for Pedestrian Dead Reckoning (PDR).
