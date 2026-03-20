const FLOOR_NAMES = { 1: 'Ground Floor', 2: 'First Floor', 3: 'Second Floor', 4: 'Third Floor' };
const COORD_TO_METERS = 0.5;
const WALK_SPEED = 1.2; // m/s

let pathData = window.pathData || [];
let checkpoints = [];
let currentCheckpointIdx = 0;
let navStartTime = null;
let feedbackTimer = null;

// Mobile UI state
const isMobile = () => window.innerWidth <= 768;
let routeFormOpen = true;

// Floor-confirmation state (PDR anchor gate)
let _floorConfirmCallback = null;

const nodeType = (id) => (window.allNodes[id]?.type) || null;

// ---------------------------------------------------------------------------
// Dark mode
// ---------------------------------------------------------------------------
function applyDarkMode(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    const moonIcon  = document.getElementById('dark-icon');
    const sunIcon   = document.getElementById('light-icon');
    if (moonIcon) moonIcon.style.display = dark ? 'none' : 'block';
    if (sunIcon)  sunIcon.style.display  = dark ? 'block' : 'none';
}

function toggleDarkMode() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    applyDarkMode(!isDark);
    localStorage.setItem('wayfinder-theme', isDark ? 'light' : 'dark');
}

document.addEventListener('DOMContentLoaded', () => {
    // ── Dark mode: restore saved preference ──
    const saved = localStorage.getItem('wayfinder-theme');
    if (saved === 'dark') applyDarkMode(true);

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
            checkpoints = [];
            currentCheckpointIdx = 0;
            navStartTime = null;
            hideCheckpointButton();
            // Reset desktop panel back to form view before new route loads
            const form = document.getElementById('nav-form');
            if (form) form.classList.remove('form-hidden');
            const rip = document.getElementById('route-info-panel');
            if (rip) rip.style.display = 'none';
            if (isMobile()) {
                closeRouteForm();
                const topBar = document.getElementById('mobile-top-bar');
                if (topBar) topBar.style.display = 'flex';
                document.documentElement.style.overflow = 'hidden';
            }
            const summaryClear = document.getElementById('route-summary');
            if (summaryClear) summaryClear.style.display = 'none';
            if (isMobile()) {
                const strip = document.getElementById('mobile-directions-strip');
                if (strip) strip.style.display = 'none';
                document.body.classList.remove('has-route');
            }
        });
    }

    window.addEventListener('resize', () => { fitSVGToImage(); fitNavSVGToImage(); });
    loadFAQs();
    fitSVGToImage();

    document.querySelectorAll('.map-image').forEach(img => {
        if (!img.complete) {
            img.addEventListener('load', fitSVGToImage, { once: true });
        }
    });

    document.querySelectorAll('.nav-floor-png').forEach(img => {
        if (!img.complete) {
            img.addEventListener('load', () => fitNavSVGToImage(), { once: true });
        }
    });

    if (Array.isArray(pathData) && pathData.length > 0) {
        const ortho = makeOrthogonalPath(pathData);
        drawPath(ortho, pathData);
        switchFloor(pathData[0].floor);
    }
});

// ---------------------------------------------------------------------------
// SVG fit — aligns overlay to letterboxed floor image
// ---------------------------------------------------------------------------
function fitSVGToImage() {
    for (let f = 1; f <= 4; f++) {
        const container = document.getElementById(`f${f}-container`);
        if (!container) continue;
        const img = container.querySelector('.map-image');
        const svg = container.querySelector('.map-overlay');
        if (!img || !svg) continue;

        const cw = container.clientWidth;
        const ch = container.clientHeight;
        const iw = img.naturalWidth  || cw;
        const ih = img.naturalHeight || ch;

        const scale   = Math.min(cw / iw, ch / ih);
        const rw      = iw * scale;
        const rh      = ih * scale;
        const offsetX = (cw - rw) / 2;
        const offsetY = (ch - rh) / 2;

        svg.style.left   = offsetX + 'px';
        svg.style.top    = offsetY + 'px';
        svg.style.width  = rw + 'px';
        svg.style.height = rh + 'px';
    }
}

// Same letterbox calculation for the nav-screen map viewport
function fitNavSVGToImage() {
    for (let f = 1; f <= 4; f++) {
        const container = document.getElementById(`nav-f${f}`);
        if (!container) continue;
        const img = container.querySelector('.nav-floor-png');
        const svg = container.querySelector('.nav-floor-svg');
        if (!img || !svg) continue;

        const cw = container.clientWidth;
        const ch = container.clientHeight;
        const iw = img.naturalWidth  || cw;
        const ih = img.naturalHeight || ch;
        if (!cw || !ch) continue;

        const scale   = Math.min(cw / iw, ch / ih);
        const rw      = iw * scale;
        const rh      = ih * scale;
        const offsetX = (cw - rw) / 2;
        const offsetY = (ch - rh) / 2;

        svg.style.left   = offsetX + 'px';
        svg.style.top    = offsetY + 'px';
        svg.style.width  = rw + 'px';
        svg.style.height = rh + 'px';
    }
}

// ---------------------------------------------------------------------------
// Floor tabs
// ---------------------------------------------------------------------------
function switchFloor(floorNum) {
    document.querySelectorAll('.floor-tab').forEach(tab =>
        tab.classList.toggle('active', tab.dataset.floor == floorNum));
    for (let i = 1; i <= 4; i++) {
        const container = document.getElementById(`f${i}-container`);
        if (container) container.style.display = (i == floorNum) ? 'block' : 'none';
    }
    fitSVGToImage();
    // Keep nav screen floor in sync
    syncNavFloor(floorNum);
}

// ---------------------------------------------------------------------------
// Orthogonal path (pass-through — elbow insertion removed in v2)
// ---------------------------------------------------------------------------
function makeOrthogonalPath(path) {
    return Array.isArray(path) ? [...path] : [];
}

// ---------------------------------------------------------------------------
// Checkpoint computation
//
// Rules:
//   • Lift:   checkpoint at DEPARTURE floor + FINAL ARRIVAL floor only.
//             Intermediate floors skipped (user rides straight through).
//   • Stairs: checkpoint on BOTH sides of every single-floor step.
//   • User-selected intermediate stops: always a checkpoint.
//   • High-degree junctions (degree >= 3): checkpoint.
//   • Final destination: always the last checkpoint.
// ---------------------------------------------------------------------------
function computeCheckpoints(logicalPath) {
    if (!logicalPath || logicalPath.length === 0) return [];

    const result   = [];
    const addedIds = new Set();
    const stopIds  = (window.stopLabels || []).map(s => s.id);

    function addCheckpoint(node) {
        if (!node) return;
        if (window.allNodes[node.id]?.is_waypoint) return;
        // For vertical nodes (lift/stairs), allow re-adding if in a different segment
        const isVertical = nodeType(node.id) === 'lift' || nodeType(node.id) === 'stairs';
        const key = isVertical ? `${node.id}::${node.segment ?? 0}` : node.id;
        if (addedIds.has(key)) return;
        addedIds.add(key);
        result.push(node);
    }

    for (let i = 1; i < logicalPath.length - 1; i++) {
        const curr = logicalPath[i];
        const next = logicalPath[i + 1];

        const currType = nodeType(curr.id);
        const isWp     = window.allNodes[curr.id]?.is_waypoint;

        if (isWp) continue;

        // --- Floor transition ---
        if (next && curr.floor !== next.floor) {
            const isLift   = currType === 'lift';
            const isStairs = currType === 'stairs';

            if (isLift) {
                // Scan past all consecutive lift-to-lift hops to find final exit.
                let j = i;
                while (
                    j + 1 < logicalPath.length &&
                    nodeType(logicalPath[j + 1].id) === 'lift' &&
                    logicalPath[j + 1].floor !== logicalPath[j].floor
                ) { j++; }
                addCheckpoint(curr);            // departure  e.g. LIFT-GF
                addCheckpoint(logicalPath[j]);  // final exit e.g. LIFT-2F
                i = j;
            } else if (isStairs) {
                // Same logic as lift: scan past ALL consecutive stair hops
                // to find the final exit floor. This means 1F→3F via stairs
                // only prompts at departure (1F) and arrival (3F), skipping 2F.
                let j = i;
                while (
                    j + 1 < logicalPath.length &&
                    nodeType(logicalPath[j + 1].id) === 'stairs' &&
                    logicalPath[j + 1].floor !== logicalPath[j].floor
                ) { j++; }
                addCheckpoint(curr);            // departure stair node
                addCheckpoint(logicalPath[j]);  // final arrival stair node
                i = j;
            }
            continue;
        }

        // --- User-selected stop or high-degree junction ---
        const isUserStop = stopIds.includes(curr.id);
        const isStopNode = currType !== 'lift' && currType !== 'stairs' &&
                           curr.id !== logicalPath[0].id &&
                           curr.id !== logicalPath[logicalPath.length - 1].id;
        const degree     = (window.nodeDegrees && window.nodeDegrees[curr.id]) || 0;
        const isJunction = degree >= 3;

        if (isStopNode && (isUserStop || isJunction)) {
            addCheckpoint(curr);
        }
    }

    // Always end with the final destination.
    const last = logicalPath[logicalPath.length - 1];
    if (!addedIds.has(last.id)) result.push(last);

    return result;
}

// ---------------------------------------------------------------------------
// Checkpoint button
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Route active panel — desktop left panel switches to metrics+directions view
// ---------------------------------------------------------------------------
function showRouteActivePanel() {
    // Hide form elements
    const form       = document.getElementById('nav-form');
    const stopsCont  = document.getElementById('stops-container');
    if (form) form.classList.add('form-hidden');

    // Show route info panel
    const rip = document.getElementById('route-info-panel');
    if (rip) rip.style.display = 'block';
}

function resetToForm() {
    // Show form again
    const form = document.getElementById('nav-form');
    if (form) form.classList.remove('form-hidden');

    // Hide route info panel
    const rip = document.getElementById('route-info-panel');
    if (rip) rip.style.display = 'none';

    // Clear SVGs and reset state
    for (let f = 1; f <= 4; f++) {
        const svg = document.getElementById(`svg-f${f}`);
        if (svg) svg.innerHTML = '';
    }
    const legend  = document.getElementById('map-legend');
    const summary = document.getElementById('route-summary');
    if (legend)  legend.style.display  = 'none';
    if (summary) summary.style.display = 'none';
    hideCheckpointButton();
    pathData    = [];
    checkpoints = [];
    currentCheckpointIdx = 0;

    // Mobile cleanup
    const topBar = document.getElementById('mobile-top-bar');
    if (topBar) topBar.style.display = 'none';
    document.body.classList.remove('has-route');
    document.documentElement.style.overflow = '';
}

function showCheckpointButton() {
    const btn = document.getElementById('checkpoint-btn');
    if (!btn) return;
    const isLast      = currentCheckpointIdx >= checkpoints.length - 1;
    btn.textContent   = isLast ? 'Finish Navigation' : 'Reached Checkpoint';
    btn.className     = isLast ? 'checkpoint-btn finish-btn' : 'checkpoint-btn';
    btn.style.display = 'flex';
}

function hideCheckpointButton() {
    const btn = document.getElementById('checkpoint-btn');
    if (btn) btn.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Mobile form sheet
// ---------------------------------------------------------------------------
function openRouteForm() {
    const sheet = document.getElementById('route-form-sheet');
    if (sheet) sheet.classList.remove('sheet-hidden');
    routeFormOpen = true;
    const topBar = document.getElementById('mobile-top-bar');
    if (topBar && isMobile()) topBar.style.display = 'none';
}

function closeRouteForm() {
    if (!isMobile()) return;
    const sheet = document.getElementById('route-form-sheet');
    if (sheet) sheet.classList.add('sheet-hidden');
    routeFormOpen = false;
}

function toggleMobileDirections() {
    const full = document.getElementById('mobile-full-directions');
    const icon = document.querySelector('.mobile-step-expand-icon');
    if (!full) return;
    const isVisible = full.style.display !== 'none';
    full.style.display = isVisible ? 'none' : 'block';
    if (icon) icon.classList.toggle('expanded', !isVisible);
}

// ---------------------------------------------------------------------------
// Floor confirmation modal
// ---------------------------------------------------------------------------
function showFloorConfirmModal(floorNum, method, onResponse) {
    const modal = document.getElementById('floor-confirm-modal');
    const icon  = document.getElementById('floor-confirm-icon');
    const title = document.getElementById('floor-confirm-title');
    const body  = document.getElementById('floor-confirm-body');
    if (!modal) { onResponse(true); return; }

    const floorName = FLOOR_NAMES[floorNum] || `Floor ${floorNum}`;

    icon.textContent      = method === 'lift' ? 'LIFT' : 'STAIRS';
    icon.style.color      = method === 'lift' ? '#6366f1' : '#f59e0b';
    icon.style.fontFamily = "'Orbitron', sans-serif";
    icon.style.fontSize   = '14px';
    icon.style.fontWeight = '700';
    icon.style.letterSpacing = '1px';
    icon.style.padding    = '8px 16px';
    icon.style.borderRadius = '8px';
    icon.style.background = method === 'lift'
        ? 'rgba(99,102,241,0.1)' : 'rgba(245,158,11,0.1)';

    title.textContent = method === 'lift'
        ? `Take the lift to the ${floorName}`
        : `Take the stairs to the ${floorName}`;
    body.textContent = method === 'lift'
        ? `Enter the lift and travel to the ${floorName}. Tap "Yes, I'm here" once the lift doors open on that floor.`
        : `Walk up/down the stairs to the ${floorName}. Tap "Yes, I'm here" once you arrive on that floor.`;

    _floorConfirmCallback = onResponse;
    modal.style.display = 'flex';
}

function hideFloorConfirmModal() {
    const modal = document.getElementById('floor-confirm-modal');
    if (modal) modal.style.display = 'none';
    _floorConfirmCallback = null;
}

function onFloorConfirmed(confirmed) {
    // Save callback BEFORE hideFloorConfirmModal nulls _floorConfirmCallback.
    const cb = _floorConfirmCallback;
    hideFloorConfirmModal();
    if (cb) cb(confirmed);
}

// ---------------------------------------------------------------------------
// Checkpoint reached handler
// ---------------------------------------------------------------------------
function onCheckpointReached() {
    if (!checkpoints || checkpoints.length === 0) return;

    const isLast = currentCheckpointIdx >= checkpoints.length - 1;

    if (isLast) {
        hideCheckpointButton();
        // Clear all SVG overlays and UI chrome
        for (let f = 1; f <= 4; f++) {
            const svg = document.getElementById(`svg-f${f}`);
            if (svg) svg.innerHTML = '';
        }
        const legend  = document.getElementById('map-legend');
        const summary = document.getElementById('route-summary');
        if (legend)  legend.style.display  = 'none';
        if (summary) summary.style.display = 'none';
        // Hide mobile nav screen
        const navScreen = document.getElementById('mobile-directions-strip');
        if (navScreen) navScreen.style.display = 'none';
        pathData   = [];
        checkpoints = [];
        const elapsed = navStartTime ? Math.round((Date.now() - navStartTime) / 1000) : 0;
        const mins    = Math.floor(elapsed / 60);
        const secs    = elapsed % 60;
        showSuccessOverlay(mins > 0 ? `${mins} min ${secs} sec` : `${secs} sec`);
        return;
    }

    const reachedCp    = checkpoints[currentCheckpointIdx];
    const nextCp       = checkpoints[currentCheckpointIdx + 1];
    const reachedType  = nodeType(reachedCp.id);
    const isLiftNode   = reachedType === 'lift'   || reachedCp.id.includes('LIFT');
    const isStairNode  = reachedType === 'stairs' || reachedCp.id.includes('STAIRS')
                         || reachedCp.id.includes('CURVEDSTAIRS');
    const floorChanging = nextCp && reachedCp.floor !== nextCp.floor;

    const needsLiftConfirm  = isLiftNode  && floorChanging;
    const needsStairConfirm = isStairNode && floorChanging;

    function advanceCheckpoint() {
        currentCheckpointIdx++;
        const activeCp = checkpoints[currentCheckpointIdx];
        if (!activeCp) return;
        if (window._pdrNavigator) window._pdrNavigator.snapToCheckpoint(activeCp);
        switchFloor(activeCp.floor);
        highlightRemainingPath(currentCheckpointIdx);
        scrollDirectionsToCheckpoint(activeCp.id);
        showCheckpointButton();
        const btn = document.getElementById('checkpoint-btn');
        if (btn && btn.style.display === 'none') btn.style.display = 'flex';
        if (isMobile()) {
            updateMobileCurrentStep(currentCheckpointIdx);
            syncNavSVGs();
        }
    }

    if (needsLiftConfirm || needsStairConfirm) {
        hideCheckpointButton();
        const method      = isLiftNode ? 'lift' : 'stairs';
        const targetFloor = nextCp.floor;
        showFloorConfirmModal(targetFloor, method, (confirmed) => {
            if (confirmed) {
                switchFloor(targetFloor);
                advanceCheckpoint();
            } else {
                toast(`Head to the ${FLOOR_NAMES[targetFloor]} and tap the button when you arrive.`);
                showCheckpointButton();
            }
        });
    } else {
        advanceCheckpoint();
    }
}

// ---------------------------------------------------------------------------
// highlightRemainingPath
//
// After a checkpoint is confirmed, redraws all floor SVGs showing:
//   • traversed portion in grey
//   • remaining portion in animated blue
//
// Both are split by (segment, floor) bucket so same-floor doubled-back
// corridors on multi-stop routes each get their own clean polyline, and
// floor transitions bridge endpoints correctly.
// ---------------------------------------------------------------------------
function highlightRemainingPath(checkpointIdx) {
    if (!pathData || pathData.length === 0) return;
    if (!checkpoints[checkpointIdx]) return;

    const currentId = checkpoints[checkpointIdx].id;
    const orthoPath = makeOrthogonalPath(pathData);

    // Walk checkpoints cumulatively to find the correct occurrence of each,
    // always searching FORWARD to avoid matching re-visited corridor nodes.
    let searchFrom = 0;
    for (let k = 0; k < checkpointIdx; k++) {
        const found = orthoPath.findIndex((p, i) => i >= searchFrom && p.id === checkpoints[k].id);
        if (found !== -1) searchFrom = found + 1;
    }

    let splitIdx = orthoPath.findIndex((p, i) => i >= searchFrom && p.id === currentId);
    if (splitIdx === -1) {
        for (let k = orthoPath.length - 1; k >= 0; k--) {
            if (orthoPath[k].id === currentId) { splitIdx = k; break; }
        }
    }
    if (splitIdx === -1) splitIdx = 0;

    const traversed = orthoPath.slice(0, splitIdx + 1);
    const remaining  = orthoPath.slice(splitIdx);

    const globalStart = pathData[0];
    const globalEnd   = pathData[pathData.length - 1];
    const stops = pathData.filter(p =>
        p.id !== globalStart.id && p.id !== globalEnd.id &&
        !p.id.includes('elbow') &&
        !window.allNodes[p.id]?.is_waypoint &&
        nodeType(p.id) !== 'lift' && nodeType(p.id) !== 'stairs'
    );

    // Split nodes into (segment, floor) buckets.
    // On a floor change, the last point of the outgoing bucket is prepended
    // to the next bucket so polylines share an endpoint.
    // Vertical nodes (stairs/lift) are also added to the adjacent floor's
    // bucket as a bridge point so stairs-only paths render correctly.
    function toBuckets(nodes) {
        const buckets = [];
        let curSeg = null, curFloor = null, curPts = [];
        nodes.forEach(p => {
            const seg = p.segment ?? 0;
            if (seg !== curSeg || p.floor !== curFloor) {
                if (curPts.length >= 2) buckets.push({ floor: curFloor, pts: curPts });
                const floorChanged = curFloor !== null && p.floor !== curFloor && curPts.length > 0;
                curPts  = floorChanged ? [curPts[curPts.length - 1], p] : [p];
                curSeg   = seg;
                curFloor = p.floor;
            } else {
                curPts.push(p);
            }
        });
        if (curPts.length >= 2) buckets.push({ floor: curFloor, pts: curPts });

        // Extra pass: for vertical (stair/lift) nodes that sit at floor
        // boundaries, add a 2-point bridge bucket on the adjacent floor
        // so the line visually connects to the stair/lift icon on that floor.
        const extra = [];
        nodes.forEach((p, idx) => {
            const isVertical = nodeType(p.id) === 'stairs' || nodeType(p.id) === 'lift';
            if (!isVertical) return;
            const prev = nodes[idx - 1];
            const next = nodes[idx + 1];
            if (prev && prev.floor !== p.floor) {
                extra.push({ floor: prev.floor, pts: [prev, p] });
            }
            if (next && next.floor !== p.floor) {
                extra.push({ floor: next.floor, pts: [p, next] });
            }
        });
        return [...buckets, ...extra];
    }

    const travBuckets = toBuckets(traversed);
    const remBuckets  = toBuckets(remaining);

    for (let f = 1; f <= 4; f++) {
        const svg = document.getElementById(`svg-f${f}`);
        if (!svg) continue;
        svg.innerHTML = '';

        // Grey traversed polylines
        travBuckets.filter(b => b.floor === f).forEach(b => {
            const pl = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
            pl.setAttribute("points", b.pts.map(p => `${p.x},${p.y}`).join(' '));
            pl.setAttribute("class", "path-line-traversed");
            svg.appendChild(pl);
        });

        // Animated blue remaining polylines
        remBuckets.filter(b => b.floor === f).forEach(b => {
            const bg = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
            bg.setAttribute("points", b.pts.map(p => `${p.x},${p.y}`).join(' '));
            bg.setAttribute("class", "path-line-bg");
            svg.appendChild(bg);

            const pl = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
            pl.setAttribute("points", b.pts.map(p => `${p.x},${p.y}`).join(' '));
            pl.setAttribute("class", "path-line");
            svg.appendChild(pl);
        });

        // Markers
        stops.forEach(stop => {
            if (stop.floor === f && remaining.some(p => p.id === stop.id))
                draw3DPin(svg, stop.x, stop.y, "marker-stop");
        });
        if (globalStart.floor === f && remaining.some(p => p.id === globalStart.id))
            draw3DPin(svg, globalStart.x, globalStart.y, "marker-start");

        // Red pin only on the final leg
        const isOnFinalLeg = currentCheckpointIdx >= checkpoints.length - 1;
        if (isOnFinalLeg && globalEnd.floor === f && remaining.some(p => p.id === globalEnd.id))
            draw3DPin(svg, globalEnd.x, globalEnd.y, "marker-end");

        // Next checkpoint purple dot
        const nextIdx = currentCheckpointIdx + 1;
        const nextCp  = nextIdx < checkpoints.length ? checkpoints[nextIdx] : null;
        if (nextCp && nextCp.floor === f && remaining.some(p => p.id === nextCp.id))
            drawCheckpointDot(svg, nextCp.x, nextCp.y);
    }
}

// ---------------------------------------------------------------------------
// Directions scroll highlight
// ---------------------------------------------------------------------------
function scrollDirectionsToCheckpoint(nodeId) {
    const list = document.getElementById('directions-list');
    if (!list) return;
    const items = Array.from(list.querySelectorAll('li'));
    if (items.length === 0) return;

    const label    = window.allNodes[nodeId]?.label || '';
    const nType    = nodeType(nodeId);
    const isLift   = nType === 'lift'   || nodeId.includes('LIFT');
    const isStairs = nType === 'stairs' || nodeId.includes('STAIRS');

    items.forEach(li => li.classList.remove('directions-active'));
    let target = null;
    if (isLift)        target = items.find(li => li.textContent.startsWith('[LIFT]'));
    else if (isStairs) target = items.find(li => li.textContent.startsWith('[STAIRS]'));
    else if (label)    items.forEach(li => { if (li.textContent.includes(label)) target = li; });

    if (!target && items.length > 0) target = items.slice(0, -1).pop() || items[0];
    if (target) {
        target.classList.add('directions-active');
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    if (isMobile()) {
        const stripItem  = document.querySelector(
            `#mobile-directions-list li[data-checkpoint="${currentCheckpointIdx}"]`);
        const stripItems = document.querySelectorAll('#mobile-directions-list li');
        stripItems.forEach(li => li.classList.remove('directions-active'));
        if (stripItem) {
            stripItem.classList.add('directions-active');
            const stepEl = document.getElementById('mobile-step-text');
            if (stepEl) stepEl.textContent =
                stripItem.childNodes[0]?.textContent?.trim() ||
                stripItem.textContent.replace(/CP\d+/, '').trim();
        }
    }
}

// ---------------------------------------------------------------------------
// Success overlay
// ---------------------------------------------------------------------------
function showSuccessOverlay(elapsedTimeStr) {
    const overlay = document.getElementById('success-overlay');
    if (!overlay) return;
    const timeEl = document.getElementById('success-elapsed-time');
    if (timeEl) timeEl.textContent = elapsedTimeStr;
    document.body.classList.remove('has-route');
    document.documentElement.style.overflow = '';
    overlay.style.display = 'flex';
    setTimeout(() => {
        overlay.style.display = 'none';
        showFeedbackModal();
    }, 3000);
}

// ---------------------------------------------------------------------------
// drawPath — initial render after route computed by Flask
// ---------------------------------------------------------------------------
function drawPath(path, logicalPath = path) {
    if (!path || path.length === 0) {
        toast('Route not available. Please try another selection.');
        return;
    }

    pathData = logicalPath;

    const floorPaths = { 1: [], 2: [], 3: [], 4: [] };
    path.forEach(node => {
        if (node.floor && floorPaths[node.floor]) floorPaths[node.floor].push(node);
    });

    const globalStart = logicalPath[0];
    const globalEnd   = logicalPath[logicalPath.length - 1];
    const stops = logicalPath.filter(p =>
        p.id !== globalStart.id && p.id !== globalEnd.id &&
        !p.id.includes('elbow') &&
        !window.allNodes[p.id]?.is_waypoint &&
        nodeType(p.id) !== 'lift' && nodeType(p.id) !== 'stairs'
    );

    const routeCheckpoints = computeCheckpoints(logicalPath);
    const nextCheckpoint   = routeCheckpoints.length > 0 ? routeCheckpoints[0] : null;

    for (let i = 1; i <= 4; i++) {
        if (floorPaths[i].length > 1) {
            renderSVG(`svg-f${i}`, floorPaths[i], globalStart, globalEnd, stops, nextCheckpoint);
        } else {
            const svg = document.getElementById(`svg-f${i}`);
            if (svg) svg.innerHTML = '';
        }
    }

    generateDirections(logicalPath);
    calculateMetrics(logicalPath);

    // On desktop, switch left panel to route-active view
    if (!isMobile()) showRouteActivePanel();

    if (isMobile()) {
        document.body.classList.add('has-route');
        closeRouteForm();
        populateMobileStrip(logicalPath);
        syncNavSVGs();
        const mobileLabel = document.getElementById('mobile-route-label');
        if (mobileLabel) {
            mobileLabel.textContent =
                `${window.allNodes[globalStart.id]?.label || globalStart.id} → ` +
                `${window.allNodes[globalEnd.id]?.label   || globalEnd.id}`;
        }
        const topBar = document.getElementById('mobile-top-bar');
        if (topBar) topBar.style.display = 'flex';
        const strip = document.getElementById('mobile-directions-strip');
        if (strip) strip.style.display = 'block';
    }

    const legend = document.getElementById('map-legend');
    if (legend) legend.style.display = 'flex';

    const summary = document.getElementById('route-summary');
    if (summary) {
        const startLabel         = window.allNodes[globalStart.id]?.label || globalStart.id;
        const endLabel           = window.allNodes[globalEnd.id]?.label   || globalEnd.id;
        const intermediateLabels = (window.stopLabels || []).map(s => s.label);
        const allLabels          = [startLabel, ...intermediateLabels, endLabel];
        summary.innerHTML = allLabels.map((label, i) => {
            let cls = 'route-summary-stop';
            if (i === 0)                    cls = 'route-summary-from';
            else if (i === allLabels.length - 1) cls = 'route-summary-to';
            const span = `<span class="${cls}" title="${label}">${label}</span>`;
            return i < allLabels.length - 1
                ? span + '<span class="route-summary-arrow"> → </span>'
                : span;
        }).join('');
        summary.style.display  = 'flex';
        summary.style.flexWrap = 'wrap';
        summary.style.maxWidth = 'none';
    }

    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = null;

    checkpoints          = routeCheckpoints;
    currentCheckpointIdx = 0;
    navStartTime         = Date.now();

    if (checkpoints.length > 0) {
        showCheckpointButton();
    } else {
        const btn = document.getElementById('checkpoint-btn');
        if (btn) {
            btn.textContent   = 'Finish Navigation';
            btn.className     = 'checkpoint-btn finish-btn';
            btn.style.display = 'flex';
        }
    }
}

// ---------------------------------------------------------------------------
// renderSVG — draws one floor's path on initial load
//
// Nodes on the same floor are merged into ONE polyline regardless of segment.
// This eliminates the CSS dash-phase gap that appears when two separate
// <polyline> elements share a boundary point (same-floor multi-stop routes).
//
// Red destination pin suppressed until the user is on the final leg.
// ---------------------------------------------------------------------------
function renderSVG(svgId, points, globalStart, globalEnd, stops, nextCheckpoint = null) {
    const svg = document.getElementById(svgId);
    if (!svg) return;
    svg.innerHTML = '';

    // One polyline per floor — merge all segments.
    // Include stair/lift boundary nodes on adjacent floors so the path
    // connects cleanly across floor transitions (stairs-only mode fix).
    const byFloor = {};
    points.forEach((p, idx) => {
        if (!byFloor[p.floor]) byFloor[p.floor] = [];
        byFloor[p.floor].push(p);

        // If this is a vertical node transitioning floors, also add it
        // to the adjacent floor's list as a bridge point so the line
        // starts/ends at the right edge rather than leaving a gap.
        const isVertical = nodeType(p.id) === 'stairs' || nodeType(p.id) === 'lift';
        if (isVertical) {
            const prev = points[idx - 1];
            const next = points[idx + 1];
            if (prev && prev.floor !== p.floor) {
                if (!byFloor[prev.floor]) byFloor[prev.floor] = [];
                byFloor[prev.floor].push(p);
            }
            if (next && next.floor !== p.floor) {
                if (!byFloor[next.floor]) byFloor[next.floor] = [];
                byFloor[next.floor].push(p);
            }
        }
    });

    Object.entries(byFloor).forEach(([, floorPts]) => {
        if (floorPts.length < 2) return;
        const pts = floorPts.map(p => `${p.x},${p.y}`).join(' ');

        const bg = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        bg.setAttribute("points", pts);
        bg.setAttribute("class", "path-line-bg");
        svg.appendChild(bg);

        const pl = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        pl.setAttribute("points", pts);
        pl.setAttribute("class", "path-line");
        svg.appendChild(pl);
    });

    // Stop markers (orange)
    stops.forEach(stop => {
        if (points.some(p => p.id === stop.id))
            draw3DPin(svg, stop.x, stop.y, "marker-stop");
    });

    // Start marker (green)
    if (points.some(p => p.id === globalStart.id))
        draw3DPin(svg, globalStart.x, globalStart.y, "marker-start");

    // Red destination pin — only on the final leg.
    const maxSeg   = Math.max(...points.map(p => p.segment ?? 0));
    const destSeg  = points.find(p => p.id === globalEnd.id)?.segment ?? maxSeg;
    const isFinalLeg = !nextCheckpoint || destSeg === maxSeg;
    if (isFinalLeg && points.some(p => p.id === globalEnd.id))
        draw3DPin(svg, globalEnd.x, globalEnd.y, "marker-end");

    // Next checkpoint dot (purple)
    if (nextCheckpoint && points.some(p => p.id === nextCheckpoint.id))
        drawCheckpointDot(svg, nextCheckpoint.x, nextCheckpoint.y);
}

// ---------------------------------------------------------------------------
// Marker helpers
// ---------------------------------------------------------------------------
function draw3DPin(svg, x, y, className) {
    const g   = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const pin = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pin.setAttribute("d", "M0,0 C-0.8,-1.1 -1.6,-2 -1.6,-3 C-1.6,-4 -0.8,-4.6 0,-4.6 C0.8,-4.6 1.6,-4 1.6,-3 C1.6,-2 0.8,-1.1 0,0 Z");
    pin.setAttribute("class", `marker-3d ${className}`);

    const baseAnim = document.createElementNS("http://www.w3.org/2000/svg", "animateTransform");
    baseAnim.setAttribute("attributeName", "transform");
    baseAnim.setAttribute("attributeType", "XML");
    baseAnim.setAttribute("type", "translate");
    baseAnim.setAttribute("values", `${x},${y}`);
    baseAnim.setAttribute("dur", "indefinite");
    baseAnim.setAttribute("repeatCount", "indefinite");
    baseAnim.setAttribute("additive", "replace");

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

function drawCheckpointDot(svg, x, y) {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("r", "1.2");
    circle.setAttribute("fill", "#8b5cf6");
    circle.setAttribute("stroke", "#ffffff");
    circle.setAttribute("stroke-width", "0.4");
    circle.setAttribute("opacity", "0.9");

    const anim = document.createElementNS("http://www.w3.org/2000/svg", "animateTransform");
    anim.setAttribute("attributeName", "transform");
    anim.setAttribute("attributeType", "XML");
    anim.setAttribute("type", "translate");
    anim.setAttribute("values", `${x},${y}`);
    anim.setAttribute("dur", "indefinite");
    anim.setAttribute("repeatCount", "indefinite");
    anim.setAttribute("additive", "replace");

    circle.appendChild(anim);
    svg.appendChild(circle);
}

// ---------------------------------------------------------------------------
// Turn-by-turn directions — rich, landmark-aware
// ---------------------------------------------------------------------------
function generateDirections(path) {
    const directions = [];
    if (!path || path.length === 0) return directions;

    const nodeLabel  = (id) => window.allNodes[id]?.label || id;
    const isTransition = (id) => nodeType(id) === 'stairs' || nodeType(id) === 'lift';
    const isWaypoint   = (id) => window.allNodes[id]?.is_waypoint ||
                                  id.includes('HALLWAY') || id.includes('PASSAGEWAY');

    // ── Geometry helpers ──────────────────────────────────────────────────────

    // Heading angle in degrees (0=right, 90=down, 180=left, 270=up) from a to b
    function heading(a, b) {
        return (Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 360) % 360;
    }

    // Turn direction: given prev heading and new heading, was it left or right?
    function turnDir(prevH, newH) {
        let diff = ((newH - prevH) + 360) % 360;
        if (diff > 180) diff -= 360; // -180..+180
        if (Math.abs(diff) < 25) return 'straight';
        return diff > 0 ? 'right' : 'left';
    }

    // Cardinal label for a heading
    function cardinal(h) {
        if (h < 22.5 || h >= 337.5) return 'east';
        if (h < 67.5)  return 'south-east';
        if (h < 112.5) return 'south';
        if (h < 157.5) return 'south-west';
        if (h < 202.5) return 'west';
        if (h < 247.5) return 'north-west';
        if (h < 292.5) return 'north';
        return 'north-east';
    }

    // Distance in metres between two nodes
    function distM(a, b) {
        return Math.hypot(b.x - a.x, b.y - a.y) * COORD_TO_METERS;
    }

    // ── Landmark finder ───────────────────────────────────────────────────────
    // Finds the closest real room (not waypoint, not transition) on the same
    // floor that is NOT on the current path, within a spatial radius.
    function nearbyLandmark(node, pathIds, radius = 18) {
        if (!window.allNodes) return null;
        let best = null, bestDist = radius;
        for (const [id, data] of Object.entries(window.allNodes)) {
            if (data.is_waypoint) continue;
            if (nodeType(id) === 'stairs' || nodeType(id) === 'lift') continue;
            if (data.floor !== node.floor) continue;
            if (pathIds.has(id)) continue;
            const d = Math.hypot(data.coords[0] - node.x, data.coords[1] - node.y);
            if (d < bestDist) { bestDist = d; best = { id, label: data.label, d }; }
        }
        return best;
    }

    // Side of corridor a landmark is on relative to direction of travel
    function landmarkSide(traveller, landmark, travelHeading) {
        // Vector from traveller to landmark
        const lx = landmark.coords[0] - traveller.x;
        const ly = landmark.coords[1] - traveller.y;
        // Rotate by -travelHeading to get local frame
        const rad = travelHeading * Math.PI / 180;
        const local_y = -lx * Math.sin(rad) + ly * Math.cos(rad);
        return local_y > 0 ? 'right' : 'left';
    }

    // ── Helpers for human-readable corridor instructions ─────────────────────

    // Collect all real (non-waypoint) rooms visible from a corridor node
    function roomsAlongCorridor(corridorNodes, pathIds) {
        const seen = new Set();
        const rooms = [];
        for (const cn of corridorNodes) {
            for (const [id, data] of Object.entries(window.allNodes)) {
                if (data.is_waypoint) continue;
                if (nodeType(id) === 'stairs' || nodeType(id) === 'lift') continue;
                if (data.floor !== cn.floor) continue;
                if (pathIds.has(id)) continue;
                if (seen.has(id)) continue;
                const d = Math.hypot(data.coords[0] - cn.x, data.coords[1] - cn.y);
                if (d <= 14) { seen.add(id); rooms.push({ id, label: data.label, coords: data.coords }); }
            }
        }
        return rooms;
    }

    const pathIds = new Set(path.map(p => p.id));

    // ── Build instruction text ────────────────────────────────────────────────

    directions.push(`[START] You are at ${nodeLabel(path[0].id)} on the ${FLOOR_NAMES[path[0].floor]}.`);

    let i = 1;
    let prevHeading = null; // track heading across steps for turn detection

    while (i < path.length) {
        const prev = path[i - 1];
        const curr = path[i];

        // ── Floor transition ──────────────────────────────────────────────────
        if (curr.floor !== prev.floor) {
            const isLift   = nodeType(curr.id) === 'lift';
            const isStairs = nodeType(curr.id) === 'stairs';
            const isCurved = isStairs && window.allNodes[curr.id]?.stairs_kind === 'curved';

            if (isLift || isStairs) {
                const originFloor = prev.floor;
                let j = i;
                while (
                    j < path.length &&
                    path[j].floor !== prev.floor &&
                    (isLift ? nodeType(path[j].id) === 'lift' : nodeType(path[j].id) === 'stairs')
                ) { j++; }
                const exitNode  = path[Math.min(j, path.length - 1)];
                const exitFloor = path[Math.min(j, path.length - 1) - 1]?.floor ?? exitNode.floor;
                const goingUp   = exitFloor > originFloor;
                const tag       = isLift ? '[LIFT]' : '[STAIRS]';

                if (isLift) {
                    directions.push(`${tag} Enter the lift and go ${goingUp ? 'up' : 'down'} to the ${FLOOR_NAMES[exitFloor]}.`);
                } else if (isCurved) {
                    directions.push(`${tag} Take the curved staircase ${goingUp ? 'up' : 'down'} to the ${FLOOR_NAMES[exitFloor]}.`);
                } else {
                    directions.push(`${tag} Take the main stairs ${goingUp ? 'up' : 'down'} to the ${FLOOR_NAMES[exitFloor]}.`);
                }
                prevHeading = null; // reset heading after floor change
                i = j;
                continue;
            }
        }

        // ── Corridor segment ──────────────────────────────────────────────────
        if (isWaypoint(curr.id)) {
            // Collect all consecutive waypoints on this floor
            let j = i;
            let totalDist = 0;
            const corridorNodes = [prev];

            while (j < path.length && isWaypoint(path[j].id) && path[j].floor === prev.floor) {
                totalDist += distM(path[j - 1], path[j]);
                corridorNodes.push(path[j]);
                j++;
            }

            const distStr = totalDist > 1 ? `about ${Math.round(totalDist)}m` : 'a short distance';
            const isPassageway = curr.id.includes('PASSAGEWAY');

            // What heading are we walking?
            const corridorHeading = heading(prev, path[Math.min(j - 1, path.length - 1)]);
            const cardDir = cardinal(corridorHeading);

            // Turn detection from previous segment
            let turnText = '';
            if (prevHeading !== null) {
                const turn = turnDir(prevHeading, corridorHeading);
                if (turn === 'left')     turnText = 'Turn left. ';
                else if (turn === 'right') turnText = 'Turn right. ';
            }

            // Find rooms alongside this corridor stretch for landmark context
            const nearbyRooms = roomsAlongCorridor(corridorNodes, pathIds);

            // What's at the end of this corridor stretch?
            const nodeAtEnd = j < path.length ? path[j] : null;
            const endLabel  = nodeAtEnd && !isWaypoint(nodeAtEnd.id) && !isTransition(nodeAtEnd.id)
                ? nodeLabel(nodeAtEnd.id) : null;

            let instruction = '';

            if (isPassageway) {
                instruction = `${turnText}Take the passageway (${distStr}).`;
            } else if (nearbyRooms.length > 0) {
                // Pick 1 landmark to reference — closest one to midpoint of corridor
                const midIdx = Math.floor(corridorNodes.length / 2);
                const mid = corridorNodes[midIdx] || prev;
                const ref = nearbyRooms.reduce((best, r) => {
                    const d = Math.hypot(r.coords[0] - mid.x, r.coords[1] - mid.y);
                    return d < best.d ? { ...r, d } : best;
                }, { ...nearbyRooms[0], d: 999 });

                const side = landmarkSide(mid, ref, corridorHeading);

                if (endLabel) {
                    instruction = `${turnText}Walk ${distStr} heading ${cardDir}, passing ${ref.label} on your ${side}, until you reach ${endLabel}.`;
                } else {
                    instruction = `${turnText}Walk ${distStr} heading ${cardDir}, with ${ref.label} on your ${side}.`;
                }
            } else if (endLabel) {
                instruction = `${turnText}Walk ${distStr} heading ${cardDir} towards ${endLabel}.`;
            } else {
                instruction = `${turnText}Walk ${distStr} heading ${cardDir} along the corridor.`;
            }

            directions.push(`[WALK] ${instruction}`);
            prevHeading = corridorHeading;
            // If we just told the user "until you reach X", the very next node
            // is X — skip the [GO] step for it to avoid a duplicate instruction.
            if (endLabel && nodeAtEnd && !isWaypoint(nodeAtEnd.id) && !isTransition(nodeAtEnd.id)) {
                i = j + 1; // skip past the destination node
            } else {
                i = j;
            }
            continue;
        }

        // ── Direct room-to-room step ──────────────────────────────────────────
        if (!isTransition(curr.id)) {
            const h    = heading(prev, curr);
            const dist = distM(prev, curr);
            const turn = prevHeading !== null ? turnDir(prevHeading, h) : null;

            // Find a landmark near curr for "look for X on your left/right"
            const lm = nearbyLandmark(curr, pathIds);
            let landmarkHint = '';
            if (lm) {
                const side = landmarkSide(curr, { coords: window.allNodes[lm.id].coords }, h);
                landmarkHint = ` You'll see ${lm.label} on your ${side}.`;
            }

            let instruction = '';
            if (turn === 'left') {
                instruction = `Turn left and walk ${Math.round(dist)}m to ${nodeLabel(curr.id)}.${landmarkHint}`;
            } else if (turn === 'right') {
                instruction = `Turn right and walk ${Math.round(dist)}m to ${nodeLabel(curr.id)}.${landmarkHint}`;
            } else {
                instruction = `Continue straight for ${Math.round(dist)}m to ${nodeLabel(curr.id)}.${landmarkHint}`;
            }

            directions.push(`[GO] ${instruction}`);
            prevHeading = h;
            i++;
            continue;
        }

        i++;
    }

    directions.push(`[ARRIVED] You have arrived at ${nodeLabel(path[path.length - 1].id)}.`);

    // ── Render into DOM ───────────────────────────────────────────────────────
    const list = document.getElementById('directions-list');
    if (list) {
        list.innerHTML = '';
        const hasMultipleLegs = path.some(p => (p.segment ?? 0) > 0);
        let lastSeg = -1;

        directions.forEach(text => {
            if (hasMultipleLegs) {
                const stepSeg = (() => {
                    for (const node of path) {
                        const label = window.allNodes[node.id]?.label || '';
                        if (label && text.includes(label)) return node.segment ?? 0;
                    }
                    return lastSeg;
                })();
                if (stepSeg !== lastSeg && stepSeg >= 0) {
                    lastSeg = stepSeg;
                    const legNum   = stepSeg + 1;
                    const legStart = window.allNodes[path.find(p => (p.segment ?? 0) === stepSeg)?.id]?.label || '';
                    const legEnd   = window.allNodes[[...path].reverse().find(p => (p.segment ?? 0) === stepSeg)?.id]?.label || '';
                    const header   = document.createElement('li');
                    header.textContent = `— LEG ${legNum}: ${legStart} → ${legEnd} —`;
                    header.style.cssText =
                        'list-style:none;font-weight:700;font-size:11px;color:var(--steel);' +
                        'letter-spacing:0.5px;padding:8px 0 4px;' +
                        'border-top:1px solid rgba(109,129,150,0.2);margin-top:4px;';
                    list.appendChild(header);
                }
            }
            const li = document.createElement('li');
            li.textContent = text;
            list.appendChild(li);
        });

        // CP badges
        if (checkpoints && checkpoints.length > 0) {
            let cpIdx = 0;
            Array.from(list.querySelectorAll('li')).forEach(li => {
                if (cpIdx >= checkpoints.length) return;
                const cp       = checkpoints[cpIdx];
                const label    = window.allNodes[cp.id]?.label || cp.id;
                const isLift   = nodeType(cp.id) === 'lift'   || cp.id.includes('LIFT');
                const isStairs = nodeType(cp.id) === 'stairs' || cp.id.includes('STAIRS');
                const matchLift   = isLift   && li.textContent.includes('[LIFT]');
                const matchStairs = isStairs && li.textContent.includes('[STAIRS]');
                const matchLabel  = !isLift && !isStairs && label && li.textContent.includes(label);
                if (matchLift || matchStairs || matchLabel) {
                    li.setAttribute('data-checkpoint', cpIdx);
                    const badge = document.createElement('span');
                    badge.textContent = ` CP${cpIdx + 1}`;
                    badge.style.cssText =
                        'color:#8b5cf6;font-weight:700;font-size:10px;margin-left:6px;' +
                        'letter-spacing:0.5px;background:rgba(139,92,246,0.1);' +
                        'border-radius:4px;padding:1px 4px;';
                    li.appendChild(badge);
                    cpIdx++;
                }
            });
        }

        const dp = document.getElementById('directions-panel');
        if (dp) { dp.style.display = 'block'; dp.open = true; }
    }
    return directions;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------
function calculateMetrics(path) {
    if (!path || path.length === 0) return;
    let distance = 0, floorChanges = 0;

    for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i];
        if (a.floor === b.floor) distance += Math.hypot(b.x - a.x, b.y - a.y);
        else floorChanges++;
    }

    const totalMeters = distance * COORD_TO_METERS;
    const seconds     = totalMeters / WALK_SPEED;
    const mins        = Math.floor(seconds / 60);
    const secs        = Math.round(seconds % 60);

    document.getElementById('m-distance').textContent = totalMeters.toFixed(1);
    document.getElementById('m-time').textContent     = `${mins} min ${secs} sec`;
    document.getElementById('m-floors').textContent   = floorChanges;
    document.getElementById('metrics-bar').style.display = 'flex';
    const rip = document.getElementById('route-info-panel');
    if (rip) rip.style.display = 'block';

    fetch(`/stats?route=${path[0].id}+${path[path.length - 1].id}`)
        .then(r => r.json())
        .then(data => {
            const el = document.getElementById('m-rating');
            if (el) el.textContent = data.avg_rating ? data.avg_rating.toFixed(2) : '--';
            // Refresh mobile metric cards now that rating is available
            if (isMobile()) {
                const floorEl = document.getElementById('m-floors');
                const cards   = document.getElementById('mobile-metrics-cards');
                if (cards) {
                    cards.innerHTML =
                        `<div class="nav-metric-card">
                            <div class="nav-metric-icon">
                                <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5">
                                    <rect x="2" y="1" width="14" height="16" rx="2"/>
                                    <line x1="2" y1="6.5" x2="16" y2="6.5"/>
                                    <line x1="2" y1="11.5" x2="16" y2="11.5"/>
                                    <line x1="7" y1="1" x2="7" y2="17"/>
                                </svg>
                            </div>
                            <div>
                                <div class="nav-metric-label">Floor Changes</div>
                                <div class="nav-metric-value">${floorEl?.textContent || '--'}</div>
                            </div>
                         </div>
                         <div class="nav-metric-card">
                            <div class="nav-metric-icon">
                                <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3">
                                    <polygon points="9,2 11,7 16,7 12,10.5 13.5,16 9,12.5 4.5,16 6,10.5 2,7 7,7"/>
                                </svg>
                            </div>
                            <div>
                                <div class="nav-metric-label">Route Rating</div>
                                <div class="nav-metric-value">${data.avg_rating ? data.avg_rating.toFixed(2) : '--'}</div>
                            </div>
                         </div>`;
                }
            }
        })
        .catch(() => {
            const el = document.getElementById('m-rating');
            if (el) el.textContent = '--';
        });
}

// ---------------------------------------------------------------------------
// Mobile active navigation screen
// ---------------------------------------------------------------------------

function stepIcon(text) {
    if (text.startsWith('[START]'))   return 'start';
    if (text.startsWith('[ARRIVED]')) return 'arrived';
    if (text.startsWith('[LIFT]'))    return 'lift';
    if (text.startsWith('[STAIRS]'))  return 'stairs';
    if (text.startsWith('[WALK]'))    return 'walk';
    if (text.startsWith('[GO]'))      return 'go';
    return 'go';
}

// SVG icons for each step type (inline, no external dependency)
function stepIconSVG(type) {
    const icons = {
        start:   `<svg viewBox="0 0 18 18" fill="none"><path d="M9 15V5M5 9l4-4 4 4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="3" y1="16" x2="15" y2="16" stroke-width="2" stroke-linecap="round"/></svg>`,
        arrived: `<svg viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke-width="1.5"/><path d="M5.5 9l2.5 3 4.5-5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
        lift:    `<svg viewBox="0 0 18 18" fill="none"><rect x="3" y="2" width="12" height="14" rx="2" stroke-width="1.5"/><path d="M9 6v6M6.5 8.5L9 6l2.5 2.5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
        stairs:  `<svg viewBox="0 0 18 18" fill="none"><path d="M3 15h4v-3h4V9h4V3" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
        walk:    `<svg viewBox="0 0 18 18" fill="none"><path d="M12 9H4M4 9l3-3M4 9l3 3" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
        go:      `<svg viewBox="0 0 18 18" fill="none"><path d="M6 9h8M14 9l-3-3M14 9l-3 3" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    };
    return icons[type] || icons.go;
}

// Human-readable step title from tag + instruction text
function stepTitle(text) {
    if (text.startsWith('[START]'))   return 'Start';
    if (text.startsWith('[ARRIVED]')) return 'Arrived';
    if (text.startsWith('[LIFT]'))    return text.includes('up') ? 'Take lift up' : 'Take lift down';
    if (text.startsWith('[STAIRS]'))  return text.includes('up') ? 'Take stairs up' : 'Take stairs down';
    if (text.startsWith('[WALK]')) {
        const body = text.replace('[WALK] ', '');
        if (body.startsWith('Turn left'))  return 'Turn left';
        if (body.startsWith('Turn right')) return 'Turn right';
        return 'Walk';
    }
    if (text.startsWith('[GO]')) {
        const body = text.replace('[GO] ', '');
        if (body.startsWith('Turn left'))  return 'Turn left';
        if (body.startsWith('Turn right')) return 'Turn right';
        return 'Continue straight';
    }
    return text;
}

function populateMobileStrip(logicalPath) {
    if (!logicalPath || logicalPath.length === 0) return;

    // ── Destination pill ──
    const globalEnd = logicalPath[logicalPath.length - 1];
    const destLabel = window.allNodes[globalEnd.id]?.label || globalEnd.id;
    const pill = document.getElementById('nav-dest-pill');
    if (pill) pill.textContent = destLabel;

    // ── Stat row: Distance + Time ──
    const distEl  = document.getElementById('m-distance');
    const timeEl  = document.getElementById('m-time');
    const statRow = document.getElementById('mobile-metrics-row');
    if (statRow) {
        statRow.innerHTML =
            `<div class="nav-stat-block">
                <div class="nav-stat-label">Distance</div>
                <div class="nav-stat-value">${distEl?.textContent || '--'}m</div>
             </div>
             <div class="nav-stat-block">
                <div class="nav-stat-label">Estimated Time</div>
                <div class="nav-stat-value">${timeEl?.textContent || '--'}</div>
             </div>`;
    }

    // ── Metric cards: Floor changes + Route rating ──
    const floorEl  = document.getElementById('m-floors');
    const ratingEl = document.getElementById('m-rating');
    const cards    = document.getElementById('mobile-metrics-cards');
    if (cards) {
        cards.innerHTML =
            `<div class="nav-metric-card">
                <div class="nav-metric-icon">
                    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="2" y="1" width="14" height="16" rx="2"/>
                        <line x1="2" y1="6.5" x2="16" y2="6.5"/>
                        <line x1="2" y1="11.5" x2="16" y2="11.5"/>
                        <line x1="7" y1="1" x2="7" y2="17"/>
                    </svg>
                </div>
                <div>
                    <div class="nav-metric-label">Floor Changes</div>
                    <div class="nav-metric-value">${floorEl?.textContent || '--'}</div>
                </div>
             </div>
             <div class="nav-metric-card">
                <div class="nav-metric-icon">
                    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3">
                        <polygon points="9,2 11,7 16,7 12,10.5 13.5,16 9,12.5 4.5,16 6,10.5 2,7 7,7"/>
                    </svg>
                </div>
                <div>
                    <div class="nav-metric-label">Route Rating</div>
                    <div class="nav-metric-value">${ratingEl?.textContent || '--'}</div>
                </div>
             </div>`;
    }

    // ── Timeline directions list ──
    const srcList    = document.getElementById('directions-list');
    const mobileList = document.getElementById('mobile-directions-list');
    if (srcList && mobileList) {
        mobileList.innerHTML = '';
        let stepNum = 1;
        const srcItems = Array.from(srcList.querySelectorAll('li'))
            .filter(li => !li.style.color.includes('99, 102, 241')); // skip leg headers

        srcItems.forEach((srcLi, idx) => {
            const rawText = srcLi.childNodes[0]?.textContent?.trim() || srcLi.textContent.trim();
            const type    = stepIcon(rawText);
            const isLast  = idx === srcItems.length - 1;
            const title   = stepTitle(rawText);
            // Sub-text: everything after the [TAG] prefix
            const sub     = rawText.replace(/^\[[\w]+\]\s*/, '');

            const li = document.createElement('li');
            const cp = srcLi.getAttribute('data-checkpoint');
            if (cp !== null) li.setAttribute('data-checkpoint', cp);
            if (srcLi.classList.contains('directions-active')) li.classList.add('directions-active');

            // Left column
            const left = document.createElement('div');
            left.className = 'nav-step-left';

            const iconWrap = document.createElement('div');
            iconWrap.className = `nav-step-icon${type === 'start' ? ' start' : ''}`;
            iconWrap.innerHTML = stepIconSVG(type);
            left.appendChild(iconWrap);

            if (!isLast) {
                const line = document.createElement('div');
                line.className = 'nav-step-line';
                left.appendChild(line);
            }

            // Right column
            const content = document.createElement('div');
            content.className = 'nav-step-content';

            const titleEl = document.createElement('div');
            titleEl.className = 'nav-step-title';
            titleEl.textContent = `${title}`;
            content.appendChild(titleEl);

            if (sub && sub !== title && sub.length > 1) {
                const subEl = document.createElement('div');
                subEl.className = 'nav-step-sub';
                subEl.textContent = sub;
                content.appendChild(subEl);
            }

            // CP badge if present
            const badge = srcLi.querySelector('span[style]');
            if (badge) {
                const b = badge.cloneNode(true);
                b.style.cssText = 'font-size:10px;font-weight:700;color:#8b5cf6;margin-left:6px;';
                titleEl.appendChild(b);
            }

            li.appendChild(left);
            li.appendChild(content);
            mobileList.appendChild(li);
            stepNum++;
        });
    }

    syncMobileCheckpointBtn();
    syncNavSVGs();
    updateMobileCurrentStep(0);
}

function syncNavSVGs() {
    for (let f = 1; f <= 4; f++) {
        const src  = document.getElementById(`svg-f${f}`);
        const dest = document.getElementById(`svg-nav-f${f}`);
        if (src && dest) dest.innerHTML = src.innerHTML;
    }
    // Fit nav SVGs to their letterboxed images after content is copied
    // Use rAF to ensure the nav screen is visible and has layout dimensions
    requestAnimationFrame(() => fitNavSVGToImage());
}

function syncNavFloor(floorNum) {
    document.querySelectorAll('.nav-tab').forEach(tab =>
        tab.classList.toggle('active', tab.dataset.floor == floorNum));
    for (let i = 1; i <= 4; i++) {
        const el = document.getElementById(`nav-f${i}`);
        if (el) el.style.display = (i == floorNum) ? 'block' : 'none';
    }
    requestAnimationFrame(() => fitNavSVGToImage());
}

function syncMobileCheckpointBtn() {
    const btn = document.getElementById('mobile-checkpoint-btn');
    if (!btn) return;
    // Don't show the button until checkpoints are actually populated
    if (!checkpoints || checkpoints.length === 0) {
        btn.style.display = 'none';
        return;
    }
    const isLast = currentCheckpointIdx >= checkpoints.length - 1;
    btn.innerHTML = isLast
        ? `<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M5 11l5 5 7-8" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
        : `<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M11 18V5M6 10l5-5 5 5" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    btn.className = isLast ? 'nav-fab-btn finish-btn' : 'nav-fab-btn';
    btn.style.display = 'flex';
}

function updateMobileCurrentStep(checkpointIdx) {
    const list = document.getElementById('mobile-directions-list');
    if (!list) return;
    const items = Array.from(list.querySelectorAll('li'));
    if (items.length === 0) return;

    const activeItem =
        items.find(li => li.getAttribute('data-checkpoint') == checkpointIdx) ||
        items.find(li => {
            const t = li.textContent;
            return t.includes('Continue') || t.includes('proceed') || t.includes('Head');
        }) ||
        items[Math.min(1, items.length - 1)];

    if (activeItem) {
        items.forEach(li => li.classList.remove('directions-active'));
        activeItem.classList.add('directions-active');
        activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    syncMobileCheckpointBtn();
}

// ---------------------------------------------------------------------------
// Feedback modal
// ---------------------------------------------------------------------------
function showFeedbackModal() {
    const modal = document.getElementById('feedback-modal');
    if (modal) modal.style.display = 'flex';
}

function closeFeedback() {
    const modal = document.getElementById('feedback-modal');
    if (modal) modal.style.display = 'none';
    // Reset star rating for next time
    document.querySelectorAll('#star-rating span').forEach(s => s.classList.remove('selected'));
    const comment = document.getElementById('feedback-comment');
    if (comment) comment.value = '';
    // Return to form so user can start a new route
    resetToForm();
    if (isMobile()) openRouteForm();
}

function submitFeedback() {
    const allSelected = [...document.querySelectorAll('#star-rating span.selected')];
    const selected    = allSelected.length > 0 ? allSelected[allSelected.length - 1] : null;
    const rating      = selected ? +selected.dataset.val : null;
    if (!rating) { toast('Please select a star rating before submitting.'); return; }
    if (!pathData || pathData.length === 0) { closeFeedback(); return; }

    const comment = document.getElementById('feedback-comment').value || '';
    fetch('/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({
            start:   pathData[0]?.id || '',
            end:     pathData[pathData.length - 1]?.id || '',
            path:    pathData.map(p => p.id),
            rating,
            comment
        })
    })
    .then(() => { closeFeedback(); toast('Thanks for your feedback!'); })
    .catch(() => { closeFeedback(); toast('Could not send feedback right now.'); });
}

function toast(msg) {
    const el = document.createElement('div');
    el.className   = 'toast-msg';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

// ---------------------------------------------------------------------------
// FAQ Chatbot
// ---------------------------------------------------------------------------
let faqData = [];

async function loadFAQs() {
    try { faqData = await (await fetch('/faq')).json(); }
    catch (e) { faqData = []; }
}

function faqMatch(input) {
    const lower = input.toLowerCase().trim();
    for (const faq of faqData)
        for (const keyword of faq.keywords)
            if (lower.includes(keyword.toLowerCase())) return faq.answer;
    return null;
}

function toggleFAQChat() {
    const chat   = document.getElementById('faq-chat');
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
        appendFAQMessage(
            faqMatch(text) || "I'm not sure about that. Try using the navigation form to find your destination, or rephrase your question.",
            'bot'
        );
    }, 280);
}

function appendFAQMessage(text, sender) {
    const messages = document.getElementById('faq-messages');
    if (!messages) return;
    const div = document.createElement('div');
    div.className   = `faq-msg faq-msg-${sender}`;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
}

// ---------------------------------------------------------------------------
// PDR — Pedestrian Dead Reckoning (stub for future implementation)
// ---------------------------------------------------------------------------
class PDRNavigator {
    constructor(floorGraph, onPositionUpdate) {
        this.graph    = floorGraph;
        this.onUpdate = onPositionUpdate;
        this.position = null;
        this.heading  = 0;
        this.stepCount = 0;
        this.lastCheckpointNode = null;
    }
    start()  { /* Request DeviceMotion + DeviceOrientation permissions (iOS 13+) */ }
    stop()   { /* Remove event listeners */ }
    onStep(heading, strideLength) { /* Update estimated position */ }
    snapToNode(threshold = 5) { /* Find nearest node within threshold % units */ }
    snapToCheckpoint(node) {
        this.position = { x: node.x, y: node.y, floor: node.floor };
        this.stepCount = 0;
        this.lastCheckpointNode = node.id;
        if (this.onUpdate) this.onUpdate(this.position);
    }
}