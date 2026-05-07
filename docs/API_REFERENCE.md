# API Reference

*Note: All backend endpoints are prefixed with `/`. The server runs at `http://localhost:8000` by default.*

## Public Endpoints

### 1. Start Session
- **Method:** `POST`
- **URL:** `/session/start`
- **Format:** JSON
- **Body:**
  ```json
  {
    "session_id": "uuid-string",
    "start_node": "A",
    "end_node": "B",
    "mobility": "none",
    "planned_path": ["A", "C", "B"],
    "planned_distance_m": 45.2
  }
  ```
- **Response:** `{"status": "ok"}`
- **Errors:** `409 Conflict` if `session_id` already exists.

### 2. Log Checkpoint
- **Method:** `POST`
- **URL:** `/session/checkpoint`
- **Format:** JSON
- **Body:**
  ```json
  {
    "session_id": "uuid-string",
    "checkpoint_index": 1,
    "checkpoint_node_id": "C",
    "user_confirmed": true
  }
  ```
- **Response:** `{"status": "ok"}`

### 3. Log PDR Observation
- **Method:** `POST`
- **URL:** `/session/pdr`
- **Format:** JSON
- **Body:**
  ```json
  {
    "session_id": "uuid-string",
    "estimated_x": 100.5,
    "estimated_y": 200.5,
    "floor": 1,
    "nearest_node": "C",
    "distance_to_nearest_m": 1.2,
    "confidence": 0.95
  }
  ```
- **Response:** `{"status": "ok"}`

### 4. Submit Feedback
- **Method:** `POST`
- **URL:** `/feedback`
- **Format:** JSON
- **Body:**
  ```json
  {
    "start": "A",
    "end": "B",
    "path": ["A", "B"],
    "rating": 5,
    "comment": "Great route",
    "tags": ["fast", "accurate"]
  }
  ```
- **Response:** `{"status": "ok"}`

### 5. Chatbot Query
- **Method:** `GET`
- **URL:** `/faq?q=library`
- **Response:** `{"answer": "The library is on the ground floor."}` (Returns 404 if no match)

## Admin Endpoints (Requires Basic Auth)

### 1. Admin Dashboard
- **Method:** `GET`
- **URL:** `/admin`
- **Response:** HTML Page

### 2. Update FAQ
- **Method:** `POST`
- **URL:** `/admin/faq`
- **Format:** JSON
- **Body:**
  ```json
  {
    "keywords": "lab,computer",
    "answer": "First floor, left wing"
  }
  ```
- **Response:** `{"status": "ok"}`

### 3. A* Debug / Parity Check
- **Method:** `GET`
- **URL:** `/debug/astar?start=A&end=B`
- **Response:** `{"path": ["A", "C", "B"]}`
