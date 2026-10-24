const CDN = 'https://cdn.emulatorjs.org/stable/data/';
const CORES = { ds: 'nds', gba: 'gba' };

const params = new URLSearchParams(location.search);
const gameId = params.get('id');
const titleEl = document.getElementById('game-title');

function startEmulator({ title, system, url }) {
  titleEl.textContent = title;
  document.title = title;

  // Variabili globali lette da EmulatorJS
  window.EJS_player = '#game';
  window.EJS_core = CORES[system];
  window.EJS_gameName = title;          // usato anche per nome salvataggi
  window.EJS_gameUrl = url;
  window.EJS_pathtodata = CDN;
  window.EJS_startOnLoaded = true;
  window.EJS_color = '#7c5cff';

  const s = document.createElement('script');
  s.src = CDN + 'loader.js';
  document.body.appendChild(s);
}

async function loadFromLibrary() {
  if (!gameId) {
    titleEl.textContent = 'Nessun gioco selezionato';
    return;
  }
  try {
    const res = await fetch('games.json');
    const games = await res.json();
    const game = games.find(g => g.id === gameId);
    if (!game) throw new Error('Gioco non trovato');
    startEmulator({ title: game.title, system: game.system, url: game.rom });
  } catch (err) {
    titleEl.textContent = 'Errore: ' + err.message;
  }
}

// Alternativa: carichi la ROM direttamente dal tuo PC (non passa dal server)
document.getElementById('local-rom').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  const system = ext === 'gba' ? 'gba' : 'ds';
  // Con una pagina già avviata l'emulatore va ricaricato
  const url = URL.createObjectURL(file);
  sessionStorage.setItem('localRom', JSON.stringify({
    title: file.name.replace(/\.[^.]+$/, ''), system
  }));
  window.__localUrl = url;
  if (window.EJS_emulator) location.reload();
  else startEmulator({ title: file.name, system, url });
});

loadFromLibrary();