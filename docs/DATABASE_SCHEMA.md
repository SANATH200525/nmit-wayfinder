# Database Schema

## Overview
The application uses **SQLite** with Write-Ahead Logging (WAL) enabled for better concurrency. It does not use an ORM; all queries are raw SQL executed via the `sqlite3` module.

## Tables & Models

### `feedback`
Stores user ratings and comments after completing a route.
- `id` (INTEGER PRIMARY KEY)
- `timestamp` (TEXT)
- `start` (TEXT): Start node ID
- `end` (TEXT): Destination node ID
- `path` (TEXT): JSON stringified array of node IDs
- `rating` (INTEGER): 1 to 5 stars
- `comment` (TEXT)
- `tags` (TEXT): JSON stringified array of feedback tags

### `edge_weights`
Used by the RL-based pathfinding adaptation.
- `edge` (TEXT PRIMARY KEY): Formatted as "nodeA-nodeB"
- `multiplier` (REAL): Default 1.0. Lowered for good feedback, raised for bad feedback.

### `faq`
Stores question/answer pairs for the chatbot.
- `id` (INTEGER PRIMARY KEY)
- `keywords` (TEXT): Comma-separated search terms
- `answer` (TEXT)
- `active` (INTEGER): Default 1 (boolean flag)

### `route_sessions`
Logs the initiation of a navigation route.
- `id` (INTEGER PRIMARY KEY)
- `session_id` (TEXT UNIQUE): Client-generated UUID
- `start_node` (TEXT)
- `end_node` (TEXT)
- `mobility` (TEXT): e.g., 'none', 'elevator_only'
- `planned_path` (TEXT): JSON array of nodes
- `planned_distance_m` (REAL)
- `algorithm` (TEXT)
- `timestamp` (TEXT)
- `online` (INTEGER): 1 if connected, 0 if queued offline

### `pdr_observations`
High-frequency telemetry logging user movement via sensors.
- `id` (INTEGER PRIMARY KEY)
- `session_id` (TEXT)
- `timestamp` (TEXT)
- `estimated_x` (REAL)
- `estimated_y` (REAL)
- `floor` (INTEGER)
- `nearest_node` (TEXT)
- `distance_to_nearest_m` (REAL)
- `confidence` (REAL)

### `route_accuracy_log`
Logs when users pass predefined checkpoints on their route.
- `id` (INTEGER PRIMARY KEY)
- `session_id` (TEXT)
- `timestamp` (TEXT)
- `checkpoint_index` (INTEGER)
- `checkpoint_node_id` (TEXT)
- `user_confirmed` (INTEGER)
- `deviation_m` (REAL)
- `on_correct_path` (INTEGER)

## Indexes
- `idx_feedback_route`: Index on `feedback (start, end)` to speed up edge weight recalculations.
