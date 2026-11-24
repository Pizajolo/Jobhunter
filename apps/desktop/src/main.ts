/**
 * Jobhunter desktop shell (spec §3.5): starts the engine as a child process, shows the UI, keeps
 * running in the tray so daily scans happen while the laptop is awake, catches up after sleep,
 * and turns engine notifications into OS notifications.
 */
import { app, BrowserWindow, Menu, Notification, Tray, nativeImage, powerMonitor, shell, utilityProcess, type UtilityProcess } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

interface EngineMessage {
  type: 'ready' | 'notification';
  url?: string;
  title?: string;
  body?: string;
  urgent?: boolean;
  link?: string | null;
}

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let engine: UtilityProcess | null = null;
let engineUrl = '';
let quitting = false;

const resources = app.isPackaged ? join(process.resourcesPath, 'app') : join(__dirname, '../../..');
const paths = app.isPackaged
  ? { engine: join(resources, 'engine/main.js'), web: join(resources, 'web'), icon: join(process.resourcesPath, 'icon.png') }
  : { engine: join(resources, 'apps/engine/dist/main.js'), web: join(resources, 'apps/web/dist'), icon: join(resources, 'apps/desktop/build/icon.png') };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
  });
}

const browsersPath = () => join(app.getPath('userData'), 'ms-playwright');

/** First run: download Playwright's Chromium (PDF rendering and applying) into the user data folder. */
function ensureChromium(): Promise<void> {
  const dir = browsersPath();
  if (existsSync(dir) && readdirSync(dir).some((d) => d.startsWith('chromium'))) return Promise.resolve();
  const cli = join(app.isPackaged ? join(process.resourcesPath, 'app') : resources, 'node_modules/playwright/cli.js');
  if (!existsSync(cli)) return Promise.resolve();
  new Notification({ title: 'Jobhunter', body: 'Downloading the browser used for PDFs and applications (one time)…' }).show();
  return new Promise((resolve) => {
    const p: ChildProcess = spawn(process.execPath, [cli, 'install', 'chromium'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PLAYWRIGHT_BROWSERS_PATH: dir },
      stdio: 'ignore',
    });
    p.on('exit', () => resolve());
    p.on('error', () => resolve());
  });
}

async function startEngine(): Promise<string> {
  const port = await freePort();
  return new Promise((resolve, reject) => {
    engine = utilityProcess.fork(paths.engine, [], {
      serviceName: 'Jobhunter engine',
      stdio: 'inherit',
      env: {
        ...process.env,
        JOBHUNTER_MODE: 'desktop',
        JOBHUNTER_PORT: String(port),
        JOBHUNTER_HOST: '127.0.0.1',
        JOBHUNTER_WEB_DIST: paths.web,
        PLAYWRIGHT_BROWSERS_PATH: browsersPath(),
      },
    });
    const timer = setTimeout(() => reject(new Error('The Jobhunter engine did not start in time')), 60_000);
    engine.on('message', (m: EngineMessage) => {
      if (m.type === 'ready' && m.url) {
        clearTimeout(timer);
        resolve(m.url);
      } else if (m.type === 'notification') {
        showNotification(m);
      }
    });
    engine.on('exit', (code) => {
      engine = null;
      if (!quitting) {
        clearTimeout(timer);
        reject(new Error(`The Jobhunter engine stopped (code ${code})`));
      }
    });
  });
}

function showNotification(m: EngineMessage): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: m.title ?? 'Jobhunter', body: m.body ?? '', urgency: m.urgent ? 'critical' : 'normal' });
  n.on('click', () => {
    showWindow();
    if (m.link && win) void win.loadURL(`${engineUrl}${m.link}`);
  });
  n.show();
}

function showWindow(): void {
  if (!win) createWindow();
  win?.show();
  win?.focus();
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 380,
    title: 'Jobhunter',
    icon: paths.icon,
    backgroundColor: '#F6F6F3',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(engineUrl)) void shell.openExternal(url);
    return { action: url.startsWith(engineUrl) ? 'allow' : 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(engineUrl)) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });
  win.on('close', (e) => {
    // Keep running in the tray so scheduled scans and email checks continue.
    if (!quitting && process.platform !== 'linux') {
      e.preventDefault();
      win?.hide();
    }
  });
  win.on('closed', () => (win = null));
  void win.loadURL(engineUrl);
}

function buildTray(): void {
  const icon = existsSync(paths.icon) ? nativeImage.createFromPath(paths.icon).resize({ width: 18, height: 18 }) : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('Jobhunter');
  const refresh = () =>
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Jobhunter', click: showWindow },
        { label: 'Scan now', click: () => void fetch(`${engineUrl}/api/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }) },
        { type: 'separator' },
        {
          label: 'Start at login',
          type: 'checkbox',
          checked: app.getLoginItemSettings().openAtLogin,
          click: (item) => {
            app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] });
            refresh();
          },
        },
        { type: 'separator' },
        {
          label: 'Quit Jobhunter',
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ]),
    );
  refresh();
  tray.on('click', showWindow);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(async () => {
    try {
      await ensureChromium();
      engineUrl = await startEngine();
    } catch (err) {
      const { dialog } = await import('electron');
      dialog.showErrorBox('Jobhunter could not start', String(err instanceof Error ? err.message : err));
      app.quit();
      return;
    }
    buildTray();
    const hidden = process.argv.includes('--hidden');
    if (!hidden) createWindow();
    // Catch up on missed scans after the laptop wakes up.
    powerMonitor.on('resume', () => engine?.postMessage({ type: 'resume' }));
    powerMonitor.on('unlock-screen', () => engine?.postMessage({ type: 'resume' }));
  });
  app.on('activate', showWindow);
  app.on('window-all-closed', () => {
    if (process.platform === 'linux' && !tray) app.quit();
  });
  app.on('before-quit', () => {
    quitting = true;
    engine?.kill();
  });
}
