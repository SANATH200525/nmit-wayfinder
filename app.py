from flask import Flask, render_template, request
import heapq
import math
import json

app = Flask(__name__)

# --- 1. DATA: IMAGINARY MULTI-STOREY BUILDING ---
# Coordinates are percentages (0-100%) of the image width/height.
nodes = {
    # === FLOOR 1 ===
    'F1-MAIN-ENTRY':   {'coords': (50, 95), 'floor': 1, 'facing': 'North', 'label': 'Main Entrance'},
    'F1-CORRIDOR':     {'coords': (50, 50), 'floor': 1, 'facing': 'North', 'label': 'F1 Main Corridor'},
    'F1-CAFETERIA':    {'coords': (20, 50), 'floor': 1, 'facing': 'East',  'label': 'Cafeteria'},
    'F1-CLASS-101':    {'coords': (80, 20), 'floor': 1, 'facing': 'West',  'label': 'Classroom 101'},
    'F1-CLASS-102':    {'coords': (80, 80), 'floor': 1, 'facing': 'West',  'label': 'Classroom 102'},
    'F1-STAIRS':       {'coords': (40, 20), 'floor': 1, 'facing': 'South', 'label': 'Stairs (Floor 1)'},
    'F1-ELEVATOR':     {'coords': (60, 20), 'floor': 1, 'facing': 'South', 'label': 'Elevator (Floor 1)'},

    # === FLOOR 2 ===
    # Vertical connectors must align with Floor 1 coordinates
    'F2-STAIRS':       {'coords': (40, 20), 'floor': 2, 'facing': 'South', 'label': 'Stairs (Floor 2)'},
    'F2-ELEVATOR':     {'coords': (60, 20), 'floor': 2, 'facing': 'South', 'label': 'Elevator (Floor 2)'},
    'F2-CORRIDOR':     {'coords': (50, 50), 'floor': 2, 'facing': 'North', 'label': 'F2 Main Corridor'},
    'F2-LIBRARY':      {'coords': (20, 50), 'floor': 2, 'facing': 'East',  'label': 'Library'},
    'F2-COMP-LAB':     {'coords': (80, 20), 'floor': 2, 'facing': 'West',  'label': 'Computer Lab 201'},
    'F2-OFFICE-202':   {'coords': (80, 50), 'floor': 2, 'facing': 'West',  'label': 'Prof. Office 202'},
    'F2-OFFICE-203':   {'coords': (80, 80), 'floor': 2, 'facing': 'West',  'label': 'Prof. Office 203'}
}

# CONNECTIONS (Graph)
graph = {
    # Floor 1
    'F1-MAIN-ENTRY': ['F1-CORRIDOR'],
    'F1-CORRIDOR':   ['F1-MAIN-ENTRY', 'F1-CAFETERIA', 'F1-CLASS-101', 'F1-CLASS-102', 'F1-STAIRS', 'F1-ELEVATOR'],
    'F1-CAFETERIA':  ['F1-CORRIDOR'],
    'F1-CLASS-101':  ['F1-CORRIDOR'],
    'F1-CLASS-102':  ['F1-CORRIDOR'],
    'F1-STAIRS':     ['F1-CORRIDOR', 'F2-STAIRS'],      # Vertical Link
    'F1-ELEVATOR':   ['F1-CORRIDOR', 'F2-ELEVATOR'],    # Vertical Link

    # Floor 2
    'F2-STAIRS':     ['F2-CORRIDOR', 'F1-STAIRS'],      # Vertical Link
    'F2-ELEVATOR':   ['F2-CORRIDOR', 'F1-ELEVATOR'],    # Vertical Link
    'F2-CORRIDOR':   ['F2-STAIRS', 'F2-ELEVATOR', 'F2-LIBRARY', 'F2-COMP-LAB', 'F2-OFFICE-202', 'F2-OFFICE-203'],
    'F2-LIBRARY':    ['F2-CORRIDOR'],
    'F2-COMP-LAB':   ['F2-CORRIDOR'],
    'F2-OFFICE-202': ['F2-CORRIDOR'],
    'F2-OFFICE-203': ['F2-CORRIDOR']
}

VECTORS = {'East': (1, 0), 'West': (-1, 0), 'North': (0, -1), 'South': (0, 1)}

# --- 2. CORE LOGIC ---
def heuristic(a, b):
    (x1, y1) = nodes[a]['coords']
    (x2, y2) = nodes[b]['coords']
    f1, f2 = nodes[a]['floor'], nodes[b]['floor']
    dist = math.sqrt((x1 - x2)**2 + (y1 - y2)**2)
    return dist + (abs(f1 - f2) * 1000)

def get_relative_turn(start_vec, move_vec):
    cross = start_vec[0] * move_vec[1] - start_vec[1] * move_vec[0]
    dot = start_vec[0] * move_vec[0] + start_vec[1] * move_vec[1]
    if dot > 0.8: return "straight"
    if dot < -0.8: return "turn around"
    return "right" if cross > 0 else "left"

def generate_natural_instructions(path):
    steps = []
    # A. Start
    start, next_node = path[0], path[1]
    if nodes[start]['floor'] != nodes[next_node]['floor']:
        steps.append(f"📍 <b>Start:</b> You are at {nodes[start]['label']}.")
    else:
        p1, p2 = nodes[start]['coords'], nodes[next_node]['coords']
        move_vec = (p2[0]-p1[0], p2[1]-p1[1])
        mag = math.sqrt(move_vec[0]**2 + move_vec[1]**2)
        if mag > 0: move_vec = (move_vec[0]/mag, move_vec[1]/mag)
        
        turn = get_relative_turn(VECTORS[nodes[start]['facing']], move_vec)
        steps.append(f"📍 <b>Start:</b> Face the door of <b>{nodes[start]['label']}</b>.")
        
        if turn == "straight": steps.append("⬆️ Walk straight ahead.")
        elif turn == "left": steps.append("⬅️ Turn <b>Left</b>.")
        elif turn == "right": steps.append("➡️ Turn <b>Right</b>.")
        else: steps.append("🔄 Turn around.")

    # B. Path Loop
    for i in range(1, len(path) - 1):
        prev, curr, nxt = path[i-1], path[i], path[i+1]
        c_floor, n_floor = nodes[curr]['floor'], nodes[nxt]['floor']
        
        if c_floor != n_floor:
            transport = "stairs" if "STAIRS" in curr else "elevator"
            action = "up" if n_floor > c_floor else "down"
            steps.append(f"🪜 At {nodes[curr]['label']}, take the {transport} <b>{action}</b> to Floor {n_floor}.")
            continue
        
        if nodes[prev]['floor'] != c_floor:
            steps.append(f"✅ You have arrived at Floor {c_floor}.")
            continue

        v_in = (nodes[curr]['coords'][0]-nodes[prev]['coords'][0], nodes[curr]['coords'][1]-nodes[prev]['coords'][1])
        v_out = (nodes[nxt]['coords'][0]-nodes[curr]['coords'][0], nodes[nxt]['coords'][1]-nodes[curr]['coords'][1])
        
        mag_in = math.sqrt(v_in[0]**2 + v_in[1]**2)
        mag_out = math.sqrt(v_out[0]**2 + v_out[1]**2)
        
        if mag_in > 0 and mag_out > 0:
            v_in, v_out = (v_in[0]/mag_in, v_in[1]/mag_in), (v_out[0]/mag_out, v_out[1]/mag_out)
            turn = get_relative_turn(v_in, v_out)
            if turn == "left": steps.append(f"⬅️ At {nodes[curr]['label']}, Turn <b>Left</b>.")
            elif turn == "right": steps.append(f"➡️ At {nodes[curr]['label']}, Turn <b>Right</b>.")

    steps.append(f"🏁 <b>Arrived:</b> {nodes[path[-1]]['label']} is here.")
    return steps

def a_star_search(start, goal):
    frontier = [(0, start)]
    came_from = {start: None}
    cost_so_far = {start: 0}
    
    while frontier:
        current = heapq.heappop(frontier)[1]
        if current == goal: break
        for next_node in graph.get(current, []):
            new_cost = cost_so_far[current] + heuristic(current, next_node)
            if next_node not in cost_so_far or new_cost < cost_so_far[next_node]:
                cost_so_far[next_node] = new_cost
                priority = new_cost + heuristic(next_node, goal)
                heapq.heappush(frontier, (priority, next_node))
                came_from[next_node] = current
    return came_from

@app.route('/', methods=['GET', 'POST'])
def index():
    path_res, path_coords_json = [], "[]"
    node_opts = sorted([(k, f"{v['label']} (Floor {v['floor']})") for k, v in nodes.items()], key=lambda x: x[1])
    
    if request.method == 'POST':
        start, end = request.form.get('start_node'), request.form.get('end_node')
        if start != end:
            came_from = a_star_search(start, end)
            if end in came_from:
                path = []
                curr = end
                while curr:
                    path.append(curr)
                    curr = came_from[curr]
                path.reverse()
                path_res = generate_natural_instructions(path)
                
                # Create JSON for visualization
                coord_list = [{'x': nodes[n]['coords'][0], 'y': nodes[n]['coords'][1], 'floor': nodes[n]['floor']} for n in path]
                path_coords_json = json.dumps(coord_list)
        else:
            path_res = ["You are already at your destination."]

    return render_template('index.html', nodes=node_opts, result=path_res, path_data=path_coords_json)

if __name__ == '__main__':
    app.run(debug=True)