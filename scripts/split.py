import os

src = r"c:\Users\sanat\Desktop\final_project\app.py"
with open(src, "r") as f:
    lines = f.readlines()

def write(path, content):
    with open(path, "w") as f:
        f.write(content)

# models.py
write(r"c:\Users\sanat\Desktop\final_project\backend\models.py", "".join(["from pydantic import BaseModel, Field, field_validator\n\n"] + lines[567:600]))

# middleware.py
write(r"c:\Users\sanat\Desktop\final_project\backend\middleware.py", "".join(["import datetime\nfrom fastapi import Request\n\n"] + lines[42:55]))

# auth.py
write(r"c:\Users\sanat\Desktop\final_project\backend\auth.py", "".join([
    "import secrets\nfrom typing import Annotated\nfrom fastapi import Depends, HTTPException, Request, status\nfrom fastapi.security import HTTPBasic, HTTPBasicCredentials\n\n",
    "security = HTTPBasic(auto_error=False)\n\n"
] + lines[59:61] + ["\n"] + lines[76:94]))

# db.py
write(r"c:\Users\sanat\Desktop\final_project\backend\db.py", "".join([
    "import sqlite3\nfrom pathlib import Path\n\n",
    "BASE_DIR = Path(__file__).resolve().parent.parent\n",
] + lines[65:75] + ["\n"] + lines[95:199]))

# graph/nodes.py
write(r"c:\Users\sanat\Desktop\final_project\backend\graph\nodes.py", "".join(lines[226:322]))

# graph/weights.py
write(r"c:\Users\sanat\Desktop\final_project\backend\graph\weights.py", "".join([
    "import time\nimport sqlite3\nfrom backend.db import DB_PATH\n\n"
] + lines[200:222]))

# graph/edges.py
write(r"c:\Users\sanat\Desktop\final_project\backend\graph\edges.py", "".join([
    "import math\n",
    "from backend.graph.nodes import nodes\n\n"
] + lines[322:448] + ["\n"] + lines[450:478]))

# graph/__init__.py
write(r"c:\Users\sanat\Desktop\final_project\backend\graph\__init__.py", "".join([
    "from .nodes import nodes, FLOOR_DISPLAY, CATEGORY_ORDER\n",
    "from .edges import build_graph, add_edge, validate_graph\n",
    "from .weights import get_learned_weights, _weight_cache, _clamp_weight\n"
]))

print("Done slicing!")
