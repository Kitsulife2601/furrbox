# Verbesserung Desktop – Windows-Feeling & Votekick-Timing

Stand: 2026-10-05 (Europe/Berlin)

## Ziel

Die FurrBox-Desktop-Oberfläche (Electron + React) soll sich **wie eine echte Windows-Desktop-Umgebung** anfühlen – und dabei so **flüssig wie die gelungene Votekick-Animation/der Votekick-Sound** reagieren.

Goldstandard:

- `src/lib/furr/sounds.ts` (Votekick-Melodie: Notenabstand **130 ms**, Soft-Attack **12 ms**)
- `src/components/furr/useVoteWatch.ts` (Toast + Sound im gleichen Moment)
- Spring-Pop wie Splash/Sticker: **`cubic-bezier(0.3, 1.6, 0.5, 1)`**, **450 ms**

## Was vorher fehlte / inkonsistent war

- Boot, Toasts, Flyouts und Fenster hatten **kein gemeinsames Timing** (Boot-Schritte 520 ms, Exit 650 ms, Toasts ohne Ein-/Ausblendung).
- Taskleiste ohne **„Desktop anzeigen“**, Running-Indicator nur als dünner Strich ohne klaren Fokus-Unterschied.
- Snap existierte funktional, aber **ohne visuelle Vorschau** beim Ziehen an Kanten.
- Kein einfacher **Alt+Tab**-Umschalter.
- Update-Tray und Lock-/Power-Übergänge wirkten „flach“ neben dem Votekick-Feedback.

## Zentrale Timing-Konstanten (`src/lib/furr/motion.ts`)

| Konstante | Wert | Herkunft / Zweck |
|-----------|------|------------------|
| `noteGapMs` | **130** | Votekick-Notenabstand |
| `attackMs` | **12** | Soft-Attack der Oscillator-Noten |
| `popMs` / `easePop` | **450** / spring | Splash-Pfote, Sticker, Boot-Exit, Lock-In, Toast-In |
| `enterMs` / `easeOut` | **180** / ease-out | Fenster, Flyouts, Toast-Out, VR-Window-Feel |
| `toastMs` | **5200** | Lesbar nach ~1,4 s Votekick-Call |
| `toastOutMs` | **180** | Ausblendung |
| `bootStepMs` / `bootHoldMs` | **390** | ≈ 3× Notenabstand |
| `bootExitMs` | **450** | = `popMs` |
| `alertPulseMs` | **900** | wie VR-Votekick-Puls |

## Was geändert wurde (Dateiübersicht)

### Neu

- `src/lib/furr/motion.ts` – gemeinsame MOTION-Konstanten
- `src/components/desktop/AltTab.tsx` – einfacher Alt+Tab-Umschalter

### Timing / Feedback

- `src/components/desktop/BootScreen.tsx` – nutzt `MOTION.bootStepMs/Hold/Exit`
- `src/store/notifications.ts` – `toastMs` + Exit-Phase `toastOutMs`
- `src/components/desktop/Flyouts.tsx` – `furr-flyout-in` / `furr-toast-in` / `furr-toast-out`
- `src/styles.css` – MOTION-Animationen (Toast, Flyout, Window, Lock, Update-Puls, Snap-Preview, Show-Desktop)
- `desktop/splash.html` – Pop/Rise auf **450 ms** (wie `popMs`)
- `src/components/desktop/UpdatePopup.tsx` – Tray mit Pop + `furr-update-pulse` (900 ms)
- `src/components/desktop/LockScreen.tsx` – `furr-lock-in`
- `src/components/desktop/Power.tsx` – Power-Menü mit `furr-flyout-in`
- `src/components/desktop/DesktopIcons.tsx` – Icon-Verschieben **180 ms** ease-out

### Windows-näheres Verhalten

- `src/store/desktop.ts` – `toggleShowDesktop` / `desktopPeek`, `snapPreview` / `setSnapPreview`
- `src/components/desktop/Taskbar.tsx` – **Desktop-anzeigen-Streifen** rechts, klarere Running-Indicator (`taskbar-running`)
- `src/components/desktop/WindowFrame.tsx` – **Snap-Assist-Vorschau** live beim Ziehen; `SnapAssistPreview`; Fenster-Enter-Animation
- `src/components/desktop/Desktop.tsx` – bindet Snap-Preview + Alt+Tab ein

### Bewusst unverändert

- Lange Power-Shutdown-Animation (~3,4 s) – eigenes „Einschlafen“-Narrativ, kein Votekick-Snap.
- Discord-Bot- / VR-Logik außer gemeinsamen Sounds/MOTION (VR-Alert-Puls-Wert nur als Referenz übernommen).
- **Kein Git-Push**, keine Remotes.

## Backup

`C:\Users\denni\Downloads\FurrBox_Verbesserung\backup_desktop\`

Enthält u. a. `desktop/` (main, preload, splash, setup, …), `src/components/desktop/*`, relevante Furr-/Sound-Dateien, `notifications.ts`, `styles.css`, `desktop.ts`.

## Manuelle Checks

1. **Boot:** App starten → Boot-Texte wirken zügiger (~390 ms), Zoom-out ~450 ms in den Lockscreen.
2. **Votekick-Referenz:** Votekick auslösen → Sound + Toast gleichzeitig; Toast poppt ein (450 ms), bleibt ~5,2 s, fade-out 180 ms.
3. **Update:** Bei verfügbarem Update → Update-Sound + Toast; Tray-Icon pulst (900 ms) und poppt einmal ein.
4. **Flyouts:** Start / Suche / Info-Center / Uhr → kurzes Einfahren (180 ms).
5. **Fenster:** App öffnen → kurzes Window-In; an Bildschirmkante ziehen → **blaue Snap-Vorschau** (Halb/Viertel/Max), loslassen snapt.
6. **Taskleiste:** Rechter Rand „Desktop anzeigen“ → alle Fenster weg; erneut → wiederherstellen. Fokus-App hat längeren Accent-Strich.
7. **Alt+Tab:** Alt gedrückt halten, Tab tippen → Umschalter; Alt loslassen → gewähltes Fenster fokusieren.
8. **Reduced Motion:** OS „Animationen reduzieren“ → MOTION-Keyframes abgeschaltet (bestehende Prefers-Reduced-Motion-Regeln).

## Kurzfazit

Feedback (Boot, Toast, Update, Flyouts, Fenster) läuft jetzt über **dieselben MOTION-Zahlen wie der Votekick-Pfad**. Zusätzlich kamen Windows-typische Lücken dazu: **Show Desktop**, **Snap-Assist-Vorschau**, klarere Taskleisten-Indikatoren und ein schlanker **Alt+Tab**.

---

## Nachzug: Icons & Settings (Priorität Dennis)

### Icons / Apps

**Problem:** Flache App-Liste im Startmenü, lange „Furr…“-Namen, enges Desktop-Raster, kein Anordnen.

**Änderungen:**

- `src/lib/apps.ts`
  - Kurze Labels: z. B. Browser, Terminal, Evidence, Presence, Modlog, Whitelist, Instanzen, Accounts, Einstellungen, Tasks
  - Gruppen: **System** · **Tools** · **Moderation** (`group` + `APP_GROUPS` + `groupApps()`)
  - Einstellungen-Fenster größer (920×640)
- `src/components/desktop/Flyouts.tsx` (Startmenü): Apps nach Gruppen, scannbare Tiles, Suche auch in Untertiteln
- `src/components/desktop/DesktopIcons.tsx`: Raster **96×104**, Padding **20**, etwas mehr Luft
- `src/store/desktop.ts` + Desktop-Kontextmenü: **„Icons automatisch anordnen“** (setzt gespeicherte Positionen zurück → Spaltenfüllung)

### Settings (Windows-mäßig)

**Problem:** Eine Sidebar ohne Icons, Personalisierung/System als lange Blöcke.

**Änderungen in** `src/components/furr/Settings.tsx`:

- **Home/Übersicht** mit Kacheln zu den Bereichen
- Sidebar mit **Icons + Kategorien** (Start, Personalisierung, Konto, …)
- **Karten** (`SettingCard`): Personalisierung getrennt in Modus / Hintergrund / Akzent; System getrennt in Updates / Gerät
- Mehr Weißraum, klarere Überschriften; Töne und VR bleiben eigene Kategorien

### Manuell prüfen (Icons/Settings)

1. Startmenü öffnen → drei Gruppen sichtbar, kurze Namen.
2. Desktop Rechtsklick → „Icons automatisch anordnen“ → Icons links oben im Raster.
3. Einstellungen öffnen → Home-Kacheln; Sidebar-Icons; Personalisierung zeigt drei Karten; System zeigt Updates- und Gerät-Karte.
