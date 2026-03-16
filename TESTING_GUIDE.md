# NMIT Wayfinder — Team Testing Guide
### Version: v2 | Stack: Flask + Vanilla JS | Python 3.10+

---

## QUICK START

### Prerequisites
- Python 3.10 or higher
- Git
- Chrome or Edge (recommended for PWA testing)

### Step 1 — Clone and set up
`ash
git clone <repo-url>
cd final_project
`

### Step 2 — Create virtual environment
`ash
# Windows
python -m venv venv
venv\Scripts\activate.bat

# Mac / Linux
python3 -m venv venv
source venv/bin/activate
`

### Step 3 — Install dependencies
`ash
pip install -r requirements.txt
`

### Step 4 — Run the app
`ash
python app.py
`
Open: **http://127.0.0.1:5000**
Admin: **http://127.0.0.1:5000/admin**

The database (eedback.db) is created automatically on first run and comes
pre-loaded with 29 FAQ entries. No manual setup needed.

### Step 5 — Run automated tests
`ash
pytest test_app.py -v
`
All 8 tests should pass. Note any failures and report them.

---

## WHAT THIS APP DOES

NMIT Wayfinder is an indoor navigation PWA for NITTE School of Management.
It uses the **A* pathfinding algorithm** to find routes across 4 floors.

Key things to know while testing:
- Routes are drawn as animated dashed lines on top of floor plan images
- Routes can span multiple floors using the lift or either staircase
- The system **learns from feedback** — 4-5 star ratings make a route preferred,
  1-2 star ratings penalise it. You can see learned weights at /admin.
- A floating ? bubble answers building navigation questions (FAQ chatbot)
- The app is a PWA — installable on Android/iOS like a native app

---

## TESTING AREAS

For each test, record one of:
- **PASS** — works as expected
- **FAIL** — describe what happened + browser/device
- **WEIRD** — works but something looks off — describe it

---

### AREA 1 — Basic Routing

**Test 1.1 — Same floor route**
1. Start: Main Entrance (Ground Floor)
2. Destination: Computer Lab (Ground Floor)
3. Click INITIATE ROUTE
4. ✅ Expected: Dashed blue path on Ground Floor map. Route info panel shows
   distance, time, floor changes. Turn-by-turn directions appear in left panel.

**Test 1.2 — Multi-floor via lift**
1. Start: Main Entrance (Ground Floor)
2. Destination: Placement Cell (Second Floor)
3. Mobility Mode: **Elevator Only**
4. Click INITIATE ROUTE
5. ✅ Expected: Directions mention "lift". No stairs mentioned anywhere.

**Test 1.3 — Multi-floor via stairs**
1. Same as 1.2 but Mobility Mode: **Stairs Only**
2. ✅ Expected: Directions mention staircase. No lift mentioned.

**Test 1.4 — Multi-stop route**
1. Start: Main Entrance (Ground Floor)
2. Click + ADD STOP → select Seminar Hall (First Floor)
3. Destination: Placement Cell (Second Floor)
4. Click INITIATE ROUTE
5. ✅ Expected: Route passes through Seminar Hall. Directions show all stages.

**Test 1.5 — Same start and destination**
1. Set both dropdowns to the same location
2. ✅ Expected: Error message or empty path. No crash.

**Test 1.6 — Route to Third Floor**
1. Start: Main Entrance (Ground Floor)
2. Destination: Room 1 (Third Floor)
3. ✅ Expected: Path spans all 4 floors. Switch tabs to see each segment.

---

### AREA 2 — Map Display

**Test 2.1 — Floor tab switching**
After a multi-floor route, click GF / 1F / 2F / 3F tabs.
✅ Expected: Map switches floor. Path segment visible on the correct floor.
Active tab highlighted purple.

**Test 2.2 — Route summary pill**
After any route, look to the right of the floor tabs.
✅ Expected: Small pill shows [Start Name] → [Destination Name]
in green and red. Disappears when you initiate a new route.

**Test 2.3 — Map legend**
After any route, look below the map.
✅ Expected: Legend shows Start (green), Destination (red),
Stop (yellow), Checkpoint (purple).

**Test 2.4 — Path line appearance**
✅ Expected: Thin animated dashed blue line. Not thick or covering room labels.

**Test 2.5 — Marker pins**
✅ Expected: Small pins — green start, red destination, yellow stops,
purple checkpoints. Not oversized.

---

### AREA 3 — Directions & Checkpoints

**Test 3.1 — Directions content**
Expand Turn-by-Turn Directions after any route.
✅ Expected: Steps use [START], [WALK], [STAIRS], [LIFT], [GO],
[ARRIVED] labels. No ?? anywhere. Last step is green.

**Test 3.2 — Checkpoint progression**
1. Generate any multi-floor route
2. Click ✅ Reached Checkpoint at each checkpoint
3. ✅ Expected: Path behind greys out. Directions highlight current step.
   Button becomes 🏁 Finish Navigation on the last checkpoint.

**Test 3.3 — Finish Navigation**
Click 🏁 Finish Navigation after all checkpoints.
✅ Expected: "You've Arrived!" overlay → feedback modal opens.

---

### AREA 4 — Feedback System

**Test 4.1 — Submit with stars + comment**
1. Complete a route → feedback modal appears
2. Select a star rating, type a comment, click Submit
3. ✅ Expected: Modal closes. Check /admin — feedback row should appear
   in Recent Feedback table.

**Test 4.2 — Skip feedback**
Click Skip on the feedback modal.
✅ Expected: Modal closes cleanly. No crash.

**Test 4.3 — Submit without selecting stars**
Click Submit without selecting any stars.
✅ Expected: Error toast "Please select a star rating". Does not submit.

---

### AREA 5 — FAQ Chatbot

**Test 5.1 — Open and close**
Click the ? bubble (bottom-right corner).
✅ Expected: Chat window opens. Click X or bubble again to close.

**Test 5.2 — Known questions (expect specific answers)**
Type each of these exactly:
- where is the library
- placement cell
- how do I get to the third floor
- where is the lift
- estroom
- how to use
- wheelchair
- dd stop

✅ Expected: Each returns a relevant, specific building answer.

**Test 5.3 — Unknown question (expect fallback)**
Type: what is the wifi password
✅ Expected: Polite fallback saying it doesn't know, suggesting the nav form.

**Test 5.4 — Enter key**
Type a question and press Enter (not Send button).
✅ Expected: Message sends normally.

---

### AREA 6 — Admin Dashboard

Navigate to **http://127.0.0.1:5000/admin**

**Test 6.1 — Page loads**
✅ Expected: Stats cards, route table, edge weights panel, recent feedback,
FAQ training panel all visible. No crash, no error.

**Test 6.2 — Add a FAQ entry**
1. Scroll to FAQ Chatbot Training panel
2. Keywords: canteen,food,where is food
3. Answer: There is no canteen in the building. Food is available outside the main gate.
4. Click + Add FAQ Entry
5. ✅ Expected: Toast "FAQ added!", page reloads with new row
6. Go back to main app → open chatbot → type canteen
7. ✅ Expected: Returns your new answer

**Test 6.3 — Disable a FAQ entry**
1. Click Disable on any active row
2. ✅ Expected: Row goes grey, status shows Inactive
3. Test in chatbot — that question should no longer get an answer
4. Re-enable it

**Test 6.4 — Delete a FAQ entry**
1. Add a test entry with keywords deletemetest123
2. Delete it
3. ✅ Expected: Row disappears. Chatbot no longer responds to deletemetest123

**Test 6.5 — Reset edge weights**
1. Submit some feedback first (complete a route and rate it)
2. Check Adapted Edge Weights panel — entries should appear
3. Click Reset All Weights to Default and confirm
4. ✅ Expected: Weights panel shows empty/cleared

---

### AREA 7 — Mobile Testing (important)

Use a real phone OR Chrome DevTools (F12 → device toolbar → iPhone/Android preset).

**Test 7.1 — Layout**
✅ Expected: Form stacks above map. Map has a visible fixed height.
Does not collapse or disappear.

**Test 7.2 — Directions don't collapse the map**
1. Generate a route on mobile
2. Expand Turn-by-Turn Directions
3. ✅ Expected: Map stays at its fixed height. Does NOT shrink or disappear
   when the directions panel expands. This is the most important mobile test.

**Test 7.3 — FAQ bubble**
✅ Expected: Bubble visible bottom-right. Chat window fills most of screen width.

**Test 7.4 — Dropdowns**
Tap start/destination dropdowns.
✅ Expected: TomSelect opens, grouped categories visible, search works by typing.

---

### AREA 8 — PWA (optional)

**Test 8.1 — Install on Android**
1. Open in Chrome on Android
2. Menu → "Add to Home Screen" or "Install App"
3. ✅ Expected: Installs and opens without browser chrome

**Test 8.2 — Cached floor maps offline**
1. Visit the app once (all floors loaded)
2. Go offline (airplane mode)
3. Reload
4. ✅ Expected: Floor images still load. Routing fails (expected — server-side).

---

## KNOWN LIMITATIONS — do not report these as bugs

- Routing requires active Flask server — offline routing is not supported
- /admin has no login — do not share the URL publicly
- Path line coordinates are approximate — minor misalignment with corridors
  on some routes is expected. Only report if the path goes through a wall.
- FAQ chatbot uses keyword matching — complex sentences may not match.
  Short phrases work best.
- debug=True in app.py is intentional for development

---

## BUG REPORT FORMAT

`
[AREA] Test X.X — <one line description>
Device/Browser: e.g. iPhone 14 / Chrome 120 / Windows 11 Edge
Severity: CRASH / WRONG BEHAVIOUR / VISUAL GLITCH
Steps:
  1.
  2.
Expected:
Actual:
Screenshot: (attach if possible)
`

---

## ENDPOINTS REFERENCE

| URL | Purpose |
|-----|---------|
| http://127.0.0.1:5000/ | Main app |
| http://127.0.0.1:5000/admin | Admin dashboard |
| http://127.0.0.1:5000/faq | Active FAQs as JSON |
| http://127.0.0.1:5000/stats | Route stats as JSON |
| http://127.0.0.1:5000/coord-picker | Coordinate picker (dev only) |

---

## AUTOMATED TEST COVERAGE

pytest test_app.py -v — 8 tests, backend only:

| Test | What it checks |
|------|---------------|
| 	est_get_index_ok | Homepage loads, empty path on GET |
| 	est_simple_route_same_floor | Entrance → Computer Lab (GF) |
| 	est_simple_route_multi_floor | Entrance → Research Centre (2F) |
| 	est_elevator_only_avoids_stairs | Elevator-only excludes STAIRS nodes |
| 	est_stairs_only_avoids_elevator | Stairs-only excludes LIFT nodes |
| 	est_multiple_stops | Route with stop at Seminar Hall |
| 	est_invalid_node_returns_empty_path | Bad node ID returns empty path |
| 	est_a_star_direct_connectivity | A* reaches Room 1 (3F) from Entrance |

Areas 2–8 above require manual testing.

---

Contact Sanat before starting — make sure you're on the latest commit.
