/**
 * SSF EventStore Hub - Interactive Session Inactivity Monitor
 * Bi-directional UI-Server interaction for 5-minute session idle timeout.
 */
(function () {
  'use strict';

  // Read server-injected configuration or defaults
  const config = window.__SESSION_CONFIG__ || {
    sessionIdleTimeoutMinutes: 5,
    idleTimeoutMs: 5 * 60 * 1000,
    warningCountdownSeconds: 30,
    heartbeatIntervalSeconds: 30,
    csrfToken: ''
  };

  const IDLE_TIMEOUT_MS = config.idleTimeoutMs || (5 * 60 * 1000);
  const WARNING_THRESHOLD_MS = (config.warningCountdownSeconds || 30) * 1000;
  const HEARTBEAT_INTERVAL_MS = (config.heartbeatIntervalSeconds || 30) * 1000;
  const CSRF_TOKEN = config.csrfToken || document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';

  let lastActivity = Date.now();
  let lastHeartbeat = Date.now();
  let isWarningVisible = false;
  let isTerminated = false;
  let timerInterval = null;

  // Sync activity with localStorage for multi-tab consistency
  function broadcastActivity(timestamp) {
    try {
      localStorage.setItem('ssf_session_last_activity', String(timestamp));
    } catch (e) {}
  }

  // Handle active user interaction (throttled)
  function recordUserActivity(explicit) {
    if (isTerminated) return;

    const now = Date.now();
    lastActivity = now;
    broadcastActivity(now);

    // If warning modal is open and user explicitly interacted (clicked or button), hide modal
    if (isWarningVisible && explicit) {
      hideWarningModal();
    }

    // Throttled heartbeat to sync activity with server
    if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS || explicit) {
      sendHeartbeat();
    }
  }

  // Send heartbeat to server to refresh session.lastActivity
  async function sendHeartbeat() {
    lastHeartbeat = Date.now();
    try {
      const res = await fetch('/api/session/heartbeat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': CSRF_TOKEN
        }
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.expired) {
          triggerTimeoutRedirect();
        }
      }
    } catch (err) {
      console.warn('[SessionMonitor] Heartbeat ping notice:', err.message);
    }
  }

  // Notify server of session timeout and redirect to login
  async function triggerTimeoutRedirect() {
    if (isTerminated) return;
    isTerminated = true;
    clearInterval(timerInterval);

    try {
      await fetch('/api/session/timeout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': CSRF_TOKEN
        }
      });
    } catch (e) {}

    window.location.href = '/login?expired=1';
  }

  // Display the warning modal with live ticking countdown
  function showWarningModal(remainingSeconds) {
    if (isWarningVisible) {
      updateCountdownDisplay(remainingSeconds);
      return;
    }

    isWarningVisible = true;
    let modal = document.getElementById('session-inactivity-modal');
    if (modal) {
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
      updateCountdownDisplay(remainingSeconds);
    }
  }

  // Hide warning modal
  function hideWarningModal() {
    isWarningVisible = false;
    const modal = document.getElementById('session-inactivity-modal');
    if (modal) {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }
  }

  // Update countdown display in the modal
  function updateCountdownDisplay(seconds) {
    const el = document.getElementById('session-countdown-seconds');
    if (el) {
      el.textContent = Math.max(0, Math.ceil(seconds));
    }
  }

  // Check remaining time against server state
  async function syncWithServerStatus() {
    try {
      const res = await fetch('/api/session/status');
      if (res.ok) {
        const data = await res.json();
        if (data.expired || !data.authenticated) {
          triggerTimeoutRedirect();
        } else if (typeof data.remainingMs === 'number') {
          // Sync client timer with server's authoritative remaining time
          lastActivity = Date.now() - (IDLE_TIMEOUT_MS - data.remainingMs);
        }
      }
    } catch (e) {}
  }

  // Periodic timer evaluation (ticks every second)
  function evaluateInactivity() {
    if (isTerminated) return;

    const now = Date.now();
    const idleElapsed = now - lastActivity;
    const remainingMs = Math.max(0, IDLE_TIMEOUT_MS - idleElapsed);
    const remainingSeconds = remainingMs / 1000;

    if (remainingMs <= 0) {
      // 5-minute timeout reached: log out immediately
      triggerTimeoutRedirect();
    } else if (remainingMs <= WARNING_THRESHOLD_MS) {
      // Enter warning state
      showWarningModal(remainingSeconds);
    } else if (isWarningVisible) {
      hideWarningModal();
    }
  }

  // Initialize event listeners and interactive modal handlers
  function init() {
    // Listen to user interaction signals
    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    let debounceTimer = null;

    activityEvents.forEach((eventType) => {
      window.addEventListener(eventType, () => {
        if (!debounceTimer) {
          debounceTimer = setTimeout(() => {
            debounceTimer = null;
            recordUserActivity(false);
          }, 300);
        }
      }, { passive: true });
    });

    // Multi-tab storage sync
    window.addEventListener('storage', (e) => {
      if (e.key === 'ssf_session_last_activity' && e.newValue) {
        const ts = Number(e.newValue);
        if (!isNaN(ts) && ts > lastActivity) {
          lastActivity = ts;
          if (isWarningVisible) {
            hideWarningModal();
          }
        }
      }
    });

    // Sync on tab visibility change
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        syncWithServerStatus();
      }
    });

    // Wire up Modal Interactive Controls
    const stayBtn = document.getElementById('session-stay-logged-btn');
    if (stayBtn) {
      stayBtn.addEventListener('click', (e) => {
        e.preventDefault();
        recordUserActivity(true);
        hideWarningModal();
      });
    }

    const logoutBtn = document.getElementById('session-logout-now-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        triggerTimeoutRedirect();
      });
    }

    // Initial server state verification
    syncWithServerStatus();

    // Start 1-second interval timer
    timerInterval = setInterval(evaluateInactivity, 1000);
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
