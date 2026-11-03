import { app, BrowserWindow, Tray, Menu, nativeImage, Notification, globalShortcut } from "electron";
import * as path from "node:path";
import { getConfig } from "../engine/config";
import { ensureDb, scanAll } from "../engine/ingest/manager";
import { startHttpServer } from "../engine/http";
import { startWatcher, stopWatcher } from "../engine/ingest/watcher";
import { scanAndNotify } from "./scan";
import { startBackgroundJobs, stopBackgroundJobs } from "../engine/lifecycle";
import { getBoolSetting } from "../engine/store/db";

let tray: Tray | null = null;
let win: BrowserWindow | null = null;
let quickWin: BrowserWindow | null = null;
let paletteWin: BrowserWindow | null = null;
let quitting = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showWindow();
  });
}

function createIcon(): Electron.NativeImage {
  const logo = nativeImage.createFromPath(path.join(__dirname, "..", "..", "logo.png"));
  if (!logo.isEmpty()) {
    return logo.resize({ width: 16, height: 16 });
  }
  const size = 16;
  const canvasData = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    canvasData[i * 4] = 79;
    canvasData[i * 4 + 1] = 140;
    canvasData[i * 4 + 2] = 255;
    canvasData[i * 4 + 3] = 255;
  }
  return nativeImage.createFromBuffer(canvasData, { width: size, height: size });
}

function dashboardUrl(file = ""): string {
  return `http://127.0.0.1:${getConfig().httpPort}/${file}`;
}

function showWindow(): void {
  if (!win || win.isDestroyed()) {
    win = new BrowserWindow({
      width: 1200,
      height: 780,
      title: "Memoria",
      backgroundColor: "#0d0e11",
      icon: createIcon(),
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    win.loadURL(dashboardUrl());
    win.on("closed", () => (win = null));
  }
  win.show();
  win.focus();
}

function createTray(): void {
  tray = new Tray(createIcon());
  tray.setToolTip("Memoria — second brain semua AI tool");
  const menu = Menu.buildFromTemplate([
    { label: "Buka Dashboard", click: showWindow },
    { label: "Cari Memori (Ctrl+Shift+Space)", click: openPaletteWindow },
    { label: "Catat Cepat (Ctrl+Shift+M)", click: openQuickWindow },
    { label: "Scan sekarang", click: async () => {
        const res = await scanAndNotify();
        new Notification({
          title: "Memoria",
          body: `Scan selesai — transcript baru: ${res.totalNew}`,
        }).show();
      } },
    { type: "separator" },
    { label: "Keluar", click: () => {
        quitting = true;
        app.quit();
      } },
  ]);
  tray.setContextMenu(menu);
  tray.on("double-click", showWindow);
}

function openQuickWindow(): void {
  try {
    if (!getBoolSetting("quickInbox", true)) return;
  } catch {
    return;
  }
  if (quickWin && !quickWin.isDestroyed()) {
    quickWin.show();
    quickWin.focus();
    return;
  }
  quickWin = new BrowserWindow({
    width: 480,
    height: 300,
    title: "Catat cepat — Memoria",
    alwaysOnTop: true,
    backgroundColor: "#14161a",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  quickWin.loadURL(dashboardUrl("quick.html"));
  quickWin.on("closed", () => (quickWin = null));
}

function openPaletteWindow(): void {
  try {
    if (!getBoolSetting("globalPalette", true)) return;
  } catch {
    return;
  }
  if (paletteWin && !paletteWin.isDestroyed()) {
    paletteWin.show();
    paletteWin.focus();
    return;
  }
  paletteWin = new BrowserWindow({
    width: 660,
    height: 520,
    title: "Cari memori — Memoria",
    alwaysOnTop: true,
    backgroundColor: "#14161a",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  paletteWin.loadURL(dashboardUrl("palette.html"));
  paletteWin.on("closed", () => (paletteWin = null));
}

app.whenReady().then(async () => {
  ensureDb();
  // Tunggu server siap dulu — semua window memuat UI dari HTTP server ini.
  await startHttpServer();
  startWatcher();
  createTray();
  try {
    globalShortcut.register("CommandOrControl+Shift+M", () => openQuickWindow());
    globalShortcut.register("CommandOrControl+Shift+Space", () => openPaletteWindow());
  } catch {
    // shortcut sudah dipakai aplikasi lain
  }
  if (process.env.PECUT_SHOW_ON_START === "1") {
    showWindow();
  } else if (!app.getLoginItemSettings().wasOpenedAtLogin) {
    showWindow();
  }
  startBackgroundJobs();

  // Auto-start kini opsional (setting "autoStartLogin", default aktif).
  // openAsHidden: macOS — mulai sebagai tray tanpa membuka window.
  const autoStart = getBoolSetting("autoStartLogin", true);
  app.setLoginItemSettings({
    openAtLogin: autoStart,
    openAsHidden: autoStart && process.platform === "darwin",
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) showWindow();
  });
});

app.on("window-all-closed", () => {
  if (!quitting) {
    // biarkan tray hidup
  } else {
    app.quit();
  }
});

app.on("before-quit", () => {
  quitting = true;
  globalShortcut.unregisterAll();
  stopWatcher();
  stopBackgroundJobs();
});
