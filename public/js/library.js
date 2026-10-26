const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const search = document.getElementById('search');
const chips = document.querySelectorAll('.chip');

let games = [];
let filter = 'all';

const LABELS = { ds: 'NDS', gba: 'GBA' };

async function init() {
  try {
    const res = await fetch('games.json');
    games = await res.json();
    render();
  } catch (err) {
    grid.innerHTML = '<p class="empty">Impossibile caricare games.json</p>';
    console.error(err);
  }
}

function render() {
  const q = search.value.trim().toLowerCase();
  const list = games.filter(g =>
    (filter === 'all' || g.system === filter) &&
    g.title.toLowerCase().includes(q)
  );

  grid.innerHTML = '';
  empty.hidden = list.length > 0;

  list.forEach(g => {
    const a = document.createElement('a');
    a.className = 'card';
    a.href = `play.html?id=${encodeURIComponent(g.id)}`;

    const img = document.createElement('img');
    img.src = g.cover || '';
    img.alt = g.title;
    img.loading = 'lazy';
    img.onerror = () => { img.style.visibility = 'hidden'; };

    const badge = document.createElement('span');
    badge.className = `badge ${g.system}`;
    badge.textContent = LABELS[g.system] || g.system;

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = g.title;

    a.append(img, badge, title);
    grid.appendChild(a);
  });
}

chips.forEach(chip => {
  chip.addEventListener('click', () => {
    chips.forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    filter = chip.dataset.filter;
    render();
  });
});

search.addEventListener('input', render);
init();