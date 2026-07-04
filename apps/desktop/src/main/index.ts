import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { app, BrowserWindow } from "electron";
import { startCore, type CoreHandle } from "../core/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BACKGROUND = "#0A0B0F";
let core: CoreHandle | null = null;
let mainWindow: BrowserWindow | null = null;

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
  core = await startCore();

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
  if (core) {
    event.preventDefault();
    const handle = core;
    core = null;
    await handle.stop().catch(() => undefined);
    app.quit();
  }
});
