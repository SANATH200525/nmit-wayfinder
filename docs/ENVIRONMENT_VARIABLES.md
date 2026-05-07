# Environment Variables

| Variable | Purpose | Required | Example |
|---|---|---|---|
| `WAYFINDER_DB_PATH` | Overrides the default SQLite database file path. Useful for Docker volumes or isolated testing. | No | `/app/data/feedback.db` |
| `FASTAPI_RELOAD` | Enables Uvicorn hot-reloading. Set to `true` in development. | No | `true` |

*Note: Administrative credentials (`ADMIN_USERNAME`, `ADMIN_PASSWORD`) are currently hardcoded in `backend/auth.py`. Consider extracting these to Environment Variables for production deployments.*
