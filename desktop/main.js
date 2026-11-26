const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");
const { startServer } = require("./server");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
let win, port;

// The game's 3D models are .obj files, which the packager silently strips from the app bundle,
// so the build copies the web bundle into Resources/web instead (see build-mac.yml).
const webRoot = () => app.isPackaged ? path.join(process.resourcesPath, "web") : path.join(__dirname, "web");

const url = (mode) => `http://127.0.0.1:${port}/${mode ? "?mode=" + mode : ""}`;

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu" },
    {
      label: "Game",
      submenu: [
        { label: "Main menu", accelerator: "CmdOrCtrl+M", click: () => win.loadURL(url(null)) },
        { label: "You vs AI", accelerator: "CmdOrCtrl+1", click: () => win.loadURL(url("you-vs-ai")) },
        { label: "AI vs AI", accelerator: "CmdOrCtrl+2", click: () => win.loadURL(url("ai-vs-ai")) },
        { label: "Settings / data", accelerator: "CmdOrCtrl+,", click: () => win.loadURL(url("settings")) },
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
    width: 1100, height: 760, minWidth: 700, minHeight: 480,
    title: "Crossy Road", backgroundColor: "#000000",
    webPreferences: { contextIsolation: true, backgroundThrottling: false },
  });
  buildMenu();
  win.loadURL(url(false));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
