from flask import Flask, render_template, request, jsonify
import heapq
import math
import json
import sqlite3
import datetime

app = Flask(__name__)

# -------------------------------------------------------------------
# Database + adaptive edge weights
# -------------------------------------------------------------------
DB_PATH = 'feedback.db'


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
            ('where is the library,find library,library location', 'The Library is on the Ground Floor, on the left side of the main corridor.'),
            ('placement cell,placement office,placements', 'The Placement Cell is on the Second Floor (2F). Take the lift or stairs up to 2F and walk left along the corridor.'),
            ('principal office,where is principal,principals room', "The Principal's Office is on the Ground Floor, at the far left end of the main corridor."),
            ('admin office,administration,where is admin', 'The Admin Office is on the Ground Floor, near the Main Entrance on the right side.'),
            ('computer lab,where is computer lab,lab location', 'The Computer Lab is on the Ground Floor, in the middle of the main corridor.'),
            ('seminar hall,where is seminar hall,seminar room', 'The Seminar Hall is on the First Floor (1F), in the centre of the corridor.'),
            ('board room,where is board room,boardroom', 'The Board Room is on the First Floor (1F), toward the left end of the corridor.'),
            ('design lab,design thinking,design thinking lab', 'The Design Thinking Lab is on the First Floor (1F), in the right-centre area of the corridor.'),
            ('alumni,alumni office,alumni relations', 'The Alumni Relations Office is on the Second Floor (2F), on the right side near the curved stairs.'),
            ('entrepreneurship,e-cell,entrepreneurship cell', 'The Entrepreneurship Cell is on the Second Floor (2F), along the main corridor.'),
            ('research,publication,research centre', 'The Research & Publication Centre is on the Second Floor (2F), in the middle of the corridor.'),
            ('faculty lounge,staff lounge,faculty room', 'The Faculty Lounge is on the Second Floor (2F), accessible from the main corridor.'),
            ('case study lab,case study,case lab', 'There are two Case Study Labs on the Second Floor (2F) — Lab 1 and Lab 2, both along the main corridor.'),
            ('corporate relations,corporate office', 'The Corporate Relations Office is on the Second Floor (2F), on the right side of the corridor.'),
            ('student council,student council room', 'The Student Council Room is on the Second Floor (2F), near the right end of the corridor.'),
            ('media unit,media room,media', 'The Media Unit is on the First Floor (1F), near the curved stairs on the right side.'),
            ('ups room,ups,server room', 'The UPS Room is on the First Floor (1F), in the centre of the corridor.'),
            ('conference room,conference,meeting room', 'There are two Conference Rooms on the Ground Floor — Conference Room 1 and Conference Room 2, along the main corridor.'),
            ('classroom,class room,where is class', 'Classroom 1 is on the Ground Floor, on the left side of the main corridor.'),
            ('how to get to top floor,third floor,how to reach 3f,3rd floor', 'To reach the Third Floor, use the lift near the Main Entrance or the straight staircase on the far left.'),
            ('where is the lift,elevator location,find lift', 'The lift is near the Main Entrance on the Ground Floor. It serves all four floors.'),
            ('stairs,staircase,where are the stairs', 'There are two staircases — straight stairs on the far left, and curved stairs on the far right near the Main Entrance.'),
            ('restroom,toilet,washroom,bathroom,where is toilet', 'Restrooms are available on every floor — at the left end of the corridor on each floor.'),
            ('wheelchair,accessible,disability,mobility', 'Use the lift for wheelchair-accessible navigation. Select \"Elevator Only\" under Mobility Mode in the app for a lift-only route.'),
            ('balcony,where is balcony', 'The Balcony is on the First Floor (1F), on the right side near the curved stairs.'),
            ('how to use,how does this work,how to navigate', 'Select your current location, choose your destination, then tap \"Initiate Route\". The map shows your path with turn-by-turn directions.'),
            ('add stop,multiple stops,via,intermediate stop', 'Tap the \"+ Add Stop\" button to add an intermediate stop on your route.'),
            ('floor changes,what does floor changes mean', '\"Floor Changes\" shows how many different floors your route passes through.'),
            ('checkpoint,what is checkpoint,reached checkpoint', 'Checkpoints are waypoints along your route. Tap \"Reached Checkpoint\" at each one to track your progress and grey out the path behind you.'),
        ]
        conn.executemany('INSERT INTO faq (keywords, answer) VALUES (?, ?)', seed)
        conn.commit()
    conn.close()


def load_learned_weights():
    try:
        conn = sqlite3.connect(DB_PATH)
        rows = conn.execute('SELECT edge, multiplier FROM edge_weights').fetchall()
        conn.close()
        return dict(rows)
    except Exception:
        return {}


_learned_weights = {}

# -------------------------------------------------------------------
# Graph data
# Coordinates are percentage values (0–100) relative to each floor PNG.
# -------------------------------------------------------------------
nodes = {
    # ==================== GROUND FLOOR (floor: 1) ====================
    'ENTRANCE-GF':           {'coords': (68, 54), 'floor': 1, 'label': 'Main Entrance', 'category': 'Entrance & Navigation'},
    'ADMIN-OFFICE-GF':       {'coords': (66, 57), 'floor': 1, 'label': 'Admin Office', 'category': 'Offices'},
    'TUTORIAL-ROOM-GF':      {'coords': (61, 56), 'floor': 1, 'label': 'Tutorial Room', 'category': 'Labs & Classrooms'},
    'COMPUTER-LAB-GF':       {'coords': (41, 56), 'floor': 1, 'label': 'Computer Lab', 'category': 'Labs & Classrooms'},
    'LIBRARY-GF':            {'coords': (26, 56), 'floor': 1, 'label': 'Library', 'category': 'Library & Research'},
    'PRINCIPAL-OFFICE-GF':   {'coords': (18, 56), 'floor': 1, 'label': "Principal's Office", 'category': 'Offices'},
    'RESTROOMS-GF':          {'coords': (15, 52), 'floor': 1, 'label': 'Restrooms', 'category': 'Facilities'},
    'CLASS-ROOM1-GF':        {'coords': (31, 51), 'floor': 1, 'label': 'Classroom 1', 'category': 'Labs & Classrooms'},
    'CONFERENCE-ROOM1-GF':   {'coords': (43, 51), 'floor': 1, 'label': 'Conference Room 1', 'category': 'Halls & Meeting Rooms'},
    'CONFERENCE-ROOM2-GF':   {'coords': (50, 52), 'floor': 1, 'label': 'Conference Room 2', 'category': 'Halls & Meeting Rooms'},
    'OFFICE-GF':             {'coords': (63, 40), 'floor': 1, 'label': 'Office', 'category': 'Offices'},
    'LIFT-GF':               {'coords': (62, 48), 'floor': 1, 'label': 'Lift (Ground Floor)', 'category': 'Entrance & Navigation'},
    'STAIRS-END-GF':         {'coords': (10, 51), 'floor': 1, 'label': 'Stairs (Ground Floor)', 'category': 'Entrance & Navigation'},
    'STAIRS-CURVED-GF':      {'coords': (66, 42), 'floor': 1, 'label': 'Curved Stairs (Ground Floor)', 'category': 'Entrance & Navigation'},
    'CORRIDOR-GF-1':         {'coords': (61, 53), 'floor': 1, 'label': 'GF Corridor 1', 'is_waypoint': True},
    'CORRIDOR-GF-2':         {'coords': (48, 53), 'floor': 1, 'label': 'GF Corridor 2', 'is_waypoint': True},
    'CORRIDOR-GF-3':         {'coords': (43, 54), 'floor': 1, 'label': 'GF Corridor 3', 'is_waypoint': True},
    'CORRIDOR-GF-4':         {'coords': (27, 53), 'floor': 1, 'label': 'GF Corridor 4', 'is_waypoint': True},
    'CORRIDOR-GF-5':         {'coords': (12, 53), 'floor': 1, 'label': 'GF Corridor 5', 'is_waypoint': True},

    # ==================== FIRST FLOOR (floor: 2) ====================
    'MEDIA-UNIT-1F':         {'coords': (62, 40), 'floor': 2, 'label': 'Media Unit', 'category': 'Student Services'},
    'BALCONY-1F':            {'coords': (65, 53), 'floor': 2, 'label': 'Balcony', 'dead_end': True, 'category': 'Facilities'},
    'ROOM1-1F':              {'coords': (59, 55), 'floor': 2, 'label': 'Room 1', 'category': 'Rooms'},
    'SEMINAR-HALL-1F':       {'coords': (49, 56), 'floor': 2, 'label': 'Seminar Hall', 'category': 'Halls & Meeting Rooms'},
    'BOARD-ROOM-1F':         {'coords': (23, 56), 'floor': 2, 'label': 'Board Room', 'category': 'Halls & Meeting Rooms'},
    'ROOM2-1F':              {'coords': (17, 56), 'floor': 2, 'label': 'Room 2', 'category': 'Rooms'},
    'RESTROOMS-1F':          {'coords': (15, 51), 'floor': 2, 'label': 'Restrooms', 'category': 'Facilities'},
    'STAFFROOM1-1F':         {'coords': (30, 51), 'floor': 2, 'label': 'Staff Room 1', 'category': 'Staff Rooms'},
    'UPSROOM-1F':            {'coords': (42, 50), 'floor': 2, 'label': 'UPS Room', 'category': 'Student Services'},
    'DESIGN-LAB-1F':         {'coords': (51, 51), 'floor': 2, 'label': 'Design Thinking Lab', 'category': 'Labs & Classrooms'},
    'STAFFROOM2-1F':         {'coords': (36, 29), 'floor': 2, 'label': 'Staff Room 2', 'category': 'Staff Rooms'},
    'ROOM3-1F':              {'coords': (33, 29), 'floor': 2, 'label': 'Room 3', 'category': 'Rooms'},
    'LIFT-1F':               {'coords': (61, 48), 'floor': 2, 'label': 'Lift (First Floor)', 'category': 'Entrance & Navigation'},
    'STAIRS-END-1F':         {'coords': (11, 51), 'floor': 2, 'label': 'Stairs (First Floor)', 'category': 'Entrance & Navigation'},
    'STAIRS-CURVED-1F':      {'coords': (65, 41), 'floor': 2, 'label': 'Curved Stairs (First Floor)', 'category': 'Entrance & Navigation'},
    'CORRIDOR-1F-1':         {'coords': (61, 52), 'floor': 2, 'label': '1F Corridor 1', 'is_waypoint': True},
    'CORRIDOR-1F-2':         {'coords': (50, 53), 'floor': 2, 'label': '1F Corridor 2', 'is_waypoint': True},
    'CORRIDOR-1F-3':         {'coords': (40, 54), 'floor': 2, 'label': '1F Corridor 3', 'is_waypoint': True},
    'CORRIDOR-1F-4':         {'coords': (28, 53), 'floor': 2, 'label': '1F Corridor 4', 'is_waypoint': True},
    'CORRIDOR-1F-5':         {'coords': (17, 53), 'floor': 2, 'label': '1F Corridor 5', 'is_waypoint': True},
    'PASSAGEWAY-1F-1':       {'coords': (35, 52), 'floor': 2, 'label': '1F Passageway 1', 'is_waypoint': True},
    'PASSAGEWAY-1F-2':       {'coords': (34, 40), 'floor': 2, 'label': '1F Passageway 2', 'is_waypoint': True},

    # ==================== SECOND FLOOR (floor: 3) ====================
    'ALUMNI-RELATIONS-OFFICE-2F':     {'coords': (59, 38), 'floor': 3, 'label': 'Alumni Relations Office', 'category': 'Offices'},
    'CORPORATE-RELATIONS-2F':         {'coords': (62, 53), 'floor': 3, 'label': 'Corporate Relations Office', 'category': 'Offices'},
    'STUDENT-COUNCIL-ROOM-2F':        {'coords': (59, 52), 'floor': 3, 'label': 'Student Council Room', 'category': 'Halls & Meeting Rooms'},
    'RESEARCH-PUBLICATION-CENTRE-2F': {'coords': (41, 53), 'floor': 3, 'label': 'Research & Publication Centre', 'category': 'Library & Research'},
    'ENTREPRENEURSHIP-CELL-2F':       {'coords': (29, 53), 'floor': 3, 'label': 'Entrepreneurship Cell', 'category': 'Student Services'},
    'PLACEMENT-CELL-2F':              {'coords': (22, 53), 'floor': 3, 'label': 'Placement Cell', 'category': 'Student Services'},
    'RESTROOMS-2F':                   {'coords': (21, 50), 'floor': 3, 'label': 'Restrooms', 'category': 'Facilities'},
    'FACULTY-LOUNGE-2F':              {'coords': (33, 49), 'floor': 3, 'label': 'Faculty Lounge', 'category': 'Staff Rooms'},
    'CASE-STUDY-LAB1-2F':             {'coords': (43, 49), 'floor': 3, 'label': 'Case Study Lab 1', 'category': 'Labs & Classrooms'},
    'CASE-STUDY-LAB2-2F':             {'coords': (48, 50), 'floor': 3, 'label': 'Case Study Lab 2', 'category': 'Labs & Classrooms'},
    'LIFT-2F':               {'coords': (59, 46), 'floor': 3, 'label': 'Lift (Second Floor)', 'category': 'Entrance & Navigation'},
    'STAIRS-END-2F':         {'coords': (16, 49), 'floor': 3, 'label': 'Stairs (Second Floor)', 'category': 'Entrance & Navigation'},
    'STAIRS-CURVED-2F':      {'coords': (63, 40), 'floor': 3, 'label': 'Curved Stairs (Second Floor)', 'category': 'Entrance & Navigation'},
    'CORRIDOR-2F-1':         {'coords': (59, 50), 'floor': 3, 'label': '2F Corridor 1', 'is_waypoint': True},
    'CORRIDOR-2F-2':         {'coords': (45, 51), 'floor': 3, 'label': '2F Corridor 2', 'is_waypoint': True},
    'CORRIDOR-2F-3':         {'coords': (35, 51), 'floor': 3, 'label': '2F Corridor 3', 'is_waypoint': True},
    'CORRIDOR-2F-4':         {'coords': (22, 51), 'floor': 3, 'label': '2F Corridor 4', 'is_waypoint': True},

    # ==================== THIRD FLOOR (floor: 4) ====================
    'ROOM4-3F':              {'coords': (62, 39), 'floor': 4, 'label': 'Room 4', 'category': 'Rooms'},
    'ROOM3-3F':              {'coords': (48, 51), 'floor': 4, 'label': 'Room 3', 'category': 'Rooms'},
    'ROOM2-3F':              {'coords': (43, 51), 'floor': 4, 'label': 'Room 2', 'category': 'Rooms'},
    'ROOM1-3F':              {'coords': (30, 51), 'floor': 4, 'label': 'Room 1', 'category': 'Rooms'},
    'RESTROOMS-3F':          {'coords': (15, 50), 'floor': 4, 'label': 'Restrooms', 'category': 'Facilities'},
    'LIFT-3F':               {'coords': (61, 48), 'floor': 4, 'label': 'Lift (Third Floor)', 'category': 'Entrance & Navigation'},
    'STAIRS-END-3F':         {'coords': (11, 51), 'floor': 4, 'label': 'Stairs (Third Floor)', 'category': 'Entrance & Navigation'},
    'STAIRS-CURVED-3F':      {'coords': (66, 40), 'floor': 4, 'label': 'Curved Stairs (Third Floor)', 'category': 'Entrance & Navigation'},
    'CORRIDOR-3F-1':         {'coords': (62, 53), 'floor': 4, 'label': '3F Corridor 1', 'is_waypoint': True},
    'CORRIDOR-3F-2':         {'coords': (45, 52), 'floor': 4, 'label': '3F Corridor 2', 'is_waypoint': True},
    'CORRIDOR-3F-3':         {'coords': (32, 53), 'floor': 4, 'label': '3F Corridor 3', 'is_waypoint': True},
    'CORRIDOR-3F-4':         {'coords': (19, 53), 'floor': 4, 'label': '3F Corridor 4', 'is_waypoint': True},
}


def corridors_for_floor(floor_num):
    """Return all corridor node IDs for a floor, sorted by name."""
    result = [(nid, data) for nid, data in nodes.items()
              if data['floor'] == floor_num and 'CORRIDOR' in nid]
    return sorted(result, key=lambda x: x[0])


def node_by_floor_tag(floor_num, tag):
    """Return first node ID on floor_num whose ID contains tag."""
    for nid, data in nodes.items():
        if data['floor'] == floor_num and tag in nid:
            return nid
    return None


def add_edge(graph, a, b):
    if b not in graph[a]:
        graph[a].append(b)
    if a not in graph[b]:
        graph[b].append(a)


def build_graph():
    graph = {nid: [] for nid in nodes}

    # 1) Chain corridor waypoints in sequence per floor
    for floor in range(1, 5):
        corridor_list = corridors_for_floor(floor)
        for i in range(len(corridor_list) - 1):
            add_edge(graph, corridor_list[i][0], corridor_list[i + 1][0])

    # 2) Connect each room to its nearest corridor waypoint by Euclidean distance
    for nid, data in nodes.items():
        if data.get('is_waypoint'):
            continue
        if data.get('dead_end'):
            continue
        if 'LIFT' in nid or 'STAIRS' in nid:
            continue
        floor = data['floor']
        corridor_list = corridors_for_floor(floor)
        if not corridor_list:
            continue
        cx, cy = data['coords']
        nearest = min(corridor_list,
                      key=lambda c: math.dist((cx, cy), nodes[c[0]]['coords']))
        add_edge(graph, nid, nearest[0])

    # 3) Connect ENTRANCE-GF to nearest corridor
    if 'ENTRANCE-GF' in nodes:
        corridor_list = corridors_for_floor(1)
        if corridor_list:
            ex, ey = nodes['ENTRANCE-GF']['coords']
            nearest = min(corridor_list,
                          key=lambda c: math.dist((ex, ey), nodes[c[0]]['coords']))
            add_edge(graph, 'ENTRANCE-GF', nearest[0])

    # 3b) Direct edges for nodes physically adjacent to stairs/lift
    direct_pairs = [
        ('ADMIN-OFFICE-GF', 'STAIRS-CURVED-GF'),
        ('OFFICE-GF',       'STAIRS-CURVED-GF'),
    ]
    for a, b in direct_pairs:
        if a in nodes and b in nodes:
            add_edge(graph, a, b)

    # 4) Connect LIFT and STAIRS nodes to their nearest corridor
    for nid, data in nodes.items():
        if 'LIFT' not in nid and 'STAIRS' not in nid:
            continue
        floor = data['floor']
        corridor_list = corridors_for_floor(floor)
        if not corridor_list:
            continue
        cx, cy = data['coords']
        nearest = min(corridor_list,
                      key=lambda c: math.dist((cx, cy), nodes[c[0]]['coords']))
        add_edge(graph, nid, nearest[0])

    # 5) Passageway chain for 1F upper section rooms
    if 'PASSAGEWAY-1F-1' in nodes and 'PASSAGEWAY-1F-2' in nodes:
        add_edge(graph, 'PASSAGEWAY-1F-1', 'PASSAGEWAY-1F-2')
        for upper_room in ['STAFFROOM2-1F', 'ROOM3-1F']:
            if upper_room in nodes:
                add_edge(graph, upper_room, 'PASSAGEWAY-1F-2')
        corridor_list = corridors_for_floor(2)
        if corridor_list:
            px, py = nodes['PASSAGEWAY-1F-1']['coords']
            nearest = min(corridor_list,
                          key=lambda c: math.dist((px, py), nodes[c[0]]['coords']))
            add_edge(graph, 'PASSAGEWAY-1F-1', nearest[0])

    # 6) Vertical connectors floor-to-floor
    for floor in range(1, 4):
        upper = floor + 1
        pairs = [
            (node_by_floor_tag(floor, 'STAIRS-END'),    node_by_floor_tag(upper, 'STAIRS-END')),
            (node_by_floor_tag(floor, 'STAIRS-CURVED'), node_by_floor_tag(upper, 'STAIRS-CURVED')),
            (node_by_floor_tag(floor, 'LIFT'),          node_by_floor_tag(upper, 'LIFT')),
        ]
        for a, b in pairs:
            if a and b:
                add_edge(graph, a, b)

    return graph


graph = build_graph()

# Initialize storage and learned weights at import time
init_db()
_learned_weights = load_learned_weights()

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
        if 'STAIRS-CURVED' in a or 'STAIRS-CURVED' in b:
            cost = base + STAIRS_R_COST * floor_delta
        elif 'STAIRS-END' in a or 'STAIRS-END' in b:
            cost = base + STAIRS_L_COST * floor_delta
        elif 'LIFT' in a or 'LIFT' in b:
            cost = base + LIFT_COST * floor_delta
        else:
            cost = base + STAIRS_L_COST * floor_delta

    key = f"{a}->{b}"
    key_rev = f"{b}->{a}"
    weight = _learned_weights.get(key, _learned_weights.get(key_rev, 1.0))
    return cost * weight


def heuristic(a, b):
    (x1, y1) = nodes[a]['coords']
    (x2, y2) = nodes[b]['coords']
    f1, f2 = nodes[a]['floor'], nodes[b]['floor']
    return math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2) + min(STAIRS_L_COST, LIFT_COST) * abs(f1 - f2)


def a_star_search(start, goal, avoid_stairs=False, avoid_elevators=False):
    frontier = [(0, start)]
    came_from = {start: None}
    cost_so_far = {start: 0}

    while frontier:
        current = heapq.heappop(frontier)[1]
        if current == goal:
            break

        for nxt in graph.get(current, []):
            if avoid_stairs and ('STAIRS-END' in nxt or 'STAIRS-CURVED' in nxt):
                continue
            if avoid_elevators and 'LIFT' in nxt:
                continue
            if nodes[nxt].get('dead_end') and nxt != goal:
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
    global _learned_weights
    _learned_weights = load_learned_weights()

    path_coords_json = "[]"
    error_message = None
    FLOOR_DISPLAY = {1: 'Ground Floor', 2: 'First Floor', 3: 'Second Floor', 4: 'Third Floor'}
    CATEGORY_ORDER = [
        'Entrance & Navigation', 'Offices', 'Labs & Classrooms',
        'Halls & Meeting Rooms', 'Library & Research', 'Staff Rooms',
        'Student Services', 'Facilities', 'Rooms',
    ]
    grouped_nodes = {cat: [] for cat in CATEGORY_ORDER}
    for k, v in nodes.items():
        if v.get('is_waypoint'):
            continue
        cat = v.get('category', 'Rooms')
        label = f"{v['label']} ({FLOOR_DISPLAY[v['floor']]})"
        grouped_nodes.setdefault(cat, []).append((k, label))
    for cat in grouped_nodes:
        grouped_nodes[cat].sort(key=lambda x: x[1])
    node_opts = [(cat, grouped_nodes[cat]) for cat in CATEGORY_ORDER if grouped_nodes[cat]]
    nodes_json = json.dumps(nodes)

    if request.method == 'POST':
        error_message = None
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
            return render_template('index.html', nodes=node_opts, path_data=path_coords_json, all_nodes=nodes_json, error_message=None)

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
            coord_list = [
                {
                    'id': n,
                    'x': nodes[n]['coords'][0],
                    'y': nodes[n]['coords'][1],
                    'floor': nodes[n]['floor'],
                }
                for n in full_path
            ]
            path_coords_json = json.dumps(coord_list)
        elif not success:
            error_message = ("Route not found. The selected locations may not be connected under your current mobility "
                             "settings. Try a different mobility mode or check your selections.")

    return render_template('index.html', nodes=node_opts, path_data=path_coords_json, all_nodes=nodes_json,
                           error_message=error_message if request.method == 'POST' else None)


@app.route('/feedback', methods=['POST'])
def save_feedback():
    data = request.get_json(silent=True)
    if not data or not all(k in data for k in ('start', 'end', 'path', 'rating')):
        return jsonify({'status': 'error', 'message': 'Missing required fields'}), 400
    if not isinstance(data['rating'], int) or not (1 <= data['rating'] <= 5):
        return jsonify({'status': 'error', 'message': 'Invalid rating'}), 400
    conn = sqlite3.connect(DB_PATH)
    conn.execute('INSERT INTO feedback VALUES (NULL,?,?,?,?,?,?)',
                 (datetime.datetime.now().isoformat(), data['start'], data['end'],
                  json.dumps(data['path']), data['rating'], data.get('comment', '')))
    conn.commit()

    path = data.get('path', [])
    rating = data.get('rating', 0)
    delta = 0.05 if rating >= 4 else (-0.10 if rating <= 2 else 0)
    for i in range(len(path) - 1):
        edge = f"{path[i]}->{path[i+1]}"
        cur = conn.execute('SELECT multiplier FROM edge_weights WHERE edge=?', (edge,)).fetchone()
        old = cur[0] if cur else 1.0
        new_w = round(0.9 * old + 0.1 * (old + delta), 4)
        conn.execute('INSERT OR REPLACE INTO edge_weights VALUES (?,?)', (edge, new_w))
    conn.commit()
    conn.close()
    return jsonify({'status': 'ok'})


@app.route('/stats')
def stats():
    conn = sqlite3.connect(DB_PATH)
    
    # If a specific route is requested, return its average rating
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

    # Global stats always returned
    global_avg = conn.execute('SELECT AVG(rating) FROM feedback').fetchone()[0]
    total_count = conn.execute('SELECT COUNT(*) FROM feedback').fetchone()[0]
    weights = conn.execute('SELECT edge, multiplier FROM edge_weights').fetchall()
    conn.close()
    
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


@app.route('/admin')
def admin():
    conn = sqlite3.connect(DB_PATH)
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
    conn.close()
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


@app.route('/faq')
def get_faqs():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        'SELECT id, keywords, answer FROM faq WHERE active = 1 ORDER BY id ASC'
    ).fetchall()
    conn.close()
    return jsonify([
        {'id': r[0], 'keywords': [k.strip() for k in r[1].split(',')], 'answer': r[2]}
        for r in rows
    ])


@app.route('/admin/faq/add', methods=['POST'])
def faq_add():
    data = request.get_json(silent=True)
    if not data or not data.get('keywords') or not data.get('answer'):
        return jsonify({'status': 'error', 'message': 'keywords and answer required'}), 400
    conn = sqlite3.connect(DB_PATH)
    conn.execute('INSERT INTO faq (keywords, answer, active) VALUES (?, ?, 1)',
                 (data['keywords'].strip(), data['answer'].strip()))
    conn.commit()
    conn.close()
    return jsonify({'status': 'ok'})


@app.route('/admin/faq/toggle/<int:faq_id>', methods=['POST'])
def faq_toggle(faq_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute('UPDATE faq SET active = 1 - active WHERE id = ?', (faq_id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'ok'})


@app.route('/admin/faq/delete/<int:faq_id>', methods=['POST'])
def faq_delete(faq_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute('DELETE FROM faq WHERE id = ?', (faq_id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'ok'})


@app.route('/admin/reset-weights', methods=['POST'])
def reset_weights():
    conn = sqlite3.connect(DB_PATH)
    conn.execute('UPDATE edge_weights SET multiplier = 1.0')
    conn.commit()
    conn.close()
    return jsonify({'status': 'ok', 'message': 'All edge weights reset to 1.0'})


# -------------------------------------------------------------------
# Test routes to sanity check A* during development
#   Route 1 (same floor): ENTRANCE-GF → COMPUTER-LAB-GF
#   Route 2 (multi-floor, elevator): ENTRANCE-GF → RESEARCH-PUBLICATION-CENTRE-2F (elevator only)
#   Route 3 (multi-floor, stairs): ENTRANCE-GF → ROOM1-3F (stairs)
# -------------------------------------------------------------------



@app.route('/coord-picker')
def coord_picker():
    return app.send_static_file('coord_picker.html')


if __name__ == '__main__':
    app.run(debug=True)

