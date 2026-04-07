const API_BASE       = 'https://script.google.com/macros/s/AKfycbyBLlVjEvO35RufIh6pH9XOOTDXuj_BMrNHAJfdw9I-reScWX31dsVdOFJna1ZbJVqX/exec';
const API_TIMEOUT_MS = 15000;
const SEMANA_TTL     = 30000;  // 30 s
const PRESENCA_TTL   = 15000;  // 15 s
const RP_NAME        = 'Riva BJJ';

/* ── localStorage key constants ──────────────────────────────── */
const LS_EMAIL        = 'rv_email';
const LS_NOME         = 'rv_nome';
const LS_PROF_EMAIL   = 'rv_prof_email';
const LS_PROF_NOME    = 'rv_prof_nome';
// Biometric keys – intentionally kept on logout so next login skips re-registration
const LS_CREDENTIAL   = 'rv_credentialId';
const LS_BIO_ATIVADA  = 'rv_biometria_ativada';

/* ── JSONP helper ─────────────────────────────────────────────── */
function apiCall(params) {
  return new Promise((resolve, reject) => {
    const cb = '_rv' + Date.now() + Math.floor(Math.random() * 9999);
    const s  = document.createElement('script');
    const t  = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, API_TIMEOUT_MS);
    function cleanup() { clearTimeout(t); delete window[cb]; s.remove(); }
    window[cb] = (d) => { cleanup(); resolve(d); };
    s.onerror   = () => { cleanup(); reject(new Error('net')); };
    const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    s.src = `${API_BASE}?${qs}&callback=${cb}`;
    document.head.appendChild(s);
  });
}

/* ── Helpers ──────────────────────────────────────────────────── */
const $    = id => document.getElementById(id);
const show = id => $(id).classList.remove('hidden');
const hide = id => $(id).classList.add('hidden');

/* ── WebAuthn / Biometria ──────────────────────────────────────── */
let bioAction = 'unlock'; // 'unlock' | 'register'

function b64urlEncode(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

function webAuthnAvailable() {
  return !!(window.PublicKeyCredential &&
            navigator.credentials &&
            typeof navigator.credentials.create === 'function' &&
            typeof navigator.credentials.get   === 'function');
}

function bioErrorMsg(e) {
  if (e.name === 'NotAllowedError')
    return 'Autenticação cancelada ou negada. Toque em "Desbloquear" para tentar novamente.';
  if (e.name === 'NotSupportedError')
    return 'Biometria não suportada neste dispositivo ou navegador.';
  if (e.name === 'SecurityError')
    return 'Erro de segurança. Verifique se o site está em HTTPS.';
  if (e.name === 'InvalidStateError')
    return 'Biometria já registrada neste dispositivo.';
  return `Erro ao autenticar: ${e.message || 'desconhecido'}.`;
}

async function bioRegister(email) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId    = crypto.getRandomValues(new Uint8Array(16));
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: RP_NAME, id: location.hostname },
      user: { id: userId, name: email, displayName: email },
      challenge,
      pubKeyCredParams: [
        { type: 'public-key', alg: -7   },  // ES256
        { type: 'public-key', alg: -257 },  // RS256
      ],
      authenticatorSelection: {
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
      attestation: 'none',
    },
  });
  localStorage.setItem(LS_CREDENTIAL,      b64urlEncode(cred.rawId));
  localStorage.setItem(LS_BIO_ATIVADA, '1');
}

async function bioAuthenticate() {
  const challenge  = crypto.getRandomValues(new Uint8Array(32));
  const credIdStr  = localStorage.getItem(LS_CREDENTIAL);
  const allowCreds = credIdStr
    ? [{ type: 'public-key', id: b64urlDecode(credIdStr) }]
    : [];
  await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: allowCreds,
      userVerification: 'required',
      timeout: 60000,
    },
  });
}

function showBioLock(mode) {
  bioAction = mode;
  ['cardLogin', 'cardAluno', 'cardAgendar', 'cardProf', 'cardBioLock', 'cardNoSupport'].forEach(hide);
  hide('mainNav');
  if (mode === 'unlock') {
    $('bioIcon').textContent     = '🔒';
    $('bioTitle').textContent    = 'Riva BJJ';
    $('bioSubtitle').textContent = 'Use biometria para desbloquear o app.';
    $('btnBioAction').textContent = '🔓 Desbloquear';
  } else {
    $('bioIcon').textContent     = '🔐';
    $('bioTitle').textContent    = 'Ativar Biometria';
    $('bioSubtitle').textContent = 'Para sua segurança, registre sua biometria neste dispositivo antes de continuar.';
    $('btnBioAction').textContent = '🔐 Registrar Biometria';
  }
  $('bioErr').textContent  = '';
  $('bioInfo').textContent = '';
  show('cardBioLock');
}

async function onBioAction() {
  $('btnBioAction').disabled = true;
  $('bioErr').textContent    = '';
  $('bioInfo').textContent   = 'Aguardando biometria…';
  const email = localStorage.getItem(LS_EMAIL) || localStorage.getItem(LS_PROF_EMAIL) || '';
  try {
    if (bioAction === 'register') {
      await bioRegister(email);
    } else {
      await bioAuthenticate();
    }
    $('bioInfo').textContent = '';
    afterBioSuccess();
  } catch (e) {
    $('bioInfo').textContent = '';
    $('bioErr').textContent  = bioErrorMsg(e);
  } finally {
    $('btnBioAction').disabled = false;
  }
}

function afterBioSuccess() {
  hide('cardBioLock');
  const email  = localStorage.getItem(LS_EMAIL);
  const nome   = localStorage.getItem(LS_NOME);
  const pEmail = localStorage.getItem(LS_PROF_EMAIL);
  const pNome  = localStorage.getItem(LS_PROF_NOME);
  

  if (pEmail && pNome) {
    profData = { nome: pNome, email: pEmail };
    showProfPage();
    apiCall({ action: 'profLoginEmail', email: pEmail })
      .then(r => { if (r && r.ok) { profData = r.data; $('pNome').textContent = profData.nome || 'Professor'; } })
      .catch(() => {});
    return;
  }

  if (email && nome) {
    alunoData = { nome };
    preencherCard(alunoData);
    apiCall({ action: 'loginEmail', email })
      .then(r => { if (r && r.ok) { alunoData = r.data; preencherCard(alunoData); } })
      .catch(() => {});
    showTab('Home');
    return;
  }

  // No session data: show login as fallback
  showTab('Home');
}

function onBioSwitchAccount() {
  alunoData = null;
  profData  = null;
  localStorage.removeItem(LS_EMAIL);
  localStorage.removeItem(LS_NOME);
  localStorage.removeItem(LS_PROF_EMAIL);
  localStorage.removeItem(LS_PROF_NOME);
  hide('cardBioLock');
  showTab('Home');
}

function afterLoginSuccess() {
  const bioOk  = localStorage.getItem(LS_BIO_ATIVADA) === '1';
  const credId = localStorage.getItem(LS_CREDENTIAL);
  if (bioOk && credId) {
    afterBioSuccess();
  } else {
    showBioLock('register');
  }
}

/* ── State ────────────────────────────────────────────────────── */
let alunoData    = null;
let profData     = null;
let semanaCache  = null;   // { ts, data }
let presenceCache = {};    // { "data|horario": { ts, data } }
let presencaInFlight = {}; // key -> true (in-flight guard)
let aSelDia      = null;
let aSelSessao   = null;
let pSelDia      = null;
let pSelSessao   = null;

/* ── Professor week helpers ───────────────────────────────────── */
const NOMES_DIA_PT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

function getProfWeekDays() {
  // Returns 6 Date objects (Mon–Sat) for the current week.
  // If today is Sunday, returns next week's Mon–Sat.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = today.getDay(); // 0=Sun, 1=Mon, …, 6=Sat
  const daysToMon = dow === 0 ? 1 : -(dow - 1);
  const monday = new Date(today);
  monday.setDate(today.getDate() + daysToMon);
  const days = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }
  return days;
}

function formatDate(d) {
  return String(d.getDate()).padStart(2, '0') + '/' +
         String(d.getMonth() + 1).padStart(2, '0') + '/' +
         d.getFullYear();
}

/* ── Cache helpers ────────────────────────────────────────────── */
function getCachedSemana() {
  if (semanaCache && Date.now() - semanaCache.ts < SEMANA_TTL) return semanaCache.data;
  return null;
}

function presencaCacheKey(data, horario) { return data + '|' + horario; }

function getCachedPresenca(data, horario) {
  const c = presenceCache[presencaCacheKey(data, horario)];
  if (c && Date.now() - c.ts < PRESENCA_TTL) return c.data;
  return null;
}

function setCachedPresenca(data, horario, lista) {
  presenceCache[presencaCacheKey(data, horario)] = { ts: Date.now(), data: lista };
}

function invalidatePresenca(data, horario) {
  delete presenceCache[presencaCacheKey(data, horario)];
}

/* ── Navigation ───────────────────────────────────────────────── */
function showTab(tab) {
  ['cardLogin', 'cardAluno', 'cardAgendar', 'cardProf', 'cardBioLock', 'cardNoSupport'].forEach(hide);
  ['navHome', 'navAgendar'].forEach(id => $(id).classList.remove('on'));

  // Show nav only for logged-in students; professors have no bottom nav (handled in showProfPage)
  if (alunoData) show('mainNav'); else hide('mainNav');

  if (tab === 'Home') {
    $('navHome').classList.add('on');
    if (profData) { showProfPage(); return; }
    alunoData ? show('cardAluno') : show('cardLogin');
  } else if (tab === 'Agendar') {
    $('navAgendar').classList.add('on');
    if (!alunoData) { show('cardLogin'); return; }
    show('cardAgendar');
    loadSemana('aluno');
  }
}

function showProfPage() {
  ['cardLogin', 'cardAluno', 'cardAgendar'].forEach(hide);
  show('cardProf');
  hide('mainNav');
  $('pNome').textContent = profData ? (profData.nome || 'Professor') : '—';
  loadSemanaProfessor();
}

/* ── Week schedule ────────────────────────────────────────────── */
async function loadSemana(ctx) {
  const cached = getCachedSemana();
  if (cached) { renderDias(ctx, cached); return; }

  const rowId = ctx === 'prof' ? 'profDiasRow' : 'diasRow';
  $(rowId).innerHTML = '<p class="loading">Carregando…</p>';
  try {
    const r = await apiCall({ action: 'treinosSemana' });
    if (r.ok) {
      semanaCache = { ts: Date.now(), data: r.data };
      renderDias(ctx, r.data);
    } else {
      $(rowId).innerHTML = '<p class="msg err">Erro ao carregar treinos.</p>';
    }
  } catch (e) {
    $(rowId).innerHTML = '<p class="msg err">Erro de conexão.</p>';
  }
}

function renderDias(ctx, semana) {
  const rowId = ctx === 'prof' ? 'profDiasRow' : 'diasRow';
  const row   = $(rowId);
  row.innerHTML = '';
  const dias = semana.filter(d => d.treinos && d.treinos.length);
  dias.forEach(dia => {
    const btn = document.createElement('button');
    btn.className = 'dia-btn';
    btn.innerHTML =
      `<span class="dia-nome">${dia.nomeDia}</span>` +
      `<span class="dia-data">${dia.data.slice(0, 5)}</span>`;
    btn.addEventListener('click', () => {
      row.querySelectorAll('.dia-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectDia(ctx, dia);
    });
    row.appendChild(btn);
  });

  // Prefetch: auto-select first available day
  if (dias.length > 0) {
    row.children[0].classList.add('active');
    if (ctx === 'prof') { pSelDia = dias[0]; pSelSessao = null; hide('profPresencaBox'); }
    else                { aSelDia = dias[0]; aSelSessao = null; hide('presencaBox'); }
    renderSessoes(ctx, dias[0]);
  } else {
    if (ctx === 'prof') { hide('profSessoesLista'); hide('profPresencaBox'); }
    else                { hide('sessoesLista');     hide('presencaBox'); }
  }
}

/* ── Professor week loader (Mon–Sat of current week) ─────────── */
async function loadSemanaProfessor() {
  const rowId = 'profDiasRow';
  $(rowId).innerHTML = '<p class="loading">Carregando…</p>';
  try {
    let semanaData = getCachedSemana();
    if (!semanaData) {
      const r = await apiCall({ action: 'treinosSemana' });
      if (!r.ok) {
        $(rowId).innerHTML = '<p class="msg err">Erro ao carregar treinos.</p>';
        return;
      }
      semanaCache = { ts: Date.now(), data: r.data };
      semanaData  = r.data;
    }

    // Build dow → treinos map (0=Dom … 6=Sáb)
    const treinosByDow = {};
    semanaData.forEach(d => { treinosByDow[d.diaSemana] = d.treinos || []; });

    // Build Mon–Sat array with locally-computed dates
    const profSemana = getProfWeekDays().map(date => ({
      data:      formatDate(date),
      diaSemana: date.getDay(),
      nomeDia:   NOMES_DIA_PT[date.getDay()],
      treinos:   treinosByDow[date.getDay()] || [],
    }));

    renderDiasProfessor(profSemana);
  } catch (e) {
    $(rowId).innerHTML = '<p class="msg err">Erro de conexão.</p>';
  }
}

function renderDiasProfessor(profSemana) {
  const row = $('profDiasRow');
  row.innerHTML = '';

  const today    = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = formatDate(today);

  let defaultIdx = 0; // fallback: Monday (first button)
  profSemana.forEach((dia, i) => {
    const btn = document.createElement('button');
    btn.className = 'dia-btn';
    btn.innerHTML =
      `<span class="dia-nome">${dia.nomeDia}</span>` +
      `<span class="dia-data">${dia.data.slice(0, 5)}</span>`;
    btn.addEventListener('click', () => {
      row.querySelectorAll('.dia-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectDia('prof', dia);
    });
    row.appendChild(btn);
    if (dia.data === todayStr) defaultIdx = i;
  });

  if (row.children.length > 0) {
    row.children[defaultIdx].classList.add('active');
    pSelDia    = profSemana[defaultIdx];
    pSelSessao = null;
    hide('profPresencaBox');
    renderSessoes('prof', profSemana[defaultIdx]);
  }
}

function selectDia(ctx, dia) {
  if (ctx === 'prof') { pSelDia = dia; pSelSessao = null; hide('profPresencaBox'); }
  else                { aSelDia = dia; aSelSessao = null; hide('presencaBox');     }
  renderSessoes(ctx, dia);
}

function renderSessoes(ctx, dia) {
  const listaId = ctx === 'prof' ? 'profSessoesLista' : 'sessoesLista';
  const lista   = $(listaId);
  lista.innerHTML = '';

  if (!dia.treinos.length) {
    lista.innerHTML = '<p class="presenca-vazia">Sem treinos neste dia.</p>';
    if (ctx === 'prof') pSelSessao = null; else aSelSessao = null;
    show(listaId);
    return;
  }

  dia.treinos.forEach(t => {
    const card = document.createElement('div');
    card.className = 'sessao-card';
    card.innerHTML =
      `<span class="sessao-hor">${t.horario}</span>` +
      `<span class="sessao-nome">${t.nome}</span>`;
    card.addEventListener('click', () => {
      lista.querySelectorAll('.sessao-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      const sessao = { data: dia.data, horario: t.horario, nome: t.nome };
      if (ctx === 'prof') pSelSessao = sessao; else aSelSessao = sessao;
      loadPresenca(ctx, sessao);
    });
    lista.appendChild(card);
  });
  show(listaId);

  // Auto-select first session (highlight only, no presence prefetch)
  if (dia.treinos.length > 0) {
    lista.children[0].classList.add('active');
    const t = dia.treinos[0];
    const sessao = { data: dia.data, horario: t.horario, nome: t.nome };
    if (ctx === 'prof') pSelSessao = sessao; else aSelSessao = sessao;
  }
}

/* ── Presence list ────────────────────────────────────────────── */
async function loadPresenca(ctx, sessao) {
  const k = presencaCacheKey(sessao.data, sessao.horario);
  if (presencaInFlight[k]) return;

  const boxId    = ctx === 'prof' ? 'profPresencaBox'    : 'presencaBox';
  const listaId  = ctx === 'prof' ? 'profPresencaLista'  : 'presencaLista';
  const tituloId = ctx === 'prof' ? 'profPresencaTitulo' : 'presencaTitulo';

  $(tituloId).textContent = `${sessao.data.slice(0, 5)} · ${sessao.horario} · ${sessao.nome}`;
  show(boxId);

  // Serve from cache if fresh
  const cached = getCachedPresenca(sessao.data, sessao.horario);
  if (cached) {
    renderPresencaLista(ctx, cached, sessao);
    return;
  }

  presencaInFlight[k] = true;
  $(listaId).innerHTML = '<p class="loading">Carregando…</p>';
  if (ctx !== 'prof') { hide('btnCheckin'); hide('btnDeletarCheckin'); }

  try {
    const r = await apiCall({ action: 'listaPresenca', data: sessao.data, horario: sessao.horario });
    if (!r.ok) { $(listaId).innerHTML = `<p class="msg err">${r.erro || 'Erro'}</p>`; return; }
    setCachedPresenca(sessao.data, sessao.horario, r.data || []);
    renderPresencaLista(ctx, r.data || [], sessao);
  } catch (e) {
    $(listaId).innerHTML = '<p class="msg err">Erro de conexão.</p>';
  } finally {
    delete presencaInFlight[k];
  }
}

function statusCls(s) {
  if (s.includes('VALIDADO'))  return 'status-ok';
  if (s.includes('REPROVADO')) return 'status-err';
  return 'status-pend';
}

function renderPresencaLista(ctx, lista, sessao) {
  const listaId = ctx === 'prof' ? 'profPresencaLista' : 'presencaLista';
  const el      = $(listaId);

  if (!lista.length) {
    el.innerHTML = '<p class="presenca-vazia">Nenhum check-in ainda.</p>';
  } else {
    el.innerHTML = lista.map(item => {
      const sc      = statusCls(item.status);
      const actions = (ctx === 'prof' && item.status.includes('PENDENTE'))
        ? `<div class="prof-actions">
             <button class="btn-ap aprovar" data-linha="${item.linha}">✓ Aprovar</button>
             <button class="btn-ap reprovar" data-linha="${item.linha}">✗ Reprovar</button>
           </div>`
        : '';
      return `<div class="presenca-item">
        <div class="presenca-info">
          <span class="presenca-nome">${item.nome}</span>
          <span class="presenca-status ${sc}">${item.status}</span>
        </div>
        ${actions}
      </div>`;
    }).join('');

    if (ctx === 'prof') {
      el.querySelectorAll('.btn-ap.aprovar').forEach(btn =>
        btn.addEventListener('click', () => profAprovar(+btn.dataset.linha, sessao, btn)));
      el.querySelectorAll('.btn-ap.reprovar').forEach(btn =>
        btn.addEventListener('click', () => profReprovar(+btn.dataset.linha, sessao, btn)));
    }
  }

  if (ctx !== 'prof' && alunoData) {
    const meu = lista.find(i =>
      i.nome.trim().toLowerCase() === (alunoData.nome || '').trim().toLowerCase());
    if (meu) {
      hide('btnCheckin');
      meu.status.includes('PENDENTE') ? show('btnDeletarCheckin') : hide('btnDeletarCheckin');
    } else {
      show('btnCheckin');
      hide('btnDeletarCheckin');
    }
  }
}

/* ── Student check-in / cancel ────────────────────────────────── */
async function fazerCheckin() {
  if (!aSelSessao || !alunoData) return;
  $('btnCheckin').disabled = true;
  try {
    const r = await apiCall({
      action:  'checkin',
      email:   localStorage.getItem(LS_EMAIL) || '',
      data:    aSelSessao.data,
      horario: aSelSessao.horario,
      treino:  aSelSessao.nome,
    });
    if (r.ok) {
      invalidatePresenca(aSelSessao.data, aSelSessao.horario);
      loadPresenca('aluno', aSelSessao);
    } else {
      alert(r.erro || 'Erro ao fazer check-in.');
    }
  } catch (e) { alert('Erro de conexão.'); }
  finally { $('btnCheckin').disabled = false; }
}

async function deletarCheckin() {
  if (!aSelSessao || !alunoData) return;
  if (!confirm('Cancelar seu check-in neste treino?')) return;
  $('btnDeletarCheckin').disabled = true;
  try {
    const r = await apiCall({
      action:  'deletarCheckin',
      email:   localStorage.getItem(LS_EMAIL) || '',
      data:    aSelSessao.data,
      horario: aSelSessao.horario,
    });
    if (r.ok) {
      invalidatePresenca(aSelSessao.data, aSelSessao.horario);
      loadPresenca('aluno', aSelSessao);
    } else {
      alert(r.erro || 'Erro ao cancelar check-in.');
    }
  } catch (e) { alert('Erro de conexão.'); }
  finally { $('btnDeletarCheckin').disabled = false; }
}

/* ── Professor approve / reject ───────────────────────────────── */
async function profAprovar(linha, sessao, btn) {
  btn.disabled = true;
  try {
    const r = await apiCall({
      action:    'aprovar',
      emailProf: localStorage.getItem(LS_PROF_EMAIL) || '',
      linha,
    });
    if (r.ok) {
      invalidatePresenca(sessao.data, sessao.horario);
      loadPresenca('prof', sessao);
    } else {
      alert(r.erro || 'Erro ao aprovar.');
    }
  } catch (e) { alert('Erro de conexão.'); }
  finally { btn.disabled = false; }
}

async function profReprovar(linha, sessao, btn) {
  btn.disabled = true;
  try {
    const r = await apiCall({
      action:    'reprovar',
      emailProf: localStorage.getItem(LS_PROF_EMAIL) || '',
      linha,
    });
    if (r.ok) {
      invalidatePresenca(sessao.data, sessao.horario);
      loadPresenca('prof', sessao);
    } else {
      alert(r.erro || 'Erro ao reprovar.');
    }
  } catch (e) { alert('Erro de conexão.'); }
  finally { btn.disabled = false; }
}

/* ── Graduandos ───────────────────────────────────────────────── */
async function carregarGraduandos() {
  const lista = $('profGraduandosLista');
  lista.innerHTML = '<p class="loading">Carregando…</p>';
  try {
    const r = await apiCall({ action: 'graduandos' });
    if (!r || !r.ok) throw new Error((r && r.erro) ? r.erro : 'Falha ao carregar.');
    renderGraduandos(r.data || []);
  } catch (e) {
    lista.innerHTML = `<p class="msg err">Erro ao carregar graduandos. ${e.message || ''}</p>`;
  }
}

function renderGraduandos(graduandos) {
  const el = $('profGraduandosLista');
  if (!graduandos.length) {
    el.innerHTML = '<p class="presenca-vazia">Nenhum graduando no momento.</p>';
    return;
  }
  el.innerHTML = graduandos.map(a => {
    const grau = (a.grau != null && a.grau !== '')
      ? `<span class="presenca-status status-ok">Grau ${a.grau}</span>`
      : '';
    const restantes = (a.restantes != null && a.restantes !== '')
      ? `<div class="prof-grad-restantes"><span class="presenca-status status-pend">${a.restantes} restantes</span></div>`
      : '';
    return `<div class="presenca-item">
      <div class="presenca-info">
        <span class="presenca-nome">${a.nome || ''}</span>
        <span class="presenca-status status-ok">${a.faixa || ''}</span>
        ${grau}
      </div>${restantes}
    </div>`;
  }).join('');
}

/* ── Student card ─────────────────────────────────────────────── */
function preencherCard(d) {
  $('aNome').textContent  = d.nome  || '—';
  $('aFaixa').textContent = d.faixa || '—';
  $('aGrau').textContent  = (d.grau != null) ? d.grau : '—';
  $('aAulas').textContent = (d.aulasNoGrau != null) ? `${d.aulasNoGrau} / ${d.metaGrau}` : '—';
  $('aData').textContent  = d.dataGrau || '—';
  $('aStatus').textContent = d.statusExame || d.status || '—';
}

/* ── Generic login ────────────────────────────────────────────── */
async function loginGeneric() {
  const email = $('email').value.trim().toLowerCase();
  if (!email || email.indexOf('@') < 1) { $('err').textContent = 'Email inválido.'; return; }
  $('err').textContent  = '';
  $('info').textContent = 'Buscando…';
  $('btnLogin').disabled = true;
  try {
    // Try professor first
    const rProf = await apiCall({ action: 'profLoginEmail', email });
    if (rProf.ok) {
      profData = rProf.data;
      localStorage.setItem(LS_PROF_EMAIL, email);
      localStorage.setItem(LS_PROF_NOME,  profData.nome || '');
      semanaCache = null;
      pSelDia = null; pSelSessao = null;
      $('info').textContent = '';
      afterLoginSuccess();
      return;
    }
    // Try student
    const r = await apiCall({ action: 'loginEmail', email });
    if (!r.ok) { $('err').textContent = r.erro || 'Email não encontrado.'; $('info').textContent = ''; return; }
    alunoData = r.data;
    localStorage.setItem(LS_EMAIL,  email);
    localStorage.setItem(LS_NOME, alunoData.nome || '');
    preencherCard(alunoData);
    $('info').textContent = '';
    afterLoginSuccess();
  } catch (e) {
    $('err').textContent = 'Erro de conexão.';
  } finally {
    $('info').textContent  = '';
    $('btnLogin').disabled = false;
  }
}

function logout() {
  alunoData   = null;
  semanaCache = null;
  presenceCache = {};
  aSelDia = null; aSelSessao = null;
  localStorage.removeItem(LS_EMAIL);
  localStorage.removeItem(LS_NOME);
  // Keep rv_credentialId and rv_biometria_ativada so next login skips re-registration
  $('email').value = '';
  hide('mainNav');
  showTab('Home');
}

/* ── Professor logout ─────────────────────────────────────────── */
function profLogout() {
  profData     = null;
  semanaCache  = null;
  presenceCache = {};
  pSelDia = null; pSelSessao = null;
  localStorage.removeItem(LS_PROF_EMAIL);
  localStorage.removeItem(LS_PROF_NOME);
  // Keep rv_credentialId and rv_biometria_ativada so next login skips re-registration
  hide('profGraduandosBox');
  hide('cardProf');
  showTab('Home');
}

/* ── Init ─────────────────────────────────────────────────────── */
function init() {
  // 1) WebAuthn support check (mandatory)
  if (!webAuthnAvailable()) {
    ['cardLogin', 'cardAluno', 'cardAgendar', 'cardProf'].forEach(hide);
    hide('mainNav');
    show('cardNoSupport');
    return;
  }

  // 2) Wire up biometric buttons
  $('btnBioAction').addEventListener('click', onBioAction);
  $('btnBioLogout').addEventListener('click', onBioSwitchAccount);

  // 3) Wire up student buttons
  $('btnLogin').addEventListener('click', loginGeneric);
  $('email').addEventListener('keydown', e => { if (e.key === 'Enter') loginGeneric(); });
  $('btnSair').addEventListener('click', logout);
  $('btnAtualizar').addEventListener('click', async () => {
    const e = localStorage.getItem(LS_EMAIL);
    if (!e) return;
    const r = await apiCall({ action: 'loginEmail', email: e }).catch(() => null);
    if (r && r.ok) { alunoData = r.data; preencherCard(alunoData); }
  });
  $('btnCheckin').addEventListener('click', fazerCheckin);
  $('btnDeletarCheckin').addEventListener('click', deletarCheckin);

  // 4) Wire up professor buttons
  $('btnProfSair').addEventListener('click', profLogout);
  $('btnGraduandos').addEventListener('click', async () => {
    const box = $('profGraduandosBox');
    if (box.classList.contains('hidden')) {
      show('profGraduandosBox');
      await carregarGraduandos();
    } else {
      hide('profGraduandosBox');
    }
  });

  // 5) Bottom nav
  $('navHome').addEventListener('click',    () => showTab('Home'));
  $('navAgendar').addEventListener('click', () => showTab('Agendar'));

  // 6) Check for existing session and decide initial screen
  const email  = localStorage.getItem(LS_EMAIL);
  const nome   = localStorage.getItem(LS_NOME);
  const pEmail = localStorage.getItem(LS_PROF_EMAIL);
  const pNome  = localStorage.getItem(LS_PROF_NOME);
  const bioOk  = localStorage.getItem(LS_BIO_ATIVADA) === '1';
  const credId = localStorage.getItem(LS_CREDENTIAL);

  if (email && nome) {
    alunoData = { nome };
    preencherCard(alunoData);
    showBioLock(bioOk && credId ? 'unlock' : 'register');
    return;
  }

  if (pEmail && pNome) {
    profData = { nome: pNome, email: pEmail };
    showBioLock(bioOk && credId ? 'unlock' : 'register');
    return;
  }

  // No session → show login
  showTab('Home');
}

document.addEventListener('DOMContentLoaded', init);
