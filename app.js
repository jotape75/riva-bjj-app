const API_BASE       = 'https://script.google.com/macros/s/AKfycbyBLlVjEvO35RufIh6pH9XOOTDXuj_BMrNHAJfdw9I-reScWX31dsVdOFJna1ZbJVqX/exec';
const API_TIMEOUT_MS = 15000;

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

function fmtCpf(v) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return d.slice(0, 3) + '.' + d.slice(3);
  if (d.length <= 9) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6);
  return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
}

/* ── State ────────────────────────────────────────────────────── */
let alunoData   = null;
let profData    = null;
let semanaCache = null;
let aSelDia     = null;
let aSelSessao  = null;
let pSelDia     = null;
let pSelSessao  = null;

/* ── Navigation ───────────────────────────────────────────────── */
function showTab(tab) {
  ['cardLogin', 'cardAluno', 'cardAgendar', 'cardProf'].forEach(hide);
  ['navHome', 'navAgendar', 'navProf'].forEach(id => $(id).classList.remove('on'));

  if (tab === 'Home') {
    $('navHome').classList.add('on');
    alunoData ? show('cardAluno') : show('cardLogin');
  } else if (tab === 'Agendar') {
    $('navAgendar').classList.add('on');
    if (!alunoData) { show('cardLogin'); return; }
    show('cardAgendar');
    loadSemana('aluno');
  } else if (tab === 'Prof') {
    $('navProf').classList.add('on');
    show('cardProf');
    if (profData) {
      hide('profLoginBox'); show('profLogadoBox');
      loadSemana('prof');
    } else {
      show('profLoginBox'); hide('profLogadoBox');
    }
  }
}

/* ── Week schedule ────────────────────────────────────────────── */
async function loadSemana(ctx) {
  if (semanaCache) { renderDias(ctx, semanaCache); return; }
  try {
    const r = await apiCall({ action: 'treinosSemana' });
    if (r.ok) { semanaCache = r.data; renderDias(ctx, semanaCache); }
  } catch (e) { /* silently ignore */ }
}

function renderDias(ctx, semana) {
  const rowId = ctx === 'prof' ? 'profDiasRow' : 'diasRow';
  const row   = $(rowId);
  row.innerHTML = '';
  semana.filter(d => d.treinos && d.treinos.length).forEach(dia => {
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
  if (ctx === 'prof') { hide('profSessoesLista'); hide('profPresencaBox'); }
  else                { hide('sessoesLista');     hide('presencaBox');     }
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
}

/* ── Presence list ────────────────────────────────────────────── */
async function loadPresenca(ctx, sessao) {
  const boxId    = ctx === 'prof' ? 'profPresencaBox'    : 'presencaBox';
  const listaId  = ctx === 'prof' ? 'profPresencaLista'  : 'presencaLista';
  const tituloId = ctx === 'prof' ? 'profPresencaTitulo' : 'presencaTitulo';

  $(tituloId).textContent = `${sessao.data.slice(0, 5)} · ${sessao.horario} · ${sessao.nome}`;
  $(listaId).innerHTML = '<p class="loading">Carregando…</p>';
  if (ctx !== 'prof') { hide('btnCheckin'); hide('btnDeletarCheckin'); }
  show(boxId);

  try {
    const r = await apiCall({ action: 'listaPresenca', data: sessao.data, horario: sessao.horario });
    if (!r.ok) { $(listaId).innerHTML = `<p class="msg err">${r.erro || 'Erro'}</p>`; return; }
    renderPresencaLista(ctx, r.data || [], sessao);
  } catch (e) {
    $(listaId).innerHTML = '<p class="msg err">Erro de conexão.</p>';
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
      el.querySelectorAll('.btn-ap.aprovar').forEach(b =>
        b.addEventListener('click', () => profAprovar(+b.dataset.linha, sessao)));
      el.querySelectorAll('.btn-ap.reprovar').forEach(b =>
        b.addEventListener('click', () => profReprovar(+b.dataset.linha, sessao)));
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
      cpf:     localStorage.getItem('rv_cpf') || '',
      data:    aSelSessao.data,
      horario: aSelSessao.horario,
      treino:  aSelSessao.nome,
    });
    if (r.ok) loadPresenca('aluno', aSelSessao);
    else alert(r.erro || 'Erro ao fazer check-in.');
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
      cpf:     localStorage.getItem('rv_cpf') || '',
      data:    aSelSessao.data,
      horario: aSelSessao.horario,
    });
    if (r.ok) loadPresenca('aluno', aSelSessao);
    else alert(r.erro || 'Erro ao cancelar check-in.');
  } catch (e) { alert('Erro de conexão.'); }
  finally { $('btnDeletarCheckin').disabled = false; }
}

/* ── Professor approve / reject ───────────────────────────────── */
async function profAprovar(linha, sessao) {
  try {
    const r = await apiCall({
      action:   'aprovar',
      cpfProf:  localStorage.getItem('rv_prof_cpf') || '',
      linha,
    });
    if (r.ok) loadPresenca('prof', sessao);
    else alert(r.erro || 'Erro ao aprovar.');
  } catch (e) { alert('Erro de conexão.'); }
}

async function profReprovar(linha, sessao) {
  try {
    const r = await apiCall({
      action:   'reprovar',
      cpfProf:  localStorage.getItem('rv_prof_cpf') || '',
      linha,
    });
    if (r.ok) loadPresenca('prof', sessao);
    else alert(r.erro || 'Erro ao reprovar.');
  } catch (e) { alert('Erro de conexão.'); }
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

/* ── Student login / logout ───────────────────────────────────── */
async function login() {
  const cpf = $('cpf').value.replace(/\D/g, '');
  if (cpf.length !== 11) { $('err').textContent = 'CPF inválido.'; return; }
  $('err').textContent  = '';
  $('info').textContent = 'Buscando…';
  $('btnLogin').disabled = true;
  try {
    const r = await apiCall({ action: 'loginCpf', cpf });
    if (!r.ok) { $('err').textContent = r.erro || 'Não encontrado.'; $('info').textContent = ''; return; }
    alunoData = r.data;
    localStorage.setItem('rv_cpf',  cpf);
    localStorage.setItem('rv_nome', alunoData.nome || '');
    preencherCard(alunoData);
    showTab('Home');
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
  localStorage.removeItem('rv_cpf');
  localStorage.removeItem('rv_nome');
  $('cpf').value = '';
  showTab('Home');
}

/* ── Professor login / logout ─────────────────────────────────── */
async function profLogin() {
  const cpf = $('profCpf').value.replace(/\D/g, '');
  if (cpf.length !== 11) { $('profErr').textContent = 'CPF inválido.'; return; }
  $('profErr').textContent   = '';
  $('btnProfLogin').disabled = true;
  try {
    const r = await apiCall({ action: 'profLogin', cpf });
    if (!r.ok) { $('profErr').textContent = r.erro || 'Não encontrado.'; return; }
    profData = r.data;
    localStorage.setItem('rv_prof_cpf',  cpf);
    localStorage.setItem('rv_prof_nome', profData.nome || '');
    $('pNome').textContent = profData.nome || 'Professor';
    hide('profLoginBox'); show('profLogadoBox');
    loadSemana('prof');
  } catch (e) {
    $('profErr').textContent = 'Erro de conexão.';
  } finally {
    $('btnProfLogin').disabled = false;
  }
}

function profLogout() {
  profData    = null;
  semanaCache = null;
  localStorage.removeItem('rv_prof_cpf');
  localStorage.removeItem('rv_prof_nome');
  $('profCpf').value = '';
  show('profLoginBox'); hide('profLogadoBox');
}

/* ── Init ─────────────────────────────────────────────────────── */
function init() {
  // Restore student session
  const cpf  = localStorage.getItem('rv_cpf');
  const nome = localStorage.getItem('rv_nome');
  if (cpf && nome) {
    alunoData = { nome };
    preencherCard(alunoData);
    apiCall({ action: 'loginCpf', cpf })
      .then(r => { if (r && r.ok) { alunoData = r.data; preencherCard(alunoData); } })
      .catch(() => {});
  }

  // Restore professor session
  const pCpf  = localStorage.getItem('rv_prof_cpf');
  const pNome = localStorage.getItem('rv_prof_nome');
  if (pCpf && pNome) {
    profData = { nome: pNome, cpf: pCpf };
    $('pNome').textContent = pNome;
  }

  // CPF input formatting
  $('cpf').addEventListener('input', e => { e.target.value = fmtCpf(e.target.value); });
  $('cpf').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  $('profCpf').addEventListener('input', e => { e.target.value = fmtCpf(e.target.value); });
  $('profCpf').addEventListener('keydown', e => { if (e.key === 'Enter') profLogin(); });

  // Student buttons
  $('btnLogin').addEventListener('click', login);
  $('btnSair').addEventListener('click', logout);
  $('btnAtualizar').addEventListener('click', async () => {
    const c = localStorage.getItem('rv_cpf');
    if (!c) return;
    const r = await apiCall({ action: 'loginCpf', cpf: c }).catch(() => null);
    if (r && r.ok) { alunoData = r.data; preencherCard(alunoData); }
  });
  $('btnCheckin').addEventListener('click', fazerCheckin);
  $('btnDeletarCheckin').addEventListener('click', deletarCheckin);

  // Professor buttons
  $('btnProfLogin').addEventListener('click', profLogin);
  $('btnProfSair').addEventListener('click', profLogout);

  // Bottom nav
  $('navHome').addEventListener('click',    () => showTab('Home'));
  $('navAgendar').addEventListener('click', () => showTab('Agendar'));
  $('navProf').addEventListener('click',    () => showTab('Prof'));

  showTab('Home');
}

document.addEventListener('DOMContentLoaded', init);