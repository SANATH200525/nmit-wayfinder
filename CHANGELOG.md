# NMIT Wayfinder — Changelog

## v2 — Current Version
**Compared against v1 (initial uploaded codebase, March 2026)**

---

### app.py

**New: FAQ system**
- Added aq table to SQLite database (id, keywords, answer, active flag)
- init_db() now creates the aq table and seeds 29 pre-written FAQ entries on first run
- Added /faq GET endpoint — returns all active FAQs as JSON
- Added /admin/faq/add POST endpoint — adds a new FAQ entry
- Added /admin/faq/toggle/<id> POST endpoint — enables/disables an entry
- Added /admin/faq/delete/<id> POST endpoint — deletes an entry

**New: Admin dashboard route**
- Added /admin GET route rendering dmin.html with stats, feedback, edge weights, and FAQs
- Added /admin/reset-weights POST route — clears all learned edge weights from the database

**Changed: /feedback route hardened**
- Now uses get_json(silent=True) to handle malformed JSON gracefully
- Validates that start, end, path, ating fields are present
- Validates that ating is an integer between 1 and 5
- Returns 400 with error message on invalid input (v1 would crash or silently misbehave)

**Changed: Node data expanded**
- All nodes now have a category field for grouped dropdown display (e.g. "Labs", "Offices", "Stairs & Lift")
- BALCONY-1F now has dead_end: True
- ADMIN-OFFICE-GF coordinate updated to (66, 57) (was (66, 63))

**Changed: uild_graph()**
- Dead-end nodes are now excluded from the graph in step 2
- Added direct edges: ADMIN-OFFICE-GF → STAIRS-CURVED-GF and OFFICE-GF → STAIRS-CURVED-GF

**Changed: _star_search()**
- Dead-end nodes are now skipped during search unless they are the explicit goal

**Changed: / route — grouped dropdown**
- 
ode_opts is now a list of (category, [(code, label)]) tuples for grouped <optgroup> rendering
- Added CATEGORY_ORDER and grouped_nodes logic for consistent ordering

---

### templates/index.html

**Changed: Grouped dropdowns**
- All three dropdowns (start, stops, destination) now use <optgroup> tags grouped by category
- Rendered from the new 
ode_opts grouped structure from Flask

**Changed: Route info panel**
- Added #route-info-panel inside .navigator-panel to show distance, time, floor changes after a route

**Changed: Map legend**
- Added #map-legend below the map viewport showing Start / Destination / Stop / Checkpoint colour key

**Removed: Zoom controls**
- Removed +, -, ↺ zoom control buttons from .map-header

**New: FAQ chatbot bubble**
- Added floating ? bubble in bottom-right corner
- Chat window with message history, input field, Send button
- Opens/closes via 	oggleFAQChat()

---

### static/script.js

**Removed: Entire zoom/pan system**
- Deleted globals: scale, panX, panY, isDragging, startX, startY, lastPinchDist
- Deleted functions: updateMapTransform(), zoomToward(), zoomMap(), esetZoom(), initMapPanZoom(), distanceBetweenTouches()
- Removed initMapPanZoom() call from DOMContentLoaded
- Removed updateMapTransform() call from switchFloor()

**New: itSVGToImage()**
- Aligns each floor's SVG overlay to the letterboxed rendered area of object-fit: contain images
- Called on switchFloor(), DOMContentLoaded, and window resize

**Changed: makeOrthogonalPath()**
- Elbow nodes are only inserted when the diagonal distance is ≥ 8 units (prevents micro-elbows on near-straight paths)

**Changed: generateDirections()**
- Steps now use bracket labels: [START], [WALK], [STAIRS], [LIFT], [GO], [ARRIVED]
- Removed dead passingNote variable
- Uses window.allNodes[id]?.label with null guard (v1 would throw on missing labels)

**Changed: scrollDirectionsToCheckpoint()**
- Removed panel.open = true (no longer forces directions panel open)
- Now shows #route-info-panel instead

**Changed: calculateMetrics()**
- Floor changes now counted as unique floors visited (not consecutive transitions) — fixes false "Floor changes: 3" on same-floor routes
- Shows #route-info-panel after calculating

**Changed: drawPath()**
- Initial checkpoint button now shown without calling showCheckpointButton() — prevents purple checkpoint marker overwriting green start pin on single-checkpoint routes
- Shows #map-legend after drawing

**New: FAQ chatbot functions**
- loadFAQs() — fetches active FAQs from /faq on page load
- aqMatch(text) — keyword matching against loaded FAQ list
- 	oggleFAQChat() — opens/closes chat window
- sendFAQ() — sends user message, appends bot response or fallback
- ppendFAQMessage(text, sender) — adds a bubble to the chat history
- loadFAQs() called in DOMContentLoaded

**Changed: Marker pin size**
- All draw3DPin() pins reduced to 50% of original size

---

### static/style.css

**Removed: Zoom controls CSS**
- Deleted .zoom-controls and .zoom-controls button rules

**Changed: Map layout**
- .map-display changed from height: 65% + cursor: grab to lex: 1; min-height: 0; object-fit: contain; cursor: default
- .map-container — removed 	ransform-origin and 	ransition (no longer needed without zoom)
- .map-image — now object-fit: contain; height: 100% for letterbox-safe display
- Mobile fix: added media query setting .map-display { height: 55vw; min-height: 260px; max-height: 420px } to prevent map collapse on mobile

**New: Route info panel styles**
- Added #route-info-panel and #directions-panel positioning styles for left navigator panel

**New: Map legend styles**
- Added .map-legend styles with coloured dot indicators

**Changed: Path line appearance**
- stroke-width reduced from 1.5 to 0.8 for path lines, 3 to 1.5 for background glow lines

**New: TomSelect optgroup styles**
- Added .ts-optgroup-header styles for category group headers in dropdowns

**New: FAQ bubble and chat styles**
- Full chat widget CSS: bubble button, chat window, message bubbles (user/bot), input area, open/close transitions

---

### templates/admin.html (NEW FILE)

- New file — did not exist in v1
- Full admin dashboard with:
  - Stats cards (total feedback, avg rating, total routes)
  - Route history table with all feedback entries
  - Adapted Edge Weights panel (shows RL-learned multipliers)
  - FAQ Chatbot Training panel (add / enable / disable / delete FAQ entries)
  - Reset Weights button
- Jinja2 filters: {{ avg_rating|round(2) }}, {{ multiplier|round(4) }}
- Inline JS: 	oggleFAQ(), deleteFAQ(), ddFAQ() functions

---

### feedback.db

- aq table added with 29 seed entries covering common navigation questions
- eedback table: 6 test rows (from development testing)
- edge_weights table: 32 rows (from development testing)

---

### New files added
- CHANGELOG.md — this file
- TESTING_GUIDE.md — manual testing instructions for teammates
- 	emplates/admin.html — admin dashboard
- .gitignore addition: _tmp_patch.py

---

### Files unchanged from v1
- 	est_app.py — all 8 tests unchanged
- equirements.txt — unchanged
- manifest.json — unchanged
- service-worker.js — unchanged
- static/coord_picker.html — unchanged
- static/floor1-4.png — unchanged
- static/icon-192.png, icon-512.png — unchanged
