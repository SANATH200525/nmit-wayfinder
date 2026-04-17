/**
 * metrics.js — Session analytics. Fire-and-forget POSTs.
 * Uses IndexedDB to queue data when offline; Background Sync flushes it.
 * Owned by: Person D (Backend/API)
 */

import { openOfflineDB } from './db-helper.js';

// ---------------------------------------------------------------------------
// Queue a session payload into IndexedDB for offline sync
// ---------------------------------------------------------------------------
async function queueSession(payload) {
  try {
    const db = await openOfflineDB();
    await db.add('pending-sessions', { payload, ts: Date.now() });
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      const reg = await navigator.serviceWorker.ready;
      if (reg.sync) await reg.sync.register('sync-sessions');
    }
  } catch (err) {
    console.warn('[metrics] Failed to queue session:', err);
  }
}

// ---------------------------------------------------------------------------
// Queue a feedback payload into IndexedDB for offline sync
// ---------------------------------------------------------------------------
export async function queueFeedback(payload) {
  try {
    const db = await openOfflineDB();
    await db.add('pending-feedback', { payload, ts: Date.now() });
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      const reg = await navigator.serviceWorker.ready;
      if (reg.sync) await reg.sync.register('sync-feedback');
    }
  } catch (err) {
    console.warn('[metrics] Failed to queue feedback:', err);
  }
}

// ---------------------------------------------------------------------------
// startSession — POST /session/start in the background
// ---------------------------------------------------------------------------
export async function startSession({ sessionId, startNode, endNode, mobility, path }) {
  const distanceM = computePathDistance(path);
  const payload = {
    session_id: sessionId,
    start_node: startNode,
    end_node: endNode,
    mobility,
    planned_path: path.map(p => p.id),
    planned_distance_m: distanceM,
  };
  
  try {
    const res = await fetch('/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    // Offline: store in IndexedDB for background sync
    await queueSession(payload);
  }
}

// ---------------------------------------------------------------------------
// recordCheckpoint — POST /session/checkpoint in the background
// ---------------------------------------------------------------------------
export async function recordCheckpoint({ sessionId, checkpointIndex, checkpointNodeId }) {
  const payload = {
    session_id: sessionId,
    checkpoint_index: checkpointIndex,
    checkpoint_node_id: checkpointNodeId,
    user_confirmed: true
  };
  try {
    await fetch('/session/checkpoint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    /* best-effort — checkpoints are low priority, no offline queue needed */
  }
}

function computePathDistance(path) {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i-1].x;
    const dy = path[i].y - path[i-1].y;
    total += Math.sqrt(dx*dx + dy*dy) * 0.5; // COORD_TO_METERS = 0.5
  }
  return Math.round(total);
}
