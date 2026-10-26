const Sala = (() => {
  // fetch che rimanda al login se la sessione è scaduta
  async function api(url, opt) {
    const r = await fetch(url, opt);
    if (r.status === 401) {
      location.href = '/login.html';
      throw new Error('Sessione scaduta');
    }
    return r;
  }
  const json = async (url, opt) => (await api(url, opt)).json();

  async function initUser() {
    const { user } = await json('/api/me');
    const el = document.getElementById('user');
    if (el) {
      el.innerHTML = '<span></span><button class="link">Esci</button>';
      el.querySelector('span').textContent = user;
      el.querySelector('button').onclick = async () => {
        await fetch('/api/logout', { method: 'POST' });
        location.href = '/login.html';
      };
    }
    return user;
  }

  return { api, json, initUser };
})();