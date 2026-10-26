(() => {
  'use strict';

  /* ================= Configurazione ================= */
  const HASH = '6425a1d679dcbf5a61484b3d00ade2c15bf573f6691cdcd760e2ca88c0447f24'; // sala1234
  const AUTH_KEY = 'sala-auth';
  const PROFILE_KEY = 'sala-profile';
  const CDN = 'https://cdn.emulatorjs.org/stable/data/';
  const AUTOSAVE_MS = 60000;
  const CORES = { ds: 'nds', gba: 'gba' };
  const NAMES = { ds: 'Nintendo DS', gba: 'Game Boy Advance' };
  const LIBRETRO = { ds: 'Nintendo - Nintendo DS', gba: 'Nintendo - Game Boy Advance' };

  const $ = id => document.getElementById(id);
  const sha = async t => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
  window.sha = sha; // per generare un nuovo hash dalla console

  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
    del: k => { try { localStorage.removeItem(k); } catch {} }
  };

  /* ================= IndexedDB ================= */
  // roms = dati del gioco, files = file della ROM, states = salvataggi
  const dbp = new Promise((ok, ko) => {
    const r = indexedDB.open('sala-giochi', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('roms', { keyPath: 'id' });
      r.result.createObjectStore('files');
      r.result.createObjectStore('states');
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
  async function db(store, mode, fn) {
    const d = await dbp;
    return new Promise((ok, ko) => {
      const t = d.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => ok(req && req.result);
      t.onerror = t.onabort = () => ko(t.error);
    });
  }
  const dbGet = (s, k) => db(s, 'readonly', o => o.get(k));
  const dbPut = (s, v, k) => db(s, 'readwrite', o => o.put(v, k));
  const dbDel = (s, k) => db(s, 'readwrite', o => o.delete(k));
  const dbAll = s => db(s, 'readonly', o => o.getAll());
  const dbKeys = s => db(s, 'readonly', o => o.getAllKeys());

  /* ================= Password e profilo ================= */
  function unlock() {
    if (ls.get(AUTH_KEY) === HASH) {
      document.body.classList.remove('locked');
      return Promise.resolve();
    }
    return new Promise(res => {
      const form = $('gate'), err = $('gate-err');
      $('gate-pass').focus();
      form.addEventListener('submit', async e => {
        e.preventDefault();
        if ((await sha($('gate-pass').value)) === HASH) {
          ls.set(AUTH_KEY, HASH);
          document.body.classList.remove('locked');
          res();
        } else {
          err.hidden = false;
          form.classList.remove('shake');
          void form.offsetWidth;
          form.classList.add('shake');
        }
      });
    });
  }

  function askProfile() {
    const dlg = $('profile-dlg'), input = $('profile-name');
    const hasProfile = !!ls.get(PROFILE_KEY);
    input.value = ls.get(PROFILE_KEY) || '';
    $('profile-cancel').hidden = !hasProfile;
    $('profile-cancel').onclick = () => dlg.close();
    dlg.oncancel = e => { if (!hasProfile) e.preventDefault(); };
    return new Promise(res => {
      $('profile-form').onsubmit = e => {
        e.preventDefault();
        const name = input.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20);
        if (!name) return;
        ls.set(PROFILE_KEY, name);
        dlg.close();
        res(name);
      };
      dlg.showModal();
    });
  }

  /* ================= Copertine ================= */
  function coverSources(g) {
    const name = (g.coverName || g.title).replace(/[&*\/:`<>?\\|"]/g, '_');
    return [`https://thumbnails.libretro.com/${encodeURIComponent(LIBRETRO[g.system])}/Named_Boxarts/${encodeURIComponent(name)}.png`];
  }
  function placeholder(g) {
    let h = 0;
    for (const c of g.title) h = (h * 31 + c.charCodeAt(0)) % 360;
    const d = document.createElement('div');
    d.className = 'ph';
    d.style.background = `linear-gradient(145deg, hsl(${h} 45% 32%), hsl(${(h + 50) % 360} 50% 22%))`;
    d.textContent = g.title.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    return d;
  }
  function coverEl(g) {
    const srcs = coverSources(g);
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    let i = 0;
    img.onerror = () => { ++i < srcs.length ? (img.src = srcs[i]) : img.replaceWith(placeholder(g)); };
    img.src = srcs[0];
    return img;
  }

  /* ================= Libreria ================= */
  async function libraryMode(profile) {
    $('lib-bar').hidden = false;
    $('lib').hidden = false;
    $('profile-btn').textContent = `Profilo: ${profile}`;
    $('profile-btn').onclick = async () => { await askProfile(); location.reload(); };
    $('lock-btn').onclick = () => { ls.del(AUTH_KEY); location.reload(); };

    const RECENT_KEY = `recent:${profile}`;
    let roms = [], savedIds = new Set(), filter = 'all';
    const getRecent = () => { try { return JSON.parse(ls.get(RECENT_KEY) || '[]'); } catch { return []; } };

    async function load() {
      roms = (await dbAll('roms')).sort((a, b) => a.title.localeCompare(b.title));
      const keys = await dbKeys('states');
      savedIds = new Set(keys.filter(k => k.startsWith(profile + '__')).map(k => k.slice(profile.length + 2)));
      render();
    }

    function render() {
      const q = $('search').value.trim().toLowerCase();
      const list = roms.filter(g => (filter === 'all' || g.system === filter) && g.title.toLowerCase().includes(q));
      const grid = $('grid');
      grid.innerHTML = '';
      $('empty').hidden = roms.length > 0;
      $('count').textContent = list.length ? `${list.length} ${list.length === 1 ? 'gioco' : 'giochi'}` : '';

      list.forEach(g => {
        const a = document.createElement('a');
        a.className = 'card';
        a.href = `index.html?play=${encodeURIComponent(g.id)}`;
        const art = document.createElement('div');
        art.className = 'art';
        art.appendChild(coverEl(g));

        const tag = document.createElement('span');
        tag.className = `tag ${g.system}`;
        tag.textContent = g.system === 'ds' ? 'DS' : 'GBA';
        art.appendChild(tag);

        if (savedIds.has(g.id)) {
          const s = document.createElement('span');
          s.className = 'tag saved';
          s.textContent = 'In corso';
          art.appendChild(s);
        }

        const del = document.createElement('button');
        del.className = 'del';
        del.title = 'Rimuovi dal browser';
        del.textContent = '✕';
        del.onclick = async e => {
          e.preventDefault();
          if (!confirm(`Rimuovere "${g.title}" da questo browser? I salvataggi restano e tornano se la riaggiungi.`)) return;
          await dbDel('roms', g.id);
          await dbDel('files', g.id);
          load();
        };
        art.appendChild(del);

        const t = document.createElement('div');
        t.className = 'card-title';
        t.textContent = g.title;
        a.append(art, t);
        grid.appendChild(a);
      });

      // Continua a giocare
      const items = getRecent().map(id => roms.find(g => g.id === id)).filter(Boolean).slice(0, 4);
      $('recent-section').hidden = !items.length;
      const rec = $('recent');
      rec.innerHTML = '';
      items.forEach(g => {
        const a = document.createElement('a');
        a.className = 'recent-item';
        a.href = `index.html?play=${encodeURIComponent(g.id)}`;
        const art = document.createElement('div');
        art.className = 'recent-art';
        art.appendChild(coverEl(g));
        const t = document.createElement('div');
        t.innerHTML = '<strong></strong><span class="muted"></span>';
        t.querySelector('strong').textContent = g.title;
        t.querySelector('span').textContent = savedIds.has(g.id) ? 'Riprendi dal salvataggio' : NAMES[g.system];
        a.append(art, t);
        rec.appendChild(a);
      });
    }

    async function addFiles(files) {
      const skipped = [];
      let added = 0;
      for (const f of files) {
        const ext = f.name.split('.').pop().toLowerCase();
        const system = ext === 'gba' ? 'gba' : ext === 'nds' ? 'ds' : null;
        if (!system) { skipped.push(f.name); continue; }
        const base = f.name.replace(/\.[^.]+$/, '');
        const id = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + system;
        await dbPut('files', f, id);
        await dbPut('roms', {
          id, system, ext, coverName: base,
          title: base.replace(/\s*[\(\[].*?[\)\]]/g, '').trim() || base,
          added: Date.now()
        });
        added++;
      }
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); // evita che il browser le cancelli
      const note = $('notice');
      note.hidden = !(skipped.length || added);
      note.textContent = skipped.length
        ? `Formato non supportato: ${skipped.join(', ')}. Usa file .nds o .gba (estrai gli zip prima).`
        : `${added} ${added === 1 ? 'gioco aggiunto' : 'giochi aggiunti'}.`;
      load();
    }

    document.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.seg-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      filter = b.dataset.filter;
      render();
    }));
    $('search').addEventListener('input', render);
    $('add-rom').addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });

    load();
  }

  /* ================= Gioco ================= */
  async function playMode(id, profile) {
    $('player').hidden = false;
    const meta = await dbGet('roms', id);
    const titleEl = $('game-title'), statusEl = $('status');
    const setStatus = t => { statusEl.textContent = t; };
    const clock = () => new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

    if (!meta) {
      titleEl.textContent = 'Gioco non trovato';
      $('start-title').textContent = 'Questa ROM non è in questo browser';
      $('start-note').textContent = 'Torna alla libreria e aggiungila con "Aggiungi ROM".';
      $('start-btn').hidden = true;
      return;
    }

    titleEl.textContent = meta.title;
    document.title = meta.title;
    $('start-title').textContent = meta.title;

    const key = `${profile}__${id}`;
    const saved = await dbGet('states', key);
    $('start-note').textContent = saved
      ? `Riprendi dal salvataggio di ${profile} (${new Date(saved.at).toLocaleString('it-IT')})`
      : `Nuova partita per ${profile}`;

    // Cronologia per profilo
    try {
      const k = `recent:${profile}`;
      const list = JSON.parse(ls.get(k) || '[]').filter(x => x !== id);
      list.unshift(id);
      ls.set(k, JSON.stringify(list.slice(0, 8)));
    } catch {}

    async function persist(bytes) {
      if (!bytes || !bytes.length) return;
      try {
        await dbPut('states', { data: bytes, at: Date.now() }, key);
        setStatus(`Salvato alle ${clock()}`);
      } catch {
        setStatus('Salvataggio non riuscito');
      }
    }
    function saveNow() {
      const gm = window.EJS_emulator && window.EJS_emulator.gameManager;
      if (!gm) return;
      try { persist(gm.getState()); } catch { setStatus('Salvataggio non riuscito'); }
    }

    $('save-now').addEventListener('click', saveNow);
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

    $('export').addEventListener('click', async () => {
      const st = await dbGet('states', key);
      if (!st) { alert('Non c\'è ancora nessun salvataggio da esportare.'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([st.data]));
      a.download = `${id}-${profile}.state`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });

    $('import').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      if (!confirm('Importare questo file sostituirà il tuo salvataggio attuale di questo gioco. Continuare?')) return;
      await dbPut('states', { data: new Uint8Array(await f.arrayBuffer()), at: Date.now() }, key);
      location.reload();
    });

    // Il click su "Avvia" serve anche a sbloccare l'audio del browser
    $('start-btn').addEventListener('click', async () => {
      $('start').hidden = true;
      const file = await dbGet('files', id);
      window.EJS_player = '#game';
      window.EJS_core = CORES[meta.system];
      // Nome unico per profilo e gioco; l'estensione aiuta l'emulatore a riconoscere il formato
      window.EJS_gameName = `${key}.${meta.ext}`;
      window.EJS_gameUrl = URL.createObjectURL(file);
      window.EJS_pathtodata = CDN;
      window.EJS_startOnLoaded = true;
      window.EJS_color = '#ff6b8a';
      if (saved) window.EJS_loadStateURL = URL.createObjectURL(new Blob([saved.data]));

      // Il pulsante "Save state" del menu dell'emulatore salva anche nel tuo profilo
      window.EJS_onSaveState = d => persist(d.state);
      window.EJS_onGameStart = () => {
        $('save-now').disabled = false;
        setStatus(saved ? 'Ripreso dal salvataggio' : 'Nuova partita');
        setInterval(saveNow, AUTOSAVE_MS);
      };

      const s = document.createElement('script');
      s.src = CDN + 'loader.js';
      document.body.appendChild(s);
    });
  }

  /* ================= Avvio ================= */
  (async () => {
    await unlock();
    let profile = ls.get(PROFILE_KEY);
    if (!profile) profile = await askProfile();
    const id = new URLSearchParams(location.search).get('play');
    if (id) await playMode(id, profile);
    else await libraryMode(profile);
  })();
})();