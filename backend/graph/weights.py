import time
import sqlite3
from backend.db import DB_PATH

def _clamp_weight(val):
    return max(0.7, min(1.5, val))

_weight_cache = {'weights': {}, 'loaded_at': 0}
_WEIGHT_CACHE_TTL = 30  # seconds


def get_learned_weights():
    now = time.time()
    if now - _weight_cache['loaded_at'] > _WEIGHT_CACHE_TTL:
        try:
            conn = sqlite3.connect(DB_PATH)
            try:
                rows = conn.execute('SELECT edge, multiplier FROM edge_weights').fetchall()
            finally:
                conn.close()
            _weight_cache['weights'] = {k: _clamp_weight(v) for k, v in rows}
        except Exception:
            pass
        _weight_cache['loaded_at'] = now
    return _weight_cache['weights']

