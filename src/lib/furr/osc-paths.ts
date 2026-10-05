/**
 * OSC / OSCQuery – Entscheidungstabelle & priorisierte Pfade.
 * Kein Face-Tracking-Pipeline. Binary-Blob-Adresse NICHT geraten.
 */

export type OscSurface = "electron-local" | "server" | "none";

export type OscPathDecision = {
  path: string;
  purpose: string;
  surface: OscSurface;
  priority: "P0" | "P1" | "P2";
  notes: string;
};

/** Priorisierte OSC-Pfade für FurrBox (Moderation/Companion, nicht Avatar-Driver). */
export const OSC_PATH_PRIORITY: OscPathDecision[] = [
  {
    path: "/chatbox/Input",
    purpose: "Staff-Hinweise / Chatbox-Text in VRChat",
    surface: "electron-local",
    priority: "P0",
    notes: "Bereits Desktop/VR-nah; Server nur Job-Trigger (chatbox_hint).",
  },
  {
    path: "/avatar/parameters/hmdBattery",
    purpose: "Headset-Akku Status (Anzeige)",
    surface: "electron-local",
    priority: "P1",
    notes: "Nur lesen wenn VRChat OSC enabled; Idle: connect on demand.",
  },
  {
    path: "OSCQuery host discovery",
    purpose: "Erkennen: VRChat läuft + OSC an",
    surface: "electron-local",
    priority: "P1",
    notes: "Spike gegen laufendes VRChat; Server speichert nur Ergebnis-Flag optional.",
  },
  {
    path: "Face-Tracking binary blob (Unified Expressions)",
    purpose: "Native Face Tracking OSC (Dev Update 24.09.2026)",
    surface: "none",
    priority: "P2",
    notes: "Adresse/Schema UNKLAR – nicht implementieren bis Docs feststehen. Kein Raten.",
  },
];

export const OSC_SURFACE_TABLE = [
  {
    concern: "Chatbox senden",
    electron: "Ja – direkter OSC UDP an 127.0.0.1:9000",
    server: "Nur Auftrag (Bridge-Job show-chatbox), kein UDP vom Server",
  },
  {
    concern: "OSCQuery Discovery",
    electron: "Ja – lokal mDNS/HTTP gegen VRChat",
    server: "Nein – kein LAN zum User-PC von Vercel",
  },
  {
    concern: "Face Tracking Blob",
    electron: "Später read-only Badge, wenn Schema öffentlich",
    server: "Nie – Privacy + Bandbreite + unklare Adresse",
  },
  {
    concern: "Alert → XSOverlay",
    electron: "Ja – WS Client Port 42070 (Desktop)",
    server: "Nein – localhost only",
  },
] as const;

export type OscQuerySpikeResult = {
  ranAt: string;
  vrchatProcess: boolean;
  oscPorts: { "9000": boolean; "9001": boolean };
  hostsFound: string[];
  endpointsLogged: string[];
  faceTrackingAddress: "unknown";
  note: string;
};

/** Stub: echtes Spike nur wenn VRChat lokal läuft (Desktop-Agent / manuell). */
export function oscQuerySpikePlaceholder(vrchatRunning: boolean): OscQuerySpikeResult {
  return {
    ranAt: new Date().toISOString(),
    vrchatProcess: vrchatRunning,
    oscPorts: { "9000": false, "9001": false },
    hostsFound: [],
    endpointsLogged: [],
    faceTrackingAddress: "unknown",
    note: vrchatRunning
      ? "Prozess gesehen – bitte lokale OSCQuery-Lib gegen Hosts listen."
      : "VRChat nicht laufend / OSC-Ports zu – Spike übersprungen, Adresse Face-Tracking weiter unklar.",
  };
}
