import { db, auth } from './firebase-config.js';
import {
  collection, doc, query, where, orderBy, limit,
  getDocs, getDoc, addDoc, updateDoc, deleteDoc, serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

const anonAuthPromise = signInAnonymously(auth).catch(() => {});

const SEMANA_TTL          = 600000;   // 10 min
const PRESENCA_TTL        = 600000;   // 10 min
const GRADUANDOS_TTL      = 43200000; // 12 h
const NOTIF_TTL           = 900000;   // 15 min
const BIO_GRACE_MS        = 1800000;  // 30 min
const RP_NAME             = 'Riva BJJ';
const MAX_GRAU_POR_FAIXA  = 4;

// Mapa de emojis por faixa (igual ao Apps Script original)
const EMOJI_FAIXA = {
  'Branca':  '🔲',
  'Azul':    '🟦',
  'Roxa':    '🟪',
  'Marrom':  '🟫',
  'Preta':   '⬛',
};

function gerarStatus(faixa, grau) {
  const emoji = EMOJI_FAIXA[faixa] || '🔲';
  const g = Math.min(Math.max(Number(grau) || 0, 0), 4);
  if (g === 0) return 'Iniciante';
  return emoji.repeat(g);
}

/* ── localStorage key constants ──────────────────────────────── */
const LS_EMAIL        = 'rv_email';
const LS_NOME         = 'rv_nome';
const LS_PROF_EMAIL   = 'rv_prof_email';
const LS_PROF_NOME    = 'rv_prof_nome';
// Biometric keys – intentionally kept on logout so next login skips re-registration
const LS_CREDENTIAL   = 'rv_credentialId';
const LS_BIO_ATIVADA  = 'rv_biometria_ativada';
const LS_NOTIF_VISTO  = 'rv_notif_visto';
const LS_BIO_TS       = 'rv_bio_ts';
const LS_SEMANA_CACHE      = 'rv_semana_cache';
const LS_GRADUANDOS_CACHE  = 'rv_graduandos_cache';

/* ── sessionStorage key constants ─────────────────────────────── */
const SS_PAGE  = 'rv_page';
const SS_SESSAO = 'rv_sessao';

/* ── Firebase helpers ─────────────────────────────────────────── */

// Helper: format Firestore Timestamp to "DD/MM/YYYY • HH:MM"
function formatTimestamp(ts) {
  if (!ts) return '';
  let d;
  if (ts && typeof ts.toDate === 'function') d = ts.toDate();
  else if (ts instanceof Date) d = ts;
  else d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const dd   = String(d.getDate()).padStart(2, '0');
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh   = String(d.getHours()).padStart(2, '0');
  const min  = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} • ${hh}:${min}`;
}

// login: search alunos then professores by email
async function fbLogin(email) {
  try {
    // Check alunos
    const alunosQ = query(collection(db, 'alunos'), where('email', '==', email));
    const alunosSnap = await getDocs(alunosQ);
    if (!alunosSnap.empty) {
      const docData = alunosSnap.docs[0].data();
      return {
        ok: true,
        tipo: 'aluno',
        data: {
          id:             alunosSnap.docs[0].id,
          nome:           docData.nome_aluno || '',
          faixa:          docData.faixa || '',
          grau:           docData.grau_atual ?? 0,
          dataGrau:       docData.data_ultimo_grau || '',
          status:         docData.status || '',
          statusExame:    docData.statusExame || '',
          aulasNoGrau:    docData.aulas_no_grau ?? 0,
          aulasRestantes: docData.aulas_restantes ?? null,
          metaGrau:       docData.meta_grau ?? 0,
          email:          docData.email || email,
        }
      };
    }
    // Check professores
    const profsQ = query(collection(db, 'professores'), where('email', '==', email));
    const profsSnap = await getDocs(profsQ);
    if (!profsSnap.empty) {
      const docData = profsSnap.docs[0].data();
      return {
        ok: true,
        tipo: 'prof',
        data: { nome: docData.nome || '', email: docData.email || email }
      };
    }
    return { ok: false, erro: 'Email não encontrado.' };
  } catch (e) {
    return { ok: false, erro: e.message || 'Erro ao buscar.' };
  }
}

// profLoginEmail: get professor data by email
async function fbProfLoginEmail(email) {
  try {
    const q = query(collection(db, 'professores'), where('email', '==', email));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const d = snap.docs[0].data();
      return { ok: true, data: { nome: d.nome || '', email: d.email || email } };
    }
    return { ok: false, erro: 'Professor não encontrado.' };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// treinosSemana: get all sessions grouped by diaSemana
async function fbTreinosSemana() {
  try {
    const snap = await getDocs(collection(db, 'sessoes'));
    const byDow = {};
    snap.forEach(d => {
      const s = d.data();
      if (!byDow[s.diaSemana]) byDow[s.diaSemana] = [];
      byDow[s.diaSemana].push({ horario: s.horario, nome: s.nome });
    });
    // Sort treinos within each day by horario
    Object.keys(byDow).forEach(dow => {
      byDow[dow].sort((a, b) => a.horario.localeCompare(b.horario));
    });
    const data = Object.entries(byDow).map(([diaSemana, treinos]) => ({
      diaSemana: parseInt(diaSemana),
      treinos
    }));
    return { ok: true, data };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// listaPresenca: get check-ins for a given date+horario (sem filtro de arquivado)
async function fbListaPresenca(dataTreino, horario) {
  try {
    const q = query(
      collection(db, 'checkins'),
      where('data_treino', '==', dataTreino),
      where('horario', '==', horario)
    );
    const snap = await getDocs(q);
    const data = [];
    snap.forEach(d => {
      const item = d.data();
      data.push({ linha: d.id, nome: item.nome, status: item.status });
    });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// listaPresencaArquivo: mesma query (sem filtro arquivado — não há arquivamento automático)
async function fbListaPresencaArquivo(dataTreino, horario) {
  try {
    const q = query(
      collection(db, 'checkins'),
      where('data_treino', '==', dataTreino),
      where('horario', '==', horario)
    );
    const snap = await getDocs(q);
    const data = [];
    snap.forEach(d => {
      const item = d.data();
      data.push({ linha: d.id, nome: item.nome, status: item.status });
    });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// checkin: add a new check-in document
async function fbCheckin(email, nome, horario, dataTreino, alunoId) {
  try {
    // 1. Buscar checkins do aluno para esta data
    const qDia = query(
      collection(db, 'checkins'),
      where('email', '==', email),
      where('data_treino', '==', dataTreino)
    );
    const snapDia = await getDocs(qDia);

    // 2. Contar horários únicos ativos (PENDENTE ou VALIDADO) — excluir REPROVADO
    const horariosAtivos = new Set();
    snapDia.forEach(d => {
      const item = d.data();
      if (!item.status || !item.status.includes('REPROVADO')) {
        horariosAtivos.add(item.horario);
      }
    });

    // 3. Verificar se já fez check-in neste horário específico
    if (horariosAtivos.has(horario)) {
      return { ok: false, erro: 'Você já fez check-in para este treino! ❌' };
    }

    // 4. Verificar limite de 2 check-ins por dia
    if (horariosAtivos.size >= 2) {
      return { ok: false, erro: 'Limite diário: você só pode fazer 2 check-ins por dia. ❌' };
    }

    // 5. Criar o check-in
    const checkinData = {
      email,
      nome,
      horario,
      data_treino: dataTreino,
      status: 'PENDENTE ⏳',
      data_aprovacao: null,
      arquivado: false,
      criadoEm: serverTimestamp()
    };
    if (alunoId) checkinData.alunoId = alunoId;
    await addDoc(collection(db, 'checkins'), checkinData);
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// deletarCheckin: delete check-in by email + data_treino + horario
async function fbDeletarCheckin(email, dataTreino, horario) {
  try {
    const q = query(
      collection(db, 'checkins'),
      where('email', '==', email),
      where('data_treino', '==', dataTreino),
      where('horario', '==', horario)
    );
    const snap = await getDocs(q);
    const deletions = snap.docs.map(d => deleteDoc(doc(db, 'checkins', d.id)));
    await Promise.all(deletions);
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// aprovar: approve a check-in by document ID and update student's aulas/grau
async function fbAprovar(linhaId) {
  try {
    // Ensure anonymous auth is complete before writing to alunos (requires auth)
    await anonAuthPromise;

    const checkinRef = doc(db, 'checkins', String(linhaId));
    await updateDoc(checkinRef, {
      status: 'VALIDADO ✓',
      data_aprovacao: serverTimestamp()
    });

    const checkinSnap = await getDoc(checkinRef);
    if (checkinSnap.exists()) {
      const checkinData = checkinSnap.data();
      let alunoRef = null;

      if (checkinData.alunoId) {
        alunoRef = doc(db, 'alunos', checkinData.alunoId);
      } else if (checkinData.email) {
        const q = query(collection(db, 'alunos'), where('email', '==', checkinData.email), limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) alunoRef = snap.docs[0].ref;
      }

      if (alunoRef) {
        const alunoSnap = await getDoc(alunoRef);
        if (alunoSnap.exists()) {
          const a               = alunoSnap.data();
          const metaGrau        = a.meta_grau ?? (a.faixa === 'Branca' ? 36 : 56);
          const grauAtual       = a.grau_atual ?? 0;
          const novoAulasNoGrau = (a.aulas_no_grau ?? 0) + 1;

          if (novoAulasNoGrau >= metaGrau && metaGrau > 0) {
            if (grauAtual < MAX_GRAU_POR_FAIXA) {
              const novoGrau = grauAtual + 1;
              const dataBR = (() => {
                const now = new Date();
                const dd = String(now.getDate()).padStart(2, '0');
                const mm = String(now.getMonth() + 1).padStart(2, '0');
                const yyyy = now.getFullYear();
                return `${dd}/${mm}/${yyyy}`;
              })();
              await updateDoc(alunoRef, {
                grau_atual:       novoGrau,
                aulas_no_grau:    0,
                aulas_restantes:  metaGrau,
                meta_grau:        metaGrau,
                statusExame:      gerarStatus(a.faixa, novoGrau),
                data_ultimo_grau: dataBR,
              });
            } else {
              // Grau máximo: apenas zera restantes e atualiza status
              await updateDoc(alunoRef, {
                aulas_restantes: 0,
                statusExame:     gerarStatus(a.faixa, MAX_GRAU_POR_FAIXA),
              });
            }
          } else {
            await updateDoc(alunoRef, {
              aulas_no_grau:   novoAulasNoGrau,
              aulas_restantes: Math.max(0, metaGrau - novoAulasNoGrau),
              statusExame:     gerarStatus(a.faixa, grauAtual),
            });
          }
        }
      }
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// reprovar: reject a check-in by document ID
async function fbReprovar(linhaId) {
  try {
    await updateDoc(doc(db, 'checkins', String(linhaId)), {
      status: 'REPROVADO ✗',
      data_aprovacao: serverTimestamp()
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// graduandos: students ready for graduation (aulas_restantes <= 0)
async function fbGraduandos() {
  try {
    const q = query(collection(db, 'alunos'), where('status', '==', 'ATIVO'));
    const snap = await getDocs(q);
    const data = [];
    snap.forEach(d => {
      const a = d.data();
      const restantes = (a.meta_grau != null && a.aulas_no_grau != null)
        ? Math.max(0, (a.meta_grau || 0) - (a.aulas_no_grau || 0))
        : (a.aulas_restantes ?? null);
      const grauAtual = a.grau_atual ?? 0;
      if (grauAtual === MAX_GRAU_POR_FAIXA && restantes !== null && restantes <= 0) {
        data.push({
          nome:      a.nome_aluno || '',
          faixa:     a.faixa || '',
          grau:      grauAtual,
          restantes: restantes
        });
      }
    });
    data.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
    return { ok: true, data };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// notificacoes: get validated/rejected check-ins for a student in last 30 days
async function fbNotificacoes(email) {
  try {
    const q = query(
      collection(db, 'checkins'),
      where('email', '==', email),
      where('status', 'in', ['VALIDADO ✓', 'REPROVADO ✗']),
      orderBy('data_aprovacao', 'desc'),
      limit(50)
    );
    const snap = await getDocs(q);
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const data = [];
    snap.forEach(d => {
      const item = d.data();
      let ts = 0;
      if (item.data_aprovacao) {
        const dt = item.data_aprovacao.toDate ? item.data_aprovacao.toDate() : new Date(item.data_aprovacao);
        ts = dt.getTime();
      }
      if (ts >= thirtyDaysAgo) {
        data.push({
          status:         item.status,
          horario:        item.horario || '',
          dataTreino:     item.data_treino || '',
          dataAprovacao:  formatTimestamp(item.data_aprovacao)
        });
      }
    });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

/* ── Helpers ──────────────────────────────────────────────────── */
const $    = id => document.getElementById(id);
const show = id => $(id).classList.remove('hidden');
const hide = id => $(id).classList.add('hidden');

// Retorna quantos dias atrás é dataStr (formato DD/MM/YYYY). Valor positivo = passado.
function diasDiferenca(dataStr) {
  if (!dataStr || typeof dataStr !== 'string') return 0;
  var p  = dataStr.split('/');
  if (p.length !== 3) return 0;
  var dt = new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
  if (isNaN(dt.getTime())) return 0;
  var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  dt.setHours(0, 0, 0, 0);
  return Math.round((hoje - dt) / (1000 * 60 * 60 * 24));
}

/* ── Drag-to-scroll ───────────────────────────────────────────── */
function enableDragScroll(el) {
  let isDown = false, startX, scrollLeft, moved = false;
  el.addEventListener('mousedown', e => {
    isDown = true; moved = false;
    startX = e.pageX - el.offsetLeft;
    scrollLeft = el.scrollLeft;
    el.style.cursor = 'grabbing';
    el.style.userSelect = 'none';
  });
  el.addEventListener('mouseleave', () => { isDown = false; el.style.cursor = 'grab'; el.style.userSelect = ''; });
  el.addEventListener('mouseup',    () => { isDown = false; el.style.cursor = 'grab'; el.style.userSelect = ''; });
  el.addEventListener('mousemove', e => {
    if (!isDown) return;
    e.preventDefault();
    const walk = e.pageX - el.offsetLeft - startX;
    if (Math.abs(walk) > 5) moved = true;
    el.scrollLeft = scrollLeft - walk;
  });
  el.addEventListener('click', e => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
  el.style.cursor = 'grab';
}

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
  ['cardLogin', 'cardAluno', 'cardAgendar', 'cardProf', 'cardBioLock', 'cardNoSupport', 'cardNotificacoes', 'cardSessao', 'cardProfSessao'].forEach(hide);
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

function afterBioSuccess(updateTs = true) {
  if (updateTs) localStorage.setItem(LS_BIO_TS, String(Date.now()));
  hide('cardBioLock');
  const email  = localStorage.getItem(LS_EMAIL);
  const nome   = localStorage.getItem(LS_NOME);
  const pEmail = localStorage.getItem(LS_PROF_EMAIL);
  const pNome  = localStorage.getItem(LS_PROF_NOME);
  const savedPage = sessionStorage.getItem(SS_PAGE);
  const savedSessao = (() => { try { return JSON.parse(sessionStorage.getItem(SS_SESSAO)); } catch(e) { return null; } })();

  if (pEmail && pNome) {
    profData = { nome: pNome, email: pEmail };
    showProfPage();
    fbProfLoginEmail(pEmail)
      .then(r => { if (r && r.ok) { profData = r.data; $('pNome').textContent = profData.nome || 'Professor'; } })
      .catch(() => {});
    if (savedPage === 'sessaoProf' && savedSessao) {
      showSessaoProf(savedSessao);
    }
    return;
  }

  if (email && nome) {
    alunoData = { nome };
    preencherCard(alunoData);
    showAlunoSkeleton();
    fbLogin(email)
      .then(r => { if (r && r.ok) { alunoData = r.data; preencherCard(alunoData); } })
      .catch(() => {});
    if (savedPage === 'sessaoAluno' && savedSessao) {
      aSelSessao = savedSessao;
      showTab('Agendar');
      showSessaoAluno(savedSessao);
    } else if (savedPage === 'Agendar') {
      showTab('Agendar');
    } else if (savedPage === 'notificacoes') {
      showTab('Home');
      loadNotificacoes();
    } else {
      showTab('Home');
    }
    checkBellBadge();
    return;
  }

  // No session data: show login as fallback
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
let semanaInFlight   = false; // guard for concurrent treinosSemana fetches
let presencaInFlight = {}; // key -> true (in-flight guard)
let aSelDia      = null;
let aSelSessao   = null;
let pSelDia      = null;
let pSelSessao   = null;
let graduandosCache    = null;  // { ts, data }
let graduandosInFlight = false;
let notifCache         = null;  // { ts, data }
let notifInFlight      = false;

/* ── Month / day helpers ──────────────────────────────────────── */
const NOMES_DIA_PT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const MESES_PT     = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function getMonthDays() {
  const today = new Date();
  const year  = today.getFullYear();
  const month = today.getMonth();
  const last  = new Date(year, month + 1, 0).getDate();
  const days  = [];
  for (let i = 1; i <= last; i++) days.push(new Date(year, month, i));
  return days;
}

function getMesAno() {
  const today = new Date();
  return `${MESES_PT[today.getMonth()]} ${today.getFullYear()}`;
}

function formatDate(d) {
  return String(d.getDate()).padStart(2, '0') + '/' +
         String(d.getMonth() + 1).padStart(2, '0') + '/' +
         d.getFullYear();
}

/* ── Cache helpers ────────────────────────────────────────────── */
function saveSemanaCache(data) {
  try {
    localStorage.setItem(LS_SEMANA_CACHE, JSON.stringify({ ts: Date.now(), data }));
  } catch (_) {}
}

function loadSemanaCache() {
  try {
    const raw = localStorage.getItem(LS_SEMANA_CACHE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    // Invalida se passou da meia-noite (datas mudaram)
    const salvoEm = new Date(parsed.ts);
    const agora   = new Date();
    const mesmoDia = salvoEm.getDate()     === agora.getDate()  &&
                     salvoEm.getMonth()    === agora.getMonth() &&
                     salvoEm.getFullYear() === agora.getFullYear();
    if (!mesmoDia) return null;

    if (Date.now() - parsed.ts < SEMANA_TTL) return parsed;
    return null;
  } catch (_) { return null; }
}

function getCachedSemana() {
  if (semanaCache && Date.now() - semanaCache.ts < SEMANA_TTL) return semanaCache.data;
  const persisted = loadSemanaCache();
  if (persisted) { semanaCache = persisted; return persisted.data; }
  return null;
}

function saveGraduandosCache(data) {
  try {
    localStorage.setItem(LS_GRADUANDOS_CACHE, JSON.stringify({ ts: Date.now(), data }));
  } catch (_) {}
}

function loadGraduandosCache() {
  try {
    const raw = localStorage.getItem(LS_GRADUANDOS_CACHE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts < GRADUANDOS_TTL) return parsed;
    return null;
  } catch (_) { return null; }
}

function getCachedGraduandos() {
  if (graduandosCache && Date.now() - graduandosCache.ts < GRADUANDOS_TTL) return graduandosCache.data;
  const persisted = loadGraduandosCache();
  if (persisted) { graduandosCache = persisted; return persisted.data; }
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

/* ── UI helpers ───────────────────────────────────────────────── */
// Shows the loading message only if the response takes longer than `delay` ms,
// preventing a "Carregando…" flash on fast or cached responses.
function delayedLoader(el, delay = 250) {
  const t = setTimeout(() => { el.innerHTML = '<p class="loading">Carregando…</p>'; }, delay);
  return () => clearTimeout(t);
}

/* ── Skeleton helpers ─────────────────────────────────────────── */
function showAlunoSkeleton() {
  document.getElementById('aNome').innerHTML        = '<span class="skeleton sk-title"></span>';
  document.getElementById('aFaixa').innerHTML       = '<span class="skeleton sk-line-sm"></span>';
  document.getElementById('aGrau').innerHTML        = '<span class="skeleton sk-line-sm"></span>';
  document.getElementById('aData').innerHTML        = '<span class="skeleton sk-line-sm"></span>';
  document.getElementById('statAulasNum').innerHTML = '<span class="skeleton sk-num"></span>';
  document.getElementById('statRestantesNum').innerHTML = '<span class="skeleton sk-num"></span>';
  document.getElementById('aStatus').innerHTML      = '<span class="skeleton sk-line"></span>';
}

function showSessoesSkeleton(listaId) {
  const lista = document.getElementById(listaId);
  lista.innerHTML = [1,2,3].map(() =>
    `<div class="sk-card skeleton"></div>`
  ).join('');
  lista.classList.remove('hidden');
}

function showPresencaSkeleton() {
  document.getElementById('sessaoPresencaLista').innerHTML =
    [1,2,3].map(() =>
      `<div class="presenca-item"><span class="skeleton sk-line"></span></div>`
    ).join('');
}

function showGraduandosSkeleton() {
  document.getElementById('profGraduandosLista').innerHTML =
    [1,2,3,4].map(() =>
      `<div class="presenca-item"><span class="skeleton sk-line"></span></div>`
    ).join('');
}

/* ── Navigation ───────────────────────────────────────────────── */
function showTab(tab) {
  sessionStorage.setItem(SS_PAGE, tab);
  sessionStorage.removeItem(SS_SESSAO);
  ['cardLogin', 'cardAluno', 'cardAgendar', 'cardProf', 'cardBioLock', 'cardNoSupport', 'cardNotificacoes', 'cardSessao', 'cardProfSessao'].forEach(hide);
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

// Background fetch of treinosSemana; updates cache and calls onSuccess if data arrives.
async function revalidateSemana(onSuccess) {
  if (semanaInFlight) return;
  semanaInFlight = true;
  try {
    const r = await fbTreinosSemana();
    if (r.ok) { semanaCache = { ts: Date.now(), data: r.data }; saveSemanaCache(r.data); onSuccess(r.data); }
  } catch (_) { /* keep stale */ }
  finally { semanaInFlight = false; }
}

async function loadSemana(ctx) {
  const rowId  = ctx === 'prof' ? 'profDiasRow' : 'diasRow';
  const cached = getCachedSemana();

  if (cached) {
    renderDias(ctx, cached);
    // Background revalidation – keep data fresh without blocking UI
    revalidateSemana(data => renderDias(ctx, data));
    return;
  }

  if (semanaInFlight) return;
  semanaInFlight = true;
  showSessoesSkeleton(ctx === 'prof' ? 'profSessoesLista' : 'sessoesLista');
  const cancel = delayedLoader($(rowId));
  try {
    const r = await fbTreinosSemana();
    cancel();
    if (r.ok) {
      semanaCache = { ts: Date.now(), data: r.data };
      saveSemanaCache(r.data);
      renderDias(ctx, r.data);
    } else {
      $(rowId).innerHTML = '<p class="msg err">Erro ao carregar treinos.</p>';
    }
  } catch (e) {
    cancel();
    $(rowId).innerHTML = '<p class="msg err">Falha na conexão. Tente novamente.</p>';
  } finally {
    semanaInFlight = false;
  }
}

function renderDias(ctx, semana) {
  const rowId   = ctx === 'prof' ? 'profDiasRow'      : 'diasRow';
  const labelId = ctx === 'prof' ? 'profDiasMesLabel' : 'diasMesLabel';
  const row     = $(rowId);
  row.innerHTML = '';

  // Update month header
  $(labelId).textContent = getMesAno();

  // Map treinos by day of week from API data
  const treinosByDow = {};
  semana.forEach(d => { treinosByDow[d.diaSemana] = d.treinos || []; });

  // Build all days of current month
  const monthDays = getMonthDays().map(date => ({
    data:      formatDate(date),
    diaSemana: date.getDay(),
    nomeDia:   NOMES_DIA_PT[date.getDay()],
    treinos:   treinosByDow[date.getDay()] || [],
  }));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = formatDate(today);

  // Auto-select: today (if has treinos) → next day with treinos → first day with treinos
  let defaultIdx = monthDays.findIndex(d => d.data === todayStr && d.treinos.length > 0);
  if (defaultIdx < 0) {
    defaultIdx = monthDays.findIndex(d => {
      const [dd, mm, yyyy] = d.data.split('/');
      return new Date(+yyyy, +mm - 1, +dd) > today && d.treinos.length > 0;
    });
  }
  if (defaultIdx < 0) defaultIdx = monthDays.findIndex(d => d.treinos.length > 0);

  monthDays.forEach((dia) => {
    const hasTreinos = dia.treinos.length > 0;
    const btn = document.createElement('button');
    btn.className = hasTreinos ? 'dia-btn' : 'dia-btn disabled';
    btn.innerHTML =
      `<span class="dia-nome">${dia.nomeDia}</span>` +
      `<span class="dia-data">${dia.data.slice(0, 5)}</span>`;
    if (hasTreinos) {
      btn.addEventListener('click', () => {
        row.querySelectorAll('.dia-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectDia(ctx, dia);
      });
    }
    row.appendChild(btn);
  });

  if (defaultIdx >= 0) {
    const defaultBtn = row.children[defaultIdx];
    defaultBtn.classList.add('active');
    requestAnimationFrame(() => defaultBtn.scrollIntoView({ block: 'nearest', inline: 'center' }));
    const defaultDia = monthDays[defaultIdx];
    if (ctx === 'prof') { pSelDia = defaultDia; pSelSessao = null; hide('profPresencaBox'); }
    else                { aSelDia = defaultDia; aSelSessao = null; hide('presencaBox'); }
    renderSessoes(ctx, defaultDia);
  } else {
    if (ctx === 'prof') { hide('profSessoesLista'); hide('profPresencaBox'); }
    else                { hide('sessoesLista');     hide('presencaBox'); }
  }
}

async function loadSemanaProfessor() {
  const rowId  = 'profDiasRow';
  const cached = getCachedSemana();

  if (cached) {
    renderDias('prof', cached);
    // Background revalidation
    revalidateSemana(data => renderDias('prof', data));
    return;
  }

  if (semanaInFlight) return;
  semanaInFlight = true;
  showSessoesSkeleton('profSessoesLista');
  const cancel = delayedLoader($(rowId));
  try {
    const r = await fbTreinosSemana();
    cancel();
    if (!r.ok) {
      $(rowId).innerHTML = '<p class="msg err">Erro ao carregar treinos.</p>';
      return;
    }
    semanaCache = { ts: Date.now(), data: r.data };
    saveSemanaCache(r.data);
    renderDias('prof', r.data);
  } catch (e) {
    cancel();
    $(rowId).innerHTML = '<p class="msg err">Falha na conexão. Tente novamente.</p>';
  } finally {
    semanaInFlight = false;
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
  show(listaId);

  if (!dia.treinos.length) {
    lista.innerHTML = '<p class="presenca-vazia">Sem treinos neste dia.</p>';
    if (ctx === 'prof') pSelSessao = null; else aSelSessao = null;
    return;
  }

  const diaDiff = ctx !== 'prof' ? diasDiferenca(dia.data) : 0;
  dia.treinos.forEach(t => {
    const card = document.createElement('div');
    card.className = 'sessao-card';
    const btnLabel = ctx === 'prof' ? 'Aprovar Check-ins' : (diaDiff > 0 ? 'Ver treino' : 'Agendar');
    card.innerHTML =
      `<div class="sessao-info">` +
        `<span class="sessao-hor">${t.horario}</span>` +
        `<span class="sessao-nome">${t.nome}</span>` +
      `</div>` +
      `<button class="btn-sessao-action">${btnLabel}</button>`;
    const setActive = () => {
      lista.querySelectorAll('.sessao-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
    };
    const navegarSessao = () => {
      setActive();
      const sessao = { data: dia.data, horario: t.horario, nome: t.nome };
      if (ctx === 'prof') showSessaoProf(sessao);
      else showSessaoAluno(sessao);
    };
    card.addEventListener('click', navegarSessao);
    card.querySelector('.btn-sessao-action').addEventListener('click', e => {
      e.stopPropagation();
      navegarSessao();
    });
    lista.appendChild(card);
  });

  // Auto-select first session (highlight only, no presence prefetch)
  if (dia.treinos.length > 0) {
    lista.children[0].classList.add('active');
  }
}

/* ── Session screens (new flow) ───────────────────────────────── */
function showSessaoAluno(sessao) {
  aSelSessao = sessao;
  sessionStorage.setItem(SS_PAGE, 'sessaoAluno');
  sessionStorage.setItem(SS_SESSAO, JSON.stringify(sessao));
  hide('cardAgendar');
  hide('mainNav');
  show('cardSessao');
  loadPresencaSessao('aluno', sessao);
}

function showSessaoProf(sessao) {
  pSelSessao = sessao;
  sessionStorage.setItem(SS_PAGE, 'sessaoProf');
  sessionStorage.setItem(SS_SESSAO, JSON.stringify(sessao));
  hide('cardProf');
  show('cardProfSessao');
  loadPresencaSessao('prof', sessao);
}

async function loadPresencaSessao(ctx, sessao) {
  const k = presencaCacheKey(sessao.data, sessao.horario);
  if (presencaInFlight[k]) return;

  const listaId  = ctx === 'prof' ? 'profSessaoPresencaLista' : 'sessaoPresencaLista';
  const tituloId = ctx === 'prof' ? 'profSessaoTitulo'        : 'sessaoTitulo';

  $(tituloId).textContent = `${sessao.data.slice(0, 5)} · ${sessao.horario} · ${sessao.nome}`;

  // Determina se é dia passado e se já foi arquivado (>2 dias)
  const daysAgo        = diasDiferenca(sessao.data);
  sessao.isPast    = ctx !== 'prof' && daysAgo > 0;
  sessao.isArquivo = ctx !== 'prof' && daysAgo > 2;

  presencaInFlight[k] = true;

  const cached = getCachedPresenca(sessao.data, sessao.horario);
  if (cached) {
    renderPresencaLista(ctx, cached, sessao);
    try {
      const r = await (sessao.isArquivo ? fbListaPresencaArquivo(sessao.data, sessao.horario) : fbListaPresenca(sessao.data, sessao.horario));
      if (r.ok) {
        setCachedPresenca(sessao.data, sessao.horario, r.data || []);
        renderPresencaLista(ctx, r.data || [], sessao);
      }
    } catch (_) { /* keep stale */ }
    finally { delete presencaInFlight[k]; }
    return;
  }

  const cancel = delayedLoader($(listaId));
  if (ctx !== 'prof') { hide('btnSessaoCheckin'); hide('btnSessaoDeletarCheckin'); }

  try {
    const r = await (sessao.isArquivo ? fbListaPresencaArquivo(sessao.data, sessao.horario) : fbListaPresenca(sessao.data, sessao.horario));
    cancel();
    if (!r.ok) { $(listaId).innerHTML = `<p class="msg err">${r.erro || 'Erro'}</p>`; return; }
    setCachedPresenca(sessao.data, sessao.horario, r.data || []);
    renderPresencaLista(ctx, r.data || [], sessao);
  } catch (e) {
    cancel();
    $(listaId).innerHTML = '<p class="msg err">Erro de conexão.</p>';
  } finally {
    delete presencaInFlight[k];
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

  // Set in-flight early so concurrent calls are rejected even in the cached branch
  presencaInFlight[k] = true;

  // Serve from cache immediately, then revalidate in background
  const cached = getCachedPresenca(sessao.data, sessao.horario);
  if (cached) {
    renderPresencaLista(ctx, cached, sessao);
    try {
      const r = await fbListaPresenca(sessao.data, sessao.horario);
      if (r.ok) {
        setCachedPresenca(sessao.data, sessao.horario, r.data || []);
        renderPresencaLista(ctx, r.data || [], sessao);
      }
    } catch (_) { /* keep stale */ }
    finally { delete presencaInFlight[k]; }
    return;
  }

  const cancel = delayedLoader($(listaId));
  if (ctx !== 'prof') { showPresencaSkeleton(); hide('btnCheckin'); hide('btnDeletarCheckin'); }

  try {
    const r = await fbListaPresenca(sessao.data, sessao.horario);
    cancel();
    if (!r.ok) { $(listaId).innerHTML = `<p class="msg err">${r.erro || 'Erro'}</p>`; return; }
    setCachedPresenca(sessao.data, sessao.horario, r.data || []);
    renderPresencaLista(ctx, r.data || [], sessao);
  } catch (e) {
    cancel();
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
  const listaId = ctx === 'prof' ? 'profSessaoPresencaLista' : 'sessaoPresencaLista';
  const el      = $(listaId);

  if (!lista.length) {
    el.innerHTML = `<p class="presenca-vazia">${sessao.isArquivo ? 'Nenhum check-in registrado.' : 'Nenhum check-in ainda.'}</p>`;
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
        btn.addEventListener('click', () => profAprovar(btn.dataset.linha, sessao, btn)));
      el.querySelectorAll('.btn-ap.reprovar').forEach(btn =>
        btn.addEventListener('click', () => profReprovar(btn.dataset.linha, sessao, btn)));
    }
  }

  if (ctx !== 'prof' && alunoData) {
    if (sessao.isPast) {
      // Dia passado: esconde botões de ação (check-in e cancelar)
      hide('btnSessaoCheckin');
      hide('btnSessaoDeletarCheckin');
    } else {
      const meu = lista.find(i =>
        i.nome.trim().toLowerCase() === (alunoData.nome || '').trim().toLowerCase());
      if (meu) {
        hide('btnSessaoCheckin');
        meu.status.includes('PENDENTE') ? show('btnSessaoDeletarCheckin') : hide('btnSessaoDeletarCheckin');
      } else {
        show('btnSessaoCheckin');
        hide('btnSessaoDeletarCheckin');
      }
    }
  }
}

/* ── Student check-in / cancel ────────────────────────────────── */
async function fazerCheckin() {
  if (!aSelSessao || !alunoData) return;
  $('btnSessaoCheckin').disabled = true;

  // ✅ Atualiza DOM ANTES da chamada (igual ao aprovar)
  const lista = $('sessaoPresencaLista');
  const novoItem = document.createElement('div');
  novoItem.className = 'presenca-item';
  const info = document.createElement('div');
  info.className = 'presenca-info';
  const spanNome = document.createElement('span');
  spanNome.className = 'presenca-nome';
  spanNome.textContent = alunoData.nome;
  const spanStatus = document.createElement('span');
  spanStatus.className = 'presenca-status status-pend';
  spanStatus.textContent = 'PENDENTE ⏳';
  info.appendChild(spanNome);
  info.appendChild(spanStatus);
  novoItem.appendChild(info);
  if (lista) lista.appendChild(novoItem);
  hide('btnSessaoCheckin');
  show('btnSessaoDeletarCheckin');

  try {
    const r = await fbCheckin(localStorage.getItem(LS_EMAIL) || '', alunoData.nome, aSelSessao.horario, aSelSessao.data, alunoData.id || '');
    if (r.ok) {
      invalidatePresenca(aSelSessao.data, aSelSessao.horario);
    } else {
      // ❌ Reverte se der erro
      if (lista && novoItem) novoItem.remove();
      show('btnSessaoCheckin');
      hide('btnSessaoDeletarCheckin');
      alert(r.erro || 'Erro ao fazer check-in.');
    }
  } catch (e) {
    if (lista && novoItem) novoItem.remove();
    show('btnSessaoCheckin');
    hide('btnSessaoDeletarCheckin');
    alert('Falha na conexão. Tente novamente.');
  } finally {
    $('btnSessaoCheckin').disabled = false;
  }
}

async function deletarCheckin() {
  if (!aSelSessao || !alunoData) return;
  if (!confirm('Cancelar seu check-in neste treino?')) return;
  $('btnSessaoDeletarCheckin').disabled = true;

  // Remove do DOM ANTES da chamada (otimista)
  const lista = $('sessaoPresencaLista');
  let itemRemovido = null;
  let proximoSibling = null;
  if (lista) {
    const items = lista.querySelectorAll('.presenca-item');
    items.forEach(item => {
      const nome = item.querySelector('.presenca-nome');
      if (nome && nome.textContent.trim().toLowerCase() === alunoData.nome.trim().toLowerCase()) {
        itemRemovido = item;
        proximoSibling = item.nextSibling;
      }
    });
    if (itemRemovido) itemRemovido.remove();
  }
  show('btnSessaoCheckin');
  hide('btnSessaoDeletarCheckin');

  try {
    const r = await fbDeletarCheckin(localStorage.getItem(LS_EMAIL) || '', aSelSessao.data, aSelSessao.horario);
    if (r.ok) {
      invalidatePresenca(aSelSessao.data, aSelSessao.horario);
    } else {
      // Reverte se der erro
      if (lista && itemRemovido) lista.insertBefore(itemRemovido, proximoSibling);
      hide('btnSessaoCheckin');
      show('btnSessaoDeletarCheckin');
      alert(r.erro || 'Erro ao cancelar check-in.');
    }
  } catch (e) {
    if (lista && itemRemovido) lista.insertBefore(itemRemovido, proximoSibling);
    hide('btnSessaoCheckin');
    show('btnSessaoDeletarCheckin');
    alert('Falha na conexão. Tente novamente.');
  } finally {
    $('btnSessaoDeletarCheckin').disabled = false;
  }
}

/* ── Professor approve / reject ───────────────────────────────── */
async function profAprovar(linha, sessao, btn) {
  const item      = btn.closest('.presenca-item');
  const statusEl  = item ? item.querySelector('.presenca-status') : null;
  const actionsEl = item ? item.querySelector('.prof-actions') : null;

  if (statusEl) {
    statusEl.textContent = 'VALIDADO ✓';
    statusEl.className   = 'presenca-status status-ok';
  }
  if (actionsEl) actionsEl.remove();

  try {
    const r = await fbAprovar(linha);
    if (r.ok) {
      // DOM already updated optimistically above
    } else {
      if (statusEl) {
        statusEl.textContent = 'PENDENTE';
        statusEl.className   = 'presenca-status status-pend';
      }
      if (item && actionsEl) item.appendChild(actionsEl);
      alert(r.erro || 'Erro ao aprovar.');
    }
  } catch (e) {
    if (statusEl) {
      statusEl.textContent = 'PENDENTE';
      statusEl.className   = 'presenca-status status-pend';
    }
    if (item && actionsEl) item.appendChild(actionsEl);
    alert('Erro de conexão.');
  }
}

async function profReprovar(linha, sessao, btn) {
  const item      = btn.closest('.presenca-item');
  const statusEl  = item ? item.querySelector('.presenca-status') : null;
  const actionsEl = item ? item.querySelector('.prof-actions') : null;

  if (statusEl) {
    statusEl.textContent = 'REPROVADO ✗';
    statusEl.className   = 'presenca-status status-err';
  }
  if (actionsEl) actionsEl.remove();

  try {
    const r = await fbReprovar(linha);
    if (r.ok) {
      // DOM already updated optimistically above
    } else {
      if (statusEl) {
        statusEl.textContent = 'PENDENTE';
        statusEl.className   = 'presenca-status status-pend';
      }
      if (item && actionsEl) item.appendChild(actionsEl);
      alert(r.erro || 'Erro ao reprovar.');
    }
  } catch (e) {
    if (statusEl) {
      statusEl.textContent = 'PENDENTE';
      statusEl.className   = 'presenca-status status-pend';
    }
    if (item && actionsEl) item.appendChild(actionsEl);
    alert('Erro de conexão.');
  }
}

/* ── Graduandos ───────────────────────────────────────────────── */
async function carregarGraduandos(force = false) {
  const lista = $('profGraduandosLista');

  const cached = !force ? getCachedGraduandos() : null;
  if (cached) {
    renderGraduandos(cached);
    return;
  }

  if (graduandosInFlight) return;
  graduandosInFlight = true;

  showGraduandosSkeleton();
  try {
    const r = await fbGraduandos();
    if (!r || !r.ok) throw new Error((r && r.erro) ? r.erro : 'Falha ao carregar.');
    graduandosCache = { ts: Date.now(), data: r.data || [] };
    saveGraduandosCache(r.data || []);
    renderGraduandos(graduandosCache.data);
  } catch (e) {
    lista.innerHTML = `<p class="msg err">Erro ao carregar graduandos. ${e.message || ''}</p>`;
  } finally {
    graduandosInFlight = false;
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
      <div class="presenca-info grad-info">
        <span class="presenca-nome grad-nome">${a.nome || ''}</span>
        <div class="grad-badges">
          <span class="presenca-status status-ok">${a.faixa || ''}</span>
          ${grau}
        </div>
      </div>
      ${restantes}
    </div>`;
  }).join('');
}

/* ── Notifications ────────────────────────────────────────────── */
function notifAprovTs(n) {
  // n.dataAprovacao = "07/04/2026 • 14:37"
  try {
    const [datePart, timePart] = n.dataAprovacao.split(' • ');
    const [d, m, y] = datePart.split('/');
    const [hh, mm] = timePart.split(':');
    return new Date(+y, +m - 1, +d, +hh, +mm).getTime();
  } catch (_) { return 0; }
}

function checkBellBadge() {
  const email = localStorage.getItem(LS_EMAIL);
  if (!email) return;

  function evaluate(notifs) {
    const visto = parseInt(localStorage.getItem(LS_NOTIF_VISTO) || '0', 10);
    const hasUnread = notifs.some(n => notifAprovTs(n) > visto);
    hasUnread ? show('bellBadge') : hide('bellBadge');
  }

  if (notifCache && Date.now() - notifCache.ts < NOTIF_TTL) {
    evaluate(notifCache.data);
    return;
  }

  if (notifInFlight) return;
  notifInFlight = true;
  fbNotificacoes(email)
    .then(r => {
      if (r && r.ok) {
        notifCache = { ts: Date.now(), data: r.data || [] };
        evaluate(notifCache.data);
      }
    })
    .catch(() => {})
    .finally(() => { notifInFlight = false; });
}

async function loadNotificacoes() {
  const email = localStorage.getItem(LS_EMAIL);
  if (!email) return;

  sessionStorage.setItem(SS_PAGE, 'notificacoes');
  ['cardAluno', 'cardAgendar'].forEach(hide);
  show('cardNotificacoes');

  // Marca como visto agora
  localStorage.setItem(LS_NOTIF_VISTO, String(Date.now()));
  hide('bellBadge');

  if (notifCache) {
    renderNotificacoes(notifCache.data);
    if (Date.now() - notifCache.ts < NOTIF_TTL) return;
  }

  if (notifInFlight) return;
  notifInFlight = true;
  const cancel = delayedLoader($('notifLista'));
  try {
    const r = await fbNotificacoes(email);
    cancel();
    if (!r.ok) { $('notifLista').innerHTML = `<p class="msg err">${r.erro || 'Erro'}</p>`; return; }
    notifCache = { ts: Date.now(), data: r.data || [] };
    renderNotificacoes(notifCache.data);
  } catch (e) {
    cancel();
    $('notifLista').innerHTML = '<p class="msg err">Erro de conexão.</p>';
  } finally {
    notifInFlight = false;
  }
}

function renderNotificacoes(notifs) {
  const el = $('notifLista');
  if (!notifs.length) {
    el.innerHTML = '<p class="presenca-vazia">Nenhuma notificação nos últimos 30 dias.</p>';
    return;
  }
  el.innerHTML = notifs.map(n => {
    const isOk  = n.status.startsWith('VALIDADO');
    const emoji = isOk ? '✅' : '❌';
    const cls   = isOk ? 'ok' : 'err';
    const label = isOk ? 'Presença Aprovada!' : 'Presença Reprovada!';
    return `<div class="notif-item">
      <div class="notif-status ${cls}">${emoji} ${label}</div>
      <div class="notif-detalhe">Treino de ${n.horario} • ${n.dataTreino}</div>
      <div class="notif-data">Aprovação: ${n.dataAprovacao}</div>
    </div>`;
  }).join('');
}

/* ── Date formatting helper ───────────────────────────────────── */
function formatarDataBR(val) {
  if (!val || String(val).trim() === '' || String(val).trim() === 'undefined') return '—';
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.substring(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  return s; // já está em DD/MM/YYYY ou outro formato
}

/* ── Student card ─────────────────────────────────────────────── */
function preencherCard(d) {
  $('aNome').textContent  = d.nome  || '—';
  $('aFaixa').textContent = d.faixa || '—';
  const g = (d.grau != null && d.grau !== '') ? Number(d.grau) : null;
  $('aGrau').textContent = (g === 0) ? 'Iniciante' : (g != null ? String(g) : '—');
  $('aData').textContent  = d.dataGrau ? formatarDataBR(d.dataGrau) : '—';

  // Status badge: INATIVO aparece em vermelho, ATIVO mostra statusExame
  const statusEl = $('aStatus');
  if (d.status === 'INATIVO') {
    statusEl.textContent = 'INATIVO';
    statusEl.style.color = '#e74c3c';
  } else {
    statusEl.textContent = d.statusExame || d.status || '—';
    statusEl.style.color = '';
  }

  // Stats cards
  if (d.aulasNoGrau != null) {
    $('statAulasNum').textContent = d.aulasNoGrau;
    const restantes = (d.aulasRestantes != null)
      ? d.aulasRestantes
      : (d.metaGrau != null ? Math.max(0, d.metaGrau - d.aulasNoGrau) : '—');
    $('statRestantesNum').textContent = restantes;
  } else {
    $('statAulasNum').textContent = '—';
    $('statRestantesNum').textContent = '—';
  }
}

/* ── Generic login ────────────────────────────────────────────── */
async function loginGeneric() {
  const email = $('email').value.trim().toLowerCase();
  if (!email || email.indexOf('@') < 1) { $('err').textContent = 'Email inválido.'; return; }
  $('err').textContent  = '';
  $('info').textContent = 'Buscando…';
  $('btnLogin').disabled = true;
  try {
    const r = await fbLogin(email);
    if (!r.ok) { $('err').textContent = r.erro || 'Email não encontrado.'; $('info').textContent = ''; return; }

    if (r.tipo === 'prof') {
      profData = r.data;
      localStorage.setItem(LS_PROF_EMAIL, email);
      localStorage.setItem(LS_PROF_NOME, profData.nome || '');
      semanaCache = null; pSelDia = null; pSelSessao = null;
    } else {
      alunoData = r.data;
      localStorage.setItem(LS_EMAIL, email);
      localStorage.setItem(LS_NOME, alunoData.nome || '');
      preencherCard(alunoData);
    }
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
  notifCache = null;
  aSelDia = null; aSelSessao = null;
  localStorage.removeItem(LS_EMAIL);
  localStorage.removeItem(LS_NOME);
  localStorage.removeItem(LS_BIO_TS);
  sessionStorage.removeItem(SS_PAGE);
  sessionStorage.removeItem(SS_SESSAO);
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
  localStorage.removeItem(LS_BIO_TS);
  sessionStorage.removeItem(SS_PAGE);
  sessionStorage.removeItem(SS_SESSAO);
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

  // 3) Wire up student buttons
  $('btnLogin').addEventListener('click', loginGeneric);
  $('email').addEventListener('keydown', e => { if (e.key === 'Enter') loginGeneric(); });
  $('btnSair').addEventListener('click', logout);
  $('btnSessaoCheckin').addEventListener('click', fazerCheckin);
  $('btnSessaoDeletarCheckin').addEventListener('click', deletarCheckin);
  $('btnSessaoBack').addEventListener('click', () => {
    hide('cardSessao');
    show('cardAgendar');
    show('mainNav');
  });
  $('btnBell').addEventListener('click', loadNotificacoes);
  $('btnNotifBack').addEventListener('click', () => showTab('Home'));

  // 4) Wire up professor buttons
  $('btnProfSair').addEventListener('click', profLogout);
  $('btnProfSessaoBack').addEventListener('click', () => {
    hide('cardProfSessao');
    show('cardProf');
  });
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

  // 6a) Enable mouse drag-to-scroll on days-of-week rows
  enableDragScroll($('diasRow'));
  enableDragScroll($('profDiasRow'));

  // 6) Check for existing session and decide initial screen
  const email  = localStorage.getItem(LS_EMAIL);
  const nome   = localStorage.getItem(LS_NOME);
  const pEmail = localStorage.getItem(LS_PROF_EMAIL);
  const pNome  = localStorage.getItem(LS_PROF_NOME);
  const bioOk  = localStorage.getItem(LS_BIO_ATIVADA) === '1';
  const credId = localStorage.getItem(LS_CREDENTIAL);
  const bioTs    = parseInt(localStorage.getItem(LS_BIO_TS) || '0', 10);
  const bioGrace = Date.now() - bioTs < BIO_GRACE_MS; // 30 minutes

  if (email && nome) {
    alunoData = { nome };
    preencherCard(alunoData);
    if (bioOk && credId && bioGrace) { afterBioSuccess(false); return; }
    showBioLock(bioOk && credId ? 'unlock' : 'register');
    return;
  }

  if (pEmail && pNome) {
    profData = { nome: pNome, email: pEmail };
    if (bioOk && credId && bioGrace) { afterBioSuccess(false); return; }
    showBioLock(bioOk && credId ? 'unlock' : 'register');
    return;
  }

  // No session → show login
  showTab('Home');
}

document.addEventListener('DOMContentLoaded', init);
