import json
import sqlite3
import unittest
from fastapi.testclient import TestClient

from backend.app import app
from backend.auth import ADMIN_PASS, ADMIN_USER

class AppTestCase(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_get_index_ok(self):
        resp = self.client.get('/')
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn('window.pathData = ', resp.text)
        self.assertIn('<!DOCTYPE html>', resp.text)

    def test_session_start_valid(self):
        resp = self.client.post('/session/start', json={'session_id': 'sess-123'})
        self.assertEqual(resp.status_code, 200)

    def test_session_start_duplicate(self):
        self.client.post('/session/start', json={'session_id': 'sess-dup'})
        resp = self.client.post('/session/start', json={'session_id': 'sess-dup'})
        self.assertEqual(resp.status_code, 409)

    def test_feedback_valid_payload_and_header(self):
        payload = {
            'start': 'MAINENTRANCE-GF',
            'end': 'COMPUTERLAB-GF',
            'path': ['MAINENTRANCE-GF', 'COMPUTERLAB-GF'],
            'rating': 5,
            'comment': 'test',
            'tags': ['clear', 'map-helpful']
        }
        resp = self.client.post(
            '/feedback',
            json=payload,
            headers={'X-Requested-With': 'XMLHttpRequest'},
        )
        self.assertEqual(resp.status_code, 200)

    def test_low_rating_penalises_edge_cost(self):
        payload = {
            'start': 'MAINENTRANCE-GF',
            'end': 'COMPUTERLAB-GF',
            'path': ['MAINENTRANCE-GF', 'COMPUTERLAB-GF'],
            'rating': 1,
        }
        resp = self.client.post(
            '/feedback', json=payload,
            headers={'X-Requested-With': 'XMLHttpRequest'},
        )
        self.assertEqual(resp.status_code, 200)

        from backend.db import DB_PATH
        with sqlite3.connect(DB_PATH) as conn:
            weight = conn.execute(
                'SELECT multiplier FROM edge_weights WHERE edge=?',
                ('MAINENTRANCE-GF->COMPUTERLAB-GF',),
            ).fetchone()[0]
        self.assertGreater(weight, 1.0)

    def test_high_rating_restores_penalised_edge_toward_neutral(self):
        from backend.db import DB_PATH
        edge = 'MAINENTRANCE-GF->COMPUTERLAB-GF'
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute('INSERT OR REPLACE INTO edge_weights VALUES (?, ?)', (edge, 1.4))
            conn.commit()

        payload = {
            'start': 'MAINENTRANCE-GF',
            'end': 'COMPUTERLAB-GF',
            'path': ['MAINENTRANCE-GF', 'COMPUTERLAB-GF'],
            'rating': 5,
        }
        resp = self.client.post(
            '/feedback', json=payload,
            headers={'X-Requested-With': 'XMLHttpRequest'},
        )
        self.assertEqual(resp.status_code, 200)

        with sqlite3.connect(DB_PATH) as conn:
            weight = conn.execute('SELECT multiplier FROM edge_weights WHERE edge=?', (edge,)).fetchone()[0]
        self.assertLess(weight, 1.4)
        self.assertGreaterEqual(weight, 1.0)

    def test_feedback_without_header(self):
        payload = {
            'start': 'MAINENTRANCE-GF',
            'end': 'COMPUTERLAB-GF',
            'path': ['MAINENTRANCE-GF', 'COMPUTERLAB-GF'],
            'rating': 4,
            'tags': ['wrong-floor'],
        }
        resp = self.client.post('/feedback', json=payload)
        self.assertEqual(resp.status_code, 403)

    def test_feedback_invalid_tag_type(self):
        payload = {
            'start': 'MAINENTRANCE-GF',
            'end': 'COMPUTERLAB-GF',
            'path': ['MAINENTRANCE-GF', 'COMPUTERLAB-GF'],
            'rating': 4,
            'tags': ['clear', 3],
        }
        resp = self.client.post(
            '/feedback',
            json=payload,
            headers={'X-Requested-With': 'XMLHttpRequest'},
        )
        self.assertEqual(resp.status_code, 422)

    def test_get_metrics(self):
        resp = self.client.get('/metrics')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('status', resp.json())

    def test_get_admin_without_auth(self):
        resp = self.client.get('/admin')
        self.assertEqual(resp.status_code, 401)

    def test_get_faqs(self):
        resp = self.client.get('/faq')
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.json(), list)

    def test_admin_faq_add_valid(self):
        resp = self.client.post(
            '/admin/faq/add',
            json={'keywords': 'foo', 'answer': 'bar'},
            auth=(ADMIN_USER, ADMIN_PASS),
            headers={'X-Requested-With': 'XMLHttpRequest'},
        )
        self.assertEqual(resp.status_code, 200)

    def test_admin_faq_add_blank_keywords(self):
        resp = self.client.post(
            '/admin/faq/add',
            json={'keywords': '   ', 'answer': 'sample answer'},
            auth=(ADMIN_USER, ADMIN_PASS),
            headers={'X-Requested-With': 'XMLHttpRequest'},
        )
        self.assertEqual(resp.status_code, 422)

if __name__ == '__main__':
    unittest.main()
