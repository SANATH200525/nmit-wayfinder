import math
from backend.graph.nodes import nodes

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
    #   HALLWAY-TURNPOINT-2-1F <-> PASSAGEWAY-1F (corridor entry)
    #   PASSAGEWAY-1F <-> PASSAGEWAY-1F-TOP
    #   PASSAGEWAY-1F-TOP <-> STAFFROOM2-1F and ROOM3-1F (ONLY connection for these rooms)
    if 'PASSAGEWAY-1F' in nodes and 'HALLWAY-TURNPOINT-2-1F' in nodes:
        add_edge(graph, 'HALLWAY-TURNPOINT-2-1F', 'PASSAGEWAY-1F')
        if 'PASSAGEWAY-1F-TOP' in nodes:
            add_edge(graph, 'PASSAGEWAY-1F', 'PASSAGEWAY-1F-TOP')
            for upper in ('STAFFROOM2-1F', 'ROOM3-1F'):
                if upper in nodes:
                    add_edge(graph, 'PASSAGEWAY-1F-TOP', upper)

    # STEP 2b - Force Restrooms and StairsEnd to connect ONLY through
    #           the corridor end waypoint on each floor.
    end_wp_map = {
        1: 'HALLWAY-TURNPOINT-3-GF',
        2: 'HALLWAY-TURNPOINT-3-1F',
        3: 'HALLWAY-TURNPOINT-2-2F',
        4: 'HALLWAY-TURNPOINT-2-3F',
    }
    for nid, data in nodes.items():
        if 'RESTROOMS' in nid or 'STAIRSEND' in nid:
            floor = data['floor']
            end_wp = end_wp_map.get(floor)
            if end_wp and end_wp in nodes:
                add_edge(graph, nid, end_wp)

    # STEP 2c - Direct edge: Classroom <-> Principal's Room
    #           Both are on the same corridor stretch — no intermediate checkpoint needed.
    if 'CLASSROOM-GF' in nodes and 'PRINCIPALROOM-GF' in nodes:
        add_edge(graph, 'CLASSROOM-GF', 'PRINCIPALROOM-GF')

    # STEP 3 - Connect every non-waypoint, non-vertical, non-dead-end room
    #          to its two nearest hallway waypoints on the same floor.
    #          Exclude: passageway rooms (they connect only via passageway branch)
    #                   restrooms/stairsend (they connect only via end waypoint)
    passageway_only = {'STAFFROOM2-1F', 'ROOM3-1F'}
    end_only = {nid for nid in nodes if 'RESTROOMS' in nid or 'STAIRSEND' in nid}
    corner_only = {
        'OFFICE-GF': 'HALLWAY-TURNPOINT-4-GF',
        'MEDIAUNIT-1F': 'HALLWAY-TURNPOINT-4-1F',
        'ALUMNIRELATIONSOFFICE-2F': 'HALLWAY-TURNPOINT-4-2F',
        'ROOM4-3F': 'HALLWAY-TURNPOINT-4-3F',
    }

    for nid, data in nodes.items():
        if is_waypoint(nid) or is_vertical(nid) or is_dead_end(nid):
            continue
        if nid in passageway_only or nid in end_only or nid in corner_only:
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

    for nid, wp_id in corner_only.items():
        if nid in nodes and wp_id in nodes:
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
        ('CURVEDSTAIRS-GF', 'HALLWAY-TURNPOINT-1-GF'),
        ('LIFT-GF',         'HALLWAY-TURNPOINT-1-GF'),
        ('ADMIN-GF',        'HALLWAY-TURNPOINT-1-GF'),
        ('BALCONY-1F',      'HALLWAY-TURNPOINT-1-1F'),
        ('CURVEDSTAIRS-GF', 'HALLWAY-TURNPOINT-4-GF'),
        ('CURVEDSTAIRS-1F', 'HALLWAY-TURNPOINT-4-1F'),
        ('CURVEDSTAIRS-2F', 'HALLWAY-TURNPOINT-4-2F'),
        ('CURVEDSTAIRS-3F', 'HALLWAY-TURNPOINT-4-3F'),
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

