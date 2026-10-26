const form = document.getElementById('login');
const err = document.getElementById('err');

form.addEventListener('submit', async e => {
  e.preventDefault();
  err.hidden = true;
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: document.getElementById('username').value,
      password: document.getElementById('password').value
    })
  });
  if (res.ok) {
    location.href = '/';
    return;
  }
  const data = await res.json().catch(() => ({}));
  err.textContent = data.error || 'Accesso non riuscito.';
  err.hidden = false;
  form.classList.remove('shake');
  void form.offsetWidth;
  form.classList.add('shake');
});