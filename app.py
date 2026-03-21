import os
import heapq
import math
import json
import sqlite3
import datetime
import time
from functools import wraps

from flask import Flask, Response, render_template, request, jsonify, send_from_directory
from flask_wtf.csrf import CSRFProtect, generate_csrf

app = Flask(__name__)
csrf = CSRFProtect(app)
app.config['SECRET_KEY'] = 'nmit-wayfinder-secret-key-2024'
app.config['WTF_CSRF_CHECK_DEFAULT'] = False  # manual protection on selected routes

# Cache static files aggressively — 1 year for floor plans and icons,
# browser won't re-request them on repeat visits.
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 31536000  # 1 year in seconds

@app.after_request
def add_cache_headers(response):
    """Add aggressive cache headers for static assets."""
    if request.path.startswith('/static/'):
        # Floor plans and icons: cache for 1 year
        if any(request.path.endswith(ext) for ext in ('.png', '.jpg', '.ico', '.svg')):
            response.cache_control.public = True
            response.cache_control.max_age = 31536000
            response.headers['Expires'] = (
                datetime.datetime.utcnow() + datetime.timedelta(days=365)
            ).strftime('%a, %d %b %Y %H:%M:%S GMT')
        # JS and CSS: cache for 1 day (shorter since they change more often)
        elif any(request.path.endswith(ext) for ext in ('.js', '.css')):
            response.cache_control.public = True
            response.cache_control.max_age = 86400
    return response

# ---------------------------------------------------------------------------
# Admin credentials — change these to your preferred username/password.
# ---------------------------------------------------------------------------
ADMIN_USER = 'admin'
ADMIN_PASS = 'wayfinder2026'

# -------------------------------------------------------------------
# Database + adaptive edge weights
# -------------------------------------------------------------------
DB_PATH = 'feedback.db'


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth = request.authorization
        if not auth or auth.username != ADMIN_USER or auth.password != ADMIN_PASS:
            return Response(
                'Unauthorized',
                401,
                {'WWW-Authenticate': 'Basic realm="Wayfinder Admin"'}
            )
        return f(*args, **kwargs)
    return decorated


def require_json_origin(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if request.headers.get('X-Requested-With') != 'XMLHttpRequest':
            return jsonify({'status': 'error', 'message': 'Forbidden'}), 403
        return f(*args, **kwargs)
    return decorated


def init_db():
    """Create feedback + edge_weights + faq tables if they do not exist."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute('''CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT, start TEXT, end TEXT,
        path TEXT, rating INTEGER, comment TEXT
    )''')
    conn.execute('''CREATE TABLE IF NOT EXISTS edge_weights (
        edge TEXT PRIMARY KEY, multiplier REAL DEFAULT 1.0
    )''')
    conn.execute('''CREATE TABLE IF NOT EXISTS faq (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        keywords TEXT NOT NULL,
        answer TEXT NOT NULL,
        active INTEGER DEFAULT 1
    )''')
    conn.commit()
    count = conn.execute('SELECT COUNT(*) FROM faq').fetchone()[0]
    if count == 0:
        seed = [
            ('where is the library,find library,library location',
             'The Library is on the Ground Floor, along the left side of the main corridor.'),
            ('principal office,where is principal,principals room,principal room',
             "The Principal's Room is on the Ground Floor, near the far left end of the corridor."),
            ('admin office,administration,where is admin',
             'The Admin Office is on the Ground Floor, near the main entrance on the right side.'),
            ('office ground floor,ground floor office,where is office',
             'The Office is on the Ground Floor beside the lift and curved stairs cluster.'),
            ('tutorial room,where is tutorial',
             'The Tutorial Room is on the Ground Floor, just left of the admin office area.'),
            ('computer lab,where is computer lab,lab location',
             'The Computer Lab is on the Ground Floor in the middle section of the main corridor.'),
            ('conference room 1,conf room 1,conference room one',
             'Conference Room 1 is on the Ground Floor, to the right of the computer lab.'),
            ('conference room 2,conf room 2,conference room two',
             'Conference Room 2 is on the Ground Floor, near the computer lab and classroom cluster.'),
            ('conference room,conference rooms,meeting room',
             'Conference Room 1 and Conference Room 2 are both on the Ground Floor near the centre corridor.'),
            ('classroom,class room,where is classroom',
             'The Classroom is on the Ground Floor, between the computer lab area and the library side.'),
            ('seminar hall,where is seminar hall,seminar room',
             'The Seminar Hall is on the First Floor near the central corridor.'),
            ('design lab,design thinking,design thinking lab',
             'The Design Thinking Lab is on the First Floor beside the Seminar Hall.'),
            ('ups room,ups,server room',
             'The UPS Room is on the First Floor beside the Seminar Hall and Design Thinking Lab.'),
            ('board room,where is board room,boardroom',
             'The Board Room is on the First Floor toward the left side of the corridor.'),
            ('media unit,media room,media',
             'The Media Unit is on the First Floor near the lift and curved stairs.'),
            ('staff room 1,staffroom1',
             'Staff Room 1 is on the First Floor along the main corridor.'),
            ('staff room 2,staffroom2',
             'Staff Room 2 is on the First Floor up the passageway branch from the main corridor.'),
            ('room 3 first floor,room3 first floor,room 3 on first floor',
             'Room 3 is on the First Floor up the passageway branch near Staff Room 2.'),
            ('alumni,alumni office,alumni relations',
             'The Alumni Relations Office is on the Second Floor near the right-side curved stairs.'),
            ('corporate relations,corporate office,corporate relations department',
             'The Corporate Relations Department is on the Second Floor near the Student Council Room.'),
            ('student council,student council room',
             'The Student Council Room is on the Second Floor near the right side of the corridor.'),
            ('research,publication,research centre,research department',
             'The Research and Publication Centre is on the Second Floor near the middle corridor.'),
            ('case study lab,case study lab 1,case study lab 2',
             'Case Study Lab 1 and Case Study Lab 2 are on the Second Floor near the middle corridor.'),
            ('faculty lounge,staff lounge,faculty room',
             'The Faculty Lounge is on the Second Floor along the main corridor.'),
            ('entrepreneurship,e-cell,entrepreneurship cell',
             'The Entrepreneurship Cell is on the Second Floor toward the left side of the corridor.'),
            ('placement cell,placement office,placements,career counseling',
             'The Placement Cell and Career Counseling office is on the Second Floor near the left side of the corridor.'),
            ('room 1 third floor,room1 third floor,room 1 on third floor',
             'Room 1 is on the Third Floor along the main corridor.'),
            ('room 2 third floor,room2 third floor,room 2 on third floor',
             'Room 2 is on the Third Floor along the main corridor.'),
            ('room 3 third floor,room3 third floor,room 3 on third floor',
             'Room 3 is on the Third Floor along the main corridor.'),
            ('room 4 third floor,room4 third floor,room 4 on third floor',
             'Room 4 is on the Third Floor near the right-side lift and curved stairs cluster.'),
            ('where is the lift,elevator location,find lift',
             'The lift is beside the main entrance on the Ground Floor and serves all four floors.'),
            ('stairs,staircase,where are the stairs,main stairs,curved stairs',
             'There are main stairs at the left end of each floor and curved stairs near the lift cluster on the right side.'),
            ('restroom,toilet,washroom,bathroom,where is toilet',
             'Restrooms are available on every floor near the left end of the corridor.'),
            ('wheelchair,accessible,disability,mobility',
             'Use Elevator Only mode for wheelchair-accessible routes so the app avoids both staircases.'),
            ('balcony,where is balcony',
             'The Balcony is on the First Floor beside the lift cluster.'),
            ('how to use,how does this work,how to navigate',
             'Select your current location, choose your destination, then tap Initiate Route. The map shows turn-by-turn directions.'),
            ('add stop,multiple stops,via,intermediate stop',
             'Tap the Add Stop button to add an intermediate stop on your route.'),
            ('floor changes,what does floor changes mean',
             'Floor Changes shows how many different floors your route passes through.'),
            ('checkpoint,what is checkpoint,reached checkpoint',
             'Checkpoints mark key turns along your route. Tap Reached Checkpoint to advance navigation.'),
        ]
        conn.executemany('INSERT INTO faq (keywords, answer) VALUES (?, ?)', seed)
        conn.commit()
    conn.close()


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

# -------------------------------------------------------------------
# Graph data
# Coordinates are percentage values (0–100) relative to each floor PNG.
# -------------------------------------------------------------------
nodes = {

    # -- GROUND FLOOR (floor: 1) -------------------------------------
    'MAINENTRANCE-GF':      {'coords': (80, 59), 'floor': 1, 'label': 'Main Entrance',         'category': 'Entrance'},
    'OFFICE-GF':            {'coords': (74, 43), 'floor': 1, 'label': 'Office',                'category': 'Offices'},
    'ADMIN-GF':             {'coords': (76, 59), 'floor': 1, 'label': 'Admin Office',          'category': 'Offices'},
    'TUTORIAL-GF':          {'coords': (71, 57), 'floor': 1, 'label': 'Tutorial Room',         'category': 'Rooms'},
    'CONFERENCEROOM1-GF':   {'coords': (55, 43), 'floor': 1, 'label': 'Conference Room 1',     'category': 'Rooms'},
    'CONFERENCEROOM2-GF':   {'coords': (38, 43), 'floor': 1, 'label': 'Conference Room 2',     'category': 'Rooms'},
    'COMPUTERLAB-GF':       {'coords': (43, 58), 'floor': 1, 'label': 'Computer Lab',          'category': 'Labs & Rooms'},
    'CLASSROOM-GF':         {'coords': (34, 43), 'floor': 1, 'label': 'Classroom',             'category': 'Rooms'},
    'LIBRARY-GF':           {'coords': (24, 59), 'floor': 1, 'label': 'Library',               'category': 'Offices'},
    'PRINCIPALROOM-GF':     {'coords': (19, 59), 'floor': 1, 'label': "Principal's Room",      'category': 'Offices'},
    'RESTROOMS-GF':         {'coords': (14, 43), 'floor': 1, 'label': 'Restrooms',             'category': 'Restrooms'},
    'LIFT-GF':              {'coords': (71, 52), 'floor': 1, 'label': 'Lift (Ground Floor)',   'category': 'Lift & Stairs'},
    'CURVEDSTAIRS-GF':      {'coords': (76, 43), 'floor': 1, 'label': 'Curved Stairs (Ground Floor)', 'category': 'Lift & Stairs'},
    'STAIRSEND-GF':         {'coords': (11, 58), 'floor': 1, 'label': 'Stairs End (Ground Floor)',   'category': 'Lift & Stairs'},
    # GF waypoints
    'HALLWAY-TURNPOINT-1-GF': {'coords': (74, 57), 'floor': 1, 'label': 'GF Turn 1', 'is_waypoint': True},
    'HALLWAY-TURNPOINT-2-GF': {'coords': (44, 58), 'floor': 1, 'label': 'GF Turn 2', 'is_waypoint': True},
    'HALLWAY-TURNPOINT-3-GF': {'coords': (13, 57), 'floor': 1, 'label': 'GF Turn 3', 'is_waypoint': True},

    # -- FIRST FLOOR (floor: 2) --------------------------------------
    'MEDIAUNIT-1F':         {'coords': (71, 43), 'floor': 2, 'label': 'Media Unit',            'category': 'Rooms'},
    'BALCONY-1F':           {'coords': (78, 61), 'floor': 2, 'label': 'Balcony',               'category': 'Rooms', 'dead_end': True},
    'ROOM1-1F':             {'coords': (66, 43), 'floor': 2, 'label': 'Room 1',                'category': 'Rooms'},
    'SEMINARHALL-1F':       {'coords': (55, 60), 'floor': 2, 'label': 'Seminar Hall',          'category': 'Labs & Rooms'},
    'DESIGNLAB-1F':         {'coords': (51, 60), 'floor': 2, 'label': 'Design Thinking Lab',   'category': 'Labs & Rooms'},
    'UPSROOM-1F':           {'coords': (48, 60), 'floor': 2, 'label': 'UPS Room',              'category': 'Rooms'},
    'STAFFROOM1-1F':        {'coords': (33, 43), 'floor': 2, 'label': 'Staff Room 1',          'category': 'Offices'},
    'STAFFROOM2-1F':        {'coords': (36, 27), 'floor': 2, 'label': 'Staff Room 2',          'category': 'Offices'},
    'ROOM3-1F':             {'coords': (36, 29), 'floor': 2, 'label': 'Room 3',                'category': 'Rooms'},
    'BOARDROOM-1F':         {'coords': (22, 60), 'floor': 2, 'label': 'Board Room',            'category': 'Rooms'},
    'ROOM2-1F':             {'coords': (18, 61), 'floor': 2, 'label': 'Room 2',                'category': 'Rooms'},
    'RESTROOMS-1F':         {'coords': (13, 43), 'floor': 2, 'label': 'Restrooms',             'category': 'Restrooms'},
    'LIFT-1F':              {'coords': (69, 53), 'floor': 2, 'label': 'Lift (First Floor)',    'category': 'Lift & Stairs'},
    'CURVEDSTAIRS-1F':      {'coords': (73, 43), 'floor': 2, 'label': 'Curved Stairs (First Floor)', 'category': 'Lift & Stairs'},
    'STAIRSEND-1F':         {'coords': (8, 57), 'floor': 2, 'label': 'Stairs End (First Floor)',   'category': 'Lift & Stairs'},
    # 1F waypoints
    'HALLWAY-TURNPOINT-1-1F': {'coords': (72, 59), 'floor': 2, 'label': '1F Turn 1', 'is_waypoint': True},
    'HALLWAY-TURNPOINT-2-1F': {'coords': (36, 59), 'floor': 2, 'label': '1F Turn 2', 'is_waypoint': True},
    'HALLWAY-TURNPOINT-3-1F': {'coords': (8, 60), 'floor': 2, 'label': '1F Turn 3', 'is_waypoint': True},
    # 1F passageway branch up to StaffRoom2/Room3
    'PASSAGEWAY-1F': {'coords': (36, 43), 'floor': 2, 'label': '1F Passageway Mid', 'is_waypoint': True},

    # -- SECOND FLOOR (floor: 3) -------------------------------------
    'ALUMNIRELATIONSOFFICE-2F': {'coords': (67, 42), 'floor': 3, 'label': 'Alumni Relations Office', 'category': 'Offices'},
    'STUDENTCOUNCILROOM-2F': {'coords': (67, 61), 'floor': 3, 'label': 'Student Council Room', 'category': 'Rooms'},
    'CORPORATERELATIONSDEPT-2F': {'coords': (70, 61), 'floor': 3, 'label': 'Corporate Relations Department', 'category': 'Offices'},
    'CASESTUDYLAB1-2F': {'coords': (46, 43), 'floor': 3, 'label': 'Case Study Lab 1', 'category': 'Labs & Rooms'},
    'CASESTUDYLAB2-2F': {'coords': (50, 43), 'floor': 3, 'label': 'Case Study Lab 2', 'category': 'Labs & Rooms'},
    'RESEARCHDEPT-2F': {'coords': (39, 59), 'floor': 3, 'label': 'Research & Publication Centre', 'category': 'Offices'},
    'FACULTYLOUNGE-2F': {'coords': (32, 43), 'floor': 3, 'label': 'Faculty Lounge', 'category': 'Offices'},
    'ENTREPRENEURSHIPCELL-2F': {'coords': (22, 59), 'floor': 3, 'label': 'Entrepreneurship Cell', 'category': 'Offices'},
    'PLACEMENTCELL-2F': {'coords': (18, 60), 'floor': 3, 'label': 'Placement Cell & Career Counseling', 'category': 'Offices'},
    'RESTROOMS-2F': {'coords': (13, 43), 'floor': 3, 'label': 'Restrooms', 'category': 'Restrooms'},
    'LIFT-2F': {'coords': (65, 52), 'floor': 3, 'label': 'Lift (Second Floor)', 'category': 'Lift & Stairs'},
    'CURVEDSTAIRS-2F': {'coords': (70, 42), 'floor': 3, 'label': 'Curved Stairs (Second Floor)', 'category': 'Lift & Stairs'},
    'STAIRSEND-2F': {'coords': (10, 56), 'floor': 3, 'label': 'Stairs End (Second Floor)', 'category': 'Lift & Stairs'},
    # 2F waypoints
    'HALLWAY-TURNPOINT-1-2F': {'coords': (69, 58), 'floor': 3, 'label': '2F Turn 1', 'is_waypoint': True},
    'HALLWAY-TURNPOINT-2-2F': {'coords': (10, 59), 'floor': 3, 'label': '2F Turn 2', 'is_waypoint': True},
    'HALLWAY-TURNPOINT-3-2F': {'coords': (40, 58), 'floor': 3, 'label': '2F Turn 3', 'is_waypoint': True},

    # -- THIRD FLOOR (floor: 4) --------------------------------------
    'ROOM1-3F': {'coords': (33, 43), 'floor': 4, 'label': 'Room 1', 'category': 'Rooms'},
    'ROOM2-3F': {'coords': (48, 43), 'floor': 4, 'label': 'Room 2', 'category': 'Rooms'},
    'ROOM3-3F': {'coords': (52, 43), 'floor': 4, 'label': 'Room 3', 'category': 'Rooms'},
    'ROOM4-3F': {'coords': (71, 43), 'floor': 4, 'label': 'Room 4', 'category': 'Rooms'},
    'RESTROOMS-3F': {'coords': (14, 43), 'floor': 4, 'label': 'Restrooms', 'category': 'Restrooms'},
    'LIFT-3F': {'coords': (69, 54), 'floor': 4, 'label': 'Lift (Third Floor)', 'category': 'Lift & Stairs'},
    'CURVEDSTAIRS-3F': {'coords': (74, 43), 'floor': 4, 'label': 'Curved Stairs (Third Floor)', 'category': 'Lift & Stairs'},
    'STAIRSEND-3F': {'coords': (10, 57), 'floor': 4, 'label': 'Stairs End (Third Floor)', 'category': 'Lift & Stairs'},
    # 3F waypoints
    'HALLWAY-TURNPOINT-1-3F': {'coords': (72, 58), 'floor': 4, 'label': '3F Turn 1', 'is_waypoint': True},
    'HALLWAY-TURNPOINT-2-3F': {'coords': (10, 60), 'floor': 4, 'label': '3F Turn 2', 'is_waypoint': True},
    'HALLWAY-TURNPOINT-3-3F': {'coords': (41, 59), 'floor': 4, 'label': '3F Turn 3', 'is_waypoint': True},
}


FLOOR_DISPLAY = {1: 'Ground Floor', 2: 'First Floor', 3: 'Second Floor', 4: 'Third Floor'}
CATEGORY_ORDER = ['Entrance', 'Offices', 'Rooms', 'Labs & Rooms', 'Restrooms', 'Lift & Stairs']

# Normalize node typing for safer checks
for _nid, _data in nodes.items():
    if _data.get('is_waypoint'):
        _data['type'] = 'hallway'
    elif _nid.startswith('LIFT'):
        _data['type'] = 'lift'
    elif 'STAIRS' in _nid:
        _data['type'] = 'stairs'
        _data['stairs_kind'] = 'curved' if 'CURVED' in _nid else 'straight'
    else:
        _data['type'] = 'room'

def add_edge(graph, a, b):
    if b not in graph[a]:
        graph[a].append(b)
    if a not in graph[b]:
        graph[b].append(a)


def build_graph():
    graph = {nid: [] for nid in nodes}

    def is_waypoint(nid): return nodes[nid].get('is_waypoint', False)
    def is_dead_end(nid):  return nodes[nid].get('dead_end', False)
    def is_lift(nid):      return nodes[nid].get('type') == 'lift'
    def is_straight_stairs(nid): return nodes[nid].get('type') == 'stairs' and nodes[nid].get('stairs_kind') == 'straight'
    def is_curved_stairs(nid):   return nodes[nid].get('type') == 'stairs' and nodes[nid].get('stairs_kind') == 'curved'
    def is_vertical(nid):  return nodes[nid].get('type') in ('lift', 'stairs')

    # STEP 1 - Chain hallway waypoints on each floor left-to-right by x coord
    for floor in range(1, 5):
        wps = sorted(
            [(nid, d) for nid, d in nodes.items()
             if d['floor'] == floor and is_waypoint(nid) and 'PASSAGEWAY' not in nid],
            key=lambda x: x[1]['coords'][0]
        )
        for i in range(len(wps) - 1):
            add_edge(graph, wps[i][0], wps[i+1][0])

    # STEP 2 - 1F passageway branch:
    #   HALLWAY-TURNPOINT-2-1F (x=36,y=59) <-> PASSAGEWAY-1F (x=36,y=43)
    #   PASSAGEWAY-1F <-> STAFFROOM2-1F and ROOM3-1F
    if 'PASSAGEWAY-1F' in nodes and 'HALLWAY-TURNPOINT-2-1F' in nodes:
        add_edge(graph, 'HALLWAY-TURNPOINT-2-1F', 'PASSAGEWAY-1F')
        for upper in ('STAFFROOM2-1F', 'ROOM3-1F'):
            if upper in nodes:
                add_edge(graph, 'PASSAGEWAY-1F', upper)

    # STEP 3 - Connect every non-waypoint, non-vertical, non-dead-end room
    #          to its two nearest hallway waypoints on the same floor.
    for nid, data in nodes.items():
        if is_waypoint(nid) or is_vertical(nid) or is_dead_end(nid):
            continue
        floor = data['floor']
        wps = [(wid, wd) for wid, wd in nodes.items()
               if wd['floor'] == floor and is_waypoint(wid) and 'PASSAGEWAY' not in wid]
        if not wps:
            continue
        cx, cy = data['coords']
        sorted_wps = sorted(wps, key=lambda w: math.dist((cx, cy), w[1]['coords']))
        for wp_id, _ in sorted_wps[:2]:
            add_edge(graph, nid, wp_id)

    # STEP 4 - Connect each vertical connector to nearest waypoint on its floor.
    for nid, data in nodes.items():
        if not is_vertical(nid):
            continue
        floor = data['floor']
        wps = [(wid, wd) for wid, wd in nodes.items()
               if wd['floor'] == floor and is_waypoint(wid)]
        if not wps:
            continue
        cx, cy = data['coords']
        nearest = min(wps, key=lambda w: math.dist((cx, cy), w[1]['coords']))
        add_edge(graph, nid, nearest[0])

    # STEP 5 - Also directly connect LIFT nodes to BALCONY-1F (same physical cluster)
    if 'LIFT-1F' in nodes and 'BALCONY-1F' in nodes:
        add_edge(graph, 'LIFT-1F', 'BALCONY-1F')

    # STEP 6 - Chain each vertical family floor by floor
    for family_prefix, getter in [
        ('LIFT',         lambda n: nodes[n].get('type') == 'lift'),
        ('STAIRSEND',    lambda n: nodes[n].get('type') == 'stairs' and nodes[n].get('stairs_kind') == 'straight'),
        ('CURVEDSTAIRS', lambda n: nodes[n].get('type') == 'stairs' and nodes[n].get('stairs_kind') == 'curved'),
    ]:
        chain = sorted(
            [nid for nid in nodes if getter(nid)],
            key=lambda n: nodes[n]['floor']
        )
        for i in range(len(chain) - 1):
            add_edge(graph, chain[i], chain[i+1])

    # STEP 7 - Extra direct edges for physical adjacency the waypoint system misses.
    for pair in [
        ('MAINENTRANCE-GF', 'HALLWAY-TURNPOINT-1-GF'),
        ('OFFICE-GF',       'HALLWAY-TURNPOINT-1-GF'),
        ('CURVEDSTAIRS-GF', 'HALLWAY-TURNPOINT-1-GF'),
        ('LIFT-GF',         'HALLWAY-TURNPOINT-1-GF'),
        ('ADMIN-GF',        'HALLWAY-TURNPOINT-1-GF'),
        ('BALCONY-1F',      'HALLWAY-TURNPOINT-1-1F'),
    ]:
        if pair[0] in nodes and pair[1] in nodes:
            add_edge(graph, pair[0], pair[1])

    return graph

graph = build_graph()


def validate_graph(graph):
    """Lightweight checks to catch broken connectivity at startup."""
    # Bidirectional check
    for a, neighbors in graph.items():
        for b in neighbors:
            if a not in graph.get(b, []):
                print(f"[graph] Missing reverse edge {b}->{a}")
    # Connectivity (only among declared nodes)
    remaining = set(graph.keys())
    if remaining:
        seen = set()
        stack = [next(iter(remaining))]
        while stack:
            node = stack.pop()
            if node in seen:
                continue
            seen.add(node)
            stack.extend(graph.get(node, []))
        dangling = remaining - seen
        if dangling:
            print(f"[graph] Unreachable nodes: {sorted(dangling)}")
    # Floor connector sanity: lifts/stairs should link to other floors
    verticals = [n for n, d in nodes.items() if d.get('type') in ('lift', 'stairs')]
    for v in verticals:
        floors = {nodes[nbr]['floor'] for nbr in graph.get(v, []) if nodes[nbr]['floor'] != nodes[v]['floor']}
        if not floors:
            print(f"[graph] Vertical connector {v} lacks cross-floor link")

# Initialize storage at import time
init_db()
validate_graph(graph)

# -------------------------------------------------------------------
# Pathfinding
# -------------------------------------------------------------------
STAIRS_L_COST = 150   # per floor
STAIRS_R_COST = 180   # per floor (curving)
LIFT_COST = 120       # per floor


def edge_cost(a, b):
    (x1, y1) = nodes[a]['coords']
    (x2, y2) = nodes[b]['coords']
    f1, f2 = nodes[a]['floor'], nodes[b]['floor']
    base = math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2)

    cost = base
    if f1 != f2:
        floor_delta = abs(f1 - f2)
        a_type, b_type = nodes[a].get('type'), nodes[b].get('type')
        a_kind, b_kind = nodes[a].get('stairs_kind'), nodes[b].get('stairs_kind')
        if (a_type == 'stairs' and a_kind == 'curved') or (b_type == 'stairs' and b_kind == 'curved'):
            cost = base + STAIRS_R_COST * floor_delta
        elif a_type == 'stairs' or b_type == 'stairs':
            cost = base + STAIRS_L_COST * floor_delta
        elif a_type == 'lift' or b_type == 'lift':
            cost = base + LIFT_COST * floor_delta
        else:
            cost = base + STAIRS_L_COST * floor_delta

    learned = get_learned_weights()
    key     = f"{a}->{b}"
    key_rev = f"{b}->{a}"
    weight  = _clamp_weight(learned.get(key, learned.get(key_rev, 1.0)))
    return cost * weight

def heuristic(a, b):
    (x1, y1) = nodes[a]['coords']
    (x2, y2) = nodes[b]['coords']
    f1, f2 = nodes[a]['floor'], nodes[b]['floor']
    planar = math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2)
    vertical_penalty = min(STAIRS_L_COST, LIFT_COST) * abs(f1 - f2)
    return planar + vertical_penalty


def a_star_search(start, goal, avoid_stairs=False, avoid_elevators=False):
    if start not in nodes or goal not in nodes:
        return {}
    frontier = [(0, start)]
    came_from = {start: None}
    cost_so_far = {start: 0}

    while frontier:
        current = heapq.heappop(frontier)[1]
        if current == goal:
            break

        for nxt in graph.get(current, []):
            if nodes[nxt].get('dead_end') and nxt != goal:
                continue
            if avoid_stairs:
                if nodes[nxt].get('type') == 'stairs':
                    continue
            if avoid_elevators:
                if nodes[nxt].get('type') == 'lift':
                    continue
            new_cost = cost_so_far[current] + edge_cost(current, nxt)
            if nxt not in cost_so_far or new_cost < cost_so_far[nxt]:
                cost_so_far[nxt] = new_cost
                priority = new_cost + heuristic(nxt, goal)
                heapq.heappush(frontier, (priority, nxt))
                came_from[nxt] = current
    return came_from


def reconstruct_path(came_from, start, goal):
    if goal not in came_from:
        return []
    curr = goal
    path = []
    while curr is not None:
        path.append(curr)
        curr = came_from.get(curr)
    path.reverse()
    return path


# -------------------------------------------------------------------
# Routes
# -------------------------------------------------------------------
@app.route('/', methods=['GET', 'POST'])
def index():
    path_coords_json = "[]"
    error_message = None
    stop_labels_json = "[]"

    # Build a flat list: (node_id, display_label, floor_int, category_str)
    all_opts = []
    for node_id, data in nodes.items():
        if data.get('is_waypoint'):
            continue
        floor_label = FLOOR_DISPLAY[data['floor']]
        display = f"{data['label']} ({floor_label})"
        all_opts.append({
            'id':       node_id,
            'label':    display,
            'floor':    data['floor'],
            'floor_label': floor_label,
            'category': data.get('category', 'Other'),
        })
    all_opts.sort(key=lambda x: (x['floor'], x['label']))

    # Pass to template as JSON so JS can rebuild groups dynamically
    nodes_opts_json = json.dumps(all_opts)

    # Also build server-side grouped structures for <noscript> fallback
    by_floor = {}
    for opt in all_opts:
        by_floor.setdefault(opt['floor_label'], []).append(opt)
    by_floor_ordered = [(fl, by_floor[fl]) for fl in
                        ['Ground Floor', 'First Floor', 'Second Floor', 'Third Floor']
                        if fl in by_floor]

    nodes_json = json.dumps(nodes)
    node_degrees = {nid: len(neighbors) for nid, neighbors in graph.items()}
    node_degrees_json = json.dumps(node_degrees)
    waypoints = []

    if request.method == 'POST':
        start = request.form.get('start_node')
        end = request.form.get('end_node')
        stops = request.form.getlist('stops[]')
        mobility = request.form.get('mobility', 'none')

        avoid_stairs = mobility == 'elevator_only'
        avoid_elevators = mobility == 'stairs_only'

        def valid_node(n):
            return n in nodes and not nodes[n].get('is_waypoint')

        stops = [s for s in stops if s and s.strip() and valid_node(s)]
        if not (valid_node(start) and valid_node(end)):
            return render_template('index.html',
                path_data=path_coords_json,
                all_nodes=nodes_json,
                node_degrees_json=node_degrees_json,
                all_opts=all_opts,
                nodes_opts_json=nodes_opts_json,
                by_floor_ordered=by_floor_ordered,
                error_message="One or more selected locations are invalid. Please try again.",
                stop_labels_json=stop_labels_json)

        waypoints = [start] + stops + [end]
        full_path = []
        success = True

        for i in range(len(waypoints) - 1):
            seg_start = waypoints[i]
            seg_end = waypoints[i + 1]
            if seg_start == seg_end:
                continue
            came_from = a_star_search(seg_start, seg_end, avoid_stairs=avoid_stairs, avoid_elevators=avoid_elevators)
            segment = reconstruct_path(came_from, seg_start, seg_end)
            if segment:
                if full_path:
                    full_path.extend(segment[1:])
                else:
                    full_path.extend(segment)
            else:
                success = False
                break

        if success and full_path:
            # Build a lookup: which waypoint index does each path position belong to?
            # waypoints = [start, stop1, stop2, ..., end]
            seg_boundaries = set()
            for wp in waypoints[1:]:   # every waypoint except start is a segment boundary
                seg_boundaries.add(wp)

            coord_list = []
            current_seg = 0
            for idx, n in enumerate(full_path):
                # When we reach a waypoint boundary (except the very first node), advance segment
                if idx > 0 and n in seg_boundaries and current_seg < len(waypoints) - 2:
                    current_seg += 1
                coord_list.append({
                    'id':      n,
                    'x':       nodes[n]['coords'][0],
                    'y':       nodes[n]['coords'][1],
                    'floor':   nodes[n]['floor'],
                    'type':    nodes[n].get('type'),
                    'segment': current_seg,
                })
            path_coords_json = json.dumps(coord_list)
        elif not success:
            error_message = ("Route not found. The selected locations may not be connected under your current mobility "
                             "settings. Try a different mobility mode or check your selections.")

    stop_labels_json = json.dumps([
        {'id': wp, 'label': nodes[wp]['label']}
        for wp in waypoints[1:-1]   # intermediate stops only
        if wp in nodes
    ])

    return render_template('index.html',
                           path_data=path_coords_json,
                           all_nodes=nodes_json,
                           node_degrees_json=node_degrees_json,
                           all_opts=all_opts,
                           nodes_opts_json=nodes_opts_json,
                           by_floor_ordered=by_floor_ordered,
                           error_message=error_message if request.method == 'POST' else None,
                           stop_labels_json=stop_labels_json)

@app.route('/feedback', methods=['POST'])
@csrf.exempt
@require_json_origin
def save_feedback():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'status': 'error', 'message': 'Invalid JSON'}), 400
    required = ['start', 'end', 'path', 'rating']
    for field in required:
        if field not in data:
            return jsonify({'status': 'error', 'message': f'Missing field: {field}'}), 400
    rating = data.get('rating')
    if not isinstance(rating, int) or not (1 <= rating <= 5):
        return jsonify({'status': 'error', 'message': 'Rating must be integer 1-5'}), 400

    # Use timeout to handle concurrent writes gracefully
    conn = sqlite3.connect(DB_PATH, timeout=10)
    try:
        conn.execute('INSERT INTO feedback VALUES (NULL,?,?,?,?,?,?)',
                     (datetime.datetime.now().isoformat(), data['start'], data['end'],
                      json.dumps(data['path']), rating, data.get('comment', '')))
        conn.commit()

        path = data.get('path', [])
        delta = 0.05 if rating >= 4 else (-0.10 if rating <= 2 else 0)
        for i in range(len(path) - 1):
            edge = f"{path[i]}->{path[i+1]}"
            cur = conn.execute('SELECT multiplier FROM edge_weights WHERE edge=?',
                               (edge,)).fetchone()
            old = cur[0] if cur else 1.0
            adjusted = old + delta
            decayed = 0.9 * adjusted + 0.1 * 1.0  # pull slightly toward neutral
            new_w = round(_clamp_weight(decayed), 4)
            conn.execute('INSERT OR REPLACE INTO edge_weights VALUES (?,?)', (edge, new_w))
        conn.commit()
    finally:
        conn.close()

    _weight_cache['loaded_at'] = 0
    return jsonify({'status': 'ok'})

@app.route('/stats')
def stats():
    conn = sqlite3.connect(DB_PATH)
    try:
        route_param = request.args.get('route')
        route_avg = None
        route_count = 0
        if route_param and '+' in route_param:
            parts = route_param.split('+', 1)
            route_start, route_end = parts[0].strip(), parts[1].strip()
            row = conn.execute(
                'SELECT AVG(rating), COUNT(*) FROM feedback WHERE start=? AND end=?',
                (route_start, route_end)
            ).fetchone()
            if row and row[0] is not None:
                route_avg = round(row[0], 2)
                route_count = row[1]

        global_avg = conn.execute('SELECT AVG(rating) FROM feedback').fetchone()[0]
        total_count = conn.execute('SELECT COUNT(*) FROM feedback').fetchone()[0]
        weights = conn.execute('SELECT edge, multiplier FROM edge_weights').fetchall()
        return jsonify({
            'avg_rating': route_avg if route_avg is not None else (
                round(global_avg, 2) if global_avg else None
            ),
            'route_avg': route_avg,
            'route_count': route_count,
            'global_avg': round(global_avg, 2) if global_avg else None,
            'total_feedback': total_count,
            'edge_weights': dict(weights)
        })
    finally:
        conn.close()


@app.route('/admin')
@require_auth
def admin():
    conn = sqlite3.connect(DB_PATH)
    try:
        top_routes = conn.execute('''
            SELECT start, end, COUNT(*) as trips, AVG(rating) as avg_rating
            FROM feedback GROUP BY start, end ORDER BY trips DESC LIMIT 10
        ''').fetchall()
        modified_weights = conn.execute(
            'SELECT edge, multiplier FROM edge_weights WHERE multiplier != 1.0 ORDER BY multiplier ASC'
        ).fetchall()
        recent_feedback = conn.execute('''
            SELECT timestamp, start, end, rating, comment
            FROM feedback ORDER BY id DESC LIMIT 20
        ''').fetchall()
        total_feedback = conn.execute('SELECT COUNT(*) FROM feedback').fetchone()[0]
        global_avg = conn.execute('SELECT AVG(rating) FROM feedback').fetchone()[0]
        total_edges_modified = conn.execute(
            'SELECT COUNT(*) FROM edge_weights WHERE multiplier != 1.0'
        ).fetchone()[0]
        all_faqs = conn.execute(
            'SELECT id, keywords, answer, active FROM faq ORDER BY id ASC'
        ).fetchall()
        return render_template('admin.html',
            top_routes=top_routes,
            modified_weights=modified_weights,
            recent_feedback=recent_feedback,
            total_feedback=total_feedback,
            global_avg=round(global_avg, 2) if global_avg else None,
            total_edges_modified=total_edges_modified,
            node_labels={k: v['label'] for k, v in nodes.items()},
            all_faqs=all_faqs
        )
    finally:
        conn.close()


@app.route('/faq')
def get_faqs():
    conn = sqlite3.connect(DB_PATH)
    try:
        rows = conn.execute(
            'SELECT id, keywords, answer FROM faq WHERE active = 1 ORDER BY id ASC'
        ).fetchall()
        return jsonify([
            {'id': r[0], 'keywords': [k.strip() for k in r[1].split(',')], 'answer': r[2]}
            for r in rows
        ])
    finally:
        conn.close()


@app.route('/admin/faq/add', methods=['POST'])
@require_auth
@csrf.exempt
@require_json_origin
def faq_add():
    data = request.get_json(silent=True)
    if not data or not data.get('keywords') or not data.get('answer'):
        return jsonify({'status': 'error', 'message': 'keywords and answer required'}), 400
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute('INSERT INTO faq (keywords, answer, active) VALUES (?, ?, 1)',
                     (data['keywords'].strip(), data['answer'].strip()))
        conn.commit()
        return jsonify({'status': 'ok'})
    finally:
        conn.close()


@app.route('/admin/faq/toggle/<int:faq_id>', methods=['POST'])
@require_auth
@csrf.exempt
@require_json_origin
def faq_toggle(faq_id):
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute('UPDATE faq SET active = 1 - active WHERE id = ?', (faq_id,))
        conn.commit()
        return jsonify({'status': 'ok'})
    finally:
        conn.close()


@app.route('/admin/faq/delete/<int:faq_id>', methods=['POST'])
@require_auth
@csrf.exempt
@require_json_origin
def faq_delete(faq_id):
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute('DELETE FROM faq WHERE id = ?', (faq_id,))
        conn.commit()
        return jsonify({'status': 'ok'})
    finally:
        conn.close()


@app.route('/admin/reset-weights', methods=['POST'])
@require_auth
@csrf.exempt
@require_json_origin
def reset_weights():
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute('UPDATE edge_weights SET multiplier = 1.0')
        conn.commit()
        _weight_cache['loaded_at'] = 0
        return jsonify({'status': 'ok', 'message': 'All edge weights reset to 1.0'})
    finally:
        conn.close()


@app.route('/health')
def health():
    return jsonify({
        'status': 'ok',
        'admin_configured': bool(ADMIN_USER and ADMIN_PASS),
        'db_path': DB_PATH,
        'db_exists': os.path.exists(DB_PATH)
    })


@app.route('/coord-picker')
@require_auth
def coord_picker():
    return app.send_static_file('coord_picker.html')


if __name__ == '__main__':
    app.run(debug=os.environ.get('FLASK_DEBUG', 'false').lower() == 'true')
