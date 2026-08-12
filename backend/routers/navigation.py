import math
import heapq
import sqlite3
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
import json
from datetime import datetime, timezone
from backend.utils import templates
from backend.db import get_db
from backend.auth import require_admin
from backend.graph.nodes import nodes as NODES
from backend.graph.edges import build_graph
from backend.models import SessionStartPayload, CheckpointPayload, PDRObservationPayload

router = APIRouter()





# ---------------------------------------------------------------------------
# GET / — serve the HTML shell only; routing runs client-side
# ---------------------------------------------------------------------------
@router.get('/', response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(
        request=request,
        name='index.html',
        context={'request': request},
    )


# ---------------------------------------------------------------------------
# POST /session/start — called from JS / Background Sync (no custom headers)
# ---------------------------------------------------------------------------
@router.post('/session/start')
def session_start(
    payload: SessionStartPayload,
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
):
    try:
        ts = datetime.now(timezone.utc).isoformat()
        conn.execute(
            '''INSERT INTO route_sessions
               (session_id, start_node, end_node, mobility, planned_path, planned_distance_m, timestamp, online)
               VALUES (?,?,?,?,?,?,?,?)''',
            (payload.session_id, payload.start_node, payload.end_node,
             payload.mobility, json.dumps(payload.planned_path), payload.planned_distance_m, ts, 1),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail='Duplicate session_id')
    except Exception:
        pass  # non-fatal
    return {'status': 'ok'}


# ---------------------------------------------------------------------------
# POST /session/checkpoint — called from JS / Background Sync
# ---------------------------------------------------------------------------
@router.post('/session/checkpoint')
def session_checkpoint(
    payload: CheckpointPayload,
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
):
    try:
        ts = datetime.now(timezone.utc).isoformat()
        conn.execute(
            '''INSERT INTO route_accuracy_log
               (session_id, timestamp, checkpoint_index, checkpoint_node_id, user_confirmed)
               VALUES (?,?,?,?,?)''',
            (payload.session_id, ts, payload.checkpoint_index, payload.checkpoint_node_id, 1 if payload.user_confirmed else 0),
        )
        conn.commit()
    except Exception:
        pass  # non-fatal
    return {'status': 'ok'}


# ---------------------------------------------------------------------------
# POST /session/pdr — called from JS during movement
# ---------------------------------------------------------------------------
@router.post('/session/pdr')
def session_pdr(
    payload: PDRObservationPayload,
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
):
    try:
        ts = datetime.now(timezone.utc).isoformat()
        conn.execute(
            '''INSERT INTO pdr_observations
               (session_id, timestamp, estimated_x, estimated_y, floor, nearest_node, distance_to_nearest_m, confidence)
               VALUES (?,?,?,?,?,?,?,?)''',
            (payload.session_id, ts, payload.estimated_x, payload.estimated_y, payload.floor,
             payload.nearest_node, payload.distance_to_nearest_m, payload.confidence),
        )
        conn.commit()
    except Exception:
        pass
    return {'status': 'ok'}


# ---------------------------------------------------------------------------
# GET /debug/astar — Parity test endpoint
# ---------------------------------------------------------------------------
@router.get('/debug/astar')
def debug_astar(
    start: str = Query(...),
    end: str = Query(...),
    # Only allow with admin auth (as requested)
    _admin: Annotated[str, Depends(require_admin)] = None,
):
    if start not in NODES or end not in NODES:
        return {'path': []}
    
    graph = build_graph()
    
    def edge_cost(a, b):
        # NOTE: These cost constants (150, 180) differ from the JS routing.js values
        # (STAIRS_R_COST=75, STAIRS_L_COST=85, LIFT_COST=120).
        # This endpoint is a dev/parity-test tool only. Never use it for production routing.
        x1, y1 = NODES[a]['coords']
        x2, y2 = NODES[b]['coords']
        f1 = NODES[a]['floor']
        f2 = NODES[b]['floor']
        base = math.sqrt((x1-x2)**2 + (y1-y2)**2)
        if f1 == f2: return base
        delta = abs(f1 - f2)
        a_type, b_type = NODES[a].get('type'), NODES[b].get('type')
        a_kind, b_kind = NODES[a].get('stairs_kind'), NODES[b].get('stairs_kind')
        if a_kind == 'curved' or b_kind == 'curved': return base + 150 * delta
        if a_type == 'stairs' or b_type == 'stairs': return base + 180 * delta
        if a_type == 'lift' or b_type == 'lift': return base + 120 * delta
        return base + 180 * delta

    def heuristic(a, b):
        x1, y1 = NODES[a]['coords']
        x2, y2 = NODES[b]['coords']
        return math.sqrt((x1-x2)**2 + (y1-y2)**2) + 120 * abs(NODES[a]['floor'] - NODES[b]['floor'])
    
    open_set = [(heuristic(start, end), 0, start)]
    g_score = {start: 0}
    came_from = {}
    
    while open_set:
        _, g, current = heapq.heappop(open_set)
        if current == end:
            path = []
            while current in came_from:
                path.append(current)
                current = came_from[current]
            path.append(start)
            return {'path': path[::-1]}
            
        for nbr in graph.get(current, []):
            if NODES[nbr].get('dead_end') and nbr != end: continue
            
            tentative_g = g + edge_cost(current, nbr)
            if tentative_g < g_score.get(nbr, float('inf')):
                g_score[nbr] = tentative_g
                came_from[nbr] = current
                heapq.heappush(open_set, (tentative_g + heuristic(nbr, end), tentative_g, nbr))
                
    return {'path': []}
