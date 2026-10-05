// FurrBox VR: a FurrBox panel on your arm in SteamVR (like OVR Toolkit).
// The panel is a normal FurrBox page (/vr) rendered offscreen; its picture is handed to SteamVR
// as an overlay attached to a controller, and SteamVR's laser pointer events are forwarded to the
// page as mouse input. Talks to SteamVR through openvr_api.dll (part of every SteamVR install)
// with koffi – nothing is injected into VRChat.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TABLES = require("./openvr-tables.json");
const SYSTEM = "IVRSystem_026";
const OVERLAY = "IVROverlay_028";

const OVERLAY_KEY = process.env.FURRBOX_VR_KEY || "de.furrbox.arm";
const APP_BACKGROUND = 3; // does not start SteamVR, fails when it is not running
const ROLE = { left: 1, right: 2 };
const INVALID_DEVICE = 0xffffffff;
const DEVICE_CLASS_CONTROLLER = 2;
const MAX_DEVICES = 64;
const POSE_SIZE = 80; // TrackedDevicePose_t: matrix (48) + velocities (24) + result (4) + 2 bools (+pad)
const UNIVERSE_STANDING = 1;
/** The panel reacts to the laser only while the other controller points at it from this close (m). */
const POINT_DISTANCE = 0.9;
// "Looking at your arm": the panel is within this angle of where the headset points, faces you
// and is close enough. Opens after GAZE_ON_MS, closes GAZE_OFF_MS after you look away.
const GAZE_COS = Math.cos((24 * Math.PI) / 180);
const GAZE_COS_OPEN = Math.cos((40 * Math.PI) / 180);
const GAZE_FACING = 0.2;
const GAZE_DISTANCE = 0.9;
const GAZE_ON_MS = 250;
const GAZE_OFF_MS = 1800;
const EVENT = { mouseMove: 300, mouseDown: 301, mouseUp: 302, scroll: 305, scrollSmooth: 309, quit: 700 };
const FLAG_INTERACTIVE = 65536; // MakeOverlaysInteractiveIfVisible
const FLAG_SCROLL = 131072; // SendVRSmoothScrollEvents
const INPUT_MOUSE = 1;
const EVENT_SIZE = 64;

// Like OVR Toolkit: a small widget on the wrist (clock, music, battery) and – when open – a
// window above it in the same plane. Both are one picture; the widget is its bottom part and
// stays where it is when the window opens.
const WIDGET = { width: 520, height: 200 };
const FULL = { width: 520, height: 700 };
const BATTERY_PROP = 1012; // Prop_DeviceBatteryPercentage_Float
const PROVIDES_BATTERY_PROP = 1026; // Prop_DeviceProvidesBatteryStatus_Bool

/** Where SteamVR lives (from %LOCALAPPDATA%\openvr\openvrpaths.vrpath). */
function findOpenvrDll() {
  try {
    const file = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "openvr", "openvrpaths.vrpath");
    const runtimes = JSON.parse(fs.readFileSync(file, "utf8")).runtime ?? [];
    for (const dir of runtimes) {
      const dll = path.join(dir, "bin", "win64", "openvr_api.dll");
      if (fs.existsSync(dll)) return dll;
    }
  } catch {
    // SteamVR is not installed.
  }
  return null;
}

/**
 * Panel position relative to the controller, in metres / degrees. The panel lies flat above the
 * controller like a wrist tablet: its top edge points away from you.
 */
// Default: flat on the back of the left hand up to the wrist, readable when you look at your arm
// like at a watch (turn 90° = the long side runs along the arm).
const DEFAULT_PLACEMENT = { hand: "left", width: 0.15, x: 0, y: 0.04, z: 0.1, tilt: 0, roll: 0, turn: 90, lift: 35 };

function matrixFor(p, raise = 0) {
  // Overlay X -> controller X, overlay up (Y) -> controller forward (-Z), overlay normal (Z) -> controller up (Y),
  // then tilted around X by `tilt` degrees towards the user.
  const rad = (v) => (Number(v) || 0) * (Math.PI / 180);
  const c = Math.cos(rad(p.tilt));
  const s = Math.sin(rad(p.tilt));
  // Flat panel, columns: X=(1,0,0)  Y=(0,s,-c)  Z=(0,c,s)
  let m = [
    [1, 0, 0],
    [0, s, c],
    [0, -c, s],
  ];
  const mul = (a, b) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
  // "turn": spin the panel around its own middle (like turning a phone from portrait to landscape).
  const ct = Math.cos(rad(p.turn));
  const st = Math.sin(rad(p.turn));
  m = mul(m, [
    [ct, -st, 0],
    [st, ct, 0],
    [0, 0, 1],
  ]);
  // "lift": raise the top edge towards you (the panel leans like a phone you hold up).
  const cl = Math.cos(rad(p.lift));
  const sl = Math.sin(rad(p.lift));
  m = mul(m, [
    [1, 0, 0],
    [0, cl, -sl],
    [0, sl, cl],
  ]);
  // "roll": tip the whole panel sideways around the controller's forward axis (90° = edge of the hand).
  const cr = Math.cos(rad(p.roll));
  const sr = Math.sin(rad(p.roll));
  m = mul(
    [
      [cr, -sr, 0],
      [sr, cr, 0],
      [0, 0, 1],
    ],
    m,
  );
  // `raise`: move the centre along the panel's own "up" (keeps the bottom edge in place when the window opens).
  return [...m[0], p.x + m[0][1] * raise, ...m[1], p.y + m[1][1] * raise, ...m[2], p.z + m[2][1] * raise];
}

// Function signatures are registered with koffi once per app run – registering the same name again
// (after SteamVR was restarted and FurrBox reconnects) is an error, so they are kept here.
const PROTOS = new Map();

function createVrOverlay({ BrowserWindow, preload, log = () => undefined }) {
  let koffi = null;
  let lib = null;
  let api = null; // { sys(name, proto, ...args), ovr(...) }
  let handle = null;
  let win = null;
  let timers = [];
  let state = { status: "off", error: null }; // off | waiting | running | unsupported
  let placement = { ...DEFAULT_PLACEMENT };
  let url = null;
  let attachedTo = INVALID_DEVICE;
  let pointerHand = INVALID_DEVICE;
  let visible = false;
  let interactive = false;
  let lastHit = 0;
  let mouseDown = false;
  let lastFrameError = -1;
  let lastConnectError = "";
  let loggedDevice = INVALID_DEVICE;
  let gazing = false;
  let gazeSince = 0;
  let gazeLost = 0;
  let mode = "widget"; // widget | full
  const size = () => (mode === "full" ? FULL : WIDGET);
  const widthMeters = () => Math.min(0.6, Math.max(0.08, Number(placement.width) || 0.15));
  /** Metres the centre moves up when the window is open, so the widget stays on the wrist. */
  const raise = () => (mode === "full" ? ((FULL.height - WIDGET.height) / 2) * (widthMeters() / FULL.width) : 0);
  const listeners = new Set();

  function setState(patch) {
    state = { ...state, ...patch };
    for (const fn of listeners) fn(status());
  }
  function status() {
    return { ...state, placement, installed: Boolean(findOpenvrDll()) };
  }

  function load() {
    if (lib) return true;
    const dll = findOpenvrDll();
    if (!dll) {
      setState({ status: "unsupported", error: "SteamVR ist auf diesem PC nicht installiert." });
      return false;
    }
    try {
      koffi = require("koffi");
      lib = koffi.load(dll);
      lib.init = lib.func("intptr_t VR_InitInternal(_Out_ int*, int)");
      lib.shutdown = lib.func("void VR_ShutdownInternal()");
      lib.generic = lib.func("void* VR_GetGenericInterface(const char*, _Out_ int*)");
      lib.valid = lib.func("bool VR_IsInterfaceVersionValid(const char*)");
      lib.describe = lib.func("const char* VR_GetVRInitErrorAsEnglishDescription(int)");
      return true;
    } catch (error) {
      lib = null;
      setState({ status: "unsupported", error: `SteamVR-Schnittstelle konnte nicht geladen werden: ${error.message}` });
      return false;
    }
  }

  /** Binds a C function table ("FnTable:IVROverlay_028") – functions are looked up by name. */
  function bind(version) {
    const err = [0];
    const table = lib.generic(`FnTable:${version}`, err);
    if (err[0] || !table) throw new Error(`${version}: ${lib.describe(err[0])}`);
    const names = TABLES[version];
    const pointers = koffi.decode(table, koffi.array("void*", names.length));
    const cache = new Map();
    return (name, signature, ...args) => {
      let fn = cache.get(name);
      if (!fn) {
        const index = names.indexOf(name);
        if (index < 0) throw new Error(`Unbekannte Funktion ${name}`);
        const key = `${version}_${name}`;
        if (!PROTOS.has(key)) PROTOS.set(key, koffi.proto(signature.replace("FN", key)));
        fn = { ptr: pointers[index], proto: PROTOS.get(key) };
        cache.set(name, fn);
      }
      return koffi.call(fn.ptr, fn.proto, ...args);
    };
  }

  function connect() {
    if (!load()) return false;
    const err = [0];
    lib.init(err, APP_BACKGROUND);
    if (err[0]) {
      // 121 = SteamVR is not running – the normal "waiting" case.
      setState({ status: "waiting", error: null });
      return false;
    }
    try {
      if (!lib.valid(OVERLAY) || !lib.valid(SYSTEM)) {
        disconnect();
        setState({ status: "unsupported", error: "Diese SteamVR-Version wird noch nicht unterstützt (bitte SteamVR aktualisieren)." });
        return false;
      }
      api = { sys: bind(SYSTEM), ovr: bind(OVERLAY) };
      const out = [0n];
      const e = api.ovr("CreateOverlay", "int FN(const char*, const char*, _Out_ uint64_t*)", OVERLAY_KEY, "FurrBox", out);
      if (e) throw new Error(`Overlay konnte nicht angelegt werden (Fehler ${e}).`);
      handle = out[0];
      api.ovr("SetOverlayInputMethod", "int FN(uint64_t, int)", handle, INPUT_MOUSE);
      // Not interactive by default: SteamVR would otherwise take the controllers away from VRChat
      // the whole time. updatePointer() switches the laser on only while you point at the panel.
      api.ovr("SetOverlayFlag", "int FN(uint64_t, int, bool)", handle, FLAG_INTERACTIVE, false);
      api.ovr("SetOverlayFlag", "int FN(uint64_t, int, bool)", handle, FLAG_SCROLL, true);
      visible = false;
      interactive = false;
      applySize();
      attachedTo = INVALID_DEVICE;
      applyPlacement();
      openPage();
      lastConnectError = "";
      setState({ status: "running", error: null });
      log("VR-Overlay: mit SteamVR verbunden.");
      return true;
    } catch (error) {
      // E.g. the overlay name is still held by a FurrBox that is just closing: try again shortly.
      if (error.message !== lastConnectError) log("VR-Overlay:", error.message);
      lastConnectError = error.message;
      disconnect();
      setState({ status: "waiting", error: error.message });
      return false;
    }
  }

  function applyPlacement() {
    if (!api || handle === null) return;
    api.ovr("SetOverlayWidthInMeters", "int FN(uint64_t, float)", handle, widthMeters());
    const hands = findHands();
    const device = placement.hand === "right" ? hands.right : hands.left;
    pointerHand = placement.hand === "right" ? hands.left : hands.right;
    if (device === INVALID_DEVICE) {
      // No controller yet: keep the panel hidden instead of leaving it somewhere in the room.
      attachedTo = INVALID_DEVICE;
      show(false);
      return;
    }
    const m = Buffer.alloc(48);
    matrixFor(placement, raise()).forEach((v, i) => m.writeFloatLE(v, i * 4));
    const e = api.ovr("SetOverlayTransformTrackedDeviceRelative", "int FN(uint64_t, uint32_t, void*)", handle, device, m);
    if (e) log(`VR-Overlay: Position konnte nicht gesetzt werden (Fehler ${e}).`);
    if (loggedDevice !== device) log(`VR-Overlay: hängt am Controller ${device} (${placement.hand}).`);
    loggedDevice = device;
    const changed = attachedTo !== device;
    attachedTo = device;
    show(true);
    if (changed) for (const fn of listeners) fn(status());
  }

  /** Mouse coordinates follow the size of the page (button or full panel). */
  function applySize() {
    if (!api || handle === null) return;
    const scale = Buffer.alloc(8);
    scale.writeFloatLE(size().width, 0);
    scale.writeFloatLE(size().height, 4);
    api.ovr("SetOverlayMouseScale", "int FN(uint64_t, void*)", handle, scale);
    if (win && !win.isDestroyed()) win.setContentSize(size().width, size().height);
  }

  function show(on) {
    if (!api || handle === null || visible === on) return;
    api.ovr(on ? "ShowOverlay" : "HideOverlay", "int FN(uint64_t)", handle);
    visible = on;
    if (!on) setInteractive(false);
  }

  function setInteractive(on) {
    if (!api || handle === null || interactive === on) return;
    api.ovr("SetOverlayFlag", "int FN(uint64_t, int, bool)", handle, FLAG_INTERACTIVE, on);
    interactive = on;
    if (!on && mouseDown) {
      mouseDown = false;
      mouse("mouseUp", -1, -1, { button: "left", clickCount: 1 });
    }
  }

  /** Left / right controller: SteamVR's role first, otherwise the connected controllers in order. */
  function findHands() {
    const role = (r) => api.sys("GetTrackedDeviceIndexForControllerRole", "uint32_t FN(int)", r);
    const connected = (i) => i !== INVALID_DEVICE && api.sys("IsTrackedDeviceConnected", "bool FN(uint32_t)", i);
    let left = role(ROLE.left);
    let right = role(ROLE.right);
    if (!connected(left)) left = INVALID_DEVICE;
    if (!connected(right)) right = INVALID_DEVICE;
    if (left === INVALID_DEVICE || right === INVALID_DEVICE) {
      for (let i = 0; i < MAX_DEVICES; i += 1) {
        if (api.sys("GetTrackedDeviceClass", "int FN(uint32_t)", i) !== DEVICE_CLASS_CONTROLLER || !connected(i)) continue;
        const r = api.sys("GetControllerRoleForTrackedDeviceIndex", "int FN(uint32_t)", i);
        if (r === ROLE.left && left === INVALID_DEVICE) left = i;
        else if (r === ROLE.right && right === INVALID_DEVICE) right = i;
      }
    }
    return { left, right };
  }

  /** Are you looking at the panel (like at a watch)? Tells the page, which then opens / closes. */
  function updateGaze(pointing) {
    let looking = false;
    if (attachedTo !== INVALID_DEVICE) {
      const count = attachedTo + 1;
      const poses = Buffer.alloc(POSE_SIZE * count);
      api.sys("GetDeviceToAbsoluteTrackingPose", "void FN(int, float, void*, uint32_t)", UNIVERSE_STANDING, 0, poses, count);
      const row = (device, i) => poses.readFloatLE(device * POSE_SIZE + i * 4);
      if (poses.readUInt8(76) && poses.readUInt8(attachedTo * POSE_SIZE + 76)) {
        const p = matrixFor(placement, 0);
        const h = (i) => row(attachedTo, i);
        // Panel centre and normal in room coordinates: hand pose × placement.
        const centre = [0, 1, 2].map((r) => h(r * 4) * p[3] + h(r * 4 + 1) * p[7] + h(r * 4 + 2) * p[11] + h(r * 4 + 3));
        const normal = [0, 1, 2].map((r) => h(r * 4) * p[2] + h(r * 4 + 1) * p[6] + h(r * 4 + 2) * p[10]);
        const head = [row(0, 3), row(0, 7), row(0, 11)];
        const forward = [-row(0, 2), -row(0, 6), -row(0, 10)];
        const to = centre.map((v, i) => v - head[i]);
        const dist = Math.hypot(...to) || 1;
        const dir = to.map((v) => v / dist);
        const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        // Once open, a wider angle keeps it open (you also look at the window above the widget).
        looking = dist < GAZE_DISTANCE && dot(forward, dir) > (gazing ? GAZE_COS_OPEN : GAZE_COS) && -dot(normal, dir) > (gazing ? 0 : GAZE_FACING);
      }
    }
    const now = Date.now();
    if (looking || pointing) {
      gazeLost = 0;
      if (!gazeSince) gazeSince = now;
      if (!gazing && now - gazeSince >= GAZE_ON_MS) setGazing(true);
    } else {
      gazeSince = 0;
      if (!gazeLost) gazeLost = now;
      if (gazing && now - gazeLost >= GAZE_OFF_MS) setGazing(false);
    }
  }

  function setGazing(on) {
    gazing = on;
    if (win && !win.isDestroyed()) win.webContents.send("furrbox:vr-gaze", on);
  }

  /** Switches the laser on only while the other controller points at the panel. */
  function updatePointer() {
    if (!api || handle === null || !visible) return;
    let hit = false;
    if (pointerHand !== INVALID_DEVICE) {
      const poses = Buffer.alloc(POSE_SIZE * (pointerHand + 1));
      api.sys("GetDeviceToAbsoluteTrackingPose", "void FN(int, float, void*, uint32_t)", UNIVERSE_STANDING, 0, poses, pointerHand + 1);
      const o = pointerHand * POSE_SIZE;
      if (poses.readUInt8(o + 76)) {
        const f = (i) => poses.readFloatLE(o + i * 4);
        const source = [f(3), f(7), f(11)];
        // Straight ahead (-Z) and tilted 35° down – controllers point slightly downwards.
        const forward = [-f(2), -f(6), -f(10)];
        const up = [f(1), f(5), f(9)];
        const tilted = forward.map((v, i) => v * 0.82 - up[i] * 0.57);
        hit = [forward, tilted].some((dir) => {
          const params = Buffer.alloc(28);
          source.forEach((v, i) => params.writeFloatLE(v, i * 4));
          dir.forEach((v, i) => params.writeFloatLE(v, 12 + i * 4));
          params.writeInt32LE(UNIVERSE_STANDING, 24);
          const results = Buffer.alloc(36);
          const ok = api.ovr("ComputeOverlayIntersection", "bool FN(uint64_t, void*, void*)", handle, params, results);
          return ok && results.readFloatLE(32) < POINT_DISTANCE;
        });
      }
    }
    const now = Date.now();
    if (hit) lastHit = now;
    // Keep the laser for a moment after leaving the panel (so a click at the edge still lands).
    setInteractive(hit || (interactive && now - lastHit < 400));
    updateGaze(interactive);
  }

  function openPage() {
    if (win || !url) return;
    win = new BrowserWindow({
      width: size().width,
      height: size().height,
      useContentSize: true,
      show: false,
      frame: false,
      transparent: true,
      webPreferences: { offscreen: true, preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.webContents.setFrameRate(15);
    win.webContents.on("paint", (_event, _dirty, image) => pushFrame(image));
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.loadURL(`${url}/vr`).catch((error) => log("VR-Overlay: Seite lädt nicht:", error.message));
    win.on("closed", () => {
      win = null;
    });
  }

  function pushFrame(image) {
    if (!api || handle === null) return;
    const size = image.getSize();
    if (!size.width || !size.height) return;
    // Electron gives BGRA, SteamVR wants RGBA.
    const pixels = Buffer.from(image.toBitmap());
    for (let i = 0; i < pixels.length; i += 4) {
      const b = pixels[i];
      pixels[i] = pixels[i + 2];
      pixels[i + 2] = b;
    }
    try {
      const e = api.ovr("SetOverlayRaw", "int FN(uint64_t, void*, uint32_t, uint32_t, uint32_t)", handle, pixels, size.width, size.height, 4);
      if (e !== lastFrameError) {
        lastFrameError = e;
        log(e ? `VR-Overlay: Bild wurde abgelehnt (Fehler ${e}).` : `VR-Overlay: Bild wird angezeigt (${size.width}×${size.height}).`);
      }
    } catch (error) {
      log("VR-Overlay: Bild konnte nicht gesendet werden:", error.message);
    }
  }

  function mouse(type, x, y, extra = {}) {
    if (!win || win.isDestroyed()) return;
    win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(size().height - y), ...extra });
  }

  function pump() {
    if (!api || handle === null) return;
    try {
      updatePointer();
      const event = Buffer.alloc(EVENT_SIZE);
      // Laser pointer -> mouse input for the page. (Event data starts at byte 16.)
      while (api.ovr("PollNextOverlayEvent", "bool FN(uint64_t, void*, uint32_t)", handle, event, EVENT_SIZE)) {
        const type = event.readUInt32LE(0);
        const x = event.readFloatLE(16);
        const y = event.readFloatLE(20);
        if (type === EVENT.mouseMove) mouse("mouseMove", x, y, mouseDown ? { button: "left" } : {});
        else if (type === EVENT.mouseDown) {
          mouseDown = true;
          mouse("mouseDown", x, y, { button: "left", clickCount: 1 });
        } else if (type === EVENT.mouseUp) {
          mouseDown = false;
          mouse("mouseUp", x, y, { button: "left", clickCount: 1 });
        } else if (type === EVENT.scrollSmooth || type === EVENT.scroll) {
          // Scroll data: xdelta, ydelta (floats) – position is unknown, scroll the middle of the page.
          win?.webContents.sendInputEvent({ type: "mouseWheel", x: size().width / 2, y: size().height / 2, deltaX: x * 120, deltaY: y * 120 });
        }
      }
      // SteamVR is closing: let go, otherwise it waits for us.
      while (api.sys("PollNextEvent", "bool FN(void*, uint32_t)", event, EVENT_SIZE)) {
        if (event.readUInt32LE(0) === EVENT.quit) {
          log("VR-Overlay: SteamVR wird beendet.");
          disconnect();
          setState({ status: "waiting", error: null });
          return;
        }
      }
    } catch (error) {
      log("VR-Overlay:", error.message);
    }
  }

  function disconnect() {
    try {
      if (api && handle !== null) api.ovr("DestroyOverlay", "int FN(uint64_t)", handle);
    } catch {
      // SteamVR is already gone.
    }
    handle = null;
    api = null;
    visible = false;
    interactive = false;
    attachedTo = INVALID_DEVICE;
    try {
      lib?.shutdown();
    } catch {
      // ignore
    }
    if (win) {
      if (!win.isDestroyed()) win.destroy();
      win = null;
    }
  }

  return {
    status: () => ({ ...status(), attached: attachedTo !== INVALID_DEVICE }),
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** The window showing the /vr page (for IPC permission checks). */
    webContents: () => (win && !win.isDestroyed() ? win.webContents : null),
    start(serverUrl, saved) {
      url = serverUrl;
      placement = { ...DEFAULT_PLACEMENT, ...(saved ?? {}) };
      if (timers.length) return;
      setState({ status: "waiting", error: null });
      const tick = () => {
        if (state.status === "unsupported") return;
        if (!api) connect();
        else applyPlacement(); // controllers may be switched on later, or change hands
      };
      tick();
      timers = [setInterval(tick, 5000), setInterval(pump, 40)];
    },
    stop() {
      timers.forEach(clearInterval);
      timers = [];
      disconnect();
      setState({ status: "off", error: null });
    },
    setPlacement(next) {
      placement = { ...placement, ...next };
      attachedTo = INVALID_DEVICE;
      applyPlacement();
      for (const fn of listeners) fn(status());
      return placement;
    },
    /** "widget" (wrist widget only) or "full" (widget + window above it) – chosen by the /vr page. */
    setMode(next) {
      const wanted = next === "full" ? "full" : "widget";
      if (mode === wanted) return;
      mode = wanted;
      applySize();
      attachedTo = INVALID_DEVICE;
      applyPlacement();
    },
    /** Battery of headset and controllers (0–1), null when a device does not report one. */
    battery() {
      if (!api) return null;
      const read = (device) => {
        if (device === INVALID_DEVICE) return null;
        try {
          const err = [0];
          const has = api.sys("GetBoolTrackedDeviceProperty", "bool FN(uint32_t, int, _Out_ int*)", device, PROVIDES_BATTERY_PROP, err);
          if (!has || err[0]) return null;
          const value = api.sys("GetFloatTrackedDeviceProperty", "float FN(uint32_t, int, _Out_ int*)", device, BATTERY_PROP, err);
          return err[0] ? null : Math.round(value * 100) / 100;
        } catch {
          return null;
        }
      };
      const hands = findHands();
      return { headset: read(0), left: read(hands.left), right: read(hands.right) };
    },
    /** Tells the /vr page something (e.g. new settings). */
    send(channel, payload) {
      win?.webContents.send(channel, payload);
    },
  };
}

module.exports = { createVrOverlay, DEFAULT_PLACEMENT };
