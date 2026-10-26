const CDN = 'https://cdn.emulatorjs.org/stable/data/';
const CORES = { ds: 'nds', gba: 'gba' };
const AUTOSAVE_MS = 60000;
const $ = id => document.getElementById(id);
const statusEl = $('status'), saveBtn = $('save-now'), titleEl = $('game-title');

let gameId = null, saving = false;

const setStatus = t => { statusEl.textContent = t; };
const clock = () => new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

async function uploadState(bytes) {
  if (saving || !bytes || !bytes.length) return;
  saving = true;
  try {
    const r = await Sala.api(`/api/saves/${encodeURIComponent(gameId)}/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes
    });
    if (!r.ok) throw new Error();
    setStatus(`Salvato alle ${clock()}`);
  } catch {
    setStatus('Salvataggio non riuscito');
  } finally {
    saving = false;
  }
}

// Fotografa lo stato attuale del gioco e lo invia al server
function saveNow() {
  const gm = window.EJS_emulator && window.EJS_emulator.gameManager;
  if (!gm) return;
  try { uploadState(gm.getState()); } catch { setStatus('Salvataggio non riuscito'); }
}

function launch(game, user, stateUrl) {
  titleEl.textContent = game.title;
  document.title = game.title;

  window.EJS_player = '#game';
  window.EJS_core = CORES[game.system];
  // Il nome include l'utente: anche sullo stesso browser i dati locali restano separati
  window.EJS_gameName = `${user}__${game.id}`;
  window.EJS_gameUrl = `/rom/${encodeURIComponent(game.id)}${game.ext}`;
  window.EJS_pathtodata = CDN;
  window.EJS_startOnLoaded = true;
  window.EJS_color = '#ff6b8a';
  if (stateUrl) window.EJS_loadStateURL = stateUrl;

  // Il pulsante "Save state" del menu di EmulatorJS salva anche sul server
  window.EJS_onSaveState = data => uploadState(data.state);

  window.EJS_onGameStart = () => {
    saveBtn.hidden = false;
    setStatus(stateUrl ? 'Ripreso dal salvataggio' : 'Nuova partita');
    setInterval(saveNow, AUTOSAVE_MS);
  };

  const s = document.createElement('script');
  s.src = CDN + 'loader.js';
  document.body.appendChild(s);
}

(async () => {
  try {
    const user = await Sala.initUser();
    gameId = new URLSearchParams(location.search).get('id');
    const games = await Sala.json('/api/games');
    const g = games.find(x => x.id === gameId);
    if (!g) throw new Error('Gioco non trovato nella libreria.');

    // L'estensione dell'URL serve a EmulatorJS: la ricavo dal nome indicato in games.json
    //const full = await fetch('/api/games'); // già autenticato, riuso per coerenza
    g.ext = '.' + (g.system === 'gba' ? 'gba' : 'nds');

    Sala.api(`/api/played/${encodeURIComponent(g.id)}`, { method: 'POST' });

    // Se esiste un salvataggio di questo utente lo scarico e lo passo all'emulatore
    let stateUrl = null;
    const r = await fetch(`/api/saves/${encodeURIComponent(g.id)}/state`);
    if (r.ok) stateUrl = URL.createObjectURL(await r.blob());

    saveBtn.addEventListener('click', saveNow);
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
    launch(g, user, stateUrl);
  } catch (err) {
    if (err.message !== 'Sessione scaduta') titleEl.textContent = err.message;
  }
})();