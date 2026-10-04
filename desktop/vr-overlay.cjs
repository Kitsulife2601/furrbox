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

const APP_BACKGROUND = 3; // does not start SteamVR, fails when it is not running
const ROLE = { left: 1, right: 2 };
const INVALID_DEVICE = 0xffffffff;
const EVENT = { mouseMove: 300, mouseDown: 301, mouseUp: 302, scroll: 305, scrollSmooth: 309, quit: 700 };
const FLAG_INTERACTIVE = 65536; // MakeOverlaysInteractiveIfVisible
const FLAG_SCROLL = 131072; // SendVRSmoothScrollEvents
const INPUT_MOUSE = 1;
const EVENT_SIZE = 64;

const WIDTH = 480;
const HEIGHT = 640;

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
const DEFAULT_PLACEMENT = { hand: "left", width: 0.2, x: 0, y: 0.06, z: 0.1, tilt: 0 };

function matrixFor(p) {
  // Overlay X -> controller X, overlay up (Y) -> controller forward (-Z), overlay normal (Z) -> controller up (Y),
  // then tilted around X by `tilt` degrees towards the user.
  const a = (Number(p.tilt) || 0) * (Math.PI / 180);
  const c = Math.cos(a);
  const s = Math.sin(a);
  // Columns: X=(1,0,0)  Y=(0,s,-c)  Z=(0,c,s)
  return [1, 0, 0, p.x, 0, s, c, p.y, 0, -c, s, p.z];
}

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
  let mouseDown = false;
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
        fn = { ptr: pointers[index], proto: koffi.proto(signature.replace("FN", `${version}_${name}`)) };
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
      if (!lib.valid(OVERLAY) || !lib.valid(SYSTEM)) throw new Error("Diese SteamVR-Version wird noch nicht unterstützt (bitte SteamVR aktualisieren).");
      api = { sys: bind(SYSTEM), ovr: bind(OVERLAY) };
      const out = [0n];
      const e = api.ovr("CreateOverlay", "int FN(const char*, const char*, _Out_ uint64_t*)", "de.furrbox.arm", "FurrBox", out);
      if (e) throw new Error(`Overlay konnte nicht angelegt werden (Fehler ${e}).`);
      handle = out[0];
      api.ovr("SetOverlayInputMethod", "int FN(uint64_t, int)", handle, INPUT_MOUSE);
      api.ovr("SetOverlayFlag", "int FN(uint64_t, int, bool)", handle, FLAG_INTERACTIVE, true);
      api.ovr("SetOverlayFlag", "int FN(uint64_t, int, bool)", handle, FLAG_SCROLL, true);
      const scale = Buffer.alloc(8);
      scale.writeFloatLE(WIDTH, 0);
      scale.writeFloatLE(HEIGHT, 4);
      api.ovr("SetOverlayMouseScale", "int FN(uint64_t, void*)", handle, scale);
      attachedTo = INVALID_DEVICE;
      applyPlacement();
      api.ovr("ShowOverlay", "int FN(uint64_t)", handle);
      openPage();
      setState({ status: "running", error: null });
      log("VR-Overlay: mit SteamVR verbunden.");
      return true;
    } catch (error) {
      log("VR-Overlay:", error.message);
      disconnect();
      setState({ status: "unsupported", error: error.message });
      return false;
    }
  }

  function applyPlacement() {
    if (!api || handle === null) return;
    api.ovr("SetOverlayWidthInMeters", "int FN(uint64_t, float)", handle, Math.min(0.6, Math.max(0.08, Number(placement.width) || 0.2)));
    const device = api.sys("GetTrackedDeviceIndexForControllerRole", "uint32_t FN(int)", ROLE[placement.hand] ?? ROLE.left);
    if (device === INVALID_DEVICE) {
      attachedTo = INVALID_DEVICE;
      return;
    }
    const m = Buffer.alloc(48);
    matrixFor(placement).forEach((v, i) => m.writeFloatLE(v, i * 4));
    api.ovr("SetOverlayTransformTrackedDeviceRelative", "int FN(uint64_t, uint32_t, void*)", handle, device, m);
    attachedTo = device;
  }

  function openPage() {
    if (win || !url) return;
    win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
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
      api.ovr("SetOverlayRaw", "int FN(uint64_t, void*, uint32_t, uint32_t, uint32_t)", handle, pixels, size.width, size.height, 4);
    } catch (error) {
      log("VR-Overlay: Bild konnte nicht gesendet werden:", error.message);
    }
  }

  function mouse(type, x, y, extra = {}) {
    if (!win) return;
    win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(HEIGHT - y), ...extra });
  }

  function pump() {
    if (!api || handle === null) return;
    try {
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
          win?.webContents.sendInputEvent({ type: "mouseWheel", x: WIDTH / 2, y: HEIGHT / 2, deltaX: x * 120, deltaY: y * 120 });
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
    try {
      lib?.shutdown();
    } catch {
      // ignore
    }
    if (win) {
      win.destroy();
      win = null;
    }
  }

  return {
    status,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** The window showing the /vr page (for IPC permission checks). */
    webContents: () => win?.webContents ?? null,
    start(serverUrl, saved) {
      url = serverUrl;
      placement = { ...DEFAULT_PLACEMENT, ...(saved ?? {}) };
      if (timers.length) return;
      setState({ status: "waiting", error: null });
      const tick = () => {
        if (state.status === "unsupported") return;
        if (!api) connect();
        else if (attachedTo === INVALID_DEVICE) applyPlacement(); // controller switched on later
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
    /** Tells the /vr page something (e.g. new settings). */
    send(channel, payload) {
      win?.webContents.send(channel, payload);
    },
  };
}

module.exports = { createVrOverlay, DEFAULT_PLACEMENT };
