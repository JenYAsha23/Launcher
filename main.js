const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { execFile } = require('child_process');
const { Client, Authenticator } = require('minecraft-launcher-core');

const ROOT = path.join(app.getPath('appData'), '.mclauncher');
const SETTINGS = path.join(ROOT, 'settings.json');
const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
const UA = { 'User-Agent': 'MCLauncher/1.0' };
const DEFAULTS = { nick: 'Player', mc: null, loader: 'vanilla', ram: 4, javaPath: '' };

let win;
let running = false;

process.on('uncaughtException', (e) => { try { dialog.showErrorBox('Ошибка лаунчера', String(e && e.stack || e)); } catch {} });
process.on('unhandledRejection', (e) => { try { log('Ошибка: ' + (e && e.message || e)); } catch {} });

/* ---------- helpers ---------- */
const ensure = (p) => fsp.mkdir(p, { recursive: true });
const send = (ch, data) => win && !win.isDestroyed() && win.webContents.send(ch, data);
const log = (m) => send('log', String(m));

async function readSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(await fsp.readFile(SETTINGS, 'utf8')) }; }
  catch { return { ...DEFAULTS }; }
}
async function writeSettings(patch) {
  const s = { ...(await readSettings()), ...patch };
  await ensure(ROOT);
  await fsp.writeFile(SETTINGS, JSON.stringify(s, null, 2));
  return s;
}
async function getJSON(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}
async function download(url, dest) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  await ensure(path.dirname(dest));
  await fsp.writeFile(dest, Buffer.from(await r.arrayBuffer()));
}
function checkTarget(t) {
  if (!t || !/^[\w.+\- ]+$/.test(t.mc) || !['vanilla', 'fabric', 'forge'].includes(t.loader)) {
    throw new Error('Bad version');
  }
}
const instKey = (t) => (t.loader === 'vanilla' ? t.mc : `${t.mc}-${t.loader}`);
const instDir = (t) => { checkTarget(t); return path.join(ROOT, 'instances', instKey(t)); };
const modsDir = (t) => path.join(instDir(t), 'mods');

async function getManifest() {
  const cache = path.join(ROOT, 'manifest.json');
  try {
    const m = await getJSON(MANIFEST_URL);
    await ensure(ROOT);
    await fsp.writeFile(cache, JSON.stringify(m));
    return m;
  } catch (e) {
    return JSON.parse(await fsp.readFile(cache, 'utf8')); // offline fallback
  }
}

/* ---------- Java ---------- */
function findJava(major) {
  const win32 = process.platform === 'win32';
  const bases = win32
    ? ['C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Microsoft',
       'C:\\Program Files\\Zulu', 'C:\\Program Files\\BellSoft', 'C:\\Program Files\\Amazon Corretto',
       'C:\\Program Files (x86)\\Java']
    : ['/usr/lib/jvm', '/Library/Java/JavaVirtualMachines'];
  const found = [];
  for (const b of bases) {
    let dirs = [];
    try { dirs = fs.readdirSync(b); } catch { continue; }
    for (const d of dirs) {
      const m = d.match(/(?:1\.)?(\d+)/);
      if (!m) continue;
      const home = process.platform === 'darwin' ? path.join(b, d, 'Contents', 'Home') : path.join(b, d);
      const exe = path.join(home, 'bin', win32 ? 'java.exe' : 'java');
      if (fs.existsSync(exe)) found.push({ major: parseInt(m[1], 10), exe });
    }
  }
  const exact = found.find((f) => f.major === major);
  return exact ? exact.exe : null;
}

function findExe(dir, depth = 0) {
  const name = process.platform === 'win32' ? 'java.exe' : 'java';
  const direct = path.join(dir, 'bin', name);
  if (fs.existsSync(direct)) return direct;
  if (depth > 3) return null;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const r = findExe(path.join(dir, e.name), depth + 1);
    if (r) return r;
  }
  return null;
}
function extract(archive, dest) {
  return new Promise((res, rej) =>
    execFile('tar', ['-xf', archive, '-C', dest], (e, _o, se) =>
      e ? rej(new Error('Не удалось распаковать Java: ' + (se || e.message))) : res()));
}
// Java не нужна заранее: если нет подходящей — скачиваем портативную (Adoptium) в папку лаунчера
async function resolveJava(major, settings) {
  if (settings.javaPath) return settings.javaPath;
  const rt = path.join(ROOT, 'runtime', `java${major}`);
  let exe = findExe(rt);
  if (exe) return exe;
  const sys = findJava(major);
  if (sys) return sys;
  send('status', `Скачиваю Java ${major} (один раз)...`);
  log(`Java ${major} не найдена, скачиваю...`);
  const os = { win32: 'windows', linux: 'linux', darwin: 'mac' }[process.platform];
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  const ext = os === 'windows' ? 'zip' : 'tar.gz';
  const tmp = path.join(ROOT, 'runtime', `java${major}.${ext}`);
  await download(`https://api.adoptium.net/v3/binary/latest/${major}/ga/${os}/${arch}/jre/hotspot/normal/eclipse`, tmp);
  await ensure(rt);
  send('status', 'Распаковываю Java...');
  await extract(tmp, rt);
  await fsp.rm(tmp, { force: true });
  exe = findExe(rt);
  if (!exe) throw new Error('Java не найдена после распаковки');
  return exe;
}

/* ---------- IPC: settings / versions ---------- */
ipcMain.handle('settings:get', readSettings);
ipcMain.handle('settings:set', (_, p) => writeSettings(p));

ipcMain.handle('versions:list', async () => {
  const m = await getManifest();
  return m.versions.map((v) => ({ id: v.id, type: v.type, date: v.releaseTime }));
});

ipcMain.handle('loaders:list', async (_, mc) => {
  const out = { vanilla: true, fabric: false, forge: false };
  try {
    const l = await getJSON(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}`);
    out.fabric = Array.isArray(l) && l.length > 0;
  } catch {}
  try {
    const p = await getJSON('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
    out.forge = !!(p.promos[`${mc}-recommended`] || p.promos[`${mc}-latest`]);
  } catch {}
  return out;
});

/* ---------- IPC: mods ---------- */
async function listMods(t) {
  const d = modsDir(t);
  await ensure(d);
  const files = await fsp.readdir(d);
  return files
    .filter((f) => /\.jar(\.disabled)?$/i.test(f))
    .map((f) => ({ file: f, name: f.replace(/\.disabled$/, ''), enabled: !f.endsWith('.disabled') }));
}
ipcMain.handle('mods:list', (_, t) => listMods(t));
ipcMain.handle('mods:add', async (_, t, paths) => {
  const d = modsDir(t);
  await ensure(d);
  for (const p of paths) {
    if (!/\.jar$/i.test(p)) continue;
    await fsp.copyFile(p, path.join(d, path.basename(p)));
  }
  return listMods(t);
});
ipcMain.handle('mods:pick', async (_, t) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Mods', extensions: ['jar'] }] });
  if (r.canceled) return listMods(t);
  const d = modsDir(t);
  await ensure(d);
  for (const p of r.filePaths) await fsp.copyFile(p, path.join(d, path.basename(p)));
  return listMods(t);
});
ipcMain.handle('mods:remove', async (_, t, f) => {
  await fsp.rm(path.join(modsDir(t), path.basename(f)), { force: true });
  return listMods(t);
});
ipcMain.handle('mods:toggle', async (_, t, f) => {
  const d = modsDir(t);
  const base = path.basename(f);
  const to = base.endsWith('.disabled') ? base.slice(0, -9) : base + '.disabled';
  await fsp.rename(path.join(d, base), path.join(d, to));
  return listMods(t);
});
ipcMain.handle('folder:open', async (_, t) => {
  const d = instDir(t);
  await ensure(d);
  shell.openPath(d);
});

/* ---------- IPC: skins ---------- */
const imgPath = (kind) => path.join(ROOT, 'skins', kind === 'cape' ? 'cape.png' : 'skin.png');
ipcMain.handle('skin:pick', async (_, kind) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (r.canceled) return null;
  await ensure(path.dirname(imgPath(kind)));
  await fsp.copyFile(r.filePaths[0], imgPath(kind));
  return skinData(kind);
});
ipcMain.handle('skin:clear', async (_, kind) => { await fsp.rm(imgPath(kind), { force: true }); return null; });
async function skinData(kind) {
  try { return 'data:image/png;base64,' + (await fsp.readFile(imgPath(kind))).toString('base64'); }
  catch { return null; }
}
ipcMain.handle('skin:data', (_, kind) => skinData(kind));

async function ensureSkinMod(t) {
  const d = modsDir(t);
  const files = await fsp.readdir(d).catch(() => []);
  if (files.some((f) => /customskinloader/i.test(f))) return;
  log('Ставлю CustomSkinLoader для скинов...');
  const q = `game_versions=${encodeURIComponent(JSON.stringify([t.mc]))}&loaders=${encodeURIComponent(JSON.stringify([t.loader]))}`;
  const versions = await getJSON(`https://api.modrinth.com/v2/project/customskinloader/version?${q}`);
  if (!versions.length) throw new Error('нет сборки CustomSkinLoader для этой версии');
  const f = versions[0].files.find((x) => x.primary) || versions[0].files[0];
  await download(f.url, path.join(d, f.filename));
}
async function applySkin(t, nick) {
  const base = path.join(instDir(t), 'CustomSkinLoader', 'LocalSkin');
  for (const [kind, sub] of [['skin', 'skins'], ['cape', 'capes']]) {
    if (fs.existsSync(imgPath(kind))) {
      await ensure(path.join(base, sub));
      await fsp.copyFile(imgPath(kind), path.join(base, sub, `${nick}.png`));
    }
  }
}

/* ---------- IPC: launch ---------- */
ipcMain.handle('game:launch', async (_, o) => {
  if (running) return { ok: false, error: 'Игра уже запускается' };
  const t = { mc: o.mc, loader: o.loader };
  try {
    checkTarget(t);
    if (!/^[A-Za-z0-9_]{3,16}$/.test(o.nick)) throw new Error('Ник: 3–16 символов, латиница, цифры, _');
    running = true;
    send('state', { running: true });
    await writeSettings({ nick: o.nick, mc: o.mc, loader: o.loader, ram: o.ram });
    const settings = await readSettings();

    const manifest = await getManifest();
    const entry = manifest.versions.find((v) => v.id === t.mc);
    if (!entry) throw new Error('Версия не найдена');

    // нужная Java
    let major = 8;
    try { major = (await getJSON(entry.url)).javaVersion?.majorVersion || 8; } catch {}
    const javaPath = await resolveJava(major, settings);
    log(`Java ${major}+ → ${javaPath}`);

    await ensure(instDir(t));
    const opts = {
      authorization: Authenticator.getAuth(o.nick), // офлайн, без лицензии
      root: ROOT,
      javaPath,
      overrides: { gameDirectory: instDir(t) },
      version: { number: t.mc, type: entry.type === 'release' ? 'release' : 'snapshot' },
      memory: { max: `${o.ram}G`, min: '1G' }
    };

    if (t.loader === 'fabric') {
      const loaders = await getJSON(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(t.mc)}`);
      const pick = loaders.find((l) => l.loader.stable) || loaders[0];
      const id = `fabric-loader-${pick.loader.version}-${t.mc}`;
      const prof = await getJSON(`https://meta.fabricmc.net/v2/versions/loader/${t.mc}/${pick.loader.version}/profile/json`);
      const vdir = path.join(ROOT, 'versions', id);
      await ensure(vdir);
      await fsp.writeFile(path.join(vdir, `${id}.json`), JSON.stringify(prof));
      opts.version.custom = id;
      log(`Fabric ${pick.loader.version}`);
    } else if (t.loader === 'forge') {
      const promos = (await getJSON('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')).promos;
      const fv = promos[`${t.mc}-recommended`] || promos[`${t.mc}-latest`];
      const jar = path.join(ROOT, 'forge', `forge-${t.mc}-${fv}-installer.jar`);
      if (!fs.existsSync(jar)) {
        log(`Скачиваю Forge ${fv}...`);
        await download(`https://maven.minecraftforge.net/net/minecraftforge/forge/${t.mc}-${fv}/forge-${t.mc}-${fv}-installer.jar`, jar);
      }
      opts.forge = jar;
    }

    // скины — через CustomSkinLoader (только Fabric/Forge)
    if (t.loader !== 'vanilla' && (fs.existsSync(imgPath('skin')) || fs.existsSync(imgPath('cape')))) {
      try { await ensureSkinMod(t); await applySkin(t, o.nick); }
      catch (e) { log('Скин не установлен: ' + e.message); }
    }

    const client = new Client();
    client.on('debug', (m) => log(m));
    client.on('data', (m) => log(m));
    client.on('progress', (p) => send('progress', p));
    client.on('close', (code) => { running = false; send('state', { running: false }); log(`Игра закрыта (код ${code})`); });

    const proc = await client.launch(opts);
    if (!proc) throw new Error('Не удалось запустить (проверь Java и лог)');
    send('state', { running: true, started: true });
    return { ok: true };
  } catch (e) {
    running = false;
    send('state', { running: false });
    log('Ошибка: ' + e.message);
    return { ok: false, error: e.message };
  }
});

/* ---------- window ---------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1120, height: 720, minWidth: 980, minHeight: 640,
    backgroundColor: '#0b0f14', autoHideMenuBar: true, title: 'MC Launcher',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-fail-load', (_e, code, desc) => dialog.showErrorBox('Не загрузился интерфейс', `${code} ${desc}`));
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) console.log('[renderer]', msg); });
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
