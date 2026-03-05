from flask import Flask, render_template, request
import heapq
import math
import json

app = Flask(__name__)

# --- 1. DATA: 4-FLOOR TEMPLATE GRAPH ---
nodes = {
    # === FLOOR 1 ===
    'F1-ENTRY':    {'coords': (50, 90), 'floor': 1, 'label': 'Main Entrance'},
    'F1-HALL':     {'coords': (50, 50), 'floor': 1, 'label': 'F1 Hall', 'is_waypoint': True},
    'F1-STAIRS':   {'coords': (40, 50), 'floor': 1, 'label': 'Stairs F1'},
    'F1-ELEVATOR': {'coords': (60, 50), 'floor': 1, 'label': 'Elevator F1'},

    # === FLOOR 2 ===
    'F2-HALL':     {'coords': (50, 50), 'floor': 2, 'label': 'F2 Hall', 'is_waypoint': True},
    'F2-ROOM-A':   {'coords': (20, 50), 'floor': 2, 'label': 'Room 2A'},
    'F2-STAIRS':   {'coords': (40, 50), 'floor': 2, 'label': 'Stairs F2'},
    'F2-ELEVATOR': {'coords': (60, 50), 'floor': 2, 'label': 'Elevator F2'},

    # === FLOOR 3 ===
    'F3-HALL':     {'coords': (50, 50), 'floor': 3, 'label': 'F3 Hall', 'is_waypoint': True},
    'F3-ROOM-B':   {'coords': (80, 50), 'floor': 3, 'label': 'Room 3B'},
    'F3-STAIRS':   {'coords': (40, 50), 'floor': 3, 'label': 'Stairs F3'},
    'F3-ELEVATOR': {'coords': (60, 50), 'floor': 3, 'label': 'Elevator F3'},

    # === FLOOR 4 ===
    'F4-HALL':     {'coords': (50, 50), 'floor': 4, 'label': 'F4 Hall', 'is_waypoint': True},
    'F4-ROOM-C':   {'coords': (50, 20), 'floor': 4, 'label': 'Room 4C'},
    'F4-STAIRS':   {'coords': (40, 50), 'floor': 4, 'label': 'Stairs F4'},
    'F4-ELEVATOR': {'coords': (60, 50), 'floor': 4, 'label': 'Elevator F4'},
}

# CONNECTIONS (Ensuring elevators and stairs go UP and DOWN)
graph = {
    # F1
    'F1-ENTRY':    ['F1-HALL'], 'F1-HALL': ['F1-ENTRY', 'F1-STAIRS', 'F1-ELEVATOR'],
    'F1-STAIRS':   ['F1-HALL', 'F2-STAIRS'], 
    'F1-ELEVATOR': ['F1-HALL', 'F2-ELEVATOR'], 

    # F2
    'F2-ROOM-A':   ['F2-HALL'], 'F2-HALL': ['F2-ROOM-A', 'F2-STAIRS', 'F2-ELEVATOR'],
    'F2-STAIRS':   ['F2-HALL', 'F1-STAIRS', 'F3-STAIRS'], # Bidirectional
    'F2-ELEVATOR': ['F2-HALL', 'F1-ELEVATOR', 'F3-ELEVATOR'], # Bidirectional

    # F3
    'F3-ROOM-B':   ['F3-HALL'], 'F3-HALL': ['F3-ROOM-B', 'F3-STAIRS', 'F3-ELEVATOR'],
    'F3-STAIRS':   ['F3-HALL', 'F2-STAIRS', 'F4-STAIRS'],
    'F3-ELEVATOR': ['F3-HALL', 'F2-ELEVATOR', 'F4-ELEVATOR'],

    # F4
    'F4-ROOM-C':   ['F4-HALL'], 'F4-HALL': ['F4-ROOM-C', 'F4-STAIRS', 'F4-ELEVATOR'],
    'F4-STAIRS':   ['F4-HALL', 'F3-STAIRS'],
    'F4-ELEVATOR': ['F4-HALL', 'F3-ELEVATOR']
}

# --- 2. CORE LOGIC ---
def heuristic(a, b):
    (x1, y1) = nodes[a]['coords']
    (x2, y2) = nodes[b]['coords']
    f1, f2 = nodes[a]['floor'], nodes[b]['floor']
    return math.sqrt((x1 - x2)**2 + (y1 - y2)**2) + (abs(f1 - f2) * 1000)

def a_star_search(start, goal, avoid_stairs=False, avoid_elevators=False):
    frontier = [(0, start)]
    came_from = {start: None}
    cost_so_far = {start: 0}
    
    while frontier:
        current = heapq.heappop(frontier)[1]
        if current == goal: break
        
        for next_node in graph.get(current, []):
            if avoid_stairs and 'STAIRS' in next_node: continue
            if avoid_elevators and 'ELEVATOR' in next_node: continue
            
            new_cost = cost_so_far[current] + heuristic(current, next_node)
            if next_node not in cost_so_far or new_cost < cost_so_far[next_node]:
                cost_so_far[next_node] = new_cost
                priority = new_cost + heuristic(next_node, goal)
                heapq.heappush(frontier, (priority, next_node))
                came_from[next_node] = current
    return came_from

@app.route('/', methods=['GET', 'POST'])
def index():
    path_coords_json = "[]"
    node_opts = sorted([(k, f"{v['label']} (Floor {v['floor']})") for k, v in nodes.items() if not v.get('is_waypoint')], key=lambda x: x[1])
    nodes_json = json.dumps({k: v for k, v in nodes.items()})
    
    if request.method == 'POST':
        start = request.form.get('start_node')
        end = request.form.get('end_node')
        stops = request.form.getlist('stops[]') # Get dynamic intermediate stops
        accessible = request.form.get('accessible') == 'true'

        # Build full waypoint list and remove empty selections
        waypoints = [start] + [s for s in stops if s.strip()] + [end]
        
        full_path = []
        route_successful = True

        # Segmented A* for multiple stops
        for i in range(len(waypoints) - 1):
            seg_start = waypoints[i]
            seg_end = waypoints[i+1]
            if seg_start == seg_end: continue
            
            came_from = a_star_search(seg_start, seg_end, avoid_stairs=accessible)
            
            if seg_end in came_from:
                segment, curr = [], seg_end
                while curr:
                    segment.append(curr)
                    curr = came_from[curr]
                segment.reverse()
                
                # Append segment without duplicating the meeting node
                if full_path:
                    full_path.extend(segment[1:])
                else:
                    full_path.extend(segment)
            else:
                route_successful = False
                break

        if route_successful and full_path:
            coord_list = [{'id': n, 'x': nodes[n]['coords'][0], 'y': nodes[n]['coords'][1], 'floor': nodes[n]['floor']} for n in full_path]
            path_coords_json = json.dumps(coord_list)

    return render_template('index.html', nodes=node_opts, path_data=path_coords_json, all_nodes=nodes_json)

if __name__ == '__main__':
    app.run(debug=True)