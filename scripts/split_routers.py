import os

src = r"c:\Users\sanat\Desktop\final_project\app.py"
with open(src, "r") as f:
    lines = f.readlines()

def write(path, content):
    with open(path, "w") as f:
        f.write(content)

# routers/feedback.py
write(r"c:\Users\sanat\Desktop\final_project\backend\routers\feedback.py", "".join([
    "import datetime\nimport json\nimport sqlite3\nfrom typing import Annotated\nfrom fastapi import APIRouter, Depends\n",
    "from backend.db import get_db\nfrom backend.auth import require_json_origin\nfrom backend.models import FeedbackPayload\n",
    "from backend.graph.weights import _clamp_weight, _weight_cache\n\n",
    "router = APIRouter()\n\n",
    "@router.post('/feedback')\n"
] + [line.replace("@app.post('/feedback')", "") for line in lines[736:767]]))

# routers/stats.py
write(r"c:\Users\sanat\Desktop\final_project\backend\routers\stats.py", "".join([
    "import sqlite3\nfrom typing import Annotated\nfrom fastapi import APIRouter, Depends, Query\n",
    "from backend.db import get_db\n\n",
    "router = APIRouter()\n\n",
    "@router.get('/stats')\n"
] + [line.replace("@app.get('/stats')", "") for line in lines[770:797]] + [
    "\n@router.get('/metrics')\n",
    "def metrics():\n",
    "    return {'status': 'ok'} # stub\n" 
]))

# routers/admin.py
write(r"c:\Users\sanat\Desktop\final_project\backend\routers\admin.py", "".join([
    "import sqlite3\nfrom typing import Annotated\nfrom fastapi import APIRouter, Depends, Request\nfrom fastapi.responses import HTMLResponse\n",
    "from fastapi.templating import Jinja2Templates\nfrom pathlib import Path\n",
    "from backend.db import get_db\nfrom backend.auth import require_admin, require_json_origin\nfrom backend.models import FAQCreatePayload\n",
    "from backend.graph.weights import _weight_cache\nfrom backend.graph.nodes import nodes\n\n",
    "router = APIRouter()\n",
    "TEMPLATES_DIR = Path(__file__).resolve().parent.parent.parent / 'frontend' / 'templates'\n",
    "templates = Jinja2Templates(directory=str(TEMPLATES_DIR))\n\n",
    "@router.get('/admin', response_class=HTMLResponse)\n"
] + [line.replace("@app.get('/admin', response_class=HTMLResponse)", "") for line in lines[800:845]] + [
    "\n@router.post('/admin/faq/add')\n"
] + [line.replace("@app.post('/admin/faq/add')", "") for line in lines[859:871]] + [
    "\n@router.post('/admin/faq/toggle/{faq_id}')\n"
] + [line.replace("@app.post('/admin/faq/toggle/{faq_id}')", "") for line in lines[874:883]] + [
    "\n@router.post('/admin/faq/delete/{faq_id}')\n"
] + [line.replace("@app.post('/admin/faq/delete/{faq_id}')", "") for line in lines[886:895]] + [
    "\n@router.post('/admin/reset-weights')\n"
] + [line.replace("@app.post('/admin/reset-weights')", "") for line in lines[898:907]]))

# routers/pwa.py
write(r"c:\Users\sanat\Desktop\final_project\backend\routers\pwa.py", "".join([
    "import os\nimport sqlite3\nfrom typing import Annotated\nfrom fastapi import APIRouter, Depends\nfrom fastapi.responses import FileResponse\n",
    "from pathlib import Path\nfrom backend.db import get_db, DB_PATH\nfrom backend.auth import require_admin\n\n",
    "router = APIRouter()\nSTATIC_DIR = Path(__file__).resolve().parent.parent.parent / 'frontend' / 'static'\n\n",
    "@router.get('/health')\n"
] + [line.replace("@app.get('/health')", "") for line in lines[910:917]] + [
    "\n@router.get('/coord-picker')\n"
] + [line.replace("@app.get('/coord-picker')", "") for line in lines[920:922]] + [
    "\n@router.get('/faq')\n"
] + [line.replace("@app.get('/faq')", "") for line in lines[848:856]]
))

# routers/navigation.py
write(r"c:\Users\sanat\Desktop\final_project\backend\routers\navigation.py", "".join([
    "import json\nfrom fastapi import APIRouter, Request\nfrom fastapi.responses import HTMLResponse\n",
    "from fastapi.templating import Jinja2Templates\nfrom pathlib import Path\n",
    "from backend.graph.nodes import nodes, FLOOR_DISPLAY\n",       
    "from backend.graph.edges import build_graph\n\n",
    "router = APIRouter()\n",
    "TEMPLATES_DIR = Path(__file__).resolve().parent.parent.parent / 'frontend' / 'templates'\n",
    "templates = Jinja2Templates(directory=str(TEMPLATES_DIR))\n",
    "graph = build_graph()\n\n",
] + lines[601:646] + [
    "\n@router.get('/', response_class=HTMLResponse)\n",
    "async def index(request: Request):\n",
    "    context = build_index_context(request)\n",
    "    return templates.TemplateResponse(request=request, name='index.html', context=context)\n\n",
    "@router.post('/session/start')\n",
    "async def session_start():\n",
    "    return {'status': 'ok'}\n\n",
    "@router.post('/session/checkpoint')\n",
    "async def session_checkpoint():\n",
    "    return {'status': 'ok'}\n",
]))

# routers/__init__.py
write(r"c:\Users\sanat\Desktop\final_project\backend\routers\__init__.py", "".join([
    "from .navigation import router as navigation_router\n",
    "from .feedback import router as feedback_router\n",
    "from .stats import router as stats_router\n",
    "from .admin import router as admin_router\n",
    "from .pwa import router as pwa_router\n"
]))

# NEW app.py
write(r"c:\Users\sanat\Desktop\final_project\backend\app.py", "".join([
    "import os\nfrom pathlib import Path\nfrom fastapi import FastAPI\nfrom fastapi.staticfiles import StaticFiles\n",
    "from backend.db import init_db\nfrom backend.middleware import add_cache_headers\n",
    "from backend.routers import navigation_router, feedback_router, stats_router, admin_router, pwa_router\n",
    "from backend.graph import validate_graph, build_graph\n\n",
    "BASE_DIR = Path(__file__).resolve().parent.parent\n",
    "STATIC_DIR = BASE_DIR / 'frontend' / 'static'\n\n",
    "app = FastAPI(title='NMIT Wayfinder')\n",
    "app.middleware('http')(add_cache_headers)\n",
    "app.mount('/static', StaticFiles(directory=str(STATIC_DIR)), name='static')\n\n",
    "app.include_router(navigation_router)\n",
    "app.include_router(feedback_router)\n",
    "app.include_router(stats_router)\n",
    "app.include_router(admin_router)\n",
    "app.include_router(pwa_router)\n\n",
    "init_db()\n",
    "validate_graph(build_graph())\n\n",
    "if __name__ == '__main__':\n",
    "    import uvicorn\n",
    "    uvicorn.run('backend.app:app', host='127.0.0.1', port=8000, reload=os.environ.get('FASTAPI_RELOAD', 'false').lower() == 'true')\n"
]))

print("Done generating routers and app.py!")
