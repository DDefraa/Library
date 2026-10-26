const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const SAVES = path.join(DATA, 'saves');
const PORT = process.env.PORT || 3000;
const DAYS = 30;
fs.mkdirSync(SAVES, { recursive: true });

/* ---------- Segreto per firmare i cookie ---------- */
const SECRET_FILE = path.join(DATA, 'secret.key');
let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  if (!fs.existsSync(SECRET_FILE)) {
    fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  SECRET = fs.readFileSync(SECRET_FILE, 'utf8');
}

/* ---------- Helper ---------- */
const readJSON = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};
const users = () => readJSON(path.join(DATA, 'users.json'), {});
const games = () => readJSON(path.join(ROOT, 'games.json'), []);
const findGame = id => games().find(g => g.id === id);
const userDir = u => {
  const dir = path.join(SAVES, u);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
function makeToken(user) {
  const payload = Buffer.from(JSON.stringify({ u: user, e: Date.now() + DAYS * 864e5 })).toString('base64url');
  return payload + '.' + sign(payload);
}
function readToken(token) {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const a = Buffer.from(sign(payload)), b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return d.e > Date.now() && users()[d.u] ? d.u : null;
  } catch { return null; }
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}

/* ---------- App ---------- */
const app = express();
app.set('trust proxy', 1); // Codespaces / reverse proxy
app.disable('x-powered-by');

app.use((req, res, next) => {
  req.user = readToken(parseCookies(req).sid);
  next();
});

/* Login con limite di tentativi per IP */
const fails = new Map();
const DUMMY = bcrypt.hashSync('dummy-password', 10);
app.post('/api/login', express.json(), async (req, res) => {
  const f = fails.get(req.ip) || { n: 0, t: 0 };
  const fresh = Date.now() - f.t < 15 * 60e3;
  if (fresh && f.n >= 5) {
    return res.status(429).json({ error: 'Troppi tentativi. Riprova tra 15 minuti.' });
  }
  const name = String((req.body && req.body.username) || '').trim().toLowerCase();
  const pass = String((req.body && req.body.password) || '');
  const u = users()[name];
  const ok = await bcrypt.compare(pass, u ? u.hash : DUMMY);
  if (!u || !ok) {
    fails.set(req.ip, { n: (fresh ? f.n : 0) + 1, t: Date.now() });
    return res.status(401).json({ error: 'Nome utente o password errati.' });
  }
  fails.delete(req.ip);
  res.cookie('sid', makeToken(name), {
    httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: DAYS * 864e5
  });
  res.json({ ok: true });
});

/* Tutto il resto richiede il login (tranne la pagina di login) */
const open = ['/login.html', '/css/style.css', '/js/login.js'];
app.use((req, res, next) => {
  if (req.user || open.includes(req.path)) return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/rom/')) {
    return res.status(401).json({ error: 'Non autenticato' });
  }
  res.redirect('/login.html');
});

app.get('/api/me', (req, res) => res.json({ user: req.user }));
app.post('/api/logout', (req, res) => { res.clearCookie('sid'); res.json({ ok: true }); });

app.get('/api/games', (req, res) => {
  res.json(games().map(({ rom, ...pub }) => pub)); // il percorso della ROM non esce dal server
});

/* ROM: l'estensione nell'URL serve a EmulatorJS per riconoscere il formato */
app.get('/rom/:file', (req, res) => {
  const g = games().find(x => x.id + path.extname(x.rom) === req.params.file);
  if (!g) return res.sendStatus(404);
  const file = path.join(ROOT, 'roms', path.basename(g.rom));
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'ROM non trovata in roms/' });
  res.sendFile(file);
});

/* Elenco salvataggi e cronologia dell'utente */
app.get('/api/saves', (req, res) => {
  const dir = userDir(req.user);
  const saved = games().map(g => g.id).filter(id => fs.existsSync(path.join(dir, id + '.state')));
  const recent = readJSON(path.join(dir, 'recent.json'), []);
  res.json({ saved, recent });
});

app.post('/api/played/:id', (req, res) => {
  if (!findGame(req.params.id)) return res.sendStatus(404);
  const file = path.join(userDir(req.user), 'recent.json');
  const list = readJSON(file, []).filter(x => x !== req.params.id);
  list.unshift(req.params.id);
  fs.writeFileSync(file, JSON.stringify(list.slice(0, 12)));
  res.json({ ok: true });
});

app.get('/api/saves/:id/state', (req, res) => {
  if (!findGame(req.params.id)) return res.sendStatus(404);
  const file = path.join(userDir(req.user), req.params.id + '.state');
  if (!fs.existsSync(file)) return res.sendStatus(404);
  res.set('Cache-Control', 'no-store');
  res.sendFile(file);
});

app.put('/api/saves/:id/state', express.raw({ type: () => true, limit: '100mb' }), (req, res) => {
  if (!findGame(req.params.id)) return res.sendStatus(404);
  if (!Buffer.isBuffer(req.body) || req.body.length < 16) return res.status(400).json({ error: 'Salvataggio vuoto' });
  const file = path.join(userDir(req.user), req.params.id + '.state');
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, req.body);
  fs.renameSync(tmp, file); // scrittura atomica: un crash non corrompe il salvataggio precedente
  res.json({ ok: true, savedAt: Date.now() });
});

app.use(express.static(path.join(ROOT, 'public')));

app.listen(PORT, '0.0.0.0', () => console.log(`Sala giochi attiva sulla porta ${PORT}`));