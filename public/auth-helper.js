// ── auth-helper.js — Adicione este script ao seu index.html ──────────────────
// Cole o conteúdo abaixo dentro de uma tag <script> no início do seu index.html
// ANTES de qualquer outra função que chame a API

// ── Gerenciamento de Token ─────────────────────────────────────────────────
function getToken() {
  return localStorage.getItem('oraculoToken');
}

function getAuthHeaders() {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };
}

function logout() {
  localStorage.removeItem('oraculoToken');
  localStorage.removeItem('oraculoUsername');
  localStorage.removeItem('oraculoRole');
  window.location.href = '/login.html';
}

// Verifica token ao carregar a página
async function checkAuth() {
  const token = getToken();
  if (!token) { window.location.href = '/login.html'; return; }
  try {
    const r = await fetch('/api/auth/verify', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const d = await r.json();
    if (!d.valid) { logout(); return; }
    // Mostra nome do usuário na topbar
    const el = document.getElementById('loggedUser');
    if (el) el.textContent = d.username;
  } catch { logout(); }
}

// Substitui o fetch global para sempre incluir o token
const _originalFetch = window.fetch.bind(window);
window.fetch = function(url, options = {}) {
  // Só adiciona auth para chamadas da própria API
  if (typeof url === 'string' && url.startsWith('/api/')) {
    const token = getToken();
    if (token) {
      options.headers = {
        ...options.headers,
        'Authorization': `Bearer ${token}`
      };
    }
  }
  return _originalFetch(url, options).then(async res => {
    // Se API retornar 401, redireciona para login
    if (res.status === 401 && typeof url === 'string' && url.startsWith('/api/')) {
      const data = await res.clone().json().catch(() => ({}));
      if (data.error?.includes('expirada') || data.error?.includes('inválido')) {
        logout();
        return res;
      }
    }
    return res;
  });
};

// Executa verificação ao carregar
checkAuth();
