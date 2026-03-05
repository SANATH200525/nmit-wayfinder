document.addEventListener('DOMContentLoaded', () => {
    // 1. Init Base Dropdowns (FIX APPLIED HERE)
    const selectConfig = { 
        create: false, 
        sortField: { field: "text", direction: "asc" },
        dropdownParent: 'body' // <--- This forces the menu to float above everything
    };
    new TomSelect("#start_node", selectConfig);
    new TomSelect("#end_node", selectConfig);

    // ... (rest of DOMContentLoaded stays the same)
});

// --- Dynamic Stops Logic ---
function addStopField() {
    const container = document.getElementById('stops-container');
    const template = document.getElementById('stop-template');
    const clone = template.content.cloneNode(true);
    container.appendChild(clone);
    
    // Init TomSelect on the newly added select element (FIX APPLIED HERE)
    const newSelect = container.lastElementChild.querySelector('.stop-select');
    new TomSelect(newSelect, { 
        create: false, 
        sortField: { field: "text", direction: "asc" },
        dropdownParent: 'body' // <--- Fix for dynamically added stops
    });
}

// --- Dynamic Stops Logic ---
function addStopField() {
    const container = document.getElementById('stops-container');
    const template = document.getElementById('stop-template');
    const clone = template.content.cloneNode(true);
    container.appendChild(clone);
    
    // Init TomSelect on the newly added select element
    const newSelect = container.lastElementChild.querySelector('.stop-select');
    new TomSelect(newSelect, { create: false, sortField: { field: "text", direction: "asc" } });
}

// --- Tab Logic (4 Floors) ---
function switchFloor(floorNum) {
    document.querySelectorAll('.floor-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.floor == floorNum));
    for(let i=1; i<=4; i++){
        const container = document.getElementById(`f${i}-container`);
        if(container) container.style.display = (i == floorNum) ? 'block' : 'none';
    }
}

// --- Orthogonal Algorithm ---
function makeOrthogonalPath(path) {
    let ortho = [];
    if (!path || path.length === 0) return ortho;
    ortho.push(path[0]);
    for (let i = 1; i < path.length; i++) {
        let prev = ortho[ortho.length - 1];
        let curr = path[i];
        if (prev.floor === curr.floor && prev.x !== curr.x && prev.y !== curr.y) {
            ortho.push({ id: curr.id + '-elbow', x: curr.x, y: prev.y, floor: curr.floor });
        }
        ortho.push(curr);
    }
    return ortho;
}

// --- Path Drawing & 3D Markers ---
function drawPath(path) {
    let floorPaths = { 1: [], 2: [], 3: [], 4: [] };
    path.forEach(node => floorPaths[node.floor].push(node));

    const globalStart = path[0];
    const globalEnd = path[path.length - 1];
    
    // Identify intermediate stops (waypoints that are not elbows, start, or end)
    const stops = path.filter(p => p.id !== globalStart.id && p.id !== globalEnd.id && !p.id.includes('elbow') && !window.allNodes[p.id]?.is_waypoint);

    for(let i=1; i<=4; i++){
        if (floorPaths[i].length > 0) {
            renderSVG(`svg-f${i}`, floorPaths[i], globalStart, globalEnd, stops);
        }
    }
}

function renderSVG(svgId, points, globalStart, globalEnd, stops) {
    const svg = document.getElementById(svgId);
    if(!svg) return;
    svg.innerHTML = ''; 

    const formattedPoints = points.map(p => `${p.x}%,${p.y}%`).join(' ');
    
    // Base line (Animates Drawing)
    const bgLine = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    bgLine.setAttribute("points", formattedPoints);
    bgLine.setAttribute("class", "path-line-bg");
    svg.appendChild(bgLine);

    // Flowing line (Dashes)
    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("points", formattedPoints);
    polyline.setAttribute("class", "path-line");
    svg.appendChild(polyline);

    // Draw Stops
    stops.forEach(stop => {
        if(points.some(p => p.id === stop.id)) draw3DPin(svg, stop.x, stop.y, "marker-stop");
    });

    // Draw Start & End
    if (points.some(p => p.id === globalStart.id)) draw3DPin(svg, globalStart.x, globalStart.y, "marker-start");
    if (points.some(p => p.id === globalEnd.id)) draw3DPin(svg, globalEnd.x, globalEnd.y, "marker-end");
}

function draw3DPin(svg, x, y, className) {
    // Custom Map Pin SVG Shape
    const pin = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pin.setAttribute("d", "M0,0 C-6,-8 -12,-15 -12,-22 C-12,-29 -6,-34 0,-34 C6,-34 12,-29 12,-22 C12,-15 6,-8 0,0 Z");
    pin.setAttribute("class", `marker-3d ${className}`);
    
    // Wrapper group to position the pin exactly on the coordinate
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    // Translate converts the % based coordinate to the element
    g.style.transform = `translate(${x}%, ${y}%)`;
    g.appendChild(pin);
    svg.appendChild(g);
}

// --- Map Zoom & Pan Logic ---
let scale = 1, panX = 0, panY = 0;
let isDragging = false, startX, startY;

function updateMapTransform() {
    document.querySelectorAll('.map-container').forEach(el => {
        el.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    });
}

function zoomMap(amount) {
    scale += amount;
    if (scale < 0.5) scale = 0.5;
    if (scale > 4) scale = 4;
    updateMapTransform();
}

function resetZoom() {
    scale = 1; panX = 0; panY = 0;
    updateMapTransform();
}

function initMapPanZoom() {
    const viewport = document.getElementById('map-viewport');
    
    viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        zoomMap(e.deltaY < 0 ? 0.1 : -0.1);
    });

    viewport.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX - panX;
        startY = e.clientY - panY;
    });

    viewport.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        panX = e.clientX - startX;
        panY = e.clientY - startY;
        updateMapTransform();
    });

    viewport.addEventListener('mouseup', () => isDragging = false);
    viewport.addEventListener('mouseleave', () => isDragging = false);
}

// --- Simulation Logic ---
async function simulateWalking(path) {
    if (path.length === 0) return;
    let currentFloor = path[0].floor;
    switchFloor(currentFloor);

    let pointer = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    pointer.setAttribute("r", "6");
    pointer.setAttribute("class", "user-pointer");
    document.getElementById(`svg-f${currentFloor}`).appendChild(pointer);
    pointer.setAttribute("cx", path[0].x + "%");
    pointer.setAttribute("cy", path[0].y + "%");

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
            pointer.setAttribute("cx", nextNode.x + "%");
            pointer.setAttribute("cy", nextNode.y + "%");
            void pointer.offsetWidth; 
            await sleep(500);
        } else {
            let dist = Math.sqrt(Math.pow(nextNode.x - prevNode.x, 2) + Math.pow(nextNode.y - prevNode.y, 2));
            let duration = dist * 25; 
            
            pointer.style.transition = `cx ${duration}ms linear, cy ${duration}ms linear`;
            pointer.setAttribute("cx", nextNode.x + "%");
            pointer.setAttribute("cy", nextNode.y + "%");
            await sleep(duration);
        }
    }
}