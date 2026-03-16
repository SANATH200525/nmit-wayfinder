const FLOOR_NAMES = { 1: 'Ground Floor', 2: 'First Floor', 3: 'Second Floor', 4: 'Third Floor' };
const COORD_TO_METERS = 0.5;
const WALK_SPEED = 1.2; // m/s

let pathData = window.pathData || [];
let checkpoints = [];
let currentCheckpointIdx = 0;
let navStartTime = null;
let feedbackTimer = null;

document.addEventListener('DOMContentLoaded', () => {
    const selectConfig = { 
        create: false, 
        sortField: { field: 'text', direction: 'asc' },
        dropdownParent: 'body'
    };
    new TomSelect('#start_node', selectConfig);
    new TomSelect('#end_node', selectConfig);

    // Star rating interaction
    document.querySelectorAll('#star-rating span').forEach(star => {
        star.addEventListener('click', () => {
            const val = +star.dataset.val;
            document.querySelectorAll('#star-rating span').forEach(s => {
                s.classList.toggle('selected', +s.dataset.val <= val);
            });
        });
    });

    const navForm = document.getElementById('nav-form');
    if (navForm) {
        navForm.addEventListener('submit', () => {
            if (feedbackTimer) { clearTimeout(feedbackTimer); feedbackTimer = null; }
            // Reset navigation state on new route request
            checkpoints = [];
            currentCheckpointIdx = 0;
            navStartTime = null;
            hideCheckpointButton();
            const summaryClear = document.getElementById('route-summary');
            if (summaryClear) summaryClear.style.display = 'none';
            const rip = document.getElementById('route-info-panel');
            if (rip) rip.style.display = 'block';
        });
    }

    window.addEventListener('resize', fitSVGToImage);
    loadFAQs();
    fitSVGToImage();

    if (Array.isArray(pathData) && pathData.length > 0) {
        const ortho = makeOrthogonalPath(pathData);
        drawPath(ortho, pathData);
        switchFloor(pathData[0].floor);
    }
});

// --- Dynamic Stops Logic ---
function addStopField() {
    const container = document.getElementById('stops-container');
    const template = document.getElementById('stop-template');
    const clone = template.content.cloneNode(true);
    container.appendChild(clone);
    
    const newSelect = container.lastElementChild.querySelector('.stop-select');
    new TomSelect(newSelect, { 
        create: false, 
        sortField: { field: 'text', direction: 'asc' },
        dropdownParent: 'body'
    });
}

// Fit SVG overlays to contained images (object-fit: contain)
function fitSVGToImage() {
    for (let f = 1; f <= 4; f++) {
        const container = document.getElementById(`f${f}-container`);
        if (!container) continue;
        const img = container.querySelector('.map-image');
        const svg = container.querySelector('.map-overlay');
        if (!img || !svg) continue;

        const cw = container.clientWidth;
        const ch = container.clientHeight;
        const iw = img.naturalWidth || cw;
        const ih = img.naturalHeight || ch;

        const scale = Math.min(cw / iw, ch / ih);
        const rw = iw * scale;
        const rh = ih * scale;
        const offsetX = (cw - rw) / 2;
        const offsetY = (ch - rh) / 2;

        svg.style.left   = offsetX + 'px';
        svg.style.top    = offsetY + 'px';
        svg.style.width  = rw + 'px';
        svg.style.height = rh + 'px';
    }
}

// --- Tab Logic (4 Floors) ---
function switchFloor(floorNum) {
    document.querySelectorAll('.floor-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.floor == floorNum));
    for (let i = 1; i <= 4; i++) {
        const container = document.getElementById(`f${i}-container`);
        if (container) container.style.display = (i == floorNum) ? 'block' : 'none';
    }
    fitSVGToImage();
}

// --- Orthogonal Algorithm ---
function makeOrthogonalPath(path) {
    const ortho = [];
    if (!path || path.length === 0) return ortho;
    ortho.push(path[0]);
    for (let i = 1; i < path.length; i++) {
        const prev = ortho[ortho.length - 1];
        const curr = path[i];
        if (prev.floor === curr.floor && prev.x !== curr.x && prev.y !== curr.y) {
            const dist = Math.hypot(curr.x - prev.x, curr.y - prev.y);
            if (dist >= 8) {
                ortho.push({ id: `${curr.id}-elbow`, x: curr.x, y: prev.y, floor: curr.floor });
            }
        }
        ortho.push(curr);
    }
    return ortho;
}

// --- Checkpoint Logic ---
function computeCheckpoints(logicalPath) {
    // logicalPath: array of node objects {id, x, y, floor}
    // Returns array of checkpoint node objects.
    // Rule: every 3rd node by index (0, 3, 6...) plus always the final node.
    // If path length <= 3, every intermediate node is a checkpoint.
    if (!logicalPath || logicalPath.length === 0) return [];

    const result = [];
    if (logicalPath.length <= 3) {
        // Every node except the start is a checkpoint
        for (let i = 1; i < logicalPath.length; i++) {
            result.push(logicalPath[i]);
        }
    } else {
        // Every 3rd index starting from index 3
        for (let i = 3; i < logicalPath.length; i += 3) {
            result.push(logicalPath[i]);
        }
        // Always include the final node if not already included
        const last = logicalPath[logicalPath.length - 1];
        if (result.length === 0 || result[result.length - 1].id !== last.id) {
            result.push(last);
        }
    }
    return result;
}

function showCheckpointButton() {
    let btn = document.getElementById('checkpoint-btn');
    if (!btn) return;
    const isLast = currentCheckpointIdx >= checkpoints.length - 1;
    btn.textContent = isLast ? 'ðŸ Finish Navigation' : 'âœ… Reached Checkpoint';
    btn.className = isLast ? 'checkpoint-btn finish-btn' : 'checkpoint-btn';
    btn.style.display = 'flex';
}

function hideCheckpointButton() {
    const btn = document.getElementById('checkpoint-btn');
    if (btn) btn.style.display = 'none';
}

function onCheckpointReached() {
    if (!checkpoints || checkpoints.length === 0) return;

    const isLast = currentCheckpointIdx >= checkpoints.length - 1;

    if (isLast) {
        // Navigation complete
        hideCheckpointButton();
        const elapsed = navStartTime ? Math.round((Date.now() - navStartTime) / 1000) : 0;
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        const timeStr = mins > 0 ? `${mins} min ${secs} sec` : `${secs} sec`;
        showSuccessOverlay(timeStr);
        return;
    }

    currentCheckpointIdx++;
    const nextCheckpoint = checkpoints[currentCheckpointIdx];

    // Auto-switch floor if needed
    switchFloor(nextCheckpoint.floor);

    // Highlight remaining path from current checkpoint onward
    highlightRemainingPath(currentCheckpointIdx);

    // Scroll directions list to corresponding step
    scrollDirectionsToCheckpoint(nextCheckpoint.id);

    // Update button label
    showCheckpointButton();
}

function highlightRemainingPath(checkpointIdx) {
    if (!pathData || pathData.length === 0) return;

    const currentNode = checkpoints[checkpointIdx];
    const orthoPath = makeOrthogonalPath(pathData);

    let splitIdx = 0;
    for (let i = 0; i < orthoPath.length; i++) {
        if (orthoPath[i].id === currentNode.id) {
            splitIdx = i;
            break;
        }
    }

    const traversed = orthoPath.slice(0, splitIdx + 1);
    const remaining = orthoPath.slice(splitIdx);

    const globalStart = pathData[0];
    const globalEnd = pathData[pathData.length - 1];
    const stops = pathData.filter(p =>
        p.id !== globalStart.id &&
        p.id !== globalEnd.id &&
        !p.id.includes('elbow') &&
        !window.allNodes[p.id]?.is_waypoint
    );

    for (let f = 1; f <= 4; f++) {
        const svg = document.getElementById(`svg-f${f}`);
        if (!svg) continue;
        svg.innerHTML = '';

        const travFloor = traversed.filter(p => p.floor === f);
        const remFloor  = remaining.filter(p => p.floor === f);

        if (travFloor.length > 1) {
            const pl = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
            pl.setAttribute("points", travFloor.map(p => `${p.x},${p.y}`).join(' '));
            pl.setAttribute("class", "path-line-traversed");
            svg.appendChild(pl);
        }

        if (remFloor.length > 1) {
            const bgLine = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
            bgLine.setAttribute("points", remFloor.map(p => `${p.x},${p.y}`).join(' '));
            bgLine.setAttribute("class", "path-line-bg");
            svg.appendChild(bgLine);

            const pl = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
            pl.setAttribute("points", remFloor.map(p => `${p.x},${p.y}`).join(' '));
            pl.setAttribute("class", "path-line");
            svg.appendChild(pl);
        }

        stops.forEach(stop => {
            if (remaining.some(p => p.id === stop.id)) draw3DPin(svg, stop.x, stop.y, "marker-stop");
        });
        if (remaining.some(p => p.id === globalStart.id)) draw3DPin(svg, globalStart.x, globalStart.y, "marker-start");
        if (remaining.some(p => p.id === globalEnd.id)) draw3DPin(svg, globalEnd.x, globalEnd.y, "marker-end");

        if (remFloor.some(p => p.id === currentNode.id)) {
            draw3DPin(svg, currentNode.x, currentNode.y, "marker-checkpoint");
        }
    }
}

function scrollDirectionsToCheckpoint(nodeId) {
    const list = document.getElementById('directions-list');
    if (!list) return;
    const items = list.querySelectorAll('li');

    // Find the directions item that references this node's label
    const label = window.allNodes[nodeId]?.label || nodeId;
    let targetItem = null;
    items.forEach(li => {
        if (li.textContent.includes(label)) {
            targetItem = li;
        }
    });

    // Highlight current step
    items.forEach(li => li.classList.remove('directions-active'));
    if (targetItem) {
        targetItem.classList.add('directions-active');
        targetItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function showSuccessOverlay(elapsedTimeStr) {
    const overlay = document.getElementById('success-overlay');
    if (!overlay) return;
    const timeEl = document.getElementById('success-elapsed-time');
    if (timeEl) timeEl.textContent = elapsedTimeStr;
    overlay.style.display = 'flex';

    // After 3 seconds, hide overlay and show feedback modal
    setTimeout(() => {
        overlay.style.display = 'none';
        showFeedbackModal();
    }, 3000);
}

// --- Path Drawing & 3D Markers ---
function drawPath(path, logicalPath = path) {
    if (!path || path.length === 0) return;

    // Always store the logical (non-ortho) path for checkpoint and feedback use
    pathData = logicalPath;

    const floorPaths = { 1: [], 2: [], 3: [], 4: [] };
    // Use ortho path for drawing but group by floor using only real floor nodes
    path.forEach(node => {
        if (node.floor && floorPaths[node.floor]) {
            floorPaths[node.floor].push(node);
        }
    });

    const globalStart = logicalPath[0];
    const globalEnd = logicalPath[logicalPath.length - 1];

    const stops = logicalPath.filter(p =>
        p.id !== globalStart.id &&
        p.id !== globalEnd.id &&
        !p.id.includes('elbow') &&
        !window.allNodes[p.id]?.is_waypoint
    );

    for (let i = 1; i <= 4; i++) {
        if (floorPaths[i].length > 1) {
            renderSVG(`svg-f${i}`, floorPaths[i], globalStart, globalEnd, stops);
        } else {
            const svg = document.getElementById(`svg-f${i}`);
            if (svg) svg.innerHTML = '';
        }
    }

    generateDirections(logicalPath);
    calculateMetrics(logicalPath);
    const legend = document.getElementById('map-legend');
    if (legend) legend.style.display = 'flex';

    // Show route summary in map header
    const summary = document.getElementById('route-summary');
    const fromEl  = document.getElementById('route-summary-from');
    const toEl    = document.getElementById('route-summary-to');
    if (summary && fromEl && toEl) {
        fromEl.textContent = window.allNodes[globalStart.id]?.label || globalStart.id;
        toEl.textContent   = window.allNodes[globalEnd.id]?.label   || globalEnd.id;
        summary.style.display = 'flex';
    }

    // Cancel any stale feedback timer â€” feedback is now triggered by Finish button
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = null;

    // Initialize checkpoint navigation
    checkpoints = computeCheckpoints(logicalPath);
    currentCheckpointIdx = 0;
    navStartTime = Date.now();
    if (checkpoints.length > 0) {
        showCheckpointButton();
    }
}

function renderSVG(svgId, points, globalStart, globalEnd, stops) {
    const svg = document.getElementById(svgId);
    if(!svg) return;
    svg.innerHTML = ''; 

    const formattedPoints = points.map(p => `${p.x},${p.y}`).join(' ');
    
    const bgLine = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    bgLine.setAttribute("points", formattedPoints);
    bgLine.setAttribute("class", "path-line-bg");
    svg.appendChild(bgLine);

    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("points", formattedPoints);
    polyline.setAttribute("class", "path-line");
    svg.appendChild(polyline);

    stops.forEach(stop => {
        if(points.some(p => p.id === stop.id)) draw3DPin(svg, stop.x, stop.y, "marker-stop");
    });

    if (points.some(p => p.id === globalStart.id)) draw3DPin(svg, globalStart.x, globalStart.y, "marker-start");
    if (points.some(p => p.id === globalEnd.id)) draw3DPin(svg, globalEnd.x, globalEnd.y, "marker-end");
}

function draw3DPin(svg, x, y, className) {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    // No static transform on g â€” position is handled entirely by animateTransform

    const pin = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pin.setAttribute("d", "M0,0 C-0.8,-1.1 -1.6,-2 -1.6,-3 C-1.6,-4 -0.8,-4.6 0,-4.6 C0.8,-4.6 1.6,-4 1.6,-3 C1.6,-2 0.8,-1.1 0,0 Z");
    pin.setAttribute("class", `marker-3d ${className}`);

    // Base position animation (static, stays at x,y)
    const baseAnim = document.createElementNS("http://www.w3.org/2000/svg", "animateTransform");
    baseAnim.setAttribute("attributeName", "transform");
    baseAnim.setAttribute("attributeType", "XML");
    baseAnim.setAttribute("type", "translate");
    baseAnim.setAttribute("values", `${x},${y}`);
    baseAnim.setAttribute("dur", "indefinite");
    baseAnim.setAttribute("repeatCount", "indefinite");
    baseAnim.setAttribute("additive", "replace");

    // Bounce animation layered on top
    const bounceAnim = document.createElementNS("http://www.w3.org/2000/svg", "animateTransform");
    bounceAnim.setAttribute("attributeName", "transform");
    bounceAnim.setAttribute("attributeType", "XML");
    bounceAnim.setAttribute("type", "translate");
    bounceAnim.setAttribute("values", `0,0; 0,-1.2; 0,0`);
    bounceAnim.setAttribute("dur", "1.5s");
    bounceAnim.setAttribute("repeatCount", "indefinite");
    bounceAnim.setAttribute("additive", "sum");

    g.appendChild(pin);
    g.appendChild(baseAnim);
    g.appendChild(bounceAnim);
    svg.appendChild(g);
}

// --- Map Fit Logic ---

// --- Directions ---
function generateDirections(path) {
    const directions = [];
    if (!path || path.length === 0) return directions;

    const nodeLabel = (id) => window.allNodes[id]?.label || id;
    const isTransition = (id) => id.includes('STAIRS') || id.includes('LIFT');
    const isWaypoint = (id) => id.includes('CORRIDOR') || id.includes('PASSAGEWAY');
    const distMetres = (a, b) => (Math.hypot(b.x - a.x, b.y - a.y) * COORD_TO_METERS).toFixed(0);

    // Relative direction based on dx/dy
    function relativeDir(dx, dy) {
        const adx = Math.abs(dx), ady = Math.abs(dy);
        if (adx > ady * 2) return dx > 0 ? 'to your right' : 'to your left';
        if (ady > adx * 2) return dy > 0 ? 'straight ahead' : 'straight back';
        if (dx > 0 && dy > 0) return 'ahead and to the right';
        if (dx > 0 && dy < 0) return 'ahead and to the left';
        if (dx < 0 && dy > 0) return 'behind and to the right';
        return 'behind and to the left';
    }

    directions.push(`[START] ${nodeLabel(path[0].id)} â€” ${FLOOR_NAMES[path[0].floor]}`);

    // Group consecutive same-floor walking segments to avoid repetitive steps
    let i = 1;
    while (i < path.length) {
        const prev = path[i - 1];
        const curr = path[i];

        // --- Floor transition ---
        if (curr.floor !== prev.floor) {
            if (curr.id.includes('STAIRS-END')) {
                const dir = curr.floor > prev.floor ? 'up' : 'down';
                directions.push(`[STAIRS] Take the straight staircase ${dir} to the ${FLOOR_NAMES[curr.floor]}.`);
            } else if (curr.id.includes('STAIRS-CURVED')) {
                const dir = curr.floor > prev.floor ? 'up' : 'down';
                directions.push(`[STAIRS] Take the curved staircase ${dir} to the ${FLOOR_NAMES[curr.floor]}.`);
            } else if (curr.id.includes('LIFT')) {
                const dir = curr.floor > prev.floor ? 'up' : 'down';
                directions.push(`[LIFT] Take the lift ${dir} to the ${FLOOR_NAMES[curr.floor]}.`);
            }
            i++;
            continue;
        }

        // --- Corridor step ---
        if (isWaypoint(curr.id)) {
            // Collect all consecutive corridor/passageway nodes to measure total corridor distance
            let j = i;
            let corridorDist = 0;
            while (j < path.length && isWaypoint(path[j].id) && path[j].floor === prev.floor) {
                corridorDist += Math.hypot(path[j].x - path[j-1 >= i ? j-1 : i-1].x,
                                           path[j].y - path[j-1 >= i ? j-1 : i-1].y) * COORD_TO_METERS;
                j++;
            }
            const distStr = corridorDist > 1 ? ` (about ${corridorDist.toFixed(0)}m)` : '';
            if (curr.id.includes('PASSAGEWAY')) {
                directions.push(`[WALK] Take the passageway${distStr}.`);
            } else {
                directions.push(`[WALK] Continue along the corridor${distStr}.`);
            }
            i = j;
            continue;
        }

        // --- Normal room-to-room walking step ---
        if (!isTransition(curr.id)) {
            const dx = curr.x - prev.x;
            const dy = curr.y - prev.y;
            const dist = distMetres(prev, curr);
            const dir = relativeDir(dx, dy);
            const label = nodeLabel(curr.id);

            directions.push(`[GO] Head ${dir} for about ${dist}m toward ${label}.`);
            i++;
            continue;
        }

        // --- Transition node on same floor (shouldn't normally happen, skip gracefully) ---
        i++;
    }

    directions.push(`[ARRIVED] ${nodeLabel(path[path.length - 1].id)} â€” You have arrived!`);

    const list = document.getElementById('directions-list');
    if (list) {
        list.innerHTML = '';
        directions.forEach(text => {
            const li = document.createElement('li');
            li.textContent = text;
            list.appendChild(li);
        });
        const dp = document.getElementById('directions-panel');
        if (dp) { dp.style.display = 'block'; dp.open = true; }
    }
    return directions;
}

// --- Metrics ---
function calculateMetrics(path) {
    if (!path || path.length === 0) return;
    let distance = 0;
    let floorChanges = 0;

    for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        if (a.floor === b.floor) {
            const d = Math.hypot(b.x - a.x, b.y - a.y);
            distance += d;
        } else {
            floorChanges += 1;
        }
    }

    const totalMeters = distance * COORD_TO_METERS;
    const seconds = totalMeters / WALK_SPEED;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    const timeStr = `${mins} min ${secs} sec`;

    document.getElementById('m-distance').textContent = totalMeters.toFixed(1);
    document.getElementById('m-time').textContent = timeStr;
    document.getElementById('m-floors').textContent = floorChanges;
    document.getElementById('metrics-bar').style.display = 'flex';
    const rip = document.getElementById('route-info-panel');
    if (rip) rip.style.display = 'block';

    const startId = path[0].id;
    const endId = path[path.length - 1].id;
    fetch(`/stats?route=${startId}+${endId}`)
        .then(r => r.json())
        .then(data => {
            const ratingEl = document.getElementById('m-rating');
            if (!ratingEl) return;
            ratingEl.textContent = data.avg_rating ? data.avg_rating.toFixed(2) : '--';
        })
        .catch(() => {
            const ratingEl = document.getElementById('m-rating');
            if (ratingEl) ratingEl.textContent = '--';
        });
}

// --- Feedback modal / submission ---
function showFeedbackModal() {
    const modal = document.getElementById('feedback-modal');
    if (modal) modal.style.display = 'flex';
}

function closeFeedback() {
    const modal = document.getElementById('feedback-modal');
    if (modal) modal.style.display = 'none';
}

function submitFeedback() {
    const allSelected = [...document.querySelectorAll('#star-rating span.selected')];
    const selected = allSelected.length > 0 ? allSelected[allSelected.length - 1] : null;
    const rating = selected ? +selected.dataset.val : null;
    if (!rating) {
        toast('Please select a star rating before submitting.');
        return;
    }
    if (!pathData || pathData.length === 0) {
        closeFeedback();
        return;
    }

    const comment = document.getElementById('feedback-comment').value || '';
    const payload = {
        start: pathData[0].id,
        end: pathData[pathData.length - 1].id,
        path: pathData.map(p => p.id),
        rating,
        comment
    };

    fetch('/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(() => {
        closeFeedback();
        toast('Thanks for your feedback!');
    })
    .catch(() => toast('Could not send feedback right now.'));
}

function toast(msg) {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.position = 'fixed';
    el.style.bottom = '20px';
    el.style.left = '50%';
    el.style.transform = 'translateX(-50%)';
    el.style.background = '#111827';
    el.style.color = '#fff';
    el.style.padding = '10px 16px';
    el.style.borderRadius = '8px';
    el.style.zIndex = '10000';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
}

// --- Simulation Logic ---
async function simulateWalking(path) {
    if (path.length === 0) return;
    let currentFloor = path[0].floor;
    switchFloor(currentFloor);

    const pointer = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    pointer.setAttribute("r", "6");
    pointer.setAttribute("class", "user-pointer");
    document.getElementById(`svg-f${currentFloor}`).appendChild(pointer);
    pointer.setAttribute("cx", path[0].x);
    pointer.setAttribute("cy", path[0].y);

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    await sleep(500);

    for (let i = 1; i < path.length; i++) {
        const prevNode = path[i-1], nextNode = path[i];
        
        if (nextNode.floor !== currentFloor) {
            await sleep(1000); 
            currentFloor = nextNode.floor;
            switchFloor(currentFloor);
            
            document.getElementById(`svg-f${currentFloor}`).appendChild(pointer);
            pointer.style.transition = "none";
            pointer.setAttribute("cx", nextNode.x);
            pointer.setAttribute("cy", nextNode.y);
            void pointer.offsetWidth; 
            await sleep(500);
        } else {
            const dist = Math.hypot(nextNode.x - prevNode.x, nextNode.y - prevNode.y);
            const duration = dist * 25; 
            
            pointer.style.transition = `cx ${duration}ms linear, cy ${duration}ms linear`;
            pointer.setAttribute("cx", nextNode.x);
            pointer.setAttribute("cy", nextNode.y);
            await sleep(duration);
        }
    }
}

// ============================================================
// FAQ CHATBOT — DB-backed via /faq endpoint
// ============================================================
let faqData = [];

async function loadFAQs() {
    try {
        const res = await fetch('/faq');
        faqData = await res.json();
    } catch (e) {
        faqData = [];
    }
}

function faqMatch(input) {
    const lower = input.toLowerCase().trim();
    for (const faq of faqData) {
        for (const keyword of faq.keywords) {
            if (lower.includes(keyword.toLowerCase())) return faq.answer;
        }
    }
    return null;
}

function toggleFAQChat() {
    const chat = document.getElementById('faq-chat');
    const bubble = document.getElementById('faq-bubble');
    if (!chat) return;
    const isOpen = chat.style.display !== 'none';
    chat.style.display = isOpen ? 'none' : 'flex';
    bubble.classList.toggle('faq-bubble-open', !isOpen);
}

function sendFAQ() {
    const input = document.getElementById('faq-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    appendFAQMessage(text, 'user');
    input.value = '';
    setTimeout(() => {
        const answer = faqMatch(text);
        appendFAQMessage(
            answer || "I'm not sure about that. Try using the navigation form to find your destination, or rephrase your question.",
            'bot'
        );
    }, 280);
}

function appendFAQMessage(text, sender) {
    const messages = document.getElementById('faq-messages');
    if (!messages) return;
    const div = document.createElement('div');
    div.className = `faq-msg faq-msg-${sender}`;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
}

// ============================================================
// PDR — Pedestrian Dead Reckoning (TO BE IMPLEMENTED)
// Will use DeviceMotionEvent + DeviceOrientationEvent to
// estimate user position between known graph waypoints.
// Steps:
//   1) Step detection via accelerometer peak analysis
//   2) Stride length estimation (~0.75m average)
//   3) Heading from deviceorientation compass bearing
//   4) Dead-reckoned position update on SVG overlay
//   5) Snap-to-node when within proximity threshold
// Activates automatically in GPS/WiFi dead zones.
// ============================================================
class PDRNavigator {
  constructor(floorGraph, onPositionUpdate) {
    this.graph = floorGraph;
    this.onUpdate = onPositionUpdate;
    this.position = null;
    this.heading = 0;
    this.stepCount = 0;
  }
  start() { /* Request DeviceMotion + DeviceOrientation permissions (iOS 13+) */ }
  stop()  { /* Remove event listeners */ }
  onStep(heading, strideLength) { /* Update estimated position */ }
    snapToNode(threshold = 5) { /* Find nearest node within threshold % units */ }
}




