# Deployment

## Architecture Setup
NMIT Wayfinder is designed to run easily on a single virtual machine (VPS) or containerized environment. 

### Server Components
- **Application Server:** Uvicorn (ASGI server) running FastAPI.
- **Database:** SQLite (Stored locally on disk).
- **Static Assets:** Served directly by FastAPI (via `StaticFiles`), though in high-scale production, placing Nginx or a CDN in front is recommended.

## Running in Production
```bash
# Example Production Command
uvicorn backend.app:app --host 0.0.0.0 --port 8000 --workers 4
```

## Scaling Considerations
- **Database Concurrency:** SQLite is configured with `PRAGMA journal_mode=WAL;`. This allows concurrent reads and writes, making it perfectly adequate for a single-node deployment handling moderate traffic (thousands of students).
- **Stateless Application:** Aside from the SQLite file, the FastAPI app is stateless. However, because SQLite is a local file, horizontal scaling (running across multiple physical servers) is not supported out-of-the-box unless the database is migrated to PostgreSQL/MySQL.

## CI/CD and Docker
*(Currently inferred, implement as needed)*
- A standard `Dockerfile` using `python:3.11-slim` can wrap the `requirements.txt` installation and run the uvicorn command.
- The `feedback.db` file should be mapped to a persistent Docker Volume to prevent data loss on container restarts.

## Cloud Provider Setup
- Deployable to platforms like Render, Railway, DigitalOcean App Platform, or an AWS EC2 instance.
- **HTTPS is Mandatory:** To allow PWA installation and secure Basic Auth, the deployment must include SSL/TLS certificates (e.g., Let's Encrypt).
