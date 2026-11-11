const form = document.getElementById('login-form');
const errorBox = document.getElementById('login-error');
const button = form.querySelector('button[type="submit"]');

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

fetch('/api/auth/status')
  .then((r) => r.json())
  .then((s) => {
    if (s.user) location.replace('/');
    else if (!s.hasUsers) document.getElementById('login-setup').hidden = false;
  })
  .catch(() => {});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = form.username.value.trim();
  const password = form.password.value;
  if (!username || !password) return showError('Enter your username and password.');
  button.disabled = true;
  showError('');
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      location.replace('/');
      return;
    }
    showError(body.error || `Login failed (${res.status}).`);
    form.password.value = '';
    form.password.focus();
  } catch {
    showError('Could not reach the server. Check your connection and try again.');
  } finally {
    button.disabled = false;
  }
});
