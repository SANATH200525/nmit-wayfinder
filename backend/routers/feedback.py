import datetime
import json
import sqlite3
from typing import Annotated
from fastapi import APIRouter, Depends
from backend.db import get_db
from backend.auth import require_json_origin
from backend.models import FeedbackPayload
from backend.graph.weights import _clamp_weight, _weight_cache

router = APIRouter()

@router.post('/feedback')
def save_feedback(
    payload: FeedbackPayload,
    _ajax: Annotated[None, Depends(require_json_origin)],
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
):
    conn.execute(
        'INSERT INTO feedback VALUES (NULL,?,?,?,?,?,?)',
        (
            datetime.datetime.now().isoformat(),
            payload.start,
            payload.end,
            json.dumps(payload.path),
            payload.rating,
            payload.comment,
        ),
    )
    conn.commit()

    delta = 0.05 if payload.rating >= 4 else (-0.10 if payload.rating <= 2 else 0)
    for idx in range(len(payload.path) - 1):
        edge = f"{payload.path[idx]}->{payload.path[idx + 1]}"
        cur = conn.execute('SELECT multiplier FROM edge_weights WHERE edge=?', (edge,)).fetchone()
        old = cur[0] if cur else 1.0
        adjusted = old + delta
        decayed = 0.9 * adjusted + 0.1 * 1.0
        new_w = round(_clamp_weight(decayed), 4)
        conn.execute('INSERT OR REPLACE INTO edge_weights VALUES (?,?)', (edge, new_w))
    conn.commit()

    _weight_cache['loaded_at'] = 0
    return {'status': 'ok'}

