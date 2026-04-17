import os
import sqlite3
from typing import Annotated
from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from pathlib import Path
from backend.db import get_db, DB_PATH
from backend.auth import ADMIN_USERNAME, ADMIN_PASSWORD

router = APIRouter()
STATIC_DIR = Path(__file__).resolve().parent.parent.parent / 'frontend' / 'static'


@router.get('/health')
def health():
    return {
        'status': 'ok',
        'db_path': str(DB_PATH),
        'db_exists': os.path.exists(DB_PATH),
    }


@router.get('/coord-picker')
def coord_picker():
    return FileResponse(STATIC_DIR / 'coord_picker.html')


@router.get('/faq')
def get_faqs(conn: Annotated[sqlite3.Connection, Depends(get_db)]):
    rows = conn.execute(
        'SELECT id, keywords, answer FROM faq WHERE active = 1 ORDER BY id ASC'
    ).fetchall()
    return [
        {'id': row[0], 'keywords': [kw.strip() for kw in row[1].split(',')], 'answer': row[2]}
        for row in rows
    ]
