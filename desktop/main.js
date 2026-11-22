const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");
const { startServer } = require("./server");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
let win, port;

// The game's 3D models are .obj files, which the packager silently strips from the app bundle,
// so the build copies the web bundle into Resources/web instead (see build-mac.yml).
const webRoot = () => app.isPackaged ? path.join(process.resourcesPath, "web") : path.join(__dirname, "web");

const url = (ai) => `http://127.0.0.1:${port}/${ai ? "?ai=1" : ""}`;

function buildMenu() {
  const toggleAI = () => win.webContents.executeJavaScript(
    "window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' }))");
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu" },
    {
      label: "Game",
      submenu: [
        { label: "New game (you play)", accelerator: "CmdOrCtrl+N", click: () => win.loadURL(url(false)) },
        { label: "New game (AI plays)", accelerator: "CmdOrCtrl+Shift+N", click: () => win.loadURL(url(true)) },
        { label: "Toggle AI autopilot (P)", accelerator: "CmdOrCtrl+P", click: toggleAI },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "reload" },
        { role: "toggleDevTools" },
      ],
    },
    { role: "windowMenu" },
  ]));
}

async function createWindow() {
  ({ port } = await startServer(webRoot()));
  win = new BrowserWindow({
    width: 560, height: 920, minWidth: 360, minHeight: 560,
    title: "Crossy Road v3 (3D + AI)", backgroundColor: "#000000",
    webPreferences: { contextIsolation: true, backgroundThrottling: false },
  });
  buildMenu();
  win.loadURL(url(false));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
