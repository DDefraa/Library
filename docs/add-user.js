const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const [, , name, pass] = process.argv;
if (!name || !pass) {
  console.log('Uso: npm run adduser -- nome password');
  process.exit(1);
}
if (!/^[a-z0-9_-]{2,24}$/i.test(name)) {
  console.log('Il nome può contenere solo lettere, numeri, - e _ (2-24 caratteri).');
  process.exit(1);
}
if (pass.length < 8) {
  console.log('La password deve avere almeno 8 caratteri.');
  process.exit(1);
}

const dir = path.join(__dirname, 'data');
const file = path.join(dir, 'users.json');
fs.mkdirSync(dir, { recursive: true });
let users = {};
try { users = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
const existed = !!users[name.toLowerCase()];
users[name.toLowerCase()] = { hash: bcrypt.hashSync(pass, 12) };
fs.writeFileSync(file, JSON.stringify(users, null, 2));
console.log(existed ? `Password di "${name}" aggiornata.` : `Utente "${name}" creato.`);