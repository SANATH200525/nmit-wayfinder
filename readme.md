# NMIT Wayfinder 

An intelligent indoor navigation system designed to help users navigate complex multi-storey buildings. This project uses the **A* (A-Star) Pathfinding Algorithm** to calculate the shortest path between rooms and provides both **visual map overlays** and **natural text instructions**.

##  Features

* **Optimal Pathfinding:** Uses the A* algorithm with a Euclidean distance heuristic to find the quickest route.
* **Multi-Storey Navigation:** intelligently handles floor transitions, guiding users to elevators or stairs when moving between levels.
* **Visual Guidance:** Draws a dynamic SVG path overlay on top of floor plan images.
* **Natural Language Instructions:** Generates human-friendly directions (e.g., *"Turn left at the corridor,"* *"Take the stairs up to Floor 2"*).
* **Responsive UI:** Mobile-first design suitable for use on smartphones while walking.

## Project Structure

Ensure your project directory looks exactly like this before running:

```text
/IndoorNavigation
│
├── app.py                # Main application logic (Flask & A* Algorithm)
├── README.md             # Project documentation
│
├── /static
│   ├── floor1.png        # Floor 1 map image
│   └── floor2.png        # Floor 2 map image
│
└── /templates
    └── index.html        # Frontend user interface