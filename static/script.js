document.addEventListener('DOMContentLoaded', () => {
    // --- Custom Dropdown Logic ---
    const selectWrappers = document.querySelectorAll('.custom-select-wrapper');

    selectWrappers.forEach(wrapper => {
        const trigger = wrapper.querySelector('.custom-select-trigger');
        const options = wrapper.querySelectorAll('.custom-option');
        const hiddenInput = wrapper.querySelector('input[type="hidden"]');
        const triggerText = trigger.querySelector('span');

        // Toggle dropdown
        trigger.addEventListener('click', (e) => {
            selectWrappers.forEach(otherWrapper => {
                if(otherWrapper !== wrapper) otherWrapper.classList.remove('open');
            });
            wrapper.classList.toggle('open');
            e.stopPropagation();
        });

        // Handle option selection
        options.forEach(option => {
            option.addEventListener('click', (e) => {
                options.forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
                
                // Update UI text
                triggerText.textContent = option.textContent;
                // Update Hidden Input for Flask Form
                hiddenInput.value = option.getAttribute('data-value');
                
                trigger.style.color = "#111827"; 
                trigger.style.fontWeight = "600";

                wrapper.classList.remove('open');
                e.stopPropagation();
            });
        });
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', () => {
        selectWrappers.forEach(wrapper => wrapper.classList.remove('open'));
    });

    // --- Draw Path if Data Exists (From Flask) ---
    if (window.pathData && window.pathData.length > 0) {
        drawPath(window.pathData);
    }
});

/**
 * Draws the path on the SVG overlays
 */
function drawPath(path) {
    let pointsF1 = "";
    let pointsF2 = "";
    let hasF1 = false;
    let hasF2 = false;

    const startNode = path[0];
    const endNode = path[path.length - 1];

    // Loop through coordinates to build SVG point strings
    for (let i = 0; i < path.length; i++) {
        const node = path[i];
        // Coordinate mapping: X% , Y%
        const coords = node.x + "%," + node.y + "%";

        if (node.floor === 1) {
            pointsF1 += coords + " ";
            hasF1 = true;
        } else if (node.floor === 2) {
            pointsF2 += coords + " ";
            hasF2 = true;
        }
    }

    // Render Floor 1 if needed
    if (hasF1) {
        document.getElementById('f1-container').style.display = 'block';
        renderSVG('svg-f1', pointsF1, startNode.floor === 1 ? startNode : null, endNode.floor === 1 ? endNode : null);
    }

    // Render Floor 2 if needed
    if (hasF2) {
        document.getElementById('f2-container').style.display = 'block';
        renderSVG('svg-f2', pointsF2, startNode.floor === 2 ? startNode : null, endNode.floor === 2 ? endNode : null);
    }
}

/**
 * Renders SVG elements
 */
function renderSVG(svgId, pointsStr, startObj, endObj) {
    const svg = document.getElementById(svgId);
    
    // Clear previous drawing if any
    svg.innerHTML = '';

    // 1. Draw the Path Line
    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("points", pointsStr);
    polyline.setAttribute("style", "fill:none;stroke:#2563eb;stroke-width:4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:10,5;opacity:0.9");
    
    // Animate the line drawing
    const length = 1000; // Approximate length for animation
    polyline.style.strokeDasharray = "10"; 
    
    svg.appendChild(polyline);

    // 2. Draw Start Circle (Green)
    if (startObj) {
        const circleStart = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circleStart.setAttribute("cx", startObj.x + "%");
        circleStart.setAttribute("cy", startObj.y + "%");
        circleStart.setAttribute("r", "8");
        circleStart.setAttribute("fill", "#10b981");
        circleStart.setAttribute("stroke", "#ffffff");
        circleStart.setAttribute("stroke-width", "2");
        svg.appendChild(circleStart);
    }

    // 3. Draw End Circle (Red)
    if (endObj) {
        const circleEnd = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circleEnd.setAttribute("cx", endObj.x + "%");
        circleEnd.setAttribute("cy", endObj.y + "%");
        circleEnd.setAttribute("r", "8");
        circleEnd.setAttribute("fill", "#ef4444");
        circleEnd.setAttribute("stroke", "#ffffff");
        circleEnd.setAttribute("stroke-width", "2");
        svg.appendChild(circleEnd);
    }
}