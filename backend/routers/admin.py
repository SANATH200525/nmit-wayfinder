import sqlite3
from typing import Annotated
from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from backend.db import get_db
from backend.auth import require_admin, require_json_origin
from backend.models import FAQCreatePayload
from backend.graph.weights import _weight_cache
from backend.graph.nodes import nodes
from backend.utils import templates

router = APIRouter()


@router.get('/admin', response_class=HTMLResponse)
def admin(
    request: Request,
    _admin: Annotated[str, Depends(require_admin)],
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
):
    top_routes = conn.execute(
        '''SELECT start, end, COUNT(*) as trips, AVG(rating) as avg_rating
           FROM feedback GROUP BY start, end ORDER BY trips DESC LIMIT 10'''
    ).fetchall()
    modified_weights = conn.execute(
        'SELECT edge, multiplier FROM edge_weights WHERE multiplier != 1.0 ORDER BY multiplier ASC'
    ).fetchall()
    recent_feedback = conn.execute(
        '''SELECT timestamp, start, end, rating, comment
           FROM feedback ORDER BY id DESC LIMIT 20'''
    ).fetchall()
    total_feedback = conn.execute('SELECT COUNT(*) FROM feedback').fetchone()[0]
    global_avg     = conn.execute('SELECT AVG(rating) FROM feedback').fetchone()[0]
    total_edges_modified = conn.execute(
        'SELECT COUNT(*) FROM edge_weights WHERE multiplier != 1.0'
    ).fetchone()[0]
    all_faqs = conn.execute(
        'SELECT id, keywords, answer, active FROM faq ORDER BY id ASC'
    ).fetchall()
    return templates.TemplateResponse(
        request=request,
        name='admin.html',
        context={
            'request': request,
            'top_routes': top_routes,
            'modified_weights': modified_weights,
            'recent_feedback': recent_feedback,
            'total_feedback': total_feedback,
            'global_avg': round(global_avg, 2) if global_avg else None,
            'total_edges_modified': total_edges_modified,
            'node_labels': {k: v['label'] for k, v in nodes.items()},
            'all_faqs': all_faqs,
        },
    )


@router.post('/admin/faq/add')
def faq_add(
    payload: FAQCreatePayload,
    _admin: Annotated[str, Depends(require_admin)],
    _ajax:  Annotated[None, Depends(require_json_origin)],
    conn:   Annotated[sqlite3.Connection, Depends(get_db)],
):
    conn.execute('INSERT INTO faq (keywords, answer, active) VALUES (?, ?, 1)', (payload.keywords, payload.answer))
    conn.commit()
    return {'status': 'ok'}


@router.post('/admin/faq/toggle/{faq_id}')
def faq_toggle(
    faq_id: int,
    _admin: Annotated[str, Depends(require_admin)],
    _ajax:  Annotated[None, Depends(require_json_origin)],
    conn:   Annotated[sqlite3.Connection, Depends(get_db)],
):
    conn.execute('UPDATE faq SET active = 1 - active WHERE id = ?', (faq_id,))
    conn.commit()
    return {'status': 'ok'}


@router.post('/admin/faq/delete/{faq_id}')
def faq_delete(
    faq_id: int,
    _admin: Annotated[str, Depends(require_admin)],
    _ajax:  Annotated[None, Depends(require_json_origin)],
    conn:   Annotated[sqlite3.Connection, Depends(get_db)],
):
    conn.execute('DELETE FROM faq WHERE id = ?', (faq_id,))
    conn.commit()
    return {'status': 'ok'}


@router.post('/admin/reset-weights')
def reset_weights(
    _admin: Annotated[str, Depends(require_admin)],
    _ajax:  Annotated[None, Depends(require_json_origin)],
    conn:   Annotated[sqlite3.Connection, Depends(get_db)],
):
    conn.execute('UPDATE edge_weights SET multiplier = 1.0')
    conn.commit()
    _weight_cache['loaded_at'] = 0
    return {'status': 'ok', 'message': 'All edge weights reset to 1.0'}
