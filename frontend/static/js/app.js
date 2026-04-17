/**
 * app.js — Main UI module. Owned by: Person C (Frontend/UI)
 * Imports routing logic from routing.js and graph data from graph-data.js.
 */
import { NODES, GRAPH } from './graph-data.js';
import { planRoute, planAlternate, buildDirections } from './routing.js';
import { PDREngine } from './pdr.js';
import { startSession, recordCheckpoint } from './metrics.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const FLOOR_NAMES = { 1: 'Ground Floor', 2: 'First Floor', 3: 'Second Floor', 4: 'Third Floor' };
const FLOOR_ORDER = ['Ground Floor', 'First Floor', 'Second Floor', 'Third Floor'];
const TYPE_ORDER = ['Entrance', 'Offices', 'Rooms', 'Labs & Rooms', 'Restrooms', 'Lift & Stairs'];
const COORD_TO_METERS = 0.5;
const WALK_SPEED = 1.2;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let pathData = [];
let altPathData = [];
let checkpoints = [];
let currentCheckpointIdx = 0;
let navStartTime = null;
let feedbackTimer = null;
let routeFormOpen = true;
let _floorConfirmCallback = null;
let currentStartFloor = 'Ground Floor';
let tsStart, tsEnd, tsStopInstances = [];
let currentSessionId = null;

const isMobile = () => window.innerWidth <= 768;
const nodeType = (id) => NODES[id]?.type || null;

// ---------------------------------------------------------------------------
// Build allOpts from NODES (replaces Jinja2 loop)
// ---------------------------------------------------------------------------
function buildAllOpts() {
  const opts = [];
  for (const [id, data] of Object.entries(NODES)) {
    if (data.is_waypoint) continue;
    const floorLabel = FLOOR_NAMES[data.floor];
    opts.push({
      id,
      label: `${data.label} (${floorLabel})`,
      floor: data.floor,
      floor_label: floorLabel,
      category: data.category || 'Other',
    });
  }
  opts.sort((a, b) => a.floor - b.floor || a.label.localeCompare(b.label));
  return opts;
}

// ---------------------------------------------------------------------------
// TomSelect dropdown helpers (ported from inline script in index.html)
// ---------------------------------------------------------------------------
function buildHTML(groupBy, filterFloor) {
  const allOpts = buildAllOpts();
  const order = groupBy === 'floor' ? FLOOR_ORDER : TYPE_ORDER;
  const groups = {};
  allOpts.forEach(opt => {
    if (filterFloor && opt.floor_label !== filterFloor) return;
    const key = groupBy === 'floor' ? opt.floor_label : opt.category;
    (groups[key] = groups[key] || []).push(opt);
  });
  let html = '<option value="">Select location...</option>';
  if (filterFloor) {
    (groups[filterFloor] || [])
      .sort((a, b) => a.label.localeCompare(b.label))
      .forEach(opt => { html += `<option value="${opt.id}">${opt.label}</option>`; });
  } else {
    order.forEach(grp => {
      if (!groups[grp]) return;
      html += `<optgroup label="${grp}">`;
      groups[grp].sort((a, b) => a.label.localeCompare(b.label))
        .forEach(opt => { html += `<option value="${opt.id}">${opt.label}</option>`; });
      html += '</optgroup>';
    });
  }
  return html;
}

function fixOptgroupOrder(ts, groupBy) {
  const order = groupBy === 'floor' ? FLOOR_ORDER : TYPE_ORDER;
  const dropdown = ts.dropdown_content;
  if (!dropdown) return;
  const ogEls = Array.from(dropdown.querySelectorAll('[data-group]'));
  if (!ogEls.length) return;
  ogEls.sort((a, b) => {
    const ai = order.indexOf(a.getAttribute('data-group'));
    const bi = order.indexOf(b.getAttribute('data-group'));
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
  ogEls.forEach(el => dropdown.appendChild(el));
}

function makeTomSelect(el, groupBy, preselected, filterFloor) {
  if (typeof el === 'string') el = document.querySelector(el);
  if (!el) return null;
  el.innerHTML = buildHTML(groupBy, filterFloor || null);
  const ts = new TomSelect(el, {
    create: false, sortField: false, dropdownParent: 'body',
    onInitialize() { if (!filterFloor) fixOptgroupOrder(this, groupBy); },
    onDropdownOpen() { if (!filterFloor) fixOptgroupOrder(this, groupBy); },
  });
  if (preselected) ts.setValue(preselected, true);
  return ts;
}

window.selectStartFloor = function (btn) {
  document.querySelectorAll('.floor-pick-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentStartFloor = btn.getAttribute('data-floor-label');
  if (tsStart) tsStart.destroy();
  tsStart = makeTomSelect('#start_node', 'floor', '', currentStartFloor);
};

function regroupDropdowns(groupBy) {
  const selStart = tsStart ? tsStart.getValue() : '';
  const selEnd = tsEnd ? tsEnd.getValue() : '';
  if (tsStart) tsStart.destroy();
  if (tsEnd) tsEnd.destroy();
  tsStart = makeTomSelect('#start_node', groupBy, selStart, currentStartFloor);
  tsEnd = makeTomSelect('#end_node', groupBy, selEnd);
  // Expose tsEnd for script.js Pin-to-Navigate bridge
  if (typeof window._registerTsEnd === 'function') window._registerTsEnd(tsEnd);
  const prevStops = tsStopInstances.map(ts => ts.getValue());
  tsStopInstances.forEach(ts => ts.destroy());
  tsStopInstances = [];
  document.querySelectorAll('.stop-select').forEach((sel, i) => {
    const ts = makeTomSelect(sel, groupBy, prevStops[i] || '');
    if (ts) tsStopInstances.push(ts);
  });
}

window.addStopField = function () {
  const container = document.getElementById('stops-container');
  const template = document.getElementById('stop-template');
  const clone = template.content.cloneNode(true);
  container.appendChild(clone);
  const newSel = container.lastElementChild.querySelector('.stop-select');
  const ts = makeTomSelect(newSel, 'floor', '');
  if (ts) tsStopInstances.push(ts);
};

// ---------------------------------------------------------------------------
// Error display
// ---------------------------------------------------------------------------
function showError(msg) {
  let el = document.getElementById('js-error-message');
  if (!el) {
    el = document.createElement('div');
    el.id = 'js-error-message';
    el.className = 'error-message';
    document.getElementById('nav-form').after(el);
  }
  el.textContent = `[ERROR] ${msg}`;
  el.style.display = 'block';
}
function hideError() {
  const el = document.getElementById('js-error-message');
  if (el) el.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Form submit — client-side routing
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // Dark mode
  const saved = localStorage.getItem('wayfinder-theme');
  if (saved === 'dark') applyDarkMode(true);

  // Star ratings
  document.querySelectorAll('#star-rating span').forEach(star => {
    star.addEventListener('click', () => {
      const val = +star.dataset.val;
      document.querySelectorAll('#star-rating span')
        .forEach(s => s.classList.toggle('selected', +s.dataset.val <= val));
    });
  });

  regroupDropdowns('floor');
  window.addEventListener('resize', () => { fitSVGToImage(); fitNavSVGToImage(); });
  loadFAQs();
  fitSVGToImage();

  document.querySelectorAll('.map-image').forEach(img => {
    if (!img.complete) img.addEventListener('load', fitSVGToImage, { once: true });
  });
  document.querySelectorAll('.nav-floor-png').forEach(img => {
    if (!img.complete) img.addEventListener('load', () => fitNavSVGToImage(), { once: true });
  });

  // ── Form submit: runs A* entirely in browser ────────────────────────────
  document.getElementById('nav-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (feedbackTimer) { clearTimeout(feedbackTimer); feedbackTimer = null; }
    checkpoints = []; currentCheckpointIdx = 0; navStartTime = null;
    hideCheckpointButton();

    const startNode = tsStart ? tsStart.getValue() : '';
    const endNode = tsEnd ? tsEnd.getValue() : '';
    const stops = tsStopInstances.map(ts => ts.getValue()).filter(Boolean);
    const mobilityEl = document.querySelector('input[name="mobility"]:checked');
    const mobility = mobilityEl ? mobilityEl.value : 'none';
    const avoidStairs = mobility === 'elevator_only';
    const avoidElevators = mobility === 'stairs_only';

    if (!startNode || !endNode) { showError('Please select both a start and destination.'); return; }
    if (startNode === endNode) { showError('Start and destination cannot be the same.'); return; }

    let learnedWeights = {};
    try {
      const statsRes = await fetch('/stats');
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        learnedWeights = statsData.edge_weights || {};
      }
    } catch (err) {
      console.warn('Failed to fetch learned edge weights:', err);
    }

    const path = planRoute({ startNode, endNode, stops, avoidStairs, avoidElevators, nodes: NODES, graph: GRAPH, learnedWeights });

    if (!path.length) {
      showError('Route not found. The locations may not be connected under your current mobility settings.');
      return;
    }

    hideError();
    currentSessionId = crypto.randomUUID();
    const sessionId = currentSessionId;

    // Store stop labels for checkpoint logic (mirrors old window.stopLabels)
    window.stopLabels = stops.map(id => ({ id, label: NODES[id]?.label || id }));
    window.allNodes = NODES;
    window.nodeDegrees = Object.fromEntries(Object.entries(GRAPH).map(([k, v]) => [k, v.length]));

    const ortho = makeOrthogonalPath(path);
    drawPath(ortho, path);
    switchFloor(path[0].floor);

    if (isMobile()) {
      closeRouteForm();
      const topBar = document.getElementById('mobile-top-bar');
      if (topBar) topBar.style.display = 'flex';
    }
    const summaryClear = document.getElementById('route-summary');
    if (summaryClear) summaryClear.style.display = 'none';

    // Background analytics POST — fire-and-forget
    startSession({ sessionId, startNode, endNode, mobility, path });
  });
});

// ---------------------------------------------------------------------------
// Dark mode
// ---------------------------------------------------------------------------
function applyDarkMode(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const moonIcon = document.getElementById('dark-icon');
  const sunIcon = document.getElementById('light-icon');
  if (moonIcon) moonIcon.style.display = dark ? 'none' : 'block';
  if (sunIcon) sunIcon.style.display = dark ? 'block' : 'none';
}
window.toggleDarkMode = function () {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  applyDarkMode(!isDark);
  localStorage.setItem('wayfinder-theme', isDark ? 'light' : 'dark');
};

// ---------------------------------------------------------------------------
// SVG fit
// ---------------------------------------------------------------------------
function fitSVGToImage() {
  for (let f = 1; f <= 4; f++) {
    const container = document.getElementById(`f${f}-container`);
    if (!container) continue;
    const img = container.querySelector('.map-image');
    const svg = container.querySelector('.map-overlay');
    if (!img || !svg) continue;
    const cw = container.clientWidth, ch = container.clientHeight;
    const iw = img.naturalWidth || cw, ih = img.naturalHeight || ch;
    const scale = Math.min(cw / iw, ch / ih);
    const rw = iw * scale, rh = ih * scale;
    svg.style.left = (cw - rw) / 2 + 'px'; svg.style.top = (ch - rh) / 2 + 'px';
    svg.style.width = rw + 'px'; svg.style.height = rh + 'px';
  }
}
window.fitSVGToImage = fitSVGToImage;

function fitNavSVGToImage() {
  for (let f = 1; f <= 4; f++) {
    const container = document.getElementById(`nav-f${f}`);
    if (!container) continue;
    const img = container.querySelector('.nav-floor-png');
    const svg = container.querySelector('.nav-floor-svg');
    if (!img || !svg) continue;
    const cw = container.clientWidth, ch = container.clientHeight;
    if (!cw || !ch) continue;
    const iw = img.naturalWidth || cw, ih = img.naturalHeight || ch;
    const scale = Math.min(cw / iw, ch / ih);
    const rw = iw * scale, rh = ih * scale;
    svg.style.left = (cw - rw) / 2 + 'px'; svg.style.top = (ch - rh) / 2 + 'px';
    svg.style.width = rw + 'px'; svg.style.height = rh + 'px';
  }
}
window.fitNavSVGToImage = fitNavSVGToImage;

// ---------------------------------------------------------------------------
// Floor tabs
// ---------------------------------------------------------------------------
window.switchFloor = function switchFloor(floorNum) {
  document.querySelectorAll('.floor-tab').forEach(tab =>
    tab.classList.toggle('active', tab.dataset.floor == floorNum));
  for (let i = 1; i <= 4; i++) {
    const c = document.getElementById(`f${i}-container`);
    if (c) c.style.display = (i == floorNum) ? 'block' : 'none';
  }
  fitSVGToImage();
  syncNavFloor(floorNum);
};

function makeOrthogonalPath(path) { return Array.isArray(path) ? [...path] : []; }

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------
function computeCheckpoints(logicalPath) {
  if (!logicalPath || logicalPath.length === 0) return [];
  const result = [], addedIds = new Set();
  const stopIds = (window.stopLabels || []).map(s => s.id);

  function addCheckpoint(node) {
    if (!node) return;
    if (NODES[node.id]?.is_waypoint) return;
    const isVertical = nodeType(node.id) === 'lift' || nodeType(node.id) === 'stairs';
    const key = isVertical ? `${node.id}::${node.segment ?? 0}` : node.id;
    if (addedIds.has(key)) return;
    addedIds.add(key); result.push(node);
  }

  for (let i = 1; i < logicalPath.length - 1; i++) {
    const curr = logicalPath[i], next = logicalPath[i + 1];
    const currType = nodeType(curr.id);
    if (NODES[curr.id]?.is_waypoint) continue;
    if (next && curr.floor !== next.floor) {
      const isLift = currType === 'lift', isStairs = currType === 'stairs';
      if (isLift || isStairs) {
        let j = i;
        while (j + 1 < logicalPath.length &&
          nodeType(logicalPath[j + 1].id) === currType &&
          logicalPath[j + 1].floor !== logicalPath[j].floor) { j++; }
        addCheckpoint(curr); addCheckpoint(logicalPath[j]); i = j;
      }
      continue;
    }
    const isUserStop = stopIds.includes(curr.id);
    const isStopNode = currType !== 'lift' && currType !== 'stairs' &&
      curr.id !== logicalPath[0].id && curr.id !== logicalPath[logicalPath.length - 1].id;
    const degree = (window.nodeDegrees && window.nodeDegrees[curr.id]) || 0;
    if (isStopNode && (isUserStop || degree >= 3)) addCheckpoint(curr);
  }
  const last = logicalPath[logicalPath.length - 1];
  if (!addedIds.has(last.id)) result.push(last);
  return result;
}
window.computeCheckpoints = computeCheckpoints;

// ---------------------------------------------------------------------------
// Route active panel
// ---------------------------------------------------------------------------
function showRouteActivePanel() {
  const form = document.getElementById('nav-form');
  if (form) form.classList.add('form-hidden');
  const rip = document.getElementById('route-info-panel');
  if (rip) rip.style.display = 'block';
  setAltBtnsVisible(true);
}

function setAltBtnsVisible(visible) {
  const d = document.getElementById('alt-route-btn-desktop');
  if (d) d.style.display = visible ? 'inline-flex' : 'none';
  document.querySelectorAll('.alt-route-btn-mobile').forEach(m => {
    m.style.display = visible ? 'inline-flex' : 'none';
  });
}

window.resetToForm = function () {
  const form = document.getElementById('nav-form');
  if (form) form.classList.remove('form-hidden');
  const rip = document.getElementById('route-info-panel');
  if (rip) rip.style.display = 'none';
  for (let f = 1; f <= 4; f++) {
    const svg = document.getElementById(`svg-f${f}`);
    if (svg) svg.innerHTML = '';
  }
  altPathData = [];
  setAltBtnsVisible(false);
  const d = document.getElementById('alt-route-btn-desktop');
  if (d) d.classList.remove('active-alt');
  document.querySelectorAll('.alt-route-btn-mobile').forEach(m => {
    m.classList.remove('active-alt');
  });
  const legend = document.getElementById('map-legend');
  const summary = document.getElementById('route-summary');
  if (legend) legend.style.display = 'none';
  if (summary) summary.style.display = 'none';
  hideCheckpointButton();
  pathData = []; checkpoints = []; currentCheckpointIdx = 0;
  const topBar = document.getElementById('mobile-top-bar');
  if (topBar) topBar.style.display = 'none';
  const strip = document.getElementById('mobile-directions-strip');
  if (strip) strip.style.display = 'none';
  document.body.classList.remove('has-route');
  document.documentElement.style.overflow = '';
};

function showCheckpointButton() {
  const btn = document.getElementById('checkpoint-btn');
  if (!btn) return;
  const isLast = currentCheckpointIdx >= checkpoints.length - 1;
  btn.textContent = isLast ? 'Finish Navigation' : 'Reached Checkpoint';
  btn.className = isLast ? 'checkpoint-btn finish-btn' : 'checkpoint-btn';
  btn.style.display = 'flex';
}
function hideCheckpointButton() {
  const btn = document.getElementById('checkpoint-btn');
  if (btn) btn.style.display = 'none';
}

window.openRouteForm = function () {
  const sheet = document.getElementById('route-form-sheet');
  if (sheet) sheet.classList.remove('sheet-hidden');
  routeFormOpen = true;
  const topBar = document.getElementById('mobile-top-bar');
  if (topBar && isMobile()) topBar.style.display = 'none';
};
function closeRouteForm() {
  if (!isMobile()) return;
  const sheet = document.getElementById('route-form-sheet');
  if (sheet) sheet.classList.add('sheet-hidden');
  routeFormOpen = false;
  document.documentElement.style.overflow = 'hidden';
}

// ---------------------------------------------------------------------------
// Floor confirm modal
// ---------------------------------------------------------------------------
function showFloorConfirmModal(floorNum, method, onResponse) {
  const modal = document.getElementById('floor-confirm-modal');
  const icon = document.getElementById('floor-confirm-icon');
  const title = document.getElementById('floor-confirm-title');
  const body = document.getElementById('floor-confirm-body');
  if (!modal) { onResponse(true); return; }
  const floorName = FLOOR_NAMES[floorNum] || `Floor ${floorNum}`;
  icon.textContent = method === 'lift' ? 'LIFT' : 'STAIRS';
  icon.style.color = method === 'lift' ? '#6366f1' : '#f59e0b';
  title.textContent = method === 'lift'
    ? `Take the lift to the ${floorName}`
    : `Take the stairs to the ${floorName}`;
  body.textContent = method === 'lift'
    ? `Enter the lift and travel to the ${floorName}. Tap "Yes, I'm here" once the lift doors open.`
    : `Walk up/down the stairs to the ${floorName}. Tap "Yes, I'm here" once you arrive.`;
  _floorConfirmCallback = onResponse;
  modal.style.display = 'flex';
}
function hideFloorConfirmModal() {
  const modal = document.getElementById('floor-confirm-modal');
  if (modal) modal.style.display = 'none';
  _floorConfirmCallback = null;
}
window.onFloorConfirmed = function (confirmed) {
  const cb = _floorConfirmCallback;
  hideFloorConfirmModal();
  if (cb) cb(confirmed);
};

// ---------------------------------------------------------------------------
// Checkpoint reached
// ---------------------------------------------------------------------------
window.onCheckpointReached = function () {
  if (!checkpoints || checkpoints.length === 0) return;
  const isLast = currentCheckpointIdx >= checkpoints.length - 1;
  if (isLast) {
    hideCheckpointButton();
    for (let f = 1; f <= 4; f++) {
      const svg = document.getElementById(`svg-f${f}`);
      if (svg) svg.innerHTML = '';
    }
    const legend = document.getElementById('map-legend');
    const summary = document.getElementById('route-summary');
    if (legend) legend.style.display = 'none';
    if (summary) summary.style.display = 'none';
    const navScreen = document.getElementById('mobile-directions-strip');
    if (navScreen) navScreen.style.display = 'none';
    pathData = []; checkpoints = [];
    const elapsed = navStartTime ? Math.round((Date.now() - navStartTime) / 1000) : 0;
    const mins = Math.floor(elapsed / 60), secs = elapsed % 60;
    showSuccessOverlay(mins > 0 ? `${mins} min ${secs} sec` : `${secs} sec`);
    return;
  }
  const reachedCp = checkpoints[currentCheckpointIdx];
  const nextCp = checkpoints[currentCheckpointIdx + 1];
  const reachedType = nodeType(reachedCp.id);
  const isLiftNode = reachedType === 'lift' || reachedCp.id.includes('LIFT');
  const isStairNode = reachedType === 'stairs' || reachedCp.id.includes('STAIRS') || reachedCp.id.includes('CURVEDSTAIRS');
  const floorChanging = nextCp && reachedCp.floor !== nextCp.floor;

  function advanceCheckpoint() {
    currentCheckpointIdx++;
    const activeCp = checkpoints[currentCheckpointIdx];
    if (!activeCp) return;
    window.switchFloor(activeCp.floor);
    highlightRemainingPath(currentCheckpointIdx);
    showCheckpointButton();
    if (isMobile()) { updateMobileCurrentStep(currentCheckpointIdx); syncNavSVGs(); }
    recordCheckpoint({ sessionId: currentSessionId, checkpointIndex: currentCheckpointIdx, checkpointNodeId: activeCp.id });
  }

  const currentVisibleFloor = parseInt(document.querySelector('.floor-tab.active')?.dataset.floor || '1');

  if ((isLiftNode || isStairNode) && floorChanging) {
    if (nextCp.floor === currentVisibleFloor) {
      // User is already on the target floor. Skip modal and fast-forward.
      let targetIdx = currentCheckpointIdx + 1;
      while (targetIdx < checkpoints.length && checkpoints[targetIdx].floor !== currentVisibleFloor) {
        targetIdx++;
      }
      if (targetIdx < checkpoints.length) {
        // Set to one before the target so advanceCheckpoint() lands exactly on it
        currentCheckpointIdx = targetIdx - 1;
      }
      advanceCheckpoint();
    } else {
      hideCheckpointButton();
      showFloorConfirmModal(nextCp.floor, isLiftNode ? 'lift' : 'stairs', (confirmed) => {
        if (confirmed) { window.switchFloor(nextCp.floor); advanceCheckpoint(); }
        else { toast(`Head to the ${FLOOR_NAMES[nextCp.floor]} and tap the button when you arrive.`); showCheckpointButton(); }
      });
    }
  } else { advanceCheckpoint(); }
};

// ---------------------------------------------------------------------------
// highlightRemainingPath
// ---------------------------------------------------------------------------
function highlightRemainingPath(checkpointIdx) {
  if (!pathData || pathData.length === 0) return;
  if (!checkpoints[checkpointIdx]) return;
  const currentId = checkpoints[checkpointIdx].id;
  const orthoPath = makeOrthogonalPath(pathData);
  let searchFrom = 0;
  for (let k = 0; k < checkpointIdx; k++) {
    const found = orthoPath.findIndex((p, i) => i >= searchFrom && p.id === checkpoints[k].id);
    if (found !== -1) searchFrom = found + 1;
  }
  let splitIdx = orthoPath.findIndex((p, i) => i >= searchFrom && p.id === currentId);
  if (splitIdx === -1) { for (let k = orthoPath.length - 1; k >= 0; k--) { if (orthoPath[k].id === currentId) { splitIdx = k; break; } } }
  if (splitIdx === -1) splitIdx = 0;
  const traversed = orthoPath.slice(0, splitIdx + 1);
  const remaining = orthoPath.slice(splitIdx);
  const globalStart = pathData[0], globalEnd = pathData[pathData.length - 1];

  function toBuckets(nodes) {
    const buckets = []; let curFloor = null, curPts = [];
    nodes.forEach(p => {
      if (p.floor !== curFloor) {
        if (curPts.length >= 2) buckets.push({ floor: curFloor, pts: curPts });
        curPts = [p];
        curFloor = p.floor;
      } else { curPts.push(p); }
    });
    if (curPts.length >= 2) buckets.push({ floor: curFloor, pts: curPts });
    return buckets;
  }

  const travBuckets = toBuckets(traversed), remBuckets = toBuckets(remaining);
  for (let f = 1; f <= 4; f++) {
    const svg = document.getElementById(`svg-f${f}`);
    if (!svg) { continue; } svg.innerHTML = '';
    travBuckets.filter(b => b.floor === f).forEach(b => {
      const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      pl.setAttribute('points', b.pts.map(p => `${p.x},${p.y}`).join(' '));
      pl.setAttribute('class', 'path-line-traversed'); svg.appendChild(pl);
    });
    remBuckets.filter(b => b.floor === f).forEach(b => {
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      bg.setAttribute('points', b.pts.map(p => `${p.x},${p.y}`).join(' '));
      bg.setAttribute('class', 'path-line-bg'); svg.appendChild(bg);
      const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      pl.setAttribute('points', b.pts.map(p => `${p.x},${p.y}`).join(' '));
      pl.setAttribute('class', 'path-line'); svg.appendChild(pl);
    });
    if (globalStart.floor === f && remaining.some(p => p.id === globalStart.id)) draw3DPin(svg, globalStart.x, globalStart.y, 'marker-start');
    const isOnFinalLeg = currentCheckpointIdx >= checkpoints.length - 1;
    if (isOnFinalLeg && globalEnd.floor === f && remaining.some(p => p.id === globalEnd.id)) draw3DPin(svg, globalEnd.x, globalEnd.y, 'marker-end');
    const nextIdx = currentCheckpointIdx + 1, nextCp = nextIdx < checkpoints.length ? checkpoints[nextIdx] : null;
    if (nextCp && nextCp.floor === f && remaining.some(p => p.id === nextCp.id)) drawCheckpointDot(svg, nextCp.x, nextCp.y);
  }
}

// ---------------------------------------------------------------------------
// drawPath
// ---------------------------------------------------------------------------
window.drawPath = function drawPath(path, logicalPath = path) {
  if (!path || path.length === 0) { toast('Route not available. Please try another selection.'); return; }
  pathData = logicalPath;
  const globalStart = logicalPath[0], globalEnd = logicalPath[logicalPath.length - 1];
  const routeCheckpoints = computeCheckpoints(logicalPath);
  const nextCheckpoint = routeCheckpoints.length > 0 ? routeCheckpoints[0] : null;
  for (let i = 1; i <= 4; i++) {
    renderSVG(`svg-f${i}`, path, i, globalStart, globalEnd, nextCheckpoint);
  }
  generateDirections(logicalPath);
  calculateMetrics(logicalPath);
  if (!isMobile()) showRouteActivePanel();
  const legend = document.getElementById('map-legend');
  if (legend) legend.style.display = 'flex';
  const summary = document.getElementById('route-summary');
  if (summary) {
    const startLabel = NODES[globalStart.id]?.label || globalStart.id;
    const endLabel = NODES[globalEnd.id]?.label || globalEnd.id;
    const intermediateLabels = (window.stopLabels || []).map(s => s.label);
    const allLabels = [startLabel, ...intermediateLabels, endLabel];
    summary.innerHTML = '';
    allLabels.forEach((label, i) => {
      let cls = 'route-summary-stop';
      if (i === 0) cls = 'route-summary-from';
      else if (i === allLabels.length - 1) cls = 'route-summary-to';
      const span = document.createElement('span');
      span.className = cls;
      span.title = label;
      span.textContent = label;
      summary.appendChild(span);
      if (i < allLabels.length - 1) {
        const arrow = document.createElement('span');
        arrow.className = 'route-summary-arrow';
        arrow.textContent = ' → ';
        summary.appendChild(arrow);
      }
    });
    summary.style.display = 'flex'; summary.style.flexWrap = 'wrap'; summary.style.maxWidth = 'none';
  }
  checkpoints = routeCheckpoints; currentCheckpointIdx = 0; navStartTime = Date.now();
  if (isMobile()) {
    document.body.classList.add('has-route');
    closeRouteForm();
    populateMobileStrip(logicalPath);
    syncNavSVGs();
    const mobileLabel = document.getElementById('mobile-route-label');
    if (mobileLabel) mobileLabel.textContent = `${NODES[globalStart.id]?.label || globalStart.id} → ${NODES[globalEnd.id]?.label || globalEnd.id}`;
    const topBar = document.getElementById('mobile-top-bar');
    if (topBar) topBar.style.display = 'flex';
    const strip = document.getElementById('mobile-directions-strip');
    if (strip) strip.style.display = 'flex';
    document.documentElement.style.overflow = 'hidden';
    syncMobileCheckpointBtn();
    setAltBtnsVisible(true);
  }
  if (feedbackTimer) clearTimeout(feedbackTimer); feedbackTimer = null;
  if (!isMobile()) {
    if (checkpoints.length > 0) showCheckpointButton();
    else { const btn = document.getElementById('checkpoint-btn'); if (btn) { btn.textContent = 'Finish Navigation'; btn.className = 'checkpoint-btn finish-btn'; btn.style.display = 'flex'; } }
  }
};

// ---------------------------------------------------------------------------
// renderSVG
// ---------------------------------------------------------------------------
function renderSVG(svgId, fullPath, floorNum, globalStart, globalEnd, nextCheckpoint = null) {
  const svg = document.getElementById(svgId);
  if (!svg) return; svg.innerHTML = '';

  const chunks = [];
  let currentChunk = [];

  fullPath.forEach(p => {
    if (p.floor === floorNum) {
      currentChunk.push(p);
    } else {
      if (currentChunk.length >= 2) chunks.push(currentChunk);
      currentChunk = [];
    }
  });
  if (currentChunk.length >= 2) chunks.push(currentChunk);

  chunks.forEach(pts => {
    const pointsStr = pts.map(p => `${p.x},${p.y}`).join(' ');
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    bg.setAttribute('points', pointsStr); bg.setAttribute('class', 'path-line-bg'); svg.appendChild(bg);
    const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    pl.setAttribute('points', pointsStr); pl.setAttribute('class', 'path-line'); svg.appendChild(pl);
  });

  if (fullPath.some(p => p.id === globalStart.id && p.floor === floorNum)) draw3DPin(svg, globalStart.x, globalStart.y, 'marker-start');
  const maxSeg = Math.max(...fullPath.map(p => p.segment ?? 0));
  const destSeg = fullPath.find(p => p.id === globalEnd.id)?.segment ?? maxSeg;
  const isFinalLeg = !nextCheckpoint || destSeg === maxSeg;
  if (isFinalLeg && fullPath.some(p => p.id === globalEnd.id && p.floor === floorNum)) draw3DPin(svg, globalEnd.x, globalEnd.y, 'marker-end');
  if (nextCheckpoint && fullPath.some(p => p.id === nextCheckpoint.id && p.floor === floorNum)) drawCheckpointDot(svg, nextCheckpoint.x, nextCheckpoint.y);
}

// ---------------------------------------------------------------------------
// Marker helpers
// ---------------------------------------------------------------------------
function draw3DPin(svg, x, y, className) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const pin = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  pin.setAttribute('d', 'M0,0 C-0.8,-1.1 -1.6,-2 -1.6,-3 C-1.6,-4 -0.8,-4.6 0,-4.6 C0.8,-4.6 1.6,-4 1.6,-3 C1.6,-2 0.8,-1.1 0,0 Z');
  pin.setAttribute('class', `marker-3d ${className}`);
  const base = document.createElementNS('http://www.w3.org/2000/svg', 'animateTransform');
  base.setAttribute('attributeName', 'transform'); base.setAttribute('type', 'translate');
  base.setAttribute('values', `${x},${y}`); base.setAttribute('dur', 'indefinite');
  base.setAttribute('repeatCount', 'indefinite'); base.setAttribute('additive', 'replace');
  const bounce = document.createElementNS('http://www.w3.org/2000/svg', 'animateTransform');
  bounce.setAttribute('class', 'bounce-anim');
  bounce.setAttribute('attributeName', 'transform'); bounce.setAttribute('type', 'translate');
  bounce.setAttribute('values', '0,0; 0,-1.2; 0,0'); bounce.setAttribute('dur', '1.5s');
  bounce.setAttribute('repeatCount', 'indefinite'); bounce.setAttribute('additive', 'sum');
  g.appendChild(pin); g.appendChild(base); g.appendChild(bounce); svg.appendChild(g);
}

function drawCheckpointDot(svg, x, y) {
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('r', '1.2'); circle.setAttribute('fill', '#8b5cf6');
  circle.setAttribute('stroke', '#ffffff'); circle.setAttribute('stroke-width', '0.4');
  const anim = document.createElementNS('http://www.w3.org/2000/svg', 'animateTransform');
  anim.setAttribute('attributeName', 'transform'); anim.setAttribute('type', 'translate');
  anim.setAttribute('values', `${x},${y}`); anim.setAttribute('dur', 'indefinite');
  anim.setAttribute('repeatCount', 'indefinite'); anim.setAttribute('additive', 'replace');
  circle.appendChild(anim); svg.appendChild(circle);
}

// ---------------------------------------------------------------------------
// generateDirections — renders buildDirections() output into DOM
// ---------------------------------------------------------------------------
function generateDirections(path) {
  const steps = buildDirections(path, NODES);
  const list = document.getElementById('directions-list');
  if (!list) return steps;
  list.innerHTML = '';
  steps.forEach(step => {
    const li = document.createElement('li');
    li.textContent = step.text.replace(/^\[\w+\]\s*/, '');
    li._rawText = step.text;
    list.appendChild(li);
  });
  if (checkpoints && checkpoints.length > 0) {
    let cpIdx = 0;
    Array.from(list.querySelectorAll('li')).forEach(li => {
      if (cpIdx >= checkpoints.length) return;
      const cp = checkpoints[cpIdx];
      const label = NODES[cp.id]?.label || cp.id;
      const isLift = nodeType(cp.id) === 'lift' || cp.id.includes('LIFT');
      const isStairs = nodeType(cp.id) === 'stairs' || cp.id.includes('STAIRS');
      const raw = li._rawText || li.textContent;
      const match = (isLift && raw.includes('[LIFT]')) || (isStairs && raw.includes('[STAIRS]')) || (!isLift && !isStairs && label && raw.includes(label));
      if (match) {
        li.setAttribute('data-checkpoint', cpIdx);
        const badge = document.createElement('span');
        badge.textContent = ` CP${cpIdx + 1}`;
        badge.style.cssText = 'color:#8b5cf6;font-weight:700;font-size:10px;margin-left:6px;';
        li.appendChild(badge); cpIdx++;
      }
    });
  }
  const dp = document.getElementById('directions-panel');
  if (dp) { dp.style.display = 'block'; dp.open = true; }
  return steps;
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
  const seconds = totalMeters / WALK_SPEED;
  const mins = Math.floor(seconds / 60), secs = Math.round(seconds % 60);
  document.getElementById('m-distance').textContent = totalMeters.toFixed(1);
  document.getElementById('m-time').textContent = `${mins} min ${secs} sec`;
  document.getElementById('m-floors').textContent = floorChanges;
  document.getElementById('metrics-bar').style.display = 'flex';
  const rip = document.getElementById('route-info-panel');
  if (rip) rip.style.display = 'block';
  fetch(`/stats?route=${path[0].id}+${path[path.length - 1].id}`)
    .then(r => r.json())
    .then(data => {
      const el = document.getElementById('m-rating');
      if (el) el.textContent = data.avg_rating ? data.avg_rating.toFixed(2) : '--';
    }).catch(() => { const el = document.getElementById('m-rating'); if (el) el.textContent = '--'; });
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
  setTimeout(() => { overlay.style.display = 'none'; showFeedbackModal(); }, 3000);
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------
function showFeedbackModal() { const m = document.getElementById('feedback-modal'); if (m) m.style.display = 'flex'; }
window.closeFeedback = function () {
  const m = document.getElementById('feedback-modal'); if (m) m.style.display = 'none';
  document.querySelectorAll('#star-rating span').forEach(s => s.classList.remove('selected'));
  const c = document.getElementById('feedback-comment'); if (c) c.value = '';
  window.resetToForm(); if (isMobile()) window.openRouteForm();
};
window.submitFeedback = function () {
  const allSelected = [...document.querySelectorAll('#star-rating span.selected')];
  const selected = allSelected.length > 0 ? allSelected[allSelected.length - 1] : null;
  const rating = selected ? +selected.dataset.val : null;
  if (!rating) { toast('Please select a star rating before submitting.'); return; }
  if (!pathData || pathData.length === 0) { window.closeFeedback(); return; }
  const comment = document.getElementById('feedback-comment').value || '';
  const payload = { start: pathData[0]?.id || '', end: pathData[pathData.length - 1]?.id || '', path: pathData.map(p => p.id), rating, comment };
  fetch('/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify(payload) })
    .then(() => { window.closeFeedback(); toast('Thanks for your feedback!'); })
    .catch(() => { window.closeFeedback(); toast('Could not send feedback right now.'); });
};

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast-msg'; el.textContent = msg;
  document.body.appendChild(el); setTimeout(() => el.remove(), 3000);
}

// ---------------------------------------------------------------------------
// FAQ Chatbot
// ---------------------------------------------------------------------------
let faqData = [];
window.loadFAQs = async function () {
  try { faqData = await (await fetch('/faq')).json(); } catch { faqData = []; }
};
function faqMatch(input) {
  const lower = input.toLowerCase().trim();
  for (const faq of faqData)
    for (const kw of faq.keywords)
      if (lower.includes(kw.toLowerCase())) return faq.answer;
  return null;
}
window.toggleFAQChat = function () {
  const chat = document.getElementById('faq-chat');
  const bubble = document.getElementById('faq-bubble');
  if (!chat) return;
  const isOpen = chat.style.display !== 'none';
  chat.style.display = isOpen ? 'none' : 'flex';
  bubble.classList.toggle('faq-bubble-open', !isOpen);
};
window.sendFAQ = function () {
  const input = document.getElementById('faq-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  appendFAQMessage(text, 'user'); input.value = '';
  setTimeout(() => appendFAQMessage(faqMatch(text) || "I'm not sure about that. Try using the navigation form to find your destination.", 'bot'), 280);
};
function appendFAQMessage(text, sender) {
  const messages = document.getElementById('faq-messages');
  if (!messages) return;
  const div = document.createElement('div');
  div.className = `faq-msg faq-msg-${sender}`; div.textContent = text;
  messages.appendChild(div); messages.scrollTop = messages.scrollHeight;
}

// ---------------------------------------------------------------------------
// Mobile nav screen helpers
// ---------------------------------------------------------------------------
function stepIcon(text) {
  if (text.startsWith('[START]')) return 'start';
  if (text.startsWith('[ARRIVED]')) return 'arrived';
  if (text.startsWith('[LIFT]')) return 'lift';
  if (text.startsWith('[STAIRS]')) return 'stairs';
  if (text.startsWith('[WALK]')) return text.includes('Take a left') ? 'turn-left' : text.includes('Take a right') ? 'turn-right' : 'walk';
  if (text.startsWith('[GO]')) return text.includes('Take a left') ? 'turn-left' : text.includes('Take a right') ? 'turn-right' : 'straight';
  return 'straight';
}

function populateMobileStrip(logicalPath) {
  if (!logicalPath || logicalPath.length === 0) return;
  const globalEnd = logicalPath[logicalPath.length - 1];
  const pill = document.getElementById('nav-dest-pill');
  if (pill) pill.textContent = NODES[globalEnd.id]?.label || globalEnd.id;
  const distEl = document.getElementById('m-distance'), timeEl = document.getElementById('m-time');
  const statRow = document.getElementById('mobile-metrics-row');
  if (statRow) statRow.innerHTML = `<div class="nav-stat-block"><div class="nav-stat-label">Distance</div><div class="nav-stat-value">${distEl?.textContent || '--'}m</div></div><div class="nav-stat-block"><div class="nav-stat-label">Est. Time</div><div class="nav-stat-value">${timeEl?.textContent || '--'}</div></div>`;
  const srcList = document.getElementById('directions-list'), mobileList = document.getElementById('mobile-directions-list');
  if (srcList && mobileList) {
    mobileList.innerHTML = '';
    const srcItems = Array.from(srcList.querySelectorAll('li')).filter(li => !li.style.color);
    srcItems.forEach((srcLi, idx) => {
      const rawText = srcLi._rawText || srcLi.textContent.trim();
      const type = stepIcon(rawText), isLast = idx === srcItems.length - 1;
      const body = rawText.replace(/^\[\w+\]\s*/, '');
      const li = document.createElement('li');
      const cp = srcLi.getAttribute('data-checkpoint');
      if (cp !== null) li.setAttribute('data-checkpoint', cp);
      const left = document.createElement('div'); left.className = 'nav-step-left';
      const iconWrap = document.createElement('div'); iconWrap.className = `nav-step-icon${type === 'start' ? ' start' : ''}`;
      iconWrap.innerHTML = `<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 9h8M14 9l-3-3M14 9l-3 3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      left.appendChild(iconWrap);
      if (!isLast) { const line = document.createElement('div'); line.className = 'nav-step-line'; left.appendChild(line); }
      const content = document.createElement('div'); content.className = 'nav-step-content';
      const titleEl = document.createElement('div'); titleEl.className = 'nav-step-title'; titleEl.textContent = body.split('.')[0];
      content.appendChild(titleEl);
      li.appendChild(left); li.appendChild(content); mobileList.appendChild(li);
    });
  }
  syncMobileCheckpointBtn(); syncNavSVGs(); updateMobileCurrentStep(0);
}

function syncNavSVGs() {
  for (let f = 1; f <= 4; f++) {
    const src = document.getElementById(`svg-f${f}`), dest = document.getElementById(`svg-nav-f${f}`);
    if (src && dest) dest.innerHTML = src.innerHTML;
  }
  requestAnimationFrame(() => fitNavSVGToImage());
}

function syncNavFloor(floorNum) {
  document.querySelectorAll('.floor-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.floor == floorNum));
  for (let i = 1; i <= 4; i++) { const el = document.getElementById(`nav-f${i}`); if (el) el.style.display = (i == floorNum) ? 'block' : 'none'; }
  requestAnimationFrame(() => fitNavSVGToImage());
}

function syncMobileCheckpointBtn() {
  const btn = document.getElementById('mobile-checkpoint-btn');
  if (!btn) return;
  if (!checkpoints || checkpoints.length === 0) { btn.style.display = 'none'; return; }
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
  const activeItem = items.find(li => li.getAttribute('data-checkpoint') == checkpointIdx) || items[Math.min(1, items.length - 1)];
  if (activeItem) { items.forEach(li => li.classList.remove('directions-active')); activeItem.classList.add('directions-active'); activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  syncMobileCheckpointBtn();
}

// Expose global functions required by inline HTML onclick handlers

// ---------------------------------------------------------------------------
// Alternate Route
// ---------------------------------------------------------------------------
function drawAltPath(path) {
  // Remove any previous alt overlays from all SVGs
  document.querySelectorAll('.path-line-alt').forEach(el => el.remove());
  if (!path || path.length === 0) return;
  for (let f = 1; f <= 4; f++) {
    const svg = document.getElementById(`svg-f${f}`);
    if (!svg) continue;
    const chunks = [];
    let current = [];
    path.forEach(p => {
      if (p.floor === f) { current.push(p); }
      else { if (current.length >= 2) chunks.push(current); current = []; }
    });
    if (current.length >= 2) chunks.push(current);
    chunks.forEach(pts => {
      const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      pl.setAttribute('points', pts.map(p => `${p.x},${p.y}`).join(' '));
      pl.setAttribute('class', 'path-line-alt');
      // Insert before the primary path so it renders underneath
      svg.insertBefore(pl, svg.firstChild);
    });
  }
}

window.requestAlternateRoute = async function requestAlternateRoute() {
  if (!pathData || pathData.length === 0) {
    toast('Please calculate a primary route first.');
    return;
  }

  const startNode = pathData[0].id;
  const endNode = pathData[pathData.length - 1].id;
  const mobilityEl = document.querySelector('input[name="mobility"]:checked');
  const mobility = mobilityEl ? mobilityEl.value : 'none';
  const avoidStairs = mobility === 'elevator_only';
  const avoidElevators = mobility === 'stairs_only';

  let learnedWeights = {};
  try {
    const statsRes = await fetch('/stats');
    if (statsRes.ok) {
      const statsData = await statsRes.json();
      learnedWeights = statsData.edge_weights || {};
    }
  } catch (_) { /* non-fatal */ }

  const altPath = planAlternate({
    startNode, endNode, stops: [],
    avoidStairs, avoidElevators,
    nodes: NODES, graph: GRAPH,
    learnedWeights,
    primaryPath: pathData,
  });

  if (!altPath.length || altPath.map(p => p.id).join() === pathData.map(p => p.id).join()) {
    toast('No alternate route found for this journey.');
    return;
  }

  // 1. Replace the global path array
  pathData = altPath;
  
  // 2. Re-initialize the entire navigation state using drawPath
  // (makeOrthogonalPath is globally available from script.js, but fallback to altPath just in case)
  const ortho = typeof makeOrthogonalPath === 'function' ? makeOrthogonalPath(altPath) : altPath;
  drawPath(ortho, altPath);

  toast('Alternate route activated. Navigation updated.');
};

// =============================================================================
// =============================================================================
// PANZOOM — zoomable/pannable map with proportional SVG overlay
// =============================================================================
(function initPanzoom() {
  const panzoomInstances = {};

  function setupFloorPanzoom(containerId, svgId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (panzoomInstances[containerId]) return;

    // Grab by tag to support both desktop (.map-image) and mobile (.nav-floor-png) classes
    const img = container.querySelector('img');
    const svg = container.querySelector('svg');
    if (!img || !svg) return;

    let wrapper = container.querySelector('.panzoom-wrapper');
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'panzoom-wrapper';
      wrapper.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
      container.appendChild(wrapper);
      wrapper.appendChild(img);
      wrapper.appendChild(svg);
    }

    const pz = Panzoom(wrapper, {
      maxScale: 5,
      minScale: 0.8,
      contain: 'outside',
      cursor: 'grab',
      excludeClass: 'ts-control',
    });

    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      pz.zoomWithWheel(e);
    }, { passive: false });

    panzoomInstances[containerId] = pz;

    wrapper.addEventListener('panzoomchange', () => rescaleSVGStrokes(containerId, svgId));
  }

  function rescaleSVGStrokes(containerId, svgId) {
    const inst = panzoomInstances[containerId];
    if (!inst) return;
    const scale = inst.getScale();
    const svg = document.getElementById(svgId);
    if (!svg) return;

    const basePathWidth = 0.8;
    const baseBgWidth = 1.5;
    const corrected = (base) => `${(base / scale).toFixed(3)}`;

    svg.querySelectorAll('.path-line, .path-line-alt, .path-line-traversed')
      .forEach(el => el.setAttribute('stroke-width', corrected(basePathWidth)));
    svg.querySelectorAll('.path-line-bg')
      .forEach(el => el.setAttribute('stroke-width', corrected(baseBgWidth)));

    svg.querySelectorAll('.marker-3d')
      .forEach(el => {
        const base = 1 / scale;
        el.setAttribute('transform', `scale(${base.toFixed(3)})`);
      });

    svg.querySelectorAll('.bounce-anim').forEach(el => {
      const baseBounce = -1.2;
      const scaledBounce = baseBounce / scale;
      el.setAttribute('values', `0,0; 0,${scaledBounce.toFixed(3)}; 0,0`);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    for (let f = 1; f <= 4; f++) {
      setupFloorPanzoom(`f${f}-container`, `svg-f${f}`);
      setupFloorPanzoom(`nav-f${f}`, `svg-nav-f${f}`);
    }
  });

  window.addEventListener('switchFloor', (e) => {
    if (e.detail) {
      setupFloorPanzoom(`f${e.detail}-container`, `svg-f${e.detail}`);
      setupFloorPanzoom(`nav-f${e.detail}`, `svg-nav-f${e.detail}`);
    }
  });

  window.resetMapZoom = function(containerId) {
    const pz = panzoomInstances[containerId];
    if (pz) pz.reset({ animate: true });
  };

  const _origResetToForm = window.resetToForm || function(){};
  window.resetToForm = function() {
    _origResetToForm();
    for (let f = 1; f <= 4; f++) {
      const pzDesktop = panzoomInstances[`f${f}-container`];
      if (pzDesktop) pzDesktop.reset({ animate: false });
      const pzMobile = panzoomInstances[`nav-f${f}`];
      if (pzMobile) pzMobile.reset({ animate: false });
    }
  };

  // Re-scale immediately when route is drawn so it doesn't wait for zoom interaction
  const _origDrawPath = window.drawPath || function(){};
  window.drawPath = function(...args) {
    _origDrawPath(...args);
    for (let f = 1; f <= 4; f++) {
      rescaleSVGStrokes(`f${f}-container`, `svg-f${f}`);
      rescaleSVGStrokes(`nav-f${f}`, `svg-nav-f${f}`);
    }
  };
})();
