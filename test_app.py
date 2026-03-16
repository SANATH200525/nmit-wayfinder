import json
import unittest

from app import app, a_star_search, reconstruct_path


class AppTestCase(unittest.TestCase):
    def setUp(self):
        self.app = app.test_client()

    def extract_js_json(self, html, var_name):
        marker = f"window.{var_name} = "
        start = html.find(marker)
        if start == -1:
            return None
        start += len(marker)
        end = html.find(";", start)
        json_text = html[start:end].strip()
        return json.loads(json_text)

    def test_get_index_ok(self):
        resp = self.app.get('/')
        self.assertEqual(resp.status_code, 200)
        html = resp.get_data(as_text=True)
        self.assertIn('id="start_node"', html)
        self.assertIn('id="end_node"', html)
        path = self.extract_js_json(html, 'pathData')
        self.assertEqual(path, [])

    def test_simple_route_same_floor(self):
        resp = self.app.post('/', data={
            'start_node': 'ENTRANCE-GF',
            'end_node': 'COMPUTER-LAB-GF'
        })
        self.assertEqual(resp.status_code, 200)
        path = self.extract_js_json(resp.get_data(as_text=True), 'pathData')
        self.assertIsInstance(path, list)
        self.assertGreater(len(path), 0)
        self.assertEqual(path[0]['id'], 'ENTRANCE-GF')
        self.assertEqual(path[-1]['id'], 'COMPUTER-LAB-GF')
        self.assertTrue(all(p['floor'] == 1 for p in path))

    def test_simple_route_multi_floor(self):
        resp = self.app.post('/', data={
            'start_node': 'ENTRANCE-GF',
            'end_node': 'RESEARCH-PUBLICATION-CENTRE-2F'
        })
        self.assertEqual(resp.status_code, 200)
        path = self.extract_js_json(resp.get_data(as_text=True), 'pathData')
        self.assertIsInstance(path, list)
        self.assertGreater(len(path), 0)
        self.assertEqual(path[0]['id'], 'ENTRANCE-GF')
        self.assertEqual(path[-1]['id'], 'RESEARCH-PUBLICATION-CENTRE-2F')
        self.assertTrue(any(p['floor'] == 3 for p in path))

    def test_elevator_only_avoids_stairs(self):
        resp = self.app.post('/', data={
            'start_node': 'ENTRANCE-GF',
            'end_node': 'RESEARCH-PUBLICATION-CENTRE-2F',
            'mobility': 'elevator_only'
        })
        self.assertEqual(resp.status_code, 200)
        path = self.extract_js_json(resp.get_data(as_text=True), 'pathData')
        self.assertGreater(len(path), 0)
        ids = [p['id'] for p in path]
        self.assertTrue(all('STAIRS' not in pid for pid in ids))
        self.assertTrue(any('LIFT' in pid for pid in ids))

    def test_stairs_only_avoids_elevator(self):
        resp = self.app.post('/', data={
            'start_node': 'ENTRANCE-GF',
            'end_node': 'RESEARCH-PUBLICATION-CENTRE-2F',
            'mobility': 'stairs_only'
        })
        self.assertEqual(resp.status_code, 200)
        path = self.extract_js_json(resp.get_data(as_text=True), 'pathData')
        self.assertGreater(len(path), 0)
        ids = [p['id'] for p in path]
        self.assertTrue(all('LIFT' not in pid for pid in ids))
        self.assertTrue(any('STAIRS' in pid for pid in ids))

    def test_multiple_stops(self):
        resp = self.app.post('/', data={
            'start_node': 'ENTRANCE-GF',
            'end_node': 'ROOM1-3F',
            'stops[]': ['SEMINAR-HALL-1F']
        })
        self.assertEqual(resp.status_code, 200)
        path = self.extract_js_json(resp.get_data(as_text=True), 'pathData')
        self.assertGreater(len(path), 0)
        ids = [p['id'] for p in path]
        self.assertIn('SEMINAR-HALL-1F', ids)
        self.assertEqual(ids[0], 'ENTRANCE-GF')
        self.assertEqual(ids[-1], 'ROOM1-3F')

    def test_invalid_node_returns_empty_path(self):
        resp = self.app.post('/', data={
            'start_node': 'INVALID_NODE',
            'end_node': 'COMPUTER-LAB-GF'
        })
        self.assertEqual(resp.status_code, 200)
        path = self.extract_js_json(resp.get_data(as_text=True), 'pathData')
        self.assertEqual(path, [])

    def test_a_star_direct_connectivity(self):
        came_from = a_star_search('ENTRANCE-GF', 'ROOM1-3F')
        self.assertIn('ROOM1-3F', came_from)
        path = reconstruct_path(came_from, 'ENTRANCE-GF', 'ROOM1-3F')
        self.assertGreater(len(path), 0)
        self.assertEqual(path[0], 'ENTRANCE-GF')
        self.assertEqual(path[-1], 'ROOM1-3F')


if __name__ == '__main__':
    unittest.main()
