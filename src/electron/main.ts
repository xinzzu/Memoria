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
    win.loadFile(path.join(__dirname, "..", "..", "web", "index.html"));
    win.on("closed", () => (win = null));
    if (process.env.PECUT_SHOT) {
      win.webContents.on("console-message", (e, level, message, line, sourceId) => {
        if (level >= 2) console.log("[PAGE-ERR]", message, "@", sourceId, line);
      });
      win.webContents.executeJavaScript(`
        window.addEventListener('error', (ev) => console.log('[ERR-STACK]', ev.message, ev.filename + ':' + ev.lineno));
      `).catch(() => {});
      win.webContents.once("did-finish-load", async () => {
        await new Promise((r) => setTimeout(r, 2500));
        if (process.env.PECUT_SHOT_VIEW) {
          await win!.webContents.executeJavaScript(`
            document.querySelector('[data-view="${process.env.PECUT_SHOT_VIEW}"]')?.click();
          `);
          await new Promise((r) => setTimeout(r, 1800));
        }
        if (process.env.PECUT_SHOT_CHECK) {
          await win!.webContents.executeJavaScript(process.env.PECUT_SHOT_CHECK);
          await new Promise((r) => setTimeout(r, 1200));
        }
        if (process.env.PECUT_SHOT_MEMORIES) {
          await win!.webContents.executeJavaScript(`
            document.querySelector("#search").value = "ERP planning";
            document.querySelector("#search").dispatchEvent(new Event("input", { bubbles: true }));
          `);
          await new Promise((r) => setTimeout(r, 1500));
        }
        const img = await win!.webContents.capturePage();
        const fs = require("node:fs") as typeof import("node:fs");
        fs.writeFileSync(process.env.PECUT_SHOT!, img.toPNG());
        app.quit();
      });
    }
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
  quickWin.loadFile(path.join(__dirname, "..", "..", "web", "quick.html"));
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
  paletteWin.loadFile(path.join(__dirname, "..", "..", "web", "palette.html"));
  paletteWin.on("closed", () => (paletteWin = null));
}

app.whenReady().then(() => {
  ensureDb();
  startHttpServer();
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

  app.setLoginItemSettings({ openAtLogin: true });

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
