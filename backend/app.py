import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from backend.db import init_db
from backend.middleware import add_cache_headers
from backend.routers import navigation_router, feedback_router, stats_router, admin_router, pwa_router
from backend.graph import validate_graph, build_graph

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / 'frontend' / 'static'

app = FastAPI(title='NMIT Wayfinder')
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000", "http://127.0.0.1:8000", "*"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Requested-With"],
)
app.middleware('http')(add_cache_headers)
app.mount('/static', StaticFiles(directory=str(STATIC_DIR)), name='static')

app.include_router(navigation_router)
app.include_router(feedback_router)
app.include_router(stats_router)
app.include_router(admin_router)
app.include_router(pwa_router)

init_db()
validate_graph(build_graph())

if __name__ == '__main__':
    import uvicorn
    # For production use:
    # uvicorn backend.app:app --host 0.0.0.0 --port 8000 --workers 2
    uvicorn.run('backend.app:app', host='127.0.0.1', port=8000, reload=os.environ.get('FASTAPI_RELOAD', 'false').lower() == 'true')
