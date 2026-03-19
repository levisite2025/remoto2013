const { app, BrowserWindow, ipcMain, dialog, session, desktopCapturer } = require("electron");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const http = require("http");

const { createSupportBridge } = require("./support-bridge");

const PORT = process.env.PORT || 3000;
let mainWindow = null;
let supportBridge = null;
let serverProcess = null;

app.whenReady().then(async () => {
  supportBridge = createSupportBridge({
    onConsentRequest: showConsentDialog,
  });

  configureNativeCapture();
  await ensureLocalServer();

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
    stopLocalServer();
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

app.on("before-quit", () => {
  stopLocalServer();
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

function configureNativeCapture() {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 0, height: 0 },
      });

      callback({
        video: sources[0],
        audio: "none",
      });
    } catch {
      callback({});
    }
  });
}

async function ensureLocalServer() {
  if (await isPortResponding()) {
    return;
  }

  serverProcess = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    cwd: __dirname,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(PORT),
      APP_BASE_URL: `http://127.0.0.1:${PORT}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  serverProcess.stdout.on("data", (data) => {
    console.log(`[server] ${data.toString().trim()}`);
  });

  serverProcess.stderr.on("data", (data) => {
    console.error(`[server] ${data.toString().trim()}`);
  });

  serverProcess.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`Servidor local encerrado com codigo ${code}.`);
    }
    serverProcess = null;
  });

  await waitForServer();
}

function stopLocalServer() {
  if (!serverProcess) {
    return;
  }

  try {
    serverProcess.kill();
  } catch {}

  serverProcess = null;
}

function isPortResponding() {
  return new Promise((resolve) => {
    const request = http.get(`http://127.0.0.1:${PORT}/api/config`, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });

    request.on("error", () => resolve(false));
    request.setTimeout(1000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForServer() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 10000) {
    if (await isPortResponding()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Nao foi possivel iniciar o servidor local do app.");
}
