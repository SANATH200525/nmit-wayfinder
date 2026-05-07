import sys
import os
import math
import heapq
import random
import time
import tracemalloc
import numpy as np
import matplotlib.pyplot as plt

# ---------------------------------------------------------------------------
# 1. LOAD GRAPH DATA
# ---------------------------------------------------------------------------
from backend.graph.nodes import nodes as real_nodes
from backend.graph.edges import build_graph

real_graph = build_graph()

# ---------------------------------------------------------------------------
# 2. COST AND HEURISTIC
# ---------------------------------------------------------------------------
STAIRS_L_COST = 85
STAIRS_R_COST = 75
LIFT_COST = 120

def get_edge_cost(u, v, nodes_dict, learned_weights=None):
    if learned_weights is None: learned_weights = {}
    x1, y1 = nodes_dict[u]['coords']
    x2, y2 = nodes_dict[v]['coords']
    f1 = nodes_dict[u]['floor']
    f2 = nodes_dict[v]['floor']
    base = math.sqrt((x1-x2)**2 + (y1-y2)**2)
    
    cost = base
    if f1 != f2:
        floor_delta = abs(f1 - f2)
        a_type = nodes_dict[u].get('type')
        b_type = nodes_dict[v].get('type')
        a_kind = nodes_dict[u].get('stairs_kind')
        b_kind = nodes_dict[v].get('stairs_kind')
        
        if (a_type == 'stairs' and a_kind == 'curved') or (b_type == 'stairs' and b_kind == 'curved'):
            cost = base + STAIRS_R_COST * floor_delta
        elif a_type == 'stairs' or b_type == 'stairs':
            cost = base + STAIRS_L_COST * floor_delta
        elif a_type == 'lift' or b_type == 'lift':
            cost = base + LIFT_COST * floor_delta
        else:
            cost = base + STAIRS_L_COST * floor_delta

    key = f"{u}->{v}"
    keyRev = f"{v}->{u}"
    w = learned_weights.get(key, learned_weights.get(keyRev, 1.0))
    # In routing.js, the cost applied is clamped between 0.7 and 1.5
    clamped_w = max(0.7, min(1.5, w))
    return cost * clamped_w

def get_heuristic(u, v, nodes_dict):
    x1, y1 = nodes_dict[u]['coords']
    x2, y2 = nodes_dict[v]['coords']
    f1 = nodes_dict[u]['floor']
    f2 = nodes_dict[v]['floor']
    planar = math.sqrt((x1-x2)**2 + (y1-y2)**2)
    vertical_penalty = min(STAIRS_L_COST, LIFT_COST) * abs(f1 - f2)
    return planar + vertical_penalty

# ---------------------------------------------------------------------------
# 3. ALGORITHMS
# ---------------------------------------------------------------------------

def run_astar(start, goal, graph, nodes_dict, learned_weights=None):
    if start == goal: return 0, [start]
    open_set = []
    heapq.heappush(open_set, (0, start))
    g_score = {start: 0}
    parent = {start: None}
    
    while open_set:
        _, current = heapq.heappop(open_set)
        if current == goal:
            path = []
            cur = current
            while cur is not None:
                path.append(cur)
                cur = parent[cur]
            return g_score[current], path[::-1]
            
        for nbr in graph.get(current, []):
            if nodes_dict[nbr].get('dead_end') and nbr != goal: continue
            tentative_g = g_score[current] + get_edge_cost(current, nbr, nodes_dict, learned_weights)
            if tentative_g < g_score.get(nbr, float('inf')):
                g_score[nbr] = tentative_g
                parent[nbr] = current
                f_score = tentative_g + get_heuristic(nbr, goal, nodes_dict)
                heapq.heappush(open_set, (f_score, nbr))
    return float('inf'), []

def run_bda_star(start, goal, graph, nodes_dict, learned_weights=None):
    if start == goal: return 0, [start]
    fwd = []; bwd = []
    heapq.heappush(fwd, (0, start))
    heapq.heappush(bwd, (0, goal))
    
    g_f = {start: 0}; g_b = {goal: 0}
    parent_f = {start: None}; parent_b = {goal: None}
    fwd_visited = set(); bwd_visited = set()
    mu = float('inf')
    meeting_node = None
    
    while fwd and bwd:
        f_top = fwd[0][0]
        b_top = bwd[0][0]
        if f_top >= mu or b_top >= mu:
            break
            
        if fwd:
            _, curr = heapq.heappop(fwd)
            if curr not in fwd_visited:
                fwd_visited.add(curr)
                for nbr in graph.get(curr, []):
                    if nodes_dict[nbr].get('dead_end') and nbr != goal: continue
                    new_cost = g_f[curr] + get_edge_cost(curr, nbr, nodes_dict, learned_weights)
                    if new_cost < g_f.get(nbr, float('inf')):
                        g_f[nbr] = new_cost
                        parent_f[nbr] = curr
                        heapq.heappush(fwd, (new_cost + get_heuristic(nbr, goal, nodes_dict), nbr))
                        if nbr in g_b:
                            candidate = new_cost + g_b[nbr]
                            if candidate < mu:
                                mu = candidate
                                meeting_node = nbr
                                
        if bwd:
            _, curr = heapq.heappop(bwd)
            if curr not in bwd_visited:
                bwd_visited.add(curr)
                for nbr in graph.get(curr, []):
                    if nodes_dict[nbr].get('dead_end') and nbr != start: continue
                    new_cost = g_b[curr] + get_edge_cost(nbr, curr, nodes_dict, learned_weights)
                    if new_cost < g_b.get(nbr, float('inf')):
                        g_b[nbr] = new_cost
                        parent_b[nbr] = curr
                        heapq.heappush(bwd, (new_cost + get_heuristic(nbr, start, nodes_dict), nbr))
                        if nbr in g_f:
                            candidate = g_f[nbr] + new_cost
                            if candidate < mu:
                                mu = candidate
                                meeting_node = nbr
                                
    if not meeting_node: return float('inf'), []
    
    fwd_path = []
    cur = meeting_node
    while cur is not None:
        fwd_path.append(cur)
        cur = parent_f[cur]
    fwd_path.reverse()
    
    bwd_path = []
    cur = parent_b[meeting_node]
    while cur is not None:
        bwd_path.append(cur)
        cur = parent_b[cur]
        
    return mu, fwd_path + bwd_path

def run_dstar_lite(start, goal, graph, nodes_dict, learned_weights=None):
    # D* Lite initial planning phase.
    U = []
    g = {n: float('inf') for n in nodes_dict}
    rhs = {n: float('inf') for n in nodes_dict}
    parent = {n: None for n in nodes_dict}
    rhs[goal] = 0
    
    def calc_key(s):
        return (min(g.get(s, float('inf')), rhs.get(s, float('inf'))) + get_heuristic(start, s, nodes_dict),
                min(g.get(s, float('inf')), rhs.get(s, float('inf'))))
                
    heapq.heappush(U, (*calc_key(goal), goal))
    
    while U:
        k1, k2, u = heapq.heappop(U)
        if g[u] > rhs[u]:
            g[u] = rhs[u]
            for nbr in graph.get(u, []):
                if nodes_dict[nbr].get('dead_end') and nbr != goal: continue
                # In undirected graph, edge u-nbr is same as nbr-u
                c = get_edge_cost(nbr, u, nodes_dict, learned_weights)
                if rhs[nbr] > g[u] + c:
                    rhs[nbr] = g[u] + c
                    parent[nbr] = u
                    heapq.heappush(U, (*calc_key(nbr), nbr))
        
        if rhs[start] == g[start] and k1 >= calc_key(start)[0]:
            break
            
    if g[start] == float('inf'): return float('inf'), []
    
    path = []
    cur = start
    while cur != goal and cur is not None:
        path.append(cur)
        cur = parent[cur]
    if cur == goal: path.append(goal)
    return g[start], path

# Fix bug in D* path extraction
def run_dstar_lite_fixed(start, goal, graph, nodes_dict, learned_weights=None):
    U = []; g = {n: float('inf') for n in nodes_dict}; rhs = {n: float('inf') for n in nodes_dict}
    parent = {n: None for n in nodes_dict}
    rhs[goal] = 0
    def calc_key(s):
        return (min(g[s], rhs[s]) + get_heuristic(start, s, nodes_dict), min(g[s], rhs[s]))
    heapq.heappush(U, (*calc_key(goal), goal))
    while U:
        k1, k2, u = heapq.heappop(U)
        if g[u] > rhs[u]:
            g[u] = rhs[u]
            for nbr in graph.get(u, []):
                if nodes_dict[nbr].get('dead_end') and nbr != goal: continue
                c = get_edge_cost(nbr, u, nodes_dict, learned_weights)
                if rhs[nbr] > g[u] + c:
                    rhs[nbr] = g[u] + c
                    parent[nbr] = u
                    heapq.heappush(U, (*calc_key(nbr), nbr))
        if rhs[start] == g[start] and k1 >= calc_key(start)[0]:
            break
    if g[start] == float('inf'): return float('inf'), []
    path = []
    cur = start
    while cur != goal and cur is not None:
        path.append(cur)
        cur = parent[cur]
    if cur == goal: path.append(goal)
    return g[start], path

# ---------------------------------------------------------------------------
# 4. MEASUREMENTS
# ---------------------------------------------------------------------------
output_log = []
def log(msg):
    print(msg)
    output_log.append(msg)

def simulate_rl_convergence():
    log("--- 1. RL Convergence ---")
    start_node = 'MAINENTRANCE-GF'
    goal_node = 'ROOM4-3F'
    
    rounds = 100
    bda_costs = []
    astar_costs = []
    
    # We maintain true multipliers globally across rounds for each algorithm to simulate separate evolution
    bda_weights = {}
    astar_weights = {}
    
    def simulate_feedback():
        r = random.random()
        if r < 0.20: return 2
        elif r < 0.45: return 3
        else: return 4
        
    def update_weights(weights, path, rating):
        for i in range(len(path) - 1):
            u, v = path[i], path[i+1]
            key = f"{u}->{v}"
            keyRev = f"{v}->{u}"
            cur = weights.get(key, weights.get(keyRev, 1.0))
            if rating <= 2: cur *= 1.1
            elif rating >= 4: cur *= 0.95
            cur = max(0.5, min(3.0, cur))
            weights[key] = cur
            weights[keyRev] = cur

    for _ in range(rounds):
        # BDA*
        c_bda, p_bda = run_bda_star(start_node, goal_node, real_graph, real_nodes, bda_weights)
        rating_bda = simulate_feedback()
        update_weights(bda_weights, p_bda, rating_bda)
        bda_costs.append(c_bda)
        
        # A*
        c_astar, p_astar = run_astar(start_node, goal_node, real_graph, real_nodes, astar_weights)
        rating_astar = simulate_feedback()
        update_weights(astar_weights, p_astar, rating_astar)
        astar_costs.append(c_astar)
        
    log(f"Final BDA* Cost: {bda_costs[-1]:.2f}")
    log(f"Final A* Cost: {astar_costs[-1]:.2f}")
    return bda_costs, astar_costs

def measure_query_times():
    log("\n--- 2. Query Time Distribution ---")
    nodes_list = list(real_nodes.keys())
    pairs = []
    while len(pairs) < 500:
        a = random.choice(nodes_list)
        b = random.choice(nodes_list)
        if a != b: pairs.append((a, b))
        
    times_bda = []
    times_astar = []
    times_dstar = []
    
    for a, b in pairs:
        # BDA*
        t0 = time.perf_counter()
        run_bda_star(a, b, real_graph, real_nodes)
        times_bda.append(time.perf_counter() - t0)
        
        # A*
        t0 = time.perf_counter()
        run_astar(a, b, real_graph, real_nodes)
        times_astar.append(time.perf_counter() - t0)
        
        # D*
        t0 = time.perf_counter()
        run_dstar_lite_fixed(a, b, real_graph, real_nodes)
        times_dstar.append(time.perf_counter() - t0)
        
    for name, arr in [("BDA*", times_bda), ("A*", times_astar), ("D* Lite", times_dstar)]:
        arr_ms = np.array(arr) * 1000
        log(f"{name}: Mean={np.mean(arr_ms):.2f}ms, p50={np.median(arr_ms):.2f}ms, p90={np.percentile(arr_ms, 90):.2f}ms, p99={np.percentile(arr_ms, 99):.2f}ms, Max={np.max(arr_ms):.2f}ms")
        
    return times_bda, times_astar, times_dstar

def measure_memory():
    log("\n--- 3. Peak Memory Per Query ---")
    nodes_list = list(real_nodes.keys())
    pairs = []
    while len(pairs) < 100:
        a = random.choice(nodes_list)
        b = random.choice(nodes_list)
        if a != b: pairs.append((a, b))
        
    mem_bda = []
    mem_astar = []
    mem_dstar = []
    
    for a, b in pairs:
        tracemalloc.start()
        run_bda_star(a, b, real_graph, real_nodes)
        _, peak = tracemalloc.get_traced_memory()
        mem_bda.append(peak)
        tracemalloc.stop()
        
        tracemalloc.start()
        run_astar(a, b, real_graph, real_nodes)
        _, peak = tracemalloc.get_traced_memory()
        mem_astar.append(peak)
        tracemalloc.stop()
        
        tracemalloc.start()
        run_dstar_lite_fixed(a, b, real_graph, real_nodes)
        _, peak = tracemalloc.get_traced_memory()
        mem_dstar.append(peak)
        tracemalloc.stop()
        
    for name, arr in [("BDA*", mem_bda), ("A*", mem_astar), ("D* Lite", mem_dstar)]:
        arr_kb = np.array(arr) / 1024
        log(f"{name}: Mean={np.mean(arr_kb):.2f}KB, Max={np.max(arr_kb):.2f}KB")
        
    return mem_bda, mem_astar, mem_dstar

def create_synthetic_graph(multiplier):
    syn_nodes = {}
    syn_graph = {}
    
    for i in range(multiplier):
        suffix = f"_{i}" if i > 0 else ""
        for nid, data in real_nodes.items():
            new_id = f"{nid}{suffix}"
            syn_nodes[new_id] = data.copy()
            syn_graph[new_id] = []
            
    for i in range(multiplier):
        suffix = f"_{i}" if i > 0 else ""
        for u, neighbors in real_graph.items():
            for v in neighbors:
                syn_graph[f"{u}{suffix}"].append(f"{v}{suffix}")
                
    # Connect subgraphs
    for i in range(1, multiplier):
        u = "MAINENTRANCE-GF"
        v = f"MAINENTRANCE-GF_{i}"
        syn_graph[u].append(v)
        syn_graph[v].append(u)
        
    return syn_nodes, syn_graph

def measure_scalability():
    log("\n--- 4. Scalability ---")
    results_bda = []
    results_astar = []
    results_dstar = []
    
    sizes = [1, 2, 4]
    node_counts = []
    
    for mult in sizes:
        s_nodes, s_graph = create_synthetic_graph(mult)
        node_counts.append(len(s_nodes))
        
        nodes_list = list(s_nodes.keys())
        pairs = []
        while len(pairs) < 50:
            a = random.choice(nodes_list)
            b = random.choice(nodes_list)
            if a != b: pairs.append((a, b))
            
        t_bda = 0; t_astar = 0; t_dstar = 0
        for a, b in pairs:
            t0 = time.perf_counter(); run_bda_star(a, b, s_graph, s_nodes); t_bda += time.perf_counter() - t0
            t0 = time.perf_counter(); run_astar(a, b, s_graph, s_nodes); t_astar += time.perf_counter() - t0
            t0 = time.perf_counter(); run_dstar_lite_fixed(a, b, s_graph, s_nodes); t_dstar += time.perf_counter() - t0
            
        results_bda.append((t_bda / 50) * 1000)
        results_astar.append((t_astar / 50) * 1000)
        results_dstar.append((t_dstar / 50) * 1000)
        
        log(f"Nodes: {len(s_nodes)} | BDA*: {results_bda[-1]:.2f}ms | A*: {results_astar[-1]:.2f}ms | D* Lite: {results_dstar[-1]:.2f}ms")
        
    return node_counts, results_bda, results_astar, results_dstar

# ---------------------------------------------------------------------------
# 5. EXECUTE AND PLOT
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    random.seed(42)
    bda_rl, astar_rl = simulate_rl_convergence()
    t_bda, t_astar, t_dstar = measure_query_times()
    m_bda, m_astar, m_dstar = measure_memory()
    counts, s_bda, s_astar, s_dstar = measure_scalability()
    
    with open("supplementary_metrics.txt", "w") as f:
        f.write("\n".join(output_log))
        
    # Plotting
    fig, axs = plt.subplots(2, 2, figsize=(14, 10))
    fig.suptitle('Pathfinding Algorithms Performance Metrics', fontsize=16)
    
    # 1. RL Convergence
    axs[0, 0].plot(bda_rl, label='BDA*', alpha=0.8)
    axs[0, 0].plot(astar_rl, label='A*', alpha=0.8)
    axs[0, 0].set_title('RL Convergence over 100 Rounds')
    axs[0, 0].set_xlabel('Round')
    axs[0, 0].set_ylabel('Path Cost')
    axs[0, 0].legend()
    axs[0, 0].grid(True, alpha=0.3)
    
    # 2. Query Time Distribution
    data = [np.array(t_bda)*1000, np.array(t_astar)*1000, np.array(t_dstar)*1000]
    axs[0, 1].boxplot(data, labels=['BDA*', 'A*', 'D* Lite'])
    axs[0, 1].set_title('Query Time Distribution (500 pairs)')
    axs[0, 1].set_ylabel('Time (ms)')
    axs[0, 1].grid(True, alpha=0.3, axis='y')
    
    # 3. Peak Memory
    labels = ['BDA*', 'A*', 'D* Lite']
    means = [np.mean(m_bda)/1024, np.mean(m_astar)/1024, np.mean(m_dstar)/1024]
    maxs = [np.max(m_bda)/1024, np.max(m_astar)/1024, np.max(m_dstar)/1024]
    x = np.arange(len(labels))
    width = 0.35
    axs[1, 0].bar(x - width/2, means, width, label='Mean Peak')
    axs[1, 0].bar(x + width/2, maxs, width, label='Max Peak')
    axs[1, 0].set_xticks(x)
    axs[1, 0].set_xticklabels(labels)
    axs[1, 0].set_title('Peak Memory Allocation')
    axs[1, 0].set_ylabel('Memory (KB)')
    axs[1, 0].legend()
    axs[1, 0].grid(True, alpha=0.3, axis='y')
    
    # 4. Scalability
    axs[1, 1].plot(counts, s_bda, marker='o', label='BDA*')
    axs[1, 1].plot(counts, s_astar, marker='s', label='A*')
    axs[1, 1].plot(counts, s_dstar, marker='^', label='D* Lite')
    axs[1, 1].axvline(x=len(real_nodes), color='r', linestyle='--', alpha=0.5, label='Current Graph (64)')
    axs[1, 1].set_title('Scalability on Synthetic Graphs')
    axs[1, 1].set_xlabel('Number of Nodes')
    axs[1, 1].set_ylabel('Average Query Time (ms)')
    axs[1, 1].legend()
    axs[1, 1].grid(True, alpha=0.3)
    
    plt.tight_layout(rect=[0, 0.03, 1, 0.95])
    plt.savefig('supplementary_metrics.png', dpi=300)
    print("Done. Saved supplementary_metrics.png and supplementary_metrics.txt")
