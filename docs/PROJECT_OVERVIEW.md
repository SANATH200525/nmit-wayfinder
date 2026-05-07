# Project Overview

## What the Project Does
NMIT Wayfinder is an intelligent indoor navigation Progressive Web App (PWA) specifically designed for the NITTE School of Management (NMIT) in Bangalore. It helps users navigate across 4 floors (Ground, First, Second, Third) using a visual path overlay on floor plan images.

## Main Goals
- Provide seamless turn-by-turn indoor navigation.
- Ensure the application works offline through PWA caching and service workers.
- Track user movement continuously via Pedestrian Dead Reckoning (PDR) using device sensors.
- Continually improve routing accuracy by using user feedback to adapt edge weights between graph nodes.

## Core Features
- **Offline-First PWA:** Uses Service Workers to cache floor plans and graph data.
- **Bidirectional A* Pathfinding:** Computes shortest paths directly in the browser.
- **Pedestrian Dead Reckoning (PDR):** Live motion tracking using the device compass and accelerometer.
- **Adaptive Edge Weights:** Modifies route costs dynamically based on 1-5 star user feedback.
- **FAQ Chatbot:** A simple search/chatbot system backed by admin-managed Q&A pairs.
- **Accessibility:** Wheelchair/Elevator-only routing mode.

## Tech Stack
- **Backend:** FastAPI, Python, SQLite
- **Frontend:** Vanilla JS, Jinja2 Templates, HTML/CSS, Tailwind (inferred/CSS)
- **Database:** SQLite (WAL mode enabled)

## High-Level Architecture
The application runs entirely in the browser for its core navigation tasks. The backend acts as an API and synchronization server.
- **Frontend App Shell:** Jinja2 serves the base HTML.
- **Client-Side Routing:** The browser fetches the `nodes.py` and `edges.py` data once, and performs all A* routing offline.
- **Sensor Integration:** `pdr.js` captures device orientation and acceleration to estimate steps.
- **Backend Sync:** Background sync sends route sessions, PDR observations, and user feedback back to the FastAPI server for persistent storage and analytics.
- **Admin Dashboard:** A protected `/admin` route allows for managing FAQs, edge weights, and viewing telemetry.

## Entry Points
- **User Interface:** `/` (Serves `index.html`)
- **Admin Interface:** `/admin` (Serves `admin.html`)
- **App Core:** `backend/app.py`
