import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { app, BrowserWindow, globalShortcut, Menu, nativeImage, shell, Tray } from "electron";
import { startCore, type CoreHandle } from "../core/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BACKGROUND = "#0A0B0F";
const PTT_ACCELERATOR = "Alt+Space"; // ⌥Space
/** 16×16 template mic glyph (black + alpha); macOS tints it for the menu bar. */
const TRAY_ICON_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKUlEQVR4nGNgGOzgPxRTpJlsQ0a6AeiaSTaEYgPQDSIbDJwBVAsD2gMAk38t09uYFKYAAAAASUVORK5CYII=";

let core: CoreHandle | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
/**
 * globalShortcut has no keyup, so the global hotkey is a press-toggle: first
 * press starts listening, next press stops. (In-app hold-Space PTT is handled
 * by the renderer separately.) Both edges are signalled to the renderer through
 * the core's /voice/ptt → `voice.ptt` event, keeping main→renderer off IPC.
 */
let listening = false;

async function postPtt(pressed: boolean): Promise<void> {
  if (!core) return;
  try {
    await fetch(`http://127.0.0.1:${core.port}/voice/ptt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pressed }),
    });
  } catch {
    /* core mid-teardown; nothing to signal */
  }
}

function togglePtt(): void {
  listening = !listening;
  void postPtt(listening);
  updateTrayMenu();
}

function showWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else if (core) {
    void createWindow(core.port);
  }
}

function updateTrayMenu(): void {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open MentorOS", click: showWindow },
      {
        label: `${listening ? "Stop" : "Start"} Listening (⌥Space)`,
        click: togglePtt,
      },
      { type: "separator" },
      { label: "Quit", role: "quit" },
    ]),
  );
  tray.setToolTip(listening ? "MentorOS — listening" : "MentorOS");
}

function setupTrayAndHotkey(): void {
  const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_PNG, "base64"));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  updateTrayMenu();
  tray.on("click", showWindow);

  const registered = globalShortcut.register(PTT_ACCELERATOR, togglePtt);
  console.log(
    registered
      ? `[main] push-to-talk hotkey ${PTT_ACCELERATOR} registered`
      : `[main] failed to register hotkey ${PTT_ACCELERATOR}`,
  );
}

async function createWindow(corePort: number): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: BACKGROUND,
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false,
    },
  });

  mainWindow.on("ready-to-show", () => mainWindow?.show());

  // Renderer links (KB reading view etc.) open in the system browser — never
  // a second Electron window — and in-window navigation stays in the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:") || url.startsWith("http:")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(process.env["ELECTRON_RENDERER_URL"] ?? "file:")) {
      event.preventDefault();
      if (url.startsWith("https:") || url.startsWith("http:")) void shell.openExternal(url);
    }
  });

  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  const query = `?corePort=${corePort}`;
  if (devServerUrl) {
    await mainWindow.loadURL(`${devServerUrl}${query}`);
  } else {
    await mainWindow.loadFile(join(__dirname, "../renderer/index.html"), {
      search: query,
    });
  }
}

app.whenReady().then(async () => {
  core = await startCore({ dataDir: join(app.getPath("userData"), "data") });

  setupTrayAndHotkey();

  await createWindow(core.port);

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0 && core) {
      await createWindow(core.port);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", async (event) => {
  globalShortcut.unregisterAll();
  if (core) {
    event.preventDefault();
    const handle = core;
    core = null;
    await handle.stop().catch(() => undefined);
    app.quit();
  }
});
