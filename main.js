const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const { createSupportBridge } = require("./support-bridge");

const PORT = process.env.PORT || 3000;
let mainWindow = null;
let supportBridge = null;

app.whenReady().then(() => {
  supportBridge = createSupportBridge({
    onConsentRequest: showConsentDialog,
  });

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1120,
    minHeight: 760,
    backgroundColor: "#07111a",
    title: "NovaSupport Remote Desk",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    app.whenReady().then(() => {
      if (!mainWindow) {
        mainWindow = new BrowserWindow({
          width: 1480,
          height: 960,
          webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
          },
        });

        mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
      }
    });
  }
});

ipcMain.handle("desktop-host:available", () => true);

ipcMain.handle("desktop-host:get-system-info", () => ({
  hostname: os.hostname(),
  username: os.userInfo().username,
  platform: os.platform(),
  release: os.release(),
  arch: os.arch(),
  cpus: os.cpus().length,
  memoryGb: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB`,
  uptimeMinutes: Math.round(os.uptime() / 60),
  homeDir: os.homedir(),
}));

ipcMain.handle("desktop-host:get-safe-actions", () => supportBridge.getActions());

ipcMain.handle("desktop-host:run-action", async (_event, actionId, context = {}) => {
  try {
    const result = await supportBridge.runAction(actionId, context);
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Falha ao executar acao local.",
    };
  }
});

async function showConsentDialog(action) {
  if (!mainWindow) {
    return false;
  }

  const result = await dialog.showMessageBox(mainWindow, {
    type: "question",
    buttons: ["Permitir agora", "Negar"],
    defaultId: 0,
    cancelId: 1,
    title: "NovaSupport - Confirmacao local",
    message: "O tecnico solicitou uma acao local assistida.",
    detail: `${action.label}\n\n${action.description}\n\nSomente permita se estiver acompanhando a sessao.`,
  });

  return result.response === 0;
}
