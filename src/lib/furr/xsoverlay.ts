/**
 * XSOverlay-Client (nicht Hub): SendNotification an ws://127.0.0.1:42070/?client=FurrBox.
 * Default aus (Settings-Toggle). Fail-silent wenn XSOverlay nicht läuft.
 * Idle: Connect erst beim ersten Alert, Disconnect nach Idle.
 */
const WS_URL = "ws://127.0.0.1:42070/?client=FurrBox";
const PREF_KEY = "furrbox-xsoverlay-alerts";
const IDLE_CLOSE_MS = 45_000;

export type XsoNotification = {
  title: string;
  content: string;
  timeout?: number;
  /** 0–1; Docs default ~0.7 */
  opacity?: number;
  volume?: number;
  audioPath?: string;
};

let socket: WebSocket | null = null;
let idleTimer: number | null = null;
let connectPromise: Promise<WebSocket | null> | null = null;

export function isXsoAlertsEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
}

export function setXsoAlertsEnabled(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function clearIdle() {
  if (idleTimer != null) {
    window.clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function scheduleIdleClose() {
  clearIdle();
  idleTimer = window.setTimeout(() => {
    idleTimer = null;
    try {
      socket?.close();
    } catch {
      /* ignore */
    }
    socket = null;
    connectPromise = null;
  }, IDLE_CLOSE_MS);
}

function connect(): Promise<WebSocket | null> {
  if (socket?.readyState === WebSocket.OPEN) return Promise.resolve(socket);
  if (connectPromise) return connectPromise;
  connectPromise = new Promise((resolve) => {
    let settled = false;
    const done = (ws: WebSocket | null) => {
      if (settled) return;
      settled = true;
      resolve(ws);
    };
    try {
      const ws = new WebSocket(WS_URL);
      const failTimer = window.setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        if (socket === ws) socket = null;
        connectPromise = null;
        done(null);
      }, 1_200);
      ws.onopen = () => {
        window.clearTimeout(failTimer);
        socket = ws;
        done(ws);
      };
      ws.onerror = () => {
        window.clearTimeout(failTimer);
        connectPromise = null;
        if (socket === ws) socket = null;
        done(null);
      };
      ws.onclose = () => {
        window.clearTimeout(failTimer);
        if (socket === ws) socket = null;
        connectPromise = null;
      };
    } catch {
      connectPromise = null;
      done(null);
    }
  });
  return connectPromise;
}

/** Sendet eine Notification an XSOverlay. Nie werfen – immer fail-silent. */
export async function sendXsoNotification(n: XsoNotification): Promise<boolean> {
  if (!isXsoAlertsEnabled()) return false;
  try {
    const ws = await connect();
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const payload = {
      type: "SendNotification",
      title: String(n.title ?? "").slice(0, 120),
      content: String(n.content ?? "").slice(0, 400),
      timeout: n.timeout ?? 4,
      opacity: n.opacity ?? 0.85,
      volume: n.volume ?? 0.5,
      audioPath: n.audioPath ?? "",
      sourceApp: "FurrBox",
    };
    ws.send(JSON.stringify(payload));
    scheduleIdleClose();
    return true;
  } catch {
    return false;
  }
}
