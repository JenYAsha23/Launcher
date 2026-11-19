const $ = (s) => document.querySelector(s);
const S = { settings: null, versions: [], filter: 'release', loader: 'vanilla', mc: null, avail: { vanilla: true } };
const LN = { vanilla: 'Vanilla', fabric: 'Fabric', forge: 'Forge' };
const TYPE = { release: 'релиз', snapshot: 'снапшот', old_beta: 'beta', old_alpha: 'alpha' };

const target = () => ({ mc: S.mc, loader: S.loader });
const log = (m) => { const c = $('#log'); c.textContent += m + '\n'; c.scrollTop = c.scrollHeight; };

function summary() {
  $('#heroTitle').textContent = S.mc ? `Minecraft ${S.mc}` : 'Minecraft';
  $('#heroSub').textContent = S.mc ? `${LN[S.loader]} · ${$('#nick').value || 'без ника'}` : 'Выбери версию';
  $('#modsFor').textContent = S.mc ? `Для ${S.mc} · ${LN[S.loader]}` : '';
  $('#skinnote').textContent = S.loader === 'vanilla'
    ? 'Для скинов выбери Fabric или Forge на вкладке «Играть».'
    : 'Скин и плащ применятся при запуске.';
}

/* ---- навигация ---- */
document.querySelectorAll('.nav').forEach((b) => b.onclick = () => {
  document.querySelectorAll('.nav').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('on', p.id === 'p-' + b.dataset.p));
  if (b.dataset.p === 'mods') refreshMods();
});

/* ---- версии ---- */
function renderVersions() {
  const q = $('#search').value.trim().toLowerCase();
  const list = S.versions.filter((v) => v.type === S.filter && v.id.toLowerCase().includes(q));
  const box = $('#vlist');
  box.innerHTML = '';
  for (const v of list) {
    const d = document.createElement('div');
    d.className = 'vi' + (v.id === S.mc ? ' on' : '');
    d.textContent = v.id;
    const sm = document.createElement('small');
    sm.textContent = v.date.slice(0, 10);
    d.appendChild(sm);
    d.onclick = () => selectVersion(v.id);
    box.appendChild(d);
  }
}
async function selectVersion(id) {
  S.mc = id;
  renderVersions();
  S.avail = await window.api.loaders(id);
  if (!S.avail[S.loader]) S.loader = 'vanilla';
  renderLoaders();
  summary();
  refreshMods();
}
function renderLoaders() {
  document.querySelectorAll('#loaders button').forEach((b) => {
    b.disabled = !S.avail[b.dataset.l];
    b.classList.toggle('on', b.dataset.l === S.loader);
  });
}

/* ---- моды ---- */
async function refreshMods() { if (S.mc) renderMods(await window.api.modsList(target())); }
function renderMods(mods) {
  const ul = $('#mods');
  ul.innerHTML = '';
  if (!mods.length) {
    const li = document.createElement('li');
    li.className = 'empty'; li.textContent = 'Модов пока нет';
    ul.appendChild(li); return;
  }
  for (const m of mods) {
    const li = document.createElement('li');
    if (!m.enabled) li.className = 'off';
    const name = document.createElement('span');
    name.className = 'nm'; name.textContent = m.name;
    const box = document.createElement('div');
    const tg = document.createElement('button');
    tg.className = 'btn'; tg.textContent = m.enabled ? 'Выключить' : 'Включить';
    tg.onclick = async () => renderMods(await window.api.modsToggle(target(), m.file));
    const rm = document.createElement('button');
    rm.className = 'btn ghost'; rm.textContent = 'Удалить';
    rm.onclick = async () => renderMods(await window.api.modsRemove(target(), m.file));
    box.append(tg, rm);
    li.append(name, box);
    ul.appendChild(li);
  }
}
function modsBlocked() {
  if (S.loader === 'vanilla') {
    log('Моды не работают на Vanilla — выбери Fabric или Forge.');
    $('#status').textContent = 'Для модов выбери Fabric или Forge';
    return true;
  }
  return false;
}

/* ---- скин: полная фигурка ---- */
async function drawSkin() {
  const data = await window.api.skinData('skin');
  const c = $('#body'), ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, c.width, c.height);
  if (!data) return;
  const img = new Image();
  img.onload = () => {
    const s = 8, modern = img.height >= 64;
    const part = (sx, sy, sw, sh, dx, dy, flip) => {
      if (flip) {
        ctx.save(); ctx.translate((dx + sw) * s, 0); ctx.scale(-1, 1);
        ctx.drawImage(img, sx, sy, sw, sh, 0, dy * s, sw * s, sh * s); ctx.restore();
      } else ctx.drawImage(img, sx, sy, sw, sh, dx * s, dy * s, sw * s, sh * s);
    };
    part(4, 20, 4, 12, 4, 20);                                   // правая нога
    modern ? part(20, 52, 4, 12, 8, 20) : part(4, 20, 4, 12, 8, 20, true);
    part(20, 20, 8, 12, 4, 8);                                   // тело
    part(44, 20, 4, 12, 0, 8);                                   // правая рука
    modern ? part(36, 52, 4, 12, 12, 8) : part(44, 20, 4, 12, 12, 8, true);
    part(8, 8, 8, 8, 4, 0);                                      // голова
    if (modern) {
      part(4, 36, 4, 12, 4, 20); part(4, 52, 4, 12, 8, 20);      // штаны
      part(20, 36, 8, 12, 4, 8);                                 // куртка
      part(44, 36, 4, 12, 0, 8); part(52, 52, 4, 12, 12, 8);     // рукава
    }
    part(40, 8, 8, 8, 4, 0);                                     // шляпа
  };
  img.src = data;
}

/* ---- init ---- */
async function init() {
  S.settings = await window.api.getSettings();
  $('#nick').value = S.settings.nick;
  $('#ram').value = S.settings.ram;
  $('#ramv').textContent = S.settings.ram;
  S.loader = S.settings.loader;
  S.mc = S.settings.mc;

  try { S.versions = await window.api.versions(); }
  catch { $('#status').textContent = 'Нет интернета и нет кэша версий'; }
  if (!S.mc && S.versions.length) S.mc = S.versions.find((v) => v.type === 'release').id;
  renderVersions();
  if (S.mc) await selectVersion(S.mc);
  summary();
  drawSkin();

  document.querySelectorAll('#filters button').forEach((b) => b.onclick = () => {
    S.filter = b.dataset.f;
    document.querySelectorAll('#filters button').forEach((x) => x.classList.toggle('on', x === b));
    renderVersions();
  });
  document.querySelectorAll('#loaders button').forEach((b) => b.onclick = () => {
    if (b.disabled) return;
    S.loader = b.dataset.l; renderLoaders(); summary(); refreshMods();
  });
  $('#search').oninput = renderVersions;
  $('#nick').oninput = summary;
  $('#ram').oninput = (e) => { $('#ramv').textContent = e.target.value; };

  $('#addmod').onclick = async () => { if (!modsBlocked()) renderMods(await window.api.modsPick(target())); };
  $('#openfolder').onclick = () => window.api.openFolder(target());

  const drop = $('#drop');
  window.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) drop.classList.remove('over'); });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (modsBlocked()) return;
    const paths = [...e.dataTransfer.files].map((f) => window.api.pathOf(f)).filter((p) => /\.jar$/i.test(p));
    if (paths.length) renderMods(await window.api.modsAdd(target(), paths));
  });

  $('#pickskin').onclick = async () => { if (await window.api.pickImage('skin')) drawSkin(); };
  $('#pickcape').onclick = async () => { if (await window.api.pickImage('cape')) log('Плащ выбран'); };
  $('#clearskin').onclick = async () => { await window.api.clearImage('skin'); await window.api.clearImage('cape'); drawSkin(); };

  $('#play').onclick = async () => {
    const r = await window.api.launch({ nick: $('#nick').value.trim(), mc: S.mc, loader: S.loader, ram: Number($('#ram').value) });
    if (!r.ok) $('#status').textContent = r.error;
  };

  window.api.onLog(log);
  window.api.onStatus((m) => { $('#status').textContent = m; });
  window.api.onProgress((p) => {
    if (p.total) $('#barfill').style.width = Math.round((p.task / p.total) * 100) + '%';
    $('#status').textContent = `Загрузка: ${p.type} ${p.task}/${p.total}`;
  });
  window.api.onState((s) => {
    $('#play').disabled = s.running;
    $('#playMain').textContent = s.running ? 'ЗАПУСК...' : 'ИГРАТЬ';
    if (!s.running) { $('#barfill').style.width = '0'; $('#status').textContent = 'Готов'; }
    else if (s.started) { $('#barfill').style.width = '100%'; $('#status').textContent = 'Игра запущена'; }
  });
}
init();
