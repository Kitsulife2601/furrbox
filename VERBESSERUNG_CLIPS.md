# Verbesserung Clips – Beweisaufnahme für FurrBox Desktop

Stand: 2026-10-05 (Europe/Berlin)

## Ziel

Eigenes **Clip-Programm** in der Electron-Desktop-App: bei Votekick, Hotkey oder manuell kurze Beweisclips speichern – im Leerlauf **fast keine Last** (Recorder komplett abgebaut). **Kein automatischer Upload**; Anlegen als Evidence nur nach explizitem Klick.

## Architektur

- **Ringpuffer / On-Demand** in `desktop/clips.cjs` (Main-Prozess)
- Versteckte Recorder-Seite `desktop/clips-recorder.html` + Preload (MediaRecorder + `desktopCapturer`)
- Zentrale API: **`requestClip({ source, reason, preSeconds, postSeconds, meta })`**
- IPC `furrbox:clips-*` (trusted Main-/VR-WebContents), Preload `window.furrbox.clips`
- Web ohne Desktop: Feature ausgeblendet (`hasDesktopClips()`)
- Speicherung: **`%APPDATA%/FurrBox/clips/`** (Electron `userData/clips`) – WebM + Incident-JSON-Sidecar

### Modi (`clips.mode`)

| Modus | Verhalten | Tradeoff |
|-------|-----------|----------|
| **`instanz`** (Standard) | Solange VRChat-Instanz aktiv: niedriger fps-Ringpuffer | Echter Pre-Buffer, etwas GPU/CPU in der Instanz |
| **`nurTrigger`** | Pipeline schläft; startet erst bei Vote-Arm / Hotkey / Mark | Minimaler Idle-Verbrauch, kaum/keine Vorgeschichte vor dem Trigger |

Idle (keine Instanz / deaktiviert): Recorder-Fenster **zerstört**, keine Capturer-Session.

## Clip-on-Demand & Trigger

Quellen: `desktop` | `vr` | `hotkey` | `votekick` | `mark` | (`bot` vorbereitet, siehe unten)

- **Votekick:** bei Vote-Start Puffer scharf; Export bei Ergebniszeile oder Timeout; Option `keepOnFailedVote` (Standard: behalten)
- **Hotkey:** `Strg+Umschalt+C` → `requestClip` (registriert in `app.whenReady`, freigegeben via `globalShortcut.unregisterAll()` in `before-quit`)
- **Mark In/Out:** `Strg+Umschalt+M` bzw. UI-Button
- Toast **„Beweis bereit“** – Klick öffnet Evidence mit Draft (kein Auto-Upload)

## Incident-Sidecar (JSON neben .webm)

Schema `furrbox.clip.incident.v1` u. a.:

- `timestamp` (ISO), `trigger.source` / `reason`
- **`caseId`: null** bis angehängt; danach gesetzt
- `evidence: { caseId, auditId, casePath, attachedAt }`
- VRChat: worldName, location, players, Vote-Ziel/Initiator/Ergebnis
- Clip: Größe, Dauer-Schätzung, **SHA-256**
- App-Version, Modus/Quelle

### Attach an Evidence

1. UI „Als Beweis anlegen“ / `attachClipToCase(clipId, "new"|caseId)` (Renderer, Session-Auth)
2. Bestehender Flow: `saveEvidenceCase` + ggf. `uploadToBot`
3. IPC **`furrbox:clips-attach-to-case`** Phase `complete` schreibt `caseId` (+ auditId/casePath) zurück in Sidecar

## Bot / Netzwerk

Der Discord-Bot spricht nur mit dem **Server-Bridge** (`/api/bridge/*`, Token), **nicht** direkt mit dem Desktop. Es gibt **keinen neuen offenen Port** auf dem PC.

**Hook-Idee für später:** Bridge-Job-Typ `clip-request` → Desktop/UI pollt wie andere Jobs und ruft lokal `requestClip({ source:'bot', … })` auf. Bis dahin: Trigger nur IPC/Hotkey/Votekick/UI.

## Dateien

### Neu

- `desktop/clips.cjs`
- `desktop/clips-recorder.html`
- `desktop/clips-recorder-preload.cjs`
- `src/lib/furr/clips-client.ts`
- `src/lib/furr/clip-draft.ts`
- `src/components/furr/ClipSettings.tsx`
- `VERBESSERUNG_CLIPS.md`

### Geändert (chirurgisch)

- `desktop/main.cjs`, `desktop/preload.cjs`, `desktop/package.json` (Build-Files)
- `src/components/furr/Settings.tsx` (Sektion Beweis-Clips)
- `src/components/furr/Evidence.tsx` (Clip-Button, Draft, Als Beweis anlegen)
- `src/components/desktop/Desktop.tsx` (`ClipSavedListener`)
- `src/routes/vr.tsx` (Clip-Button)

### Unverändert

- `desktop/media.cjs` / `media.ps1` (Now-Playing, keine Aufnahme)

## Config (`furrbox-config.json` → `clips`)

- `enabled`, `mode` (`instanz`|`nurTrigger`), `source` (`vrchat`|`screen`)
- `bufferSeconds` (10–60), `preSeconds`, `postSeconds`
- `quality` (`low`|`medium`|`high`), `keepCount`, `maxTotalMb`
- `keepOnFailedVote`, `voteTimeoutSeconds`

## Bekannte Grenzen

- **Exclusive Fullscreen** von VRChat kann schwarze Aufnahme liefern → Quelle „Primärmonitor“ oder Fenstered/Borderless testen; optional ffmpeg-Remux wenn im PATH
- **Privacy:** andere Spieler können im Bild sein – nur mit Bedacht / Regeln der Community
- WebM-Ring aus MediaRecorder-Segmenten: Wiedergabe ggf. nach Remux robuster
- Große Clips → Evidence über Bot-Upload (>1 MB), Inline max. ~3 MB / Video max. 4 Min

## Tests / Checks

1. `npm run typecheck` (OK)
2. `node --check` für `clips.cjs`, `main.cjs`, `preload.cjs`, Recorder-Preload (OK)
3. Smoke: `setCaseLink` setzt `caseId` von `null` → Fall-ID (OK)
4. Manuell Desktop: Instanz joinen → Status „Puffer aktiv“; Votekick / `Strg+Umschalt+C` → Datei in Clips-Ordner + Toast „Beweis bereit“; „Als Beweis anlegen“ ohne Auto-Upload vorher; Beenden → Hotkeys weg (`unregisterAll`)

## Backup

`C:\Users\denni\Downloads\FurrBox_Verbesserung\backup_clips\`

## Erneuerungs-Liste (kurz)

- Neues Desktop-Clip-Modul mit Idle-Sleep und Modi Instanz / Nur-Trigger
- Zentrale `requestClip`-API + IPC inkl. Attach-to-Case (caseId im Sidecar)
- Votekick Auto-Capture (scharf bei Start, Export bei Ergebnis/Timeout)
- Hotkeys Strg+Umschalt+C (Speichern) und Strg+Umschalt+M (Mark), Unregister beim Beenden
- Incident-JSON mit SHA-256, VRChat-Kontext, caseId=null bis Anhang
- Deutsche Einstellungen, Clip-Liste, Ordner öffnen, Toast „Beweis bereit“, kein Auto-Upload
- Evidence/VR-Buttons + Draft „Als Beweis anlegen“
- Doku Bot-Hook über bestehende Bridge (kein neuer Port)
- media.cjs unangetastet; kein Git-Push/Commit
