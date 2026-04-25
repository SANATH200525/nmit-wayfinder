import sqlite3
from typing import Annotated
from fastapi import APIRouter, Depends, Query
from backend.db import get_db

router = APIRouter()

@router.get('/stats')
def stats(
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
    route: str | None = Query(default=None),
):
    route_avg = None
    route_count = 0
    if route and '+' in route:
        route_start, route_end = route.split('+', 1)
        row = conn.execute(
            'SELECT AVG(rating), COUNT(*) FROM feedback WHERE start=? AND end=?',
            (route_start.strip(), route_end.strip()),
        ).fetchone()
        if row and row[0] is not None:
            route_avg = round(row[0], 2)
            route_count = row[1]

    global_avg = conn.execute('SELECT AVG(rating) FROM feedback').fetchone()[0]
    total_count = conn.execute('SELECT COUNT(*) FROM feedback').fetchone()[0]
    weights = conn.execute('SELECT edge, multiplier FROM edge_weights').fetchall()
    return {
        'avg_rating': route_avg if route_avg is not None else (round(global_avg, 2) if global_avg else None),
        'route_avg': route_avg,
        'route_count': route_count,
        'global_avg': round(global_avg, 2) if global_avg else None,
        'total_feedback': total_count,
        'edge_weights': dict(weights),
    }


@router.get('/metrics')
def metrics(conn: Annotated[sqlite3.Connection, Depends(get_db)]):
    try:
        # Routing stats
        sess = conn.execute("SELECT COUNT(*), AVG(planned_distance_m) FROM route_sessions").fetchone()
        tot_sess = sess[0] if sess else 0
        avg_dist = round(sess[1], 1) if sess and sess[1] is not None else None
        
        top_routes = conn.execute(
            '''SELECT start_node, end_node, COUNT(*) as c 
               FROM route_sessions 
               GROUP BY start_node, end_node 
               ORDER BY c DESC LIMIT 5'''
        ).fetchall()
        
        routes_data = []
        for r in top_routes:
            s, e, c = r
            avg_r = conn.execute(
                'SELECT AVG(rating) FROM feedback WHERE start=? AND end=?', (s, e)
            ).fetchone()[0]
            routes_data.append({
                "start": s,
                "end": e,
                "count": c,
                "avg_rating": round(avg_r, 1) if avg_r is not None else None
            })
            
        # Accuracy stats
        pdr_sess = conn.execute("SELECT COUNT(DISTINCT session_id) FROM pdr_observations").fetchone()[0]
        chkpts = conn.execute("SELECT COUNT(*), SUM(user_confirmed) FROM route_accuracy_log").fetchone()
        tot_chkpts = chkpts[0] if chkpts else 0
        conf_chkpts = chkpts[1] if chkpts and chkpts[1] else 0
        conf_rate = round(conf_chkpts / tot_chkpts * 100, 1) if tot_chkpts > 0 else 0.0

        # Feedback stats
        fb = conn.execute("SELECT COUNT(*), AVG(rating) FROM feedback").fetchone()
        tot_ratings = fb[0] if fb else 0
        avg_rating = round(fb[1], 1) if fb and fb[1] is not None else None
        
        dist_rows = conn.execute("SELECT rating, COUNT(*) FROM feedback GROUP BY rating").fetchall()
        rating_dist = {"1": 0, "2": 0, "3": 0, "4": 0, "5": 0}
        for r, count in dist_rows:
            rating_dist[str(r)] = count

        return {
            "status": "ok",
            "routing": {
                "total_sessions": tot_sess,
                "avg_planned_distance_m": avg_dist,
                "algorithm": "bda_star_js",
                "top_routes": routes_data
            },
            "accuracy": {
                "sessions_with_pdr": pdr_sess,
                "avg_deviation_m": None,
                "pct_on_correct_path": None,
                "checkpoint_confirmation_rate": conf_rate
            },
            "feedback": {
                "total_ratings": tot_ratings,
                "avg_rating": avg_rating,
                "rating_distribution": rating_dist
            }
        }
    except Exception as e:
        return {"error": str(e)}
