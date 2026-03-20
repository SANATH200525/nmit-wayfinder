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
            'start_node': 'MAINENTRANCE-GF',
            'end_node': 'COMPUTERLAB-GF'
        })
        self.assertEqual(resp.status_code, 200)
        path = self.extract_js_json(resp.get_data(as_text=True), 'pathData')
        self.assertIsInstance(path, list)
        self.assertGreater(len(path), 0)
        self.assertEqual(path[0]['id'], 'MAINENTRANCE-GF')
        self.assertEqual(path[-1]['id'], 'COMPUTERLAB-GF')
        self.assertTrue(all(p['floor'] == 1 for p in path))

    def test_simple_route_multi_floor(self):
        resp = self.app.post('/', data={
            'start_node': 'MAINENTRANCE-GF',
            'end_node': 'RESEARCHDEPT-2F'
        })
        self.assertEqual(resp.status_code, 200)
        path = self.extract_js_json(resp.get_data(as_text=True), 'pathData')
        self.assertIsInstance(path, list)
        self.assertGreater(len(path), 0)
        self.assertEqual(path[0]['id'], 'MAINENTRANCE-GF')
        self.assertEqual(path[-1]['id'], 'RESEARCHDEPT-2F')
        self.assertTrue(any(p['floor'] == 3 for p in path))

    def test_elevator_only_avoids_stairs(self):
        resp = self.app.post('/', data={
            'start_node': 'MAINENTRANCE-GF',
            'end_node': 'RESEARCHDEPT-2F',
            'mobility': 'elevator_only'
        })
        self.assertEqual(resp.status_code, 200)
        path = self.extract_js_json(resp.get_data(as_text=True), 'pathData')
        self.assertGreater(len(path), 0)
        ids = [p['id'] for p in path]
        self.assertTrue(all('STAIRSEND' not in pid and 'CURVEDSTAIRS' not in pid for pid in ids))
        self.assertTrue(any('LIFT-' in pid for pid in ids))

    def test_stairs_only_avoids_elevator(self):
        resp = self.app.post('/', data={
            'start_node': 'MAINENTRANCE-GF',
            'end_node': 'RESEARCHDEPT-2F',
            'mobility': 'stairs_only'
        })
        self.assertEqual(resp.status_code, 200)
        path = self.extract_js_json(resp.get_data(as_text=True), 'pathData')
        self.assertGreater(len(path), 0)
        ids = [p['id'] for p in path]
        self.assertTrue(all('LIFT-' not in pid for pid in ids))
        self.assertTrue(any('STAIRSEND' in pid or 'CURVEDSTAIRS' in pid for pid in ids))

    def test_multiple_stops(self):
        resp = self.app.post('/', data={
            'start_node': 'MAINENTRANCE-GF',
            'end_node': 'ROOM1-3F',
            'stops[]': ['SEMINARHALL-1F']
        })
        self.assertEqual(resp.status_code, 200)
        path = self.extract_js_json(resp.get_data(as_text=True), 'pathData')
        self.assertGreater(len(path), 0)
        ids = [p['id'] for p in path]
        self.assertIn('SEMINARHALL-1F', ids)
        self.assertEqual(ids[0], 'MAINENTRANCE-GF')
        self.assertEqual(ids[-1], 'ROOM1-3F')

    def test_path_nodes_have_segment_metadata(self):
        """Every node in a multi-stop path should carry a segment index."""
        resp = self.app.post('/', data={
            'start_node': 'MAINENTRANCE-GF',
            'end_node':   'RESEARCHDEPT-2F',
            'stops[]':    ['SEMINARHALL-1F']
        })
        self.assertEqual(resp.status_code, 200)
        path = self.extract_js_json(resp.get_data(as_text=True), 'pathData')
        self.assertGreater(len(path), 0)
        for node in path:
            self.assertIn('segment', node, f"Node {node['id']} missing 'segment' field")
        # Seminar Hall is a stop — verify at least two distinct segment values
        segs = {p['segment'] for p in path}
        self.assertGreater(len(segs), 1, "Multi-stop route should have > 1 segment")

    def test_invalid_node_returns_empty_path(self):
        resp = self.app.post('/', data={
            'start_node': 'INVALID_NODE',
            'end_node': 'COMPUTERLAB-GF'
        })
        self.assertEqual(resp.status_code, 200)
        path = self.extract_js_json(resp.get_data(as_text=True), 'pathData')
        self.assertEqual(path, [])

    def test_a_star_direct_connectivity(self):
        came_from = a_star_search('MAINENTRANCE-GF', 'ROOM1-3F')
        self.assertIn('ROOM1-3F', came_from)
        path = reconstruct_path(came_from, 'MAINENTRANCE-GF', 'ROOM1-3F')
        self.assertGreater(len(path), 0)
        self.assertEqual(path[0], 'MAINENTRANCE-GF')
        self.assertEqual(path[-1], 'ROOM1-3F')

    def test_feedback_requires_json_origin_header(self):
        """POST /feedback without X-Requested-With should be rejected."""
        payload = {
            'start': 'MAINENTRANCE-GF',
            'end': 'COMPUTERLAB-GF',
            'path': ['MAINENTRANCE-GF', 'COMPUTERLAB-GF'],
            'rating': 4
        }
        resp = self.app.post(
            '/feedback',
            data=json.dumps(payload),
            content_type='application/json'
        )
        self.assertEqual(resp.status_code, 403)

    def test_feedback_accepts_valid_json_with_header(self):
        """POST /feedback with correct headers and valid payload should return ok."""
        payload = {
            'start': 'MAINENTRANCE-GF',
            'end': 'COMPUTERLAB-GF',
            'path': ['MAINENTRANCE-GF', 'COMPUTERLAB-GF'],
            'rating': 5,
            'comment': 'test'
        }
        resp = self.app.post(
            '/feedback',
            data=json.dumps(payload),
            content_type='application/json',
            headers={'X-Requested-With': 'XMLHttpRequest'}
        )
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.get_data(as_text=True))
        self.assertEqual(data['status'], 'ok')

    def test_node_degrees_exposed_not_full_graph(self):
        """index.html should contain nodeDegrees but NOT full graph adjacency."""
        resp = self.app.get('/')
        html = resp.get_data(as_text=True)
        self.assertIn('window.nodeDegrees', html)
        self.assertNotIn('window.graph', html)


if __name__ == '__main__':
    unittest.main()
