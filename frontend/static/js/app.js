/**
 * app.js — Main UI module. Owned by: Person C (Frontend/UI)
 * Imports routing logic from routing.js and graph data from graph-data.js.
 */
import { NODES, GRAPH } from './graph-data.js';
import { planRoute, planAlternate, buildDirections } from './routing.js';
import { PDREngine, getPDRSupportState } from './pdr.js';
import { startSession, recordCheckpoint } from './metrics.js';
import { getCheckpointAdvancePlan, getCheckpointMarkersForFloor } from './checkpoint-flow.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const FLOOR_NAMES = { 1: 'Ground Floor', 2: 'First Floor', 3: 'Second Floor', 4: 'Third Floor' };
const FLOOR_ORDER = ['Ground Floor', 'First Floor', 'Second Floor', 'Third Floor'];
const TYPE_ORDER = ['Entrance', 'Offices', 'Rooms', 'Labs & Rooms', 'Restrooms', 'Lift & Stairs'];
const COORD_TO_METERS = 0.51;
const WALK_SPEED = 1.2;
const FAQ_EXPANDED_STORAGE_KEY = 'wayfinder-faq-expanded';

const ICON_SVG = {
  expand: `
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M7 3.5H3.5V7M13 3.5h3.5V7M7 16.5H3.5V13M13 16.5h3.5V13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
  collapse: `
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M6 8.5 3.5 6V3.5M14 8.5 16.5 6V3.5M6 11.5 3.5 14V16.5M14 11.5 16.5 14V16.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
  lift: `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="6" y="3.5" width="12" height="17" rx="2.5" stroke="currentColor" stroke-width="1.8"/>
      <path d="M9 9h6M9 12h6M10.5 16l1.5-1.8L13.5 16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
  stairs: `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 18h4v-4h4v-4h4V6h2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M15 6h4v4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
  straight: `
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 10h10M11 6l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
  walk: `
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="4.5" r="1.7" fill="currentColor"/>
      <path d="M10 6.8v4.2m0 0-3 2.8m3-2.8 3 1.8M8.7 9 6.8 11.7m3.2 3.1 1.2 2.7m-3.9-1.1-1.8 1.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
  'turn-left': `
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M15.5 5.5H9a3 3 0 0 0-3 3V14M9 10 5 14l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
  'turn-right': `
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4.5 5.5H11a3 3 0 0 1 3 3V14M11 10l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
  start: `
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M6 10h8M11 6l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
  arrived: `
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5 10.5 8.5 14 15 7.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
};

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
let faqExpanded = false;
let faqPendingNearest = null;
let pdrEngine = null;
let pdrLiveState = null;
let pdrStatusState = null;
let pdrPromptPending = false;
window.allNodes = NODES;

// ---------------------------------------------------------------------------
// toPathNodes — maps planRoute/planAlternate's { id, x, y, floor } shape into
// the { id, coords: [x, y], floor } shape expected by PDREngine.setPath().
// ---------------------------------------------------------------------------
function toPathNodes(path) {
  return path.map(n => ({ id: n.id, coords: [n.x, n.y], floor: n.floor }));
}

// Return the path suffix beginning at a confirmed checkpoint. PDR must not
// project a future step onto any segment already walked: at a junction those
// old segments can be closer than the forward segment and make the live dot
// snap backwards.
function getRemainingPDRPath(checkpointIdx) {
  if (!pathData?.length || checkpointIdx < 0 || !checkpoints?.[checkpointIdx]) return pathData;

  let searchFrom = 0;
  let pathIndex = -1;
  for (let i = 0; i <= checkpointIdx; i++) {
    const checkpoint = checkpoints[i];
    pathIndex = pathData.findIndex((node, index) =>
      index >= searchFrom &&
      node.id === checkpoint.id &&
      node.floor === checkpoint.floor
    );
    if (pathIndex === -1) return pathData;
    searchFrom = pathIndex + 1;
  }
  return pathData.slice(pathIndex);
}

function updatePDRProjectionFromCheckpoint(checkpointIdx) {
  if (!pdrEngine) return;
  const remainingPath = getRemainingPDRPath(checkpointIdx);
  if (remainingPath?.length >= 2) pdrEngine.setPath(toPathNodes(remainingPath));
}

const FEEDBACK_TAG_PRESETS = {
  1: [
    { tag: 'very-confusing', label: 'Very confusing' },
    { tag: 'wrong-route', label: 'Route felt wrong' },
    { tag: 'wrong-floor', label: 'Wrong floor guidance' },
    { tag: 'hard-to-follow', label: 'Hard to follow' },
    { tag: 'destination-hard', label: 'Door was hard to find' },
  ],
  2: [
    { tag: 'confusing-turn', label: 'Confusing turn' },
    { tag: 'missing-landmark', label: 'Needed more landmarks' },
    { tag: 'stairs-issue', label: 'Unexpected stairs' },
    { tag: 'wrong-floor', label: 'Floor change unclear' },
    { tag: 'destination-hard', label: 'Door was hard to find' },
  ],
  3: [
    { tag: 'mostly-clear', label: 'Mostly clear' },
    { tag: 'needed-more-detail', label: 'Needed more detail' },
    { tag: 'map-helpful', label: 'Map was helpful' },
    { tag: 'turns-could-improve', label: 'Turns could improve' },
    { tag: 'destination-hard', label: 'Door was hard to find' },
  ],
  4: [
    { tag: 'clear', label: 'Clear directions' },
    { tag: 'map-helpful', label: 'Map was helpful' },
    { tag: 'easy-to-follow', label: 'Easy to follow' },
    { tag: 'good-landmarks', label: 'Helpful landmarks' },
    { tag: 'smooth-route', label: 'Smooth route' },
  ],
  5: [
    { tag: 'super-clear', label: 'Super clear' },
    { tag: 'fast-route', label: 'Fast route' },
    { tag: 'easy-to-follow', label: 'Very easy to follow' },
    { tag: 'door-easy', label: 'Door was easy to spot' },
    { tag: 'great-overall', label: 'Great overall experience' },
  ],
};

const FEEDBACK_PROMPTS = {
  1: 'What went wrong?',
  2: 'What was difficult?',
  3: 'What could be improved?',
  4: 'What worked well?',
  5: 'What stood out?',
};

const isMobile = () => window.innerWidth <= 768;
const canDockFAQ = () => window.innerWidth > 768;
const nodeType = (id) => NODES[id]?.type || null;
const getFloorLabel = (floorNum) => FLOOR_NAMES[floorNum] || `Floor ${floorNum}`;

function getIconSvg(name) {
  return ICON_SVG[name] || ICON_SVG.straight;
}

function getNodeByLabel(label) {
  if (!label) return null;
  const normalized = label.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  let best = null;
  for (const [id, data] of Object.entries(NODES)) {
    if (data.is_waypoint) continue;
    const candidate = `${data.label} ${id}`.toLowerCase();
    if (candidate.includes(normalized) || normalized.includes(data.label.toLowerCase())) {
      const score = Math.abs(candidate.length - normalized.length);
      if (!best || score < best.score) best = { id, data, score };
    }
  }
  return best;
}

function nearestLandmarks(nodeId, limit = 3) {
  const node = NODES[nodeId];
  if (!node) return [];
  return Object.entries(NODES)
    .filter(([id, data]) => id !== nodeId && !data.is_waypoint && data.floor === node.floor)
    .map(([id, data]) => ({
      id,
      label: data.label,
      category: data.category || 'Room',
      distance: Math.hypot(data.coords[0] - node.coords[0], data.coords[1] - node.coords[1]),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

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
    onItemAdd() {
      window.requestAnimationFrame(() => {
        this.close();
        this.blur();
      });
    },
    onDropdownClose() {
      window.requestAnimationFrame(() => this.blur());
    },
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
  return ts;
};

window.removeStopField = function (trigger) {
  const group = trigger?.closest('.stop-group');
  if (!group) return;
  const select = group.querySelector('.stop-select');
  const ts = select?.tomselect || null;
  if (ts) {
    tsStopInstances = tsStopInstances.filter(instance => instance !== ts);
    ts.destroy();
  }
  group.remove();
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
      renderFeedbackTags(val);
    });
  });
  document.getElementById('feedback-tags')?.addEventListener('click', event => {
    const tag = event.target.closest('.feedback-tag');
    if (!tag) return;
    tag.classList.toggle('active');
  });
  renderFeedbackTags();

  regroupDropdowns('floor');
  faqExpanded = localStorage.getItem(FAQ_EXPANDED_STORAGE_KEY) === 'true';
  window.addEventListener('resize', () => {
    fitSVGToImage();
    fitNavSVGToImage();
    syncFAQExpandedUI();
  });
  loadFAQs();
  renderFaqSuggestions();
  fitSVGToImage();
  syncFAQExpandedUI();

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
    stopPDR();

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
    preparePDRForRoute(startNode, sessionId, path);

    if (isMobile()) {
      closeRouteForm();
      const topBar = document.getElementById('mobile-top-bar');
      if (topBar) topBar.style.display = 'flex';
    }

    // Background analytics POST — fire-and-forget
    startSession({ sessionId, startNode, endNode, mobility, path });
  });
});

// ---------------------------------------------------------------------------
// Dark mode
// ---------------------------------------------------------------------------
function applyDarkMode(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const btn = document.getElementById('dark-mode-btn');
  if (btn) {
    btn.classList.toggle('active', dark);
    btn.setAttribute('aria-pressed', String(dark));
  }
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
  document.querySelectorAll('.floor-tabs').forEach(group => {
    group.style.setProperty('--active-floor-index', Math.max(0, Number(floorNum) - 1));
  });
  document.querySelectorAll('.floor-tab').forEach(tab =>
    tab.classList.toggle('active', tab.dataset.floor == floorNum));
  for (let i = 1; i <= 4; i++) {
    const c = document.getElementById(`f${i}-container`);
    if (c) c.style.display = (i == floorNum) ? 'block' : 'none';
  }
  fitSVGToImage();
  syncNavFloor(floorNum);
  updateTransitionBanner();
  renderPDRMarkers();
};

function makeOrthogonalPath(path) { return Array.isArray(path) ? [...path] : []; }

function renderDestinationPreview(nodeId) {
  const node = NODES[nodeId];
  const panel = document.getElementById('destination-preview');
  const mobilePanel = document.getElementById('mobile-destination-preview');
  if (!node || !panel || !mobilePanel) return;

  const landmarks = nearestLandmarks(nodeId);
  const meta = getFloorLabel(node.floor);
  const landmarksHtml = landmarks.map(item =>
    `<span class="destination-preview-chip">${item.label}</span>`
  ).join('');

  document.getElementById('destination-preview-title').textContent = node.label;
  document.getElementById('destination-preview-floor').textContent = getFloorLabel(node.floor);
  document.getElementById('destination-preview-meta').textContent = meta;
  document.getElementById('destination-preview-landmarks').innerHTML = landmarksHtml;
  panel.style.display = 'block';

  mobilePanel.innerHTML = `
    <div class="destination-preview-head">
      <div>
        <div class="destination-preview-eyebrow">Destination Preview</div>
        <h3>${node.label}</h3>
      </div>
      <div class="destination-preview-floor">${getFloorLabel(node.floor)}</div>
    </div>
    <p class="destination-preview-meta">${meta}</p>
    <div class="destination-preview-landmarks">${landmarksHtml}</div>
  `;
  mobilePanel.style.display = 'block';
}

function hideDestinationPreview() {
  const panel = document.getElementById('destination-preview');
  const mobilePanel = document.getElementById('mobile-destination-preview');
  if (panel) panel.style.display = 'none';
  if (mobilePanel) mobilePanel.style.display = 'none';
}

// ---------------------------------------------------------------------------
// PDR UI + sensor lifecycle
// ---------------------------------------------------------------------------
function formatHeading(heading) {
  return Number.isFinite(heading) ? `${Math.round(heading)}°` : '--';
}

function formatConfidence(confidence) {
  return Number.isFinite(confidence) ? `${Math.round(confidence * 100)}%` : '--';
}

function buildPDRStatusMarkup(state) {
  const safeState = state || {
    tone: 'off',
    badge: 'Sensors Off',
    title: 'Motion pointer inactive',
    copy: 'Enable sensors to move the pointer as you walk.',
    heading: '--',
    steps: '0',
    confidence: '--',
  };

  const rerouteBtnHtml = safeState.showRerouteButton
    ? `<button class="pdr-reroute-btn" onclick="window.recalculateFromCurrentLocation()" style="margin-top: 10px; width: 100%; background: #f59e0b; color: #000; font-weight: 700; border: none; padding: 8px 12px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 4px 10px rgba(245, 158, 11, 0.3);">
        ⚡ Recalculate Route from Live Position
       </button>`
    : '';

  return `
    <div class="pdr-status-card">
      <div class="pdr-status-head">
        <div>
          <div class="pdr-status-title">${safeState.title}</div>
          <div class="pdr-status-copy">${safeState.copy}</div>
        </div>
        <div class="pdr-status-badge" data-tone="${safeState.tone}">${safeState.badge}</div>
      </div>
      <div class="pdr-status-grid">
        <div class="pdr-status-stat">
          <div class="pdr-status-label">Heading</div>
          <div class="pdr-status-value">${safeState.heading}</div>
        </div>
        <div class="pdr-status-stat">
          <div class="pdr-status-label">Steps</div>
          <div class="pdr-status-value">${safeState.steps}</div>
        </div>
        <div class="pdr-status-stat">
          <div class="pdr-status-label">Confidence</div>
          <div class="pdr-status-value">${safeState.confidence}</div>
        </div>
      </div>
      ${rerouteBtnHtml}
    </div>
  `;
}

function renderPDRStatus(state = null) {
  pdrStatusState = state;
  const desktopPanel = document.getElementById('pdr-status-panel');
  const mobilePanel = document.getElementById('mobile-metrics-cards');
  const hasRoute = Array.isArray(pathData) && pathData.length > 0;

  if (!hasRoute) {
    if (desktopPanel) {
      desktopPanel.style.display = 'none';
      desktopPanel.innerHTML = '';
    }
    if (mobilePanel) mobilePanel.innerHTML = '';
    return;
  }

  const markup = buildPDRStatusMarkup(state);
  if (desktopPanel) {
    desktopPanel.innerHTML = markup;
    desktopPanel.style.display = 'block';
  }
  if (mobilePanel) mobilePanel.innerHTML = markup;
}

function clearPDRMarkers() {
  document.querySelectorAll('.pdr-user-marker-root').forEach(node => node.remove());
}

function createPDRMarkerGroup(update) {
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const isOff = update.isOffRoute || update.isWrongWay;
  group.setAttribute('class', isOff ? 'pdr-user-marker-root off-route' : 'pdr-user-marker-root');
  // SVG rotate(angle) is clockwise from the positive-Y axis (down).
  // The arrow path M0 -2.25... has its tip at (0, -2.25) i.e. pointing UP (−Y).
  // For a north-up map, rotate(0)=up=north, rotate(90)=right=east, rotate(270)=left=west.
  // This matches compass convention directly — use heading with no adjustment.
  const svgHeading = Number.isFinite(update.heading) ? update.heading : 0;
  group.setAttribute('transform', `translate(${update.x},${update.y}) rotate(${svgHeading})`);

  const scaleGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  scaleGroup.setAttribute('class', 'pdr-user-marker-scale');

  const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  halo.setAttribute('class', 'pdr-user-halo');
  halo.setAttribute('cx', '0');
  halo.setAttribute('cy', '0');
  halo.setAttribute('r', '2.6');

  const body = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  body.setAttribute('class', 'pdr-user-body');
  body.setAttribute('cx', '0');
  body.setAttribute('cy', '0');
  body.setAttribute('r', '1.35');

  const core = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  core.setAttribute('class', 'pdr-user-core');
  core.setAttribute('cx', '0');
  core.setAttribute('cy', '0');
  core.setAttribute('r', '0.45');

  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrow.setAttribute('class', 'pdr-user-arrow');
  arrow.setAttribute('d', 'M0 -2.25 L1.05 -0.15 L0.38 -0.46 L0 1.6 L-0.38 -0.46 L-1.05 -0.15 Z');

  scaleGroup.appendChild(halo);
  scaleGroup.appendChild(body);
  scaleGroup.appendChild(core);
  scaleGroup.appendChild(arrow);
  group.appendChild(scaleGroup);
  return group;
}

function renderPDRMarkers() {
  clearPDRMarkers();
  if (!pdrLiveState) return;

  [`svg-f${pdrLiveState.floor}`, `svg-nav-f${pdrLiveState.floor}`].forEach(svgId => {
    const svg = document.getElementById(svgId);
    if (svg) svg.appendChild(createPDRMarkerGroup(pdrLiveState));
  });
}

function hideSensorPermissionModal() {
  const modal = document.getElementById('sensor-permission-modal');
  if (modal) modal.style.display = 'none';
}

function setSensorPermissionMessage({ title, body, note, enableLabel = 'Enable Sensors', disableEnable = false }) {
  const titleEl = document.getElementById('sensor-permission-title');
  const bodyEl = document.getElementById('sensor-permission-body');
  const noteEl = document.getElementById('sensor-permission-note');
  const enableBtn = document.getElementById('sensor-permission-enable');
  if (titleEl) titleEl.textContent = title;
  if (bodyEl) bodyEl.textContent = body;
  if (noteEl) noteEl.textContent = note;
  if (enableBtn) {
    enableBtn.textContent = enableLabel;
    enableBtn.disabled = disableEnable;
  }
}

// When false, auto-reroute is disabled — the off-route warning card and manual
// "Recalculate" button still work. Set true to re-enable after field validation.
const AUTO_REROUTE_ENABLED = false;

let pdrOffRouteCount = 0;

function preparePDRForRoute(startNode, sessionId, path) {
  pdrOffRouteCount = 0;
  pdrEngine = new PDREngine({
    startNode,
    nodes: NODES,
    graph: GRAPH,
    sessionId,
    path,
    onPositionUpdate: (update) => {
      pdrLiveState = update;
      renderPDRMarkers();
      const isOff = update.isOffRoute || update.isWrongWay;
      if (isOff) {
        pdrOffRouteCount++;
        const isWrong = update.isWrongWay;
        renderPDRStatus({
          tone: 'warn',
          badge: 'Off Route',
          title: isWrong ? 'Wrong Direction Detected' : 'Looks like you went off route.',
          copy: `Tracking near ${NODES[update.nearestNode]?.label || 'your route'} on ${getFloorLabel(update.floor)}.`,
          heading: formatHeading(update.heading),
          steps: String(update.stepCount ?? 0),
          confidence: formatConfidence(update.confidence),
          showRerouteButton: true,
        });

        // Auto-reroute after 3 consecutive off-route/wrong-way steps.
        // Disabled per field-testing feedback — auto-reroute felt premature before
        // the user had a chance to self-correct. Manual button remains available.
        if (AUTO_REROUTE_ENABLED && pdrOffRouteCount >= 3) {
          pdrOffRouteCount = 0;
          window.recalculateFromCurrentLocation({ auto: true });
        }
      } else {
        pdrOffRouteCount = 0;
        // headingReliable: false means the device returned non-absolute alpha data
        // (plain 'deviceorientation' on older Android). Switch to a warn tone so
        // the user knows the pointer direction may be inaccurate on this device.
        if (update.headingReliable === false) {
          renderPDRStatus({
            tone: 'warn',
            badge: 'Heading Unreliable',
            title: 'Compass heading may be inaccurate',
            copy: 'This device is not providing absolute compass data. The pointer direction may drift. Position tracking continues.',
            heading: formatHeading(update.heading),
            steps: String(update.stepCount ?? 0),
            confidence: formatConfidence(update.confidence),
            showRerouteButton: false,
          });
        } else {
          renderPDRStatus({
            tone: 'live',
            badge: 'Live',
            title: 'Motion pointer active',
            copy: `Tracking near ${NODES[update.nearestNode]?.label || 'your route'} on ${getFloorLabel(update.floor)}.`,
            heading: formatHeading(update.heading),
            steps: String(update.stepCount ?? 0),
            confidence: formatConfidence(update.confidence),
            showRerouteButton: false,
          });
        }
      }
    },
    onFloorChange: ({ toFloor }) => {
      window.switchFloor(toFloor);
      syncNavFloor(toFloor);
    },
  });
  pdrLiveState = null;
  clearPDRMarkers();

  // Wire the path immediately so the first _report() after start() can project.
  pdrEngine.setPath(toPathNodes(path));

  const support = getPDRSupportState();
  if (!support.motionSupported || !support.orientationSupported) {
    pdrPromptPending = false;
    clearPDRMarkers();
    renderPDRStatus({
      tone: 'warn',
      badge: 'Unavailable',
      title: 'Live pointer not available here',
      copy: 'This device does not expose the motion sensors needed for PDR. The route will still work normally.',
      heading: '--',
      steps: '0',
      confidence: '--',
    });
    return;
  }

  // On devices that don't require an explicit browser permission prompt
  // (Android, Chrome desktop), start immediately — no modal needed.
  // On iOS 13+ (permissionRequired === true), we must show the modal first
  // because sensor access requires a user-gesture-triggered requestPermission().
  if (!support.permissionRequired) {
    pdrPromptPending = false;
    window.enableRouteSensors();
    return;
  }

  // iOS path: show consent modal before calling start().
  pdrPromptPending = true;
  renderPDRStatus({
    tone: 'ready',
    badge: 'Ready',
    title: 'Enable live motion pointer',
    copy: 'Grant sensor access to move the on-screen pointer as you walk through the building.',
    heading: '--',
    steps: '0',
    confidence: '100%',
  });
  setSensorPermissionMessage({
    title: 'Enable motion-based navigation?',
    body: 'Allow motion and orientation access so Wayfinder can move your on-screen pointer as you walk.',
    note: 'Your browser will ask for sensor permission on the next tap.',
    enableLabel: 'Enable Sensors',
    disableEnable: false,
  });
  const modal = document.getElementById('sensor-permission-modal');
  if (modal) modal.style.display = 'flex';
}

function stopPDR({ clearStatus = true } = {}) {
  if (pdrEngine) pdrEngine.stop();
  pdrEngine = null;
  pdrLiveState = null;
  pdrPromptPending = false;
  clearPDRMarkers();
  hideSensorPermissionModal();
  if (clearStatus) renderPDRStatus(null);
}

// Field-test helpers. In the browser console, call getPDRDiagnostics() when
// the dot stalls; call setPDRDiagnosticMode(true) to log each detected step.
window.getPDRDiagnostics = () => pdrEngine?.getDiagnostics?.() || null;
window.setPDRDiagnosticMode = (enabled) => {
  if (!pdrEngine?.setDiagnosticMode) return false;
  const active = pdrEngine.setDiagnosticMode(enabled);
  toast(`PDR diagnostics ${active ? 'enabled' : 'disabled'}.`);
  return active;
};

// ---------------------------------------------------------------------------
// Recalculate route
// ---------------------------------------------------------------------------
window.recalculateFromCurrentLocation = function ({ auto = false } = {}) {
  if (!pdrLiveState || !pathData || pathData.length === 0) return;
  const currentNearest = pdrLiveState.nearestNode;
  const endNodeId = pathData[pathData.length - 1].id;
  if (!currentNearest || !endNodeId || currentNearest === endNodeId) return;

  const newPath = planRoute({
    startNode: currentNearest,
    endNode: endNodeId,
    nodes: NODES,
    graph: GRAPH,
  });

  if (newPath && newPath.length > 0) {
    const ortho = makeOrthogonalPath(newPath);
    drawPath(ortho, newPath);
    if (pdrEngine) pdrEngine.setPath(toPathNodes(newPath));
    pdrOffRouteCount = 0;
    toast(auto ? 'Auto-recalculated route from your live position!' : 'Route recalculated!');
  }
};

window.enableRouteSensors = async function enableRouteSensors() {
  if (!pdrEngine) return;

  setSensorPermissionMessage({
    title: 'Starting live pointer',
    body: 'Hold your phone naturally while we start reading heading and motion updates.',
    note: 'You can continue with normal navigation if the browser declines sensor access.',
    enableLabel: 'Starting...',
    disableEnable: true,
  });

  const result = await pdrEngine.start();
  if (result.started) {
    pdrPromptPending = false;
    hideSensorPermissionModal();
    toast('Live motion pointer enabled.');
    return;
  }

  pdrPromptPending = false;
  pdrLiveState = null;
  clearPDRMarkers();
  const denied = result.reason?.includes('denied');
  renderPDRStatus({
    tone: denied ? 'warn' : 'off',
    badge: denied ? 'Denied' : 'Unavailable',
    title: denied ? 'Sensor access was declined' : 'Could not start live pointer',
    copy: denied
      ? 'You can keep following the route manually, or try enabling motion permissions in your browser settings.'
      : 'Wayfinder could not read motion sensors on this device. Navigation is still available without the live pointer.',
    heading: '--',
    steps: '0',
    confidence: '--',
  });
  setSensorPermissionMessage({
    title: denied ? 'Sensor permission was denied' : 'Live pointer unavailable',
    body: denied
      ? 'Wayfinder needs motion and orientation access to move the pointer on the map.'
      : 'Your browser did not expose the required motion data for this route.',
    note: 'You can continue navigating with checkpoints and turn-by-turn guidance.',
    enableLabel: 'Try Again',
    disableEnable: Boolean(!denied && !result.support?.motionSupported),
  });
}

window.dismissSensorPermissionModal = function dismissSensorPermissionModal() {
  hideSensorPermissionModal();
  pdrPromptPending = false;
  if (!pdrEngine?.active) {
    pdrLiveState = null;
    clearPDRMarkers();
    renderPDRStatus({
      tone: 'off',
      badge: 'Off',
      title: 'Motion pointer skipped',
      copy: 'You can still follow the route using the map, checkpoints, and turn-by-turn instructions.',
      heading: '--',
      steps: '0',
      confidence: '--',
    });
  }
}

function getUpcomingTransition() {
  if (!Array.isArray(checkpoints) || checkpoints.length < 2) return null;
  const current = checkpoints[currentCheckpointIdx];
  const next = checkpoints[currentCheckpointIdx + 1];
  if (!current || !next || current.floor === next.floor) return null;
  const method = nodeType(current.id) === 'lift' || current.id.includes('LIFT') ? 'lift' : 'stairs';
  return { current, next, method };
}

function updateTransitionBanner() {
  const banner = document.getElementById('transition-banner');
  if (!banner) return;
  const transition = getUpcomingTransition();
  if (!transition) {
    banner.style.display = 'none';
    return;
  }
  const { current, next, method } = transition;
  const currentFloor = parseInt(document.querySelector('.floor-tab.active')?.dataset.floor || '1', 10);
  const icon = document.getElementById('transition-banner-icon');
  const title = document.getElementById('transition-banner-title');
  const body = document.getElementById('transition-banner-body');
  if (icon) icon.textContent = method === 'lift' ? 'ELEVATOR' : 'STAIRS';
  banner.dataset.method = method;
  if (currentFloor === current.floor) {
    title.textContent = method === 'lift' ? `Head to the lift on ${getFloorLabel(current.floor)}` : `Head to the stairs on ${getFloorLabel(current.floor)}`;
    body.textContent = `Next stop is ${getFloorLabel(next.floor)}. Follow the highlighted route to the ${method}.`;
  } else if (currentFloor === next.floor) {
    title.textContent = `You are now on ${getFloorLabel(next.floor)}`;
    body.textContent = `Confirm your position and continue from the ${NODES[next.id]?.label || 'transition point'}.`;
  } else {
    title.textContent = `Upcoming floor change to ${getFloorLabel(next.floor)}`;
    body.textContent = `This route uses the ${method} between ${getFloorLabel(current.floor)} and ${getFloorLabel(next.floor)}.`;
  }
  banner.style.display = 'flex';
}

function getSelectedFeedbackTags() {
  return Array.from(document.querySelectorAll('.feedback-tag.active')).map(tag => tag.dataset.tag);
}

function renderFeedbackTags(rating = null) {
  const block = document.querySelector('.feedback-tag-block');
  const container = document.getElementById('feedback-tags');
  const label = document.querySelector('.feedback-tag-label');
  if (!block || !container) return;

  const selectedRating = rating || document.querySelectorAll('#star-rating span.selected').length || 0;
  if (!selectedRating) {
    block.style.display = 'none';
    container.innerHTML = '';
    if (label) label.textContent = 'What stood out?';
    return;
  }

  block.style.display = 'block';
  const options = FEEDBACK_TAG_PRESETS[selectedRating] || [
    { tag: 'clear', label: 'Clear directions' },
    { tag: 'map-helpful', label: 'Map was helpful' },
    { tag: 'confusing-turn', label: 'Confusing turn' },
    { tag: 'wrong-floor', label: 'Wrong floor transition' },
    { tag: 'stairs-issue', label: 'Unexpected stairs' },
    { tag: 'destination-hard', label: 'Door was hard to find' },
  ];

  if (label) {
    label.textContent = FEEDBACK_PROMPTS[selectedRating] || 'What stood out?';
  }

  container.innerHTML = options.map(option =>
    `<button type="button" class="feedback-tag" data-tag="${option.tag}">${option.label}</button>`
  ).join('');
}

function clearFeedbackState() {
  document.querySelectorAll('#star-rating span').forEach(s => s.classList.remove('selected'));
  renderFeedbackTags();
  const comment = document.getElementById('feedback-comment');
  if (comment) comment.value = '';
}

function setStartFromNodeGlobal(nodeId) {
  const node = NODES[nodeId];
  if (!node) return false;
  const floorLabel = getFloorLabel(node.floor);
  const floorBtn = Array.from(document.querySelectorAll('.floor-pick-btn'))
    .find(btn => btn.dataset.floorLabel === floorLabel);
  if (floorBtn) floorBtn.click();
  if (tsStart) {
    tsStart.setValue(nodeId, false);
    return true;
  }
  return false;
}

function setDestinationFromNodeGlobal(nodeId) {
  if (!NODES[nodeId] || !tsEnd) return false;
  tsEnd.setValue(nodeId, false);
  return true;
}

window.swapRouteEndpoints = function () {
  const startValue = tsStart ? tsStart.getValue() : '';
  const endValue = tsEnd ? tsEnd.getValue() : '';

  if (!startValue && !endValue) {
    toast('Select a current location or destination first.');
    return;
  }

  if (endValue) setStartFromNodeGlobal(endValue);
  else if (tsStart) tsStart.clear(false);

  if (tsEnd) {
    if (startValue) tsEnd.setValue(startValue, false);
    else tsEnd.clear(false);
  }
};

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------
function computeCheckpoints(logicalPath) {
  if (!logicalPath || logicalPath.length === 0) return [];
  const result = [], addedIds = new Set();
  const stopIds = (window.stopLabels || []).map(s => s.id);

  function addCheckpoint(node) {
    if (!node) return;
    const isVertical = nodeType(node.id) === 'lift' || nodeType(node.id) === 'stairs';
    const key = isVertical ? `${node.id}::${node.segment ?? 0}` : node.id;
    if (addedIds.has(key)) return;
    addedIds.add(key); result.push(node);
  }

  for (let i = 1; i < logicalPath.length - 1; i++) {
    const curr = logicalPath[i], next = logicalPath[i + 1];
    const currType = nodeType(curr.id);
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
    const isExplicitCheckpoint = curr.id.toLowerCase().includes('checkpoint') || NODES[curr.id]?.is_waypoint;
    const isUserStop = stopIds.includes(curr.id);
    if (isExplicitCheckpoint || isUserStop) addCheckpoint(curr);
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
  if (rip) rip.style.display = 'flex';
  setAltBtnsVisible(true);
}

function setAltBtnsVisible(visible) {
  const d = document.getElementById('alt-route-btn-desktop');
  if (d) d.style.display = visible ? 'inline-flex' : 'none';
  document.querySelectorAll('.alt-route-btn-mobile').forEach(m => {
    m.style.display = visible ? 'inline-flex' : 'none';
  });
}

function updateMobileRoutePreview(startId, endId) {
  const label = document.getElementById('mobile-route-label');
  if (!label) return;
  const startText = startId ? (NODES[startId]?.label || startId) : 'Start';
  const endText = endId ? (NODES[endId]?.label || endId) : 'Destination';
  label.innerHTML = '';
  const startSpan = document.createElement('span');
  startSpan.className = 'mobile-route-label-from';
  startSpan.title = startText;
  startSpan.textContent = startText;

  const arrowSpan = document.createElement('span');
  arrowSpan.className = 'mobile-route-label-arrow';
  arrowSpan.setAttribute('aria-hidden', 'true');
  arrowSpan.textContent = '→';

  const endSpan = document.createElement('span');
  endSpan.className = 'mobile-route-label-to';
  endSpan.title = endText;
  endSpan.textContent = endText;

  label.append(startSpan, arrowSpan, endSpan);
}

window.resetToForm = function () {
  stopPDR({ clearStatus: false });
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
  hideDestinationPreview();
  updateTransitionBanner();
  pathData = []; checkpoints = []; currentCheckpointIdx = 0;
  // FIX 1c: clear path projection so PDR stops snapping to stale route
  if (pdrEngine) pdrEngine.setPath([]);
  renderPDRStatus(null);
  const topBar = document.getElementById('mobile-top-bar');
  if (topBar) topBar.style.display = 'none';
  const strip = document.getElementById('mobile-directions-strip');
  if (strip) strip.style.display = 'none';
  updateMobileRoutePreview('', '');
  document.body.classList.remove('has-route');
  document.documentElement.style.overflow = '';
  const mobileMetricsCards = document.getElementById('mobile-metrics-cards');
  if (mobileMetricsCards) mobileMetricsCards.innerHTML = '';
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

window.exitNavigationToForm = function exitNavigationToForm() {
  window.resetToForm();
  if (isMobile()) window.openRouteForm();
};

function closeRouteForm() {
  const sheet = document.getElementById('route-form-sheet');
  if (sheet) sheet.classList.add('sheet-hidden');
  routeFormOpen = false;
  const topBar = document.getElementById('mobile-top-bar');
  if (topBar && isMobile()) topBar.style.display = 'flex';
}
window.closeRouteForm = closeRouteForm;

// ---------------------------------------------------------------------------
// Floor confirm modal
// ---------------------------------------------------------------------------
function showFloorConfirmModal(targetFloor, method, onConfirm) {
  const modal = document.getElementById('floor-confirm-modal');
  if (!modal) { onConfirm(true); return; }
  const title = document.getElementById('floor-confirm-title');
  const body = document.getElementById('floor-confirm-body');
  const icon = document.getElementById('floor-confirm-icon');
  const floorName = FLOOR_NAMES[targetFloor] || `Floor ${targetFloor}`;
  if (title) title.textContent = `Take the ${method === 'lift' ? 'Elevator' : 'Stairs'}`;
  if (body) body.textContent = `Please take the ${method === 'lift' ? 'elevator' : 'stairs'} to ${floorName}, then confirm below.`;
  if (icon) icon.innerHTML = method === 'lift' ? ICON_SVG.lift : ICON_SVG.stairs;
  _floorConfirmCallback = onConfirm;
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
    stopPDR({ clearStatus: false });
    for (let f = 1; f <= 4; f++) {
      const svg = document.getElementById(`svg-f${f}`);
      if (svg) svg.innerHTML = '';
    }
    const legend = document.getElementById('map-legend');
    const summary = document.getElementById('route-summary');
    if (legend) legend.style.display = 'none';
    if (summary) summary.style.display = 'none';
    updateTransitionBanner();
    const navScreen = document.getElementById('mobile-directions-strip');
    if (navScreen) navScreen.style.display = 'none';
    pathData = []; checkpoints = [];
    // FIX 1c: clear path projection so PDR stops snapping to stale route
    if (pdrEngine) pdrEngine.setPath([]);
    renderPDRStatus(null);
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

  function advanceCheckpoint({ arrivalConfirmed = false } = {}) {
    const plan = getCheckpointAdvancePlan({
      checkpoints,
      currentIndex: currentCheckpointIdx,
      arrivalConfirmed,
    });
    if (!plan) return;

    const cpJustReached = checkpoints[plan.reachedIndex];
    const arrivalCp = checkpoints[plan.arrivalIndex];
    if (pdrEngine) pdrEngine.resetToCheckpoint(cpJustReached.id);

    // A floor-confirmation modal explicitly confirms both sides of a stair/lift
    // transition. Keep PDR anchored at the arrival landing, but make the next
    // real checkpoint active so a later tap cannot send the dot back to stairs.
    if (plan.isFloorTransition) {
      window.switchFloor(arrivalCp.floor);
      if (pdrEngine) pdrEngine.resetToCheckpoint(arrivalCp.id);
    } else {
      window.switchFloor(arrivalCp.floor);
    }

    currentCheckpointIdx = plan.nextActiveIndex;
    const activeCp = checkpoints[currentCheckpointIdx];
    if (!activeCp) return;

    updatePDRProjectionFromCheckpoint(plan.anchorIndex);
    highlightRemainingPath(plan.visualProgressIndex);
    syncDirectionsActiveStep(currentCheckpointIdx);
    showCheckpointButton();
    updateTransitionBanner();
    if (isMobile()) { updateMobileCurrentStep(currentCheckpointIdx); syncNavSVGs(); }
    plan.confirmedIndices.forEach(index => {
      const checkpoint = checkpoints[index];
      recordCheckpoint({ sessionId: currentSessionId, checkpointIndex: index, checkpointNodeId: checkpoint.id });
    });
  }

  const currentVisibleFloor = parseInt(document.querySelector('.floor-tab.active')?.dataset.floor || '1');

  if ((isLiftNode || isStairNode) && floorChanging) {
    if (nextCp.floor === currentVisibleFloor) {
      // The user is already at the arrival landing, so consume both sides of
      // the transition exactly as the confirmation modal would.
      advanceCheckpoint({ arrivalConfirmed: true });
    } else {
      hideCheckpointButton();
      showFloorConfirmModal(nextCp.floor, isLiftNode ? 'lift' : 'stairs', (confirmed) => {
        if (confirmed) advanceCheckpoint({ arrivalConfirmed: true });
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
    renderCheckpointMarkers(svg, checkpoints, f);
  }
  renderPDRMarkers();
}

// ---------------------------------------------------------------------------
// drawPath
// ---------------------------------------------------------------------------
window.drawPath = function drawPath(path, logicalPath = path) {
  if (!path || path.length === 0) { toast('Route not available. Please try another selection.'); return; }
  pathData = logicalPath;
  const globalStart = logicalPath[0], globalEnd = logicalPath[logicalPath.length - 1];
  const routeCheckpoints = computeCheckpoints(logicalPath);
  checkpoints = routeCheckpoints;
  currentCheckpointIdx = 0;
  navStartTime = Date.now();
  for (let i = 1; i <= 4; i++) {
    renderSVG(`svg-f${i}`, path, i, globalStart, globalEnd, routeCheckpoints);
  }
  generateDirections(logicalPath);
  syncDirectionsActiveStep(0);
  calculateMetrics(logicalPath);
  hideDestinationPreview();
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
  updateTransitionBanner();
  if (isMobile()) {
    document.body.classList.add('has-route');
    closeRouteForm();
    populateMobileStrip(logicalPath);
    syncNavSVGs();
    updateMobileRoutePreview(globalStart.id, globalEnd.id);
    const topBar = document.getElementById('mobile-top-bar');
    if (topBar) topBar.style.display = 'flex';
    const strip = document.getElementById('mobile-directions-strip');
    if (strip) strip.style.display = 'flex';
    document.documentElement.style.overflow = 'hidden';
    syncMobileCheckpointBtn();
    setAltBtnsVisible(true);
  }
  if (pdrStatusState) renderPDRStatus(pdrStatusState);
  renderPDRMarkers();
  if (feedbackTimer) clearTimeout(feedbackTimer); feedbackTimer = null;
  if (!isMobile()) {
    if (checkpoints.length > 0) showCheckpointButton();
    else { const btn = document.getElementById('checkpoint-btn'); if (btn) { btn.textContent = 'Finish Navigation'; btn.className = 'checkpoint-btn finish-btn'; btn.style.display = 'flex'; } }
  }
};

// ---------------------------------------------------------------------------
// renderSVG
// ---------------------------------------------------------------------------
function renderSVG(svgId, fullPath, floorNum, globalStart, globalEnd, routeCheckpoints = []) {
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
  const isFinalLeg = routeCheckpoints.length === 0 || destSeg === maxSeg;
  if (isFinalLeg && fullPath.some(p => p.id === globalEnd.id && p.floor === floorNum)) draw3DPin(svg, globalEnd.x, globalEnd.y, 'marker-end');
  renderCheckpointMarkers(svg, routeCheckpoints, floorNum, fullPath);
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

function renderCheckpointMarkers(svg, checkpointList, floorNum, route = pathData) {
  getCheckpointMarkersForFloor(checkpointList, floorNum).forEach((checkpoint, index) => {
    const isOnRoute = route.some(point => point.id === checkpoint.id && point.floor === checkpoint.floor);
    if (isOnRoute) drawCheckpointDot(svg, checkpoint.x, checkpoint.y, {
      active: checkpoint === checkpoints[currentCheckpointIdx],
      index,
    });
  });
}

function drawCheckpointDot(svg, x, y, { active = false, index = 0 } = {}) {
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('r', active ? '1.45' : '1.15'); circle.setAttribute('fill', '#8b5cf6');
  circle.setAttribute('stroke', active ? '#4c1d95' : '#ffffff'); circle.setAttribute('stroke-width', active ? '0.55' : '0.4');
  circle.setAttribute('data-checkpoint-marker', String(index));
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
    const type = (step.text.match(/^\[(\w+)\]/)?.[1] || 'STEP').toLowerCase();
    li.className = `direction-step-card direction-step-${type}`;
    li.dataset.stepType = type;
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
  if (dp) { dp.style.display = 'flex'; dp.open = true; }
  return steps;
}

function syncDirectionsActiveStep(checkpointIdx) {
  const list = document.getElementById('directions-list');
  if (!list) return;
  const items = Array.from(list.querySelectorAll('li[data-checkpoint]'));
  if (!items.length) return;

  items.forEach(li => li.classList.remove('directions-active'));
  const activeItem = items.find(li => li.getAttribute('data-checkpoint') == checkpointIdx) || items[0];
  if (!activeItem) return;

  activeItem.classList.add('directions-active');
  activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
  const distanceEl = document.getElementById('m-distance');
  const timeEl = document.getElementById('m-time');
  const floorsEl = document.getElementById('m-floors');
  const metricsBar = document.getElementById('metrics-bar');
  if (distanceEl) distanceEl.textContent = totalMeters.toFixed(1);
  if (timeEl) timeEl.textContent = `${mins} min ${secs} sec`;
  if (floorsEl) floorsEl.textContent = floorChanges;
  if (metricsBar) metricsBar.style.display = 'flex';
  const rip = document.getElementById('route-info-panel');
  if (rip) rip.style.display = 'flex';
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
function showFeedbackModal() {
  clearFeedbackState();
  const m = document.getElementById('feedback-modal');
  if (m) m.style.display = 'flex';
}
window.closeFeedback = function () {
  const m = document.getElementById('feedback-modal'); if (m) m.style.display = 'none';
  clearFeedbackState();
  window.resetToForm(); if (isMobile()) window.openRouteForm();
};
window.submitFeedback = function () {
  const allSelected = [...document.querySelectorAll('#star-rating span.selected')];
  const selected = allSelected.length > 0 ? allSelected[allSelected.length - 1] : null;
  const rating = selected ? +selected.dataset.val : null;
  if (!rating) { toast('Please select a star rating before submitting.'); return; }
  if (!pathData || pathData.length === 0) { window.closeFeedback(); return; }
  const comment = document.getElementById('feedback-comment').value || '';
  const payload = {
    start: pathData[0]?.id || '',
    end: pathData[pathData.length - 1]?.id || '',
    path: pathData.map(p => p.id),
    rating,
    comment,
    tags: getSelectedFeedbackTags(),
  };
  fetch('/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify(payload) })
    .then(() => { window.closeFeedback(); toast('Thanks for your feedback!'); })
    .catch(() => { window.closeFeedback(); toast('Could not send feedback right now.'); });
};

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast-msg';
  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '!';
  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = msg;
  el.append(icon, text);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ---------------------------------------------------------------------------
// Pin-to-navigate popup
// ---------------------------------------------------------------------------
(function initPinToNavigate() {
  const SNAP_THRESHOLD = 6;
  const pointerState = new WeakMap();
  let popupState = null;
  let suppressNextMapClick = false;

  function getCurrentVisibleFloor() {
    return parseInt(document.querySelector('.floor-tab.active')?.dataset.floor || '1', 10);
  }

  function getPopup() {
    return document.getElementById('pin-popup');
  }

  function getDropdownPulseTarget(selectOrTs) {
    if (!selectOrTs) return null;
    if (selectOrTs.wrapper) return selectOrTs.wrapper;
    if (selectOrTs.tomselect?.wrapper) return selectOrTs.tomselect.wrapper;
    const el = typeof selectOrTs === 'string' ? document.querySelector(selectOrTs) : selectOrTs;
    return el?.tomselect?.wrapper || el?.closest('.ts-wrapper') || null;
  }

  function pulseElement(el) {
    if (!el) return;
    el.classList.remove('dropdown-pulse');
    void el.offsetWidth;
    el.classList.add('dropdown-pulse');
    window.setTimeout(() => el.classList.remove('dropdown-pulse'), 700);
  }

  function hidePopup() {
    const popup = getPopup();
    if (!popup) return;
    popup.style.display = 'none';
    popupState = null;
  }

  function positionPopup(clientX, clientY) {
    const popup = getPopup();
    if (!popup) return;
    popup.style.display = 'block';
    popup.style.visibility = 'hidden';
    popup.style.left = '0px';
    popup.style.top = '0px';
    const margin = 12;
    const popupWidth = popup.offsetWidth || 180;
    const popupHeight = popup.offsetHeight || 120;
    const left = Math.min(Math.max(clientX, margin), window.innerWidth - popupWidth - margin);
    const top = Math.min(Math.max(clientY, margin), window.innerHeight - popupHeight - margin);
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.style.visibility = 'visible';
  }

  function showSnapPulse(floorNum, coords) {
    const svg = document.getElementById(`svg-f${floorNum}`);
    if (!svg) return;
    svg.querySelectorAll('.pin-snap-feedback').forEach(el => el.remove());
    const pulse = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    pulse.setAttribute('cx', coords.x);
    pulse.setAttribute('cy', coords.y);
    pulse.setAttribute('r', '1.25');
    pulse.setAttribute('class', 'snap-pulse pin-snap-feedback');
    pulse.addEventListener('animationend', () => pulse.remove(), { once: true });
    svg.appendChild(pulse);
  }

  function findNearestNode(coords, floorNum) {
    let best = null;
    for (const [id, data] of Object.entries(NODES)) {
      if (data.floor !== floorNum || data.is_waypoint) continue;
      const [nodeX, nodeY] = data.coords;
      const dist = Math.hypot(nodeX - coords.x, nodeY - coords.y);
      if (!best || dist < best.dist) {
        best = { id, data, dist, coords: { x: nodeX, y: nodeY } };
      }
    }
    return best;
  }

  function percentCoordsFromImageEvent(event, imageEl) {
    if (!imageEl || !imageEl.clientWidth || !imageEl.clientHeight) return null;

    const rect = imageEl.getBoundingClientRect();
    const rawPercentX = typeof event.offsetX === 'number'
      ? (event.offsetX / imageEl.clientWidth) * 100
      : (((event.clientX || 0) - rect.left) / imageEl.clientWidth) * 100;
    const rawPercentY = typeof event.offsetY === 'number'
      ? (event.offsetY / imageEl.clientHeight) * 100
      : (((event.clientY || 0) - rect.top) / imageEl.clientHeight) * 100;

    const naturalWidth = imageEl.naturalWidth || imageEl.clientWidth;
    const naturalHeight = imageEl.naturalHeight || imageEl.clientHeight;
    const renderedScale = Math.min(imageEl.clientWidth / naturalWidth, imageEl.clientHeight / naturalHeight);
    const renderedWidth = naturalWidth * renderedScale;
    const renderedHeight = naturalHeight * renderedScale;
    const padPercentX = ((imageEl.clientWidth - renderedWidth) / 2 / imageEl.clientWidth) * 100;
    const padPercentY = ((imageEl.clientHeight - renderedHeight) / 2 / imageEl.clientHeight) * 100;
    const renderedWidthPercent = (renderedWidth / imageEl.clientWidth) * 100;
    const renderedHeightPercent = (renderedHeight / imageEl.clientHeight) * 100;

    const x = ((rawPercentX - padPercentX) / renderedWidthPercent) * 100;
    const y = ((rawPercentY - padPercentY) / renderedHeightPercent) * 100;

    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) {
      return null;
    }

    return { x, y };
  }

  function setStartFromNode(nodeId) {
    const node = NODES[nodeId];
    if (!node) return;
    const floorLabel = getFloorLabel(node.floor);
    const floorBtn = Array.from(document.querySelectorAll('.floor-pick-btn'))
      .find(btn => btn.dataset.floorLabel === floorLabel);
    if (floorBtn) {
      floorBtn.click();
      pulseElement(floorBtn);
    }
    const startTs = document.getElementById('start_node')?.tomselect;
    if (startTs) {
      startTs.setValue(nodeId, false);
      pulseElement(getDropdownPulseTarget(startTs));
      toast(`Start set to ${node.label}`);
    }
  }

  function addStopFromNode(nodeId) {
    const node = NODES[nodeId];
    if (!node) return;
    const stopTs = window.addStopField?.();
    if (stopTs && typeof stopTs.setValue === 'function') {
      stopTs.setValue(nodeId, false);
      pulseElement(getDropdownPulseTarget(stopTs));
      toast(`Stop added: ${node.label}`);
    }
  }

  function setDestinationFromNode(nodeId) {
    const node = NODES[nodeId];
    if (!node) return;
    const endTs = document.getElementById('end_node')?.tomselect;
    if (endTs) {
      endTs.setValue(nodeId, false);
      pulseElement(getDropdownPulseTarget(endTs));
      toast(`Destination set to ${node.label}`);
    }
  }

  function openPopupForNode(nodeMatch, clickEvent) {
    popupState = {
      nodeId: nodeMatch.id,
      floorNum: nodeMatch.data.floor,
      coords: nodeMatch.coords,
    };
    const popupLabel = document.getElementById('pin-popup-label');
    const popupMeta = document.getElementById('pin-popup-meta');
    if (popupLabel) popupLabel.textContent = nodeMatch.data.label;
    if (popupMeta) popupMeta.textContent = getFloorLabel(nodeMatch.data.floor);
    showSnapPulse(nodeMatch.data.floor, nodeMatch.coords);
    positionPopup(clickEvent.clientX, clickEvent.clientY);
  }

  function handleMapImageClick(event) {
    if (suppressNextMapClick) {
      suppressNextMapClick = false;
      return;
    }

    const state = pointerState.get(event.currentTarget);
    if (state?.moved) {
      pointerState.delete(event.currentTarget);
      return;
    }

    const floorNum = getCurrentVisibleFloor();
    const activeContainer = document.getElementById(`f${floorNum}-container`);
    if (!activeContainer || event.currentTarget !== activeContainer.querySelector('.map-image')) return;

    const coords = percentCoordsFromImageEvent(event, event.currentTarget);
    if (!coords) {
      hidePopup();
      toast('Tap closer to a room door');
      return;
    }

    const nearest = findNearestNode(coords, floorNum);
    if (!nearest || nearest.dist >= SNAP_THRESHOLD) {
      hidePopup();
      toast('Tap closer to a room door');
      return;
    }

    openPopupForNode(nearest, event);
  }

  function trackPointerStart(event) {
    pointerState.set(event.currentTarget, {
      x: event.clientX,
      y: event.clientY,
      moved: false,
    });
  }

  function trackPointerMove(event) {
    const state = pointerState.get(event.currentTarget);
    if (!state) return;
    if (Math.hypot(event.clientX - state.x, event.clientY - state.y) > 6) {
      state.moved = true;
    }
  }

  function bindPopupActions() {
    const popup = getPopup();
    if (!popup) return;
    popup.addEventListener('click', event => event.stopPropagation());

    document.getElementById('pin-popup-start')?.addEventListener('click', () => {
      if (!popupState) return;
      setStartFromNode(popupState.nodeId);
      hidePopup();
    });

    document.getElementById('pin-popup-stop')?.addEventListener('click', () => {
      if (!popupState) return;
      addStopFromNode(popupState.nodeId);
      hidePopup();
    });

    document.getElementById('pin-popup-destination')?.addEventListener('click', () => {
      if (!popupState) return;
      setDestinationFromNode(popupState.nodeId);
      hidePopup();
    });
  }

  document.addEventListener('click', event => {
    const popup = getPopup();
    if (!popup || popup.style.display === 'none') return;
    if (popup.contains(event.target)) return;
    hidePopup();
    if (event.target.closest('.map-container')) {
      suppressNextMapClick = true;
      window.setTimeout(() => { suppressNextMapClick = false; }, 0);
    }
  }, true);

  window.addEventListener('resize', hidePopup);
  window.addEventListener('scroll', hidePopup, true);

  document.addEventListener('DOMContentLoaded', () => {
    bindPopupActions();
    document.querySelectorAll('.map-container .map-image').forEach(imageEl => {
      imageEl.addEventListener('pointerdown', trackPointerStart);
      imageEl.addEventListener('pointermove', trackPointerMove);
      imageEl.addEventListener('pointercancel', () => pointerState.delete(imageEl));
      imageEl.addEventListener('click', handleMapImageClick);
      imageEl.addEventListener('dragstart', event => event.preventDefault());
    });
  });
})();

// ---------------------------------------------------------------------------
// FAQ Chatbot
// ---------------------------------------------------------------------------
let faqData = [];
const DEFAULT_FAQ_SUGGESTIONS = [
  'Where is the library?',
  'How do I get to the seminar hall?',
  'Where is the nearest restroom?',
];
window.loadFAQs = async function () {
  try { faqData = await (await fetch('/faq')).json(); } catch { faqData = []; }
};
function renderFaqSuggestions(items = DEFAULT_FAQ_SUGGESTIONS) {
  const el = document.getElementById('faq-suggestions');
  if (!el) return;
  el.innerHTML = items
    .slice(0, 3)
    .map(item => `<button type="button" class="faq-suggestion-chip">${item}</button>`)
    .join('');
}

function formatFaqResponse(text, actions = []) {
  return { text, actions };
}

function buildLocationActions(nodeId) {
  if (!NODES[nodeId]) return [];
  return [
    { label: 'Set as Start', type: 'set-start', nodeId },
    { label: 'Set as Destination', type: 'set-destination', nodeId },
  ];
}

function ensureLocationActions(payload) {
  if (!payload) return { text: '', actions: [] };
  const normalized = typeof payload === 'string'
    ? { text: payload, actions: [] }
    : { ...payload, actions: Array.isArray(payload.actions) ? [...payload.actions] : [] };

  const dedupeActions = (actions) => {
    const seen = new Set();
    return actions.filter(action => {
      if (!action) return false;
      const key = [
        action.type || '',
        action.nodeId || '',
        action.startId || '',
        action.endId || '',
        action.text || '',
        action.label || '',
      ].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  normalized.actions = dedupeActions(normalized.actions);
  const actionNodeId = normalized.nodeId
    || normalized.actions.find(action =>
      action?.nodeId && (action.type === 'set-start' || action.type === 'set-destination'))?.nodeId;
  const nodeId = actionNodeId || findNodeFromQuestion(normalized.text || '')?.id;
  if (!nodeId) return normalized;

  const retainedActions = normalized.actions.filter(action =>
    action.type !== 'set-start' && action.type !== 'set-destination');
  normalized.actions = dedupeActions([
    ...buildLocationActions(nodeId),
    ...retainedActions,
  ]);
  normalized.nodeId = nodeId;
  return normalized;
}

function matchFacility(term) {
  const candidates = ['restroom', 'lift', 'stairs', 'office', 'library'];
  return candidates.find(candidate => term.includes(candidate));
}

function detectNearestFacilityType(term) {
  if (term.includes('nearest restroom') || term.includes('nearest washroom') || term.includes('nearest toilet')) {
    return 'restroom';
  }
  if (term.includes('nearest elevator') || term.includes('nearest lift')) {
    return 'lift';
  }
  if (term.includes('nearest stairs') || term.includes('where are the stairs') || term.includes('where is the stairs')) {
    return 'stairs';
  }
  return null;
}

function parseFloorReply(input) {
  const lower = input.toLowerCase();
  if (/\b(gf|ground|ground floor|floor 0|0f)\b/.test(lower)) return 1;
  if (/\b(1f|first|first floor|1st floor|floor 1)\b/.test(lower)) return 2;
  if (/\b(2f|second|second floor|2nd floor|floor 2)\b/.test(lower)) return 3;
  if (/\b(3f|third|third floor|3rd floor|floor 3)\b/.test(lower)) return 4;
  return null;
}

function buildFloorPromptActions() {
  return [
    { label: 'GF', type: 'ask', text: 'GF' },
    { label: '1F', type: 'ask', text: '1F' },
    { label: '2F', type: 'ask', text: '2F' },
    { label: '3F', type: 'ask', text: '3F' },
  ];
}

function facilityMatchesType(data, facilityType) {
  const label = data.label.toLowerCase();
  if (facilityType === 'restroom') {
    return label.includes('restroom') || label.includes('washroom') || label.includes('toilet');
  }
  if (facilityType === 'lift') {
    return label.includes('lift') || label.includes('elevator') || data.type === 'lift';
  }
  if (facilityType === 'stairs') {
    return label.includes('stairs') || data.type === 'stairs';
  }
  return false;
}

function findNearestFacilityNode(facilityType, floorNum) {
  return Object.entries(NODES)
    .filter(([, data]) => !data.is_waypoint && facilityMatchesType(data, facilityType))
    .sort(([, a], [, b]) => {
      const floorDelta = Math.abs(a.floor - floorNum) - Math.abs(b.floor - floorNum);
      if (floorDelta !== 0) return floorDelta;
      return a.label.localeCompare(b.label);
    })[0] || null;
}

function buildNearestFacilityAnswer(facilityType, floorNum) {
  const match = findNearestFacilityNode(facilityType, floorNum);
  const facilityLabel = facilityType === 'lift' ? 'lift' : facilityType;
  if (!match) {
    return formatFaqResponse(`I couldn't find a ${facilityLabel} in the building data right now.`);
  }

  const [nodeId, node] = match;
  const landmarks = nearestLandmarks(nodeId, 2).map(item => item.label).join(', ');
  const sourceFloor = getFloorLabel(floorNum);
  const targetFloor = getFloorLabel(node.floor);
  const sameFloor = node.floor === floorNum;
  const base = sameFloor
    ? `The nearest ${facilityLabel} from ${sourceFloor} is ${node.label} on the same floor.`
    : `The nearest ${facilityLabel} from ${sourceFloor} is ${node.label} on ${targetFloor}.`;
  const landmarkText = landmarks ? ` It's near ${landmarks}.` : '';
  return formatFaqResponse(base + landmarkText, buildLocationActions(nodeId));
}

function findNodeFromQuestion(lower) {
  const cleaned = lower.replace(/[^a-z0-9 ]/g, ' ');
  let best = null;
  for (const [id, data] of Object.entries(NODES)) {
    if (data.is_waypoint) continue;
    const label = data.label.toLowerCase();
    if (cleaned.includes(label)) return { id, data };
    if (cleaned.includes(id.toLowerCase().replace(/-/g, ' '))) return { id, data };
    const words = label.split(' ').filter(word => word.length > 2);
    const score = words.reduce((sum, word) => sum + (cleaned.includes(word) ? 1 : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { id, data, score };
  }
  return best;
}

function buildNodeAnswer(nodeId, opts = {}) {
  const node = NODES[nodeId];
  if (!node) return null;
  const landmarks = nearestLandmarks(nodeId, 2).map(item => item.label).join(', ');
  const base = `${node.label} is on ${getFloorLabel(node.floor)}${node.category ? ` in ${node.category}` : ''}.`;
  const landmarkText = landmarks ? ` Nearby: ${landmarks}.` : '';
  const actions = buildLocationActions(nodeId);
  return formatFaqResponse(base + landmarkText, actions);
}

function faqMatch(input) {
  const lower = input.toLowerCase().trim();

  if (faqPendingNearest) {
    const replyFloor = parseFloorReply(lower);
    if (replyFloor) {
      const pending = faqPendingNearest;
      faqPendingNearest = null;
      return buildNearestFacilityAnswer(pending.facilityType, replyFloor);
    }
    if (!/\b(where|what|how|nearest|take me|route|help)\b/.test(lower)) {
      return formatFaqResponse(
        'Please tell me Ground Floor/GF, 1F, 2F, or 3F.',
        buildFloorPromptActions(),
      );
    }
    faqPendingNearest = null;
  }

  const nearestFacilityType = detectNearestFacilityType(lower);
  if (nearestFacilityType) {
    const explicitFloor = parseFloorReply(lower);
    if (explicitFloor) {
      return buildNearestFacilityAnswer(nearestFacilityType, explicitFloor);
    }
    faqPendingNearest = { facilityType: nearestFacilityType };
    return formatFaqResponse('Which floor are you on?', buildFloorPromptActions());
  }

  const routeMatch = lower.match(/(?:from)\s+(.+?)\s+(?:to)\s+(.+)/);
  if (routeMatch) {
    const fromNode = getNodeByLabel(routeMatch[1]);
    const toNode = getNodeByLabel(routeMatch[2]);
    if (fromNode && toNode) {
      return formatFaqResponse(
        `I found ${fromNode.data.label} and ${toNode.data.label}. I can place them into the route form for you.`,
        [
          { label: 'Use This Route', type: 'set-route', startId: fromNode.id, endId: toNode.id },
          { label: 'Set as Destination', type: 'set-destination', nodeId: toNode.id },
        ],
      );
    }
  }

  if (lower.includes('where is') || lower.includes('what floor') || lower.includes('take me to')) {
    const facility = matchFacility(lower);
    if (facility && !lower.includes('how do i get')) {
      const facilityNode = Object.entries(NODES).find(([, data]) =>
        !data.is_waypoint && data.label.toLowerCase().includes(facility)
      );
      if (facilityNode) return buildNodeAnswer(facilityNode[0], { allowStart: true });
    }
    const node = findNodeFromQuestion(lower);
    if (node) return buildNodeAnswer(node.id, { allowStart: true });
  }

  for (const faq of faqData) {
    for (const kw of faq.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        return formatFaqResponse(faq.answer);
      }
    }
  }

  const directNode = findNodeFromQuestion(lower);
  if (directNode) return buildNodeAnswer(directNode.id, { allowStart: true });

  return formatFaqResponse(
    "I can help with room locations, what floor something is on, or setting a route from one place to another.",
    [
      { label: 'Library', type: 'ask', text: 'Where is the library?' },
      { label: 'Seminar Hall', type: 'ask', text: 'How do I get to the seminar hall?' },
      { label: 'Restroom', type: 'ask', text: 'Where is the nearest restroom?' },
      { label: 'Nearest Lift', type: 'ask', text: 'Where is the nearest elevator?' },
      { label: 'Route Help', type: 'ask', text: 'How do I get from the library to the seminar hall?' },
    ],
  );
}
function getFAQElements() {
  return {
    chat: document.getElementById('faq-chat'),
    bubble: document.getElementById('faq-bubble'),
    backdrop: document.getElementById('faq-chat-backdrop'),
  };
}

function ensureFAQMount() {
  const { chat, bubble, backdrop } = getFAQElements();
  if (!chat || !bubble || !document.body) return;
  if (bubble.parentElement !== document.body) document.body.appendChild(bubble);
  if (backdrop && backdrop.parentElement !== document.body) document.body.appendChild(backdrop);
  if (chat.parentElement !== document.body) document.body.appendChild(chat);
}

function shouldShowFAQBackdrop() {
  return true;
}

function syncFAQBackdrop() {
  const { chat, backdrop } = getFAQElements();
  if (!chat || !backdrop || !chat.classList.contains('faq-chat-open')) return;
  if (shouldShowFAQBackdrop()) {
    backdrop.style.display = 'block';
    backdrop.setAttribute('aria-hidden', 'false');
    backdrop.classList.add('faq-chat-backdrop-open');
  } else {
    backdrop.classList.remove('faq-chat-backdrop-open');
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.style.display = 'none';
  }
}

function syncFAQExpandedUI() {
  const { chat } = getFAQElements();
  const expandBtn = document.getElementById('faq-expand-btn');
  const expandedOnDesktop = faqExpanded && canDockFAQ();
  if (chat) chat.classList.toggle('faq-chat-expanded', expandedOnDesktop);
  if (expandBtn) {
    expandBtn.style.display = canDockFAQ() ? 'inline-flex' : 'none';
    expandBtn.setAttribute('aria-pressed', expandedOnDesktop ? 'true' : 'false');
    expandBtn.setAttribute('aria-label', expandedOnDesktop ? 'Collapse assistant' : 'Expand assistant');
    expandBtn.setAttribute('title', expandedOnDesktop ? 'Collapse assistant' : 'Expand assistant');
    expandBtn.innerHTML = getIconSvg(expandedOnDesktop ? 'collapse' : 'expand');
  }
  syncFAQBackdrop();
}

window.toggleFAQChatExpanded = function (forceState) {
  faqExpanded = typeof forceState === 'boolean' ? forceState : !faqExpanded;
  localStorage.setItem(FAQ_EXPANDED_STORAGE_KEY, String(faqExpanded));
  syncFAQExpandedUI();
};

window.toggleFAQChat = function (forceState) {
  ensureFAQMount();
  const chat = document.getElementById('faq-chat');
  const bubble = document.getElementById('faq-bubble');
  const backdrop = document.getElementById('faq-chat-backdrop');
  if (!chat || !bubble) return;
  const currentlyOpen = chat.classList.contains('faq-chat-open');
  const shouldOpen = typeof forceState === 'boolean' ? forceState : !currentlyOpen;

  if (!shouldOpen) {
    chat.classList.remove('faq-chat-open');
    chat.setAttribute('aria-hidden', 'true');
    backdrop?.classList.remove('faq-chat-backdrop-open');
    backdrop?.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => {
      if (!chat.classList.contains('faq-chat-open')) chat.style.display = 'none';
      if (backdrop && !chat.classList.contains('faq-chat-open')) backdrop.style.display = 'none';
    }, 300);
  } else {
    chat.style.display = 'flex';
    chat.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      chat.classList.add('faq-chat-open');
      syncFAQBackdrop();
    });
  }
  bubble.classList.remove('faq-bubble-ripple');
  void bubble.offsetWidth;
  bubble.classList.add('faq-bubble-ripple');
  window.setTimeout(() => bubble.classList.remove('faq-bubble-ripple'), 520);
  bubble.classList.toggle('faq-bubble-open', shouldOpen);
  bubble.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');

  if (shouldOpen) {
    document.getElementById('faq-input')?.focus();
  }
};
window.sendFAQ = function () {
  const input = document.getElementById('faq-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  appendFAQMessage(text, 'user'); input.value = '';
  setTimeout(() => appendFAQMessage(faqMatch(text), 'bot'), 280);
};
window.applyFaqAction = function (action) {
  if (!action) return;
  if (action.type === 'ask' && action.text) {
    const input = document.getElementById('faq-input');
    if (input) {
      input.value = action.text;
      window.sendFAQ();
    }
    return;
  }
  if (action.type === 'set-start' && action.nodeId) {
    setStartFromNodeGlobal(action.nodeId);
    toast(`Start set to ${NODES[action.nodeId]?.label || 'selected room'}`);
    return;
  }
  if (action.type === 'set-destination' && action.nodeId) {
    setDestinationFromNodeGlobal(action.nodeId);
    toast(`Destination set to ${NODES[action.nodeId]?.label || 'selected room'}`);
    return;
  }
  if (action.type === 'set-route' && action.startId && action.endId) {
    setStartFromNodeGlobal(action.startId);
    setDestinationFromNodeGlobal(action.endId);
    toast(`Route prepared from ${NODES[action.startId]?.label} to ${NODES[action.endId]?.label}`);
  }
};

function appendFAQMessage(payload, sender) {
  const messages = document.getElementById('faq-messages');
  if (!messages) return;
  const div = document.createElement('div');
  div.className = `faq-msg faq-msg-${sender}`;
  if (sender === 'bot') payload = ensureLocationActions(payload);
  if (typeof payload === 'string') {
    div.textContent = payload;
  } else {
    div.textContent = payload?.text || '';
    if (sender === 'bot' && Array.isArray(payload?.actions) && payload.actions.length) {
      const row = document.createElement('div');
      row.className = 'faq-action-row';
      payload.actions.forEach((action, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'faq-action-btn';
        btn.textContent = action.label || `Action ${idx + 1}`;
        btn.addEventListener('click', () => window.applyFaqAction(action));
        row.appendChild(btn);
      });
      div.appendChild(row);
    }
  }
  messages.appendChild(div); messages.scrollTop = messages.scrollHeight;
}

document.addEventListener('DOMContentLoaded', () => {
  ensureFAQMount();
  document.getElementById('faq-chat')?.addEventListener('click', event => event.stopPropagation());
  document.getElementById('faq-suggestions')?.addEventListener('click', event => {
    const btn = event.target.closest('.faq-suggestion-chip');
    if (!btn) return;
    const input = document.getElementById('faq-input');
    if (!input) return;
    btn.classList.remove('faq-chip-pop');
    void btn.offsetWidth;
    btn.classList.add('faq-chip-pop');
    input.value = btn.textContent || '';
    window.setTimeout(() => {
      btn.classList.remove('faq-chip-pop');
      window.sendFAQ();
    }, 170);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') window.toggleFAQChat(false);
  });
  document.addEventListener('click', event => {
    const { chat, bubble } = getFAQElements();
    if (!chat || !bubble || !chat.classList.contains('faq-chat-open')) return;
    if (chat.contains(event.target) || bubble.contains(event.target)) return;
    window.toggleFAQChat(false);
  });
});

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
      iconWrap.dataset.icon = type;
      iconWrap.innerHTML = getIconSvg(type);
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
  renderPDRMarkers();
  requestAnimationFrame(() => fitNavSVGToImage());
}

function syncNavFloor(floorNum) {
  document.querySelectorAll('.floor-tabs').forEach(group => {
    group.style.setProperty('--active-floor-index', Math.max(0, Number(floorNum) - 1));
  });
  document.querySelectorAll('.floor-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.floor == floorNum));
  for (let i = 1; i <= 4; i++) { const el = document.getElementById(`nav-f${i}`); if (el) el.style.display = (i == floorNum) ? 'block' : 'none'; }
  renderPDRMarkers();
  requestAnimationFrame(() => fitNavSVGToImage());
}

function syncMobileCheckpointBtn() {
  const btn = document.getElementById('mobile-checkpoint-btn');
  if (!btn) return;
  if (!checkpoints || checkpoints.length === 0) { btn.style.display = 'none'; return; }
  const isLast = currentCheckpointIdx >= checkpoints.length - 1;
  btn.innerHTML = `<span class="nav-fab-btn-label">${isLast ? 'FINISH' : 'NEXT'}</span>`;
  btn.className = isLast ? 'nav-fab-btn finish-btn' : 'nav-fab-btn';
  btn.setAttribute('aria-label', isLast ? 'Finish navigation' : 'Next checkpoint');
  btn.onclick = window.onCheckpointReached;
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
    startNode, endNode, stops: window.stopLabels ? window.stopLabels.map(s => s.id) : [],
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
  // FIX 1b: update PDR path projection to use the alternate route
  if (pdrEngine) pdrEngine.setPath(toPathNodes(altPath));

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

    svg.querySelectorAll('.pdr-user-marker-scale')
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

  window.resetMapZoom = function (containerId) {
    const pz = panzoomInstances[containerId];
    if (pz) pz.reset({ animate: true });
  };

  const _origResetToForm = window.resetToForm || function () { };
  window.resetToForm = function () {
    _origResetToForm();
    for (let f = 1; f <= 4; f++) {
      const pzDesktop = panzoomInstances[`f${f}-container`];
      if (pzDesktop) pzDesktop.reset({ animate: false });
      const pzMobile = panzoomInstances[`nav-f${f}`];
      if (pzMobile) pzMobile.reset({ animate: false });
    }
  };

  // Re-scale immediately when route is drawn so it doesn't wait for zoom interaction
  const _origDrawPath = window.drawPath || function () { };
  window.drawPath = function (...args) {
    _origDrawPath(...args);
    for (let f = 1; f <= 4; f++) {
      rescaleSVGStrokes(`f${f}-container`, `svg-f${f}`);
      rescaleSVGStrokes(`nav-f${f}`, `svg-nav-f${f}`);
    }
    renderPDRMarkers();
    for (let f = 1; f <= 4; f++) {
      rescaleSVGStrokes(`f${f}-container`, `svg-f${f}`);
      rescaleSVGStrokes(`nav-f${f}`, `svg-nav-f${f}`);
    }
  };
})();
