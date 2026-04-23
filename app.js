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
const NOTIF_TTL           = 900000;   // 15 min
const BIO_GRACE_MS        = 1800000;  // 30 min
const RP_NAME             = 'Riva BJJ';
const MAX_GRAU_POR_FAIXA = 4;

// Faixas juvenis (36 aulas por grau)
const FAIXAS_JUVENIS = new Set([
  'Cinza/Branca','Cinza','Cinza/Preta',
  'Amarela/Branca','Amarela','Amarela/Preta',
  'Laranja/Branca','Laranja','Laranja/Preta',
  'Verde/Branca','Verde','Verde/Preta',
]);

// Ícones: emoji para monocores com emoji disponível, HTML para o resto
const EMOJI_FAIXA = {
  'Branca':  '🔲',
  'Azul':    '🟦',
  'Roxa':    '🟪',
  'Marrom':  '🟫',
  'Amarela': '🟨',
  'Laranja': '🟧',
  'Verde':   '🟩',
};

// Cores para quadradinhos HTML
const COR_FAIXA = {
  'Cinza':   '#9E9E9E',
  'Preta':   '#111111',
  'Branca':  '#FFFFFF',
  'Amarela': '#FFD600',
  'Laranja': '#FF6D00',
  'Verde':   '#2E7D32',
};
function _quadrado(cor, borda = false) {
  const b = borda ? 'border:1.5px solid #fff;' : '';
  return `<span style="display:inline-block;width:16px;height:16px;border-radius:3px;background:${cor};${b}vertical-align:middle;"></span>`;
}

function _quadradoBicolor(cor1, cor2, borda = false) {
  const b = borda ? 'border:1.5px solid #fff;' : '';
  return `<span style="display:inline-block;width:16px;height:16px;border-radius:3px;background:linear-gradient(to right,${cor1} 50%,${cor2} 50%);${b}vertical-align:middle;"></span>`;
}

function iconeGrau(faixa) {
  if (EMOJI_FAIXA[faixa]) return EMOJI_FAIXA[faixa];
  if (faixa.includes('/')) {
    const [c1, c2] = faixa.split('/');
    const cor1 = COR_FAIXA[c1] || '#888';
    const cor2 = COR_FAIXA[c2] || '#888';
    const borda = c2 === 'Preta';
    return _quadradoBicolor(cor1, cor2, borda);
  }
  const cor  = COR_FAIXA[faixa] || '#888';
  const borda = faixa === 'Preta';
  return _quadrado(cor, borda);
}

function gerarStatusHTML(faixa, grau) {
  const g = Math.min(Math.max(Number(grau) || 0, 0), MAX_GRAU_POR_FAIXA);
  if (g === 0) return 'Iniciante';
  const icone = iconeGrau(faixa);
  if (!icone.includes('<')) return icone.repeat(g);
  return Array(g).fill(icone).join(' ');
}

function gerarStatus(faixa, grau) {
  return gerarStatusHTML(faixa, grau);
}

function hojeDataBR() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function iniciaisDe(nome) {
  if (!nome) return '?';
  const partes = nome.trim().split(' ').filter(Boolean);
  if (partes.length === 1) return partes[0][0].toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function atualizarAvatar(fotoUrl, nome) {
  const img      = document.getElementById('avatarImg');
  const initials = document.getElementById('avatarInitials');
  if (!img || !initials) return;
  if (fotoUrl) {
    img.src = fotoUrl;
    img.style.display = '';
    initials.style.display = 'none';
  } else {
    img.style.display = 'none';
    initials.textContent  = iniciaisDe(nome);
    initials.style.display = '';
  }
}

async function uploadFotoPerfil(file, alunoId) {
  const base64 = await new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = 200;
      canvas.height = 200;
      const ctx = canvas.getContext('2d');
      const size = Math.min(img.width, img.height);
      const sx   = (img.width  - size) / 2;
      const sy   = (img.height - size) / 2;
      ctx.drawImage(img, sx, sy, size, size, 0, 0, 200, 200);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = reject;
    img.src = url;
  });

  await updateDoc(doc(db, 'alunos', alunoId), { foto_url: base64 });
  return base64;
}

/* ── Contrato ─────────────────────────────────────────────── */

function valorDePlanoContrato(plano) {
  if (!plano) return '—';
  const p = plano.toLowerCase();
  if (p.includes('recorrente')) return 'R$ 200,00/mês';
  if (p.includes('semestral'))  return 'R$ 220,00/mês';
  if (p.includes('mensal'))     return 'R$ 240,00/mês';
  return '—';
}

function dataAtualBR() {
  const d = new Date();
  const dia = String(d.getDate()).padStart(2,'0');
  const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  return `${dia} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

function preencherTextoContrato(a) {
  const isResponsavel = ['Kids','Infantil','Juvenil'].includes(a.categoria);
  const nomeAluno = isResponsavel ? (a.resp_nome || a.nome_aluno || '—') : (a.nome_aluno || a.nome || '—');
  const endereco = [a.rua||'', a.numero||'', a.bairro||'', a.cidade||'', a.estado||''].filter(Boolean).join(', ') || '—';
  const cpf      = isResponsavel ? (a.resp_cpf || '—') : (a.cpf || '—');
  const plano    = a.plano || '—';
  const valor    = valorDePlanoContrato(a.plano);
  const inicio   = a.data_contrato || a.data_inicio || '';
  const inicioFmt = inicio ? (() => { const [y,m,d] = inicio.split('-'); return `${d}/${m}/${y}`; })() : '—';
  const data     = dataAtualBR();
  const campo = (v) => `<span style="background:#222;border-radius:4px;padding:1px 6px;color:#f39c12;font-weight:700;">${v}</span>`;

  return `
    <p style="font-weight:900;text-align:center;color:#fff;margin-bottom:14px;">CONTRATO DE PRESTAÇÃO DE SERVIÇOS</p>
    <p>Pelo presente instrumento particular, de um lado, <strong>RIVA BJJ BRAZILIAN JIU JITSU LTDA</strong>, com sede na Rua Jose Ramos, nº 4181, Loja 07, Parque Barnabé, Indaiatuba/SP, inscrita no CNPJ/MF sob nº 66.256.625/0001-27, aqui denominada simplesmente <strong>CONTRATADA</strong>, e de outro lado, ${campo(nomeAluno)}, inscrito(a) no CPF/MF sob o nº ${campo(cpf)}, residente e domiciliado(a) na ${campo(endereco)}, aqui denominado(a) simplesmente <strong>CONTRATANTE</strong>, fica ajustada a prestação de serviços específicos na área de preparação física, onde serão ministradas aulas de acordo com as cláusulas abaixo especificadas:</p>
    <p><strong>Cláusula Primeira – Dos Planos:</strong> As aulas terão frequência mínima de 02 aulas semanais, com planos mensais, recorrentes e anuais. Plano: ${campo(plano)} &nbsp; Valor: ${campo(valor)} &nbsp; Início: ${campo(inicioFmt)}</p>
    <p>Parágrafo único – Não haverá reposição e/ou troca de aula, exceto em caso de justificativa médica comprovada ou falta por parte da CONTRATADA. Nestes casos, o CONTRATANTE poderá repor a aula em horário que lhe seja conveniente, com prévia e expressa autorização da CONTRATADA.</p>
    <p><strong>Cláusula Segunda – Dos Valores:</strong> O valor correspondente a cada plano será pago a vencer, de forma mensal, mediante débito automático em cartão de crédito ou Pix, de acordo com a tabela de preço que segue em anexo, que poderá sofrer variações e reajustes a critério da CONTRATADA, limitados às disposições legais.</p>
    <p>Parágrafo único – Não será permitida qualquer espécie de cessão do presente contrato, transferência de créditos restantes ou do plano contratado, independente do grau de parentesco ou da relação existente com o CONTRATANTE.</p>
    <p><strong>Cláusula Terceira – Do Prazo:</strong> O presente contrato poderá ser renovado automaticamente.</p>
    <p>Parágrafo único – Quando da renovação, novos pagamentos deverão ser feitos de acordo com o plano escolhido.</p>
    <p><strong>Cláusula Quarta – Da Rescisão:</strong> O CONTRATANTE deverá comunicá-la com antecedência mínima de 30 (trinta) dias, sob pena de incidir o pagamento do mês vigente.</p>
    <p>Parágrafo único – Não ocorrendo o aviso de rescisão, nem o comparecimento na aula seguinte ao vencimento do plano, o CONTRATANTE renuncia o horário de suas aulas, facultando ao CONTRATADO disponibilização daquele horário.</p>
    <p><strong>Cláusula Quinta – Do Termo de Responsabilidade:</strong> O CONTRATANTE declara ter consultado médico de sua confiança, e estar apto para a prática de atividades físicas e esportivas de qualquer natureza, bem como, declara estar ciente de que deverá apresentar o respectivo atestado médico.</p>
    <p>Parágrafo 1º – O CONTRATANTE se responsabiliza pela manutenção e cuidados de sua saúde, bem como, pelo uso de qualquer medicamento e/ou substância que faça uso ou passe a utilizar, sob prescrição médica ou não.</p>
    <p>Parágrafo 2º – O CONTRATANTE deverá apresentar também, caso seja portador de alguma deficiência ou enfermidade que imponha limitações à atividade física, laudo médico informando tal estado.</p>
    <p>Parágrafo 3º – A validade do atestado médico e/ou laudo médico é de 01 (um) ano, sendo necessária sua renovação.</p>
    <p><strong>Cláusula Sexta – Dos Danos e Acidentes:</strong> O CONTRATANTE se obriga a observar estrita e exclusivamente as orientações dos profissionais da CONTRATADA para a prática das atividades físicas.</p>
    <p>Parágrafo único – A CONTRATADA não se responsabiliza por danos físicos de qualquer natureza resultantes da inobservância do CONTRATANTE às suas orientações, pelo acatamento à orientação de terceiros estranhos, ou ainda pelo uso inadequado dos aparelhos e equipamentos.</p>
    <p><strong>Cláusula Sétima – Da Imagem:</strong> A CONTRATADA, livre de quaisquer ônus junto ao CONTRATANTE, poderá utilizar-se da sua imagem para fins exclusivos de divulgação da Academia e suas atividades, podendo reproduzi-la ou divulgá-la junto à Internet, redes sociais, jornais e todos os demais meios de comunicação público ou privado.</p>
    <p>Parágrafo único – Em nenhuma hipótese poderá a imagem do CONTRATANTE ser utilizada de maneira contrária à moral ou aos bons costumes ou à ordem pública.</p>
    <p><strong>Cláusula Oitava – Dos Danos Causados:</strong> O CONTRATANTE se obriga a ressarcir a CONTRATADA por qualquer dano causado por ele, por dolo ou culpa, em até 48 horas após a constatação do evento e sua consequente comunicação formal ao CONTRATANTE.</p>
    <p><strong>Cláusula Nona – Dos Armários, Objetos e Pertences:</strong> A CONTRATADA disponibiliza aos seus usuários guarda-volumes e/ou armários, que deverão ser esvaziados diariamente. A CONTRATADA não se responsabiliza pelos objetos deixados no interior dos armários ou guarda-volumes.</p>
    <p><strong>Cláusula Décima – Do Estacionamento:</strong> O estacionamento é gratuito e de uso exclusivo dos CONTRATANTES. A CONTRATADA não se responsabiliza por roubos, furtos, danos de veículos ou motos, ou por objetos deixados no interior deles.</p>
    <p><strong>Cláusula Décima Primeira – Do Foro:</strong> As partes elegem o foro da cidade de Indaiatuba/SP, desprezando qualquer outro, por mais privilegiado que seja, para dirimir eventual entrave decorrente do presente contrato.</p>
    <p>E por estarem justos e contratados, assinam o presente instrumento em 02 (duas) vias de igual teor.</p>
    <p style="text-align:center;margin-top:14px;">Indaiatuba, ${data}</p>
  `;
}

function verificarBotaoContrato() {
  const leu     = document.getElementById('chkContratoLeitura').checked;
  const assinou = document.getElementById('contratoInputAssinatura').value.trim().length >= 3;
  document.getElementById('btnAssinarContrato').disabled = !(leu && assinou);
}

async function mostrarTelaContrato(a) {
  document.getElementById('contratoTexto').innerHTML = preencherTextoContrato(a);
  document.getElementById('chkContratoLeitura').checked = false;
  document.getElementById('btnAssinarContrato').disabled = true;
  document.getElementById('contratoErr').textContent  = '';
  document.getElementById('contratoInfo').textContent = '';
  const input = document.getElementById('contratoInputAssinatura');
  const preview = document.getElementById('contratoTextoAssinatura');
  if (input)   input.value = '';
  if (preview) preview.textContent = '—';

  ['cardLogin','cardAluno','cardAgendar','cardNotificacoes','cardSessao'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  hide('mainNav');
  const isResponsavel = ['Kids','Infantil','Juvenil'].includes(a.categoria);
  const labelAss = document.getElementById('contratoLabelAssinatura');
  if (labelAss) {
    const nomeResp = a.resp_nome || '';
    labelAss.textContent = isResponsavel
      ? `✍️ Assinatura do Responsável${nomeResp ? ' (' + nomeResp + ')' : ''}:`
      : '✍️ Digite seu nome para assinar:';
  }
  const inputAss = document.getElementById('contratoInputAssinatura');
  if (inputAss) {
    inputAss.placeholder = isResponsavel ? 'Digite o nome do responsável' : 'Digite seu nome completo';
  }

  show('cardContrato');
}

async function salvarAssinaturaContrato(a) {
  const nome = document.getElementById('contratoInputAssinatura').value.trim();
  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100">
    <rect width="400" height="100" fill="white"/>
    <text x="200" y="70" font-family="Dancing Script, cursive" font-size="48"
      font-weight="700" fill="#1a1a1a" text-anchor="middle">${nome}</text>
  </svg>`;
  const assinaturaBase64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)));
  const agora = new Date().toISOString();
  await updateDoc(doc(db, 'alunos', a.id), {
    contrato_assinado:    true,
    contrato_assinado_em: agora,
    contrato_assinatura:  assinaturaBase64,
  });
}

/* ── localStorage key constants ──────────────────────────────── */
const LS_EMAIL        = 'rv_email';
const LS_NOME         = 'rv_nome';
const LS_PROF_EMAIL   = 'rv_prof_email';
const LS_PROF_NOME    = 'rv_prof_nome';
const LS_CREDENTIAL   = 'rv_credentialId';
const LS_BIO_ATIVADA  = 'rv_biometria_ativada';
const LS_NOTIF_VISTO  = 'rv_notif_visto';
const LS_BIO_TS       = 'rv_bio_ts';
const LS_SEMANA_CACHE = 'rv_semana_cache';

/* ── sessionStorage key constants ─────────────────────────────── */
const SS_PAGE   = 'rv_page';
const SS_SESSAO = 'rv_sessao';

/* ── Firebase helpers ─────────────────────────────────────────── */

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

async function fbLogin(email) {
  try {
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
          nome_aluno:     docData.nome_aluno || '',
          faixa:          docData.faixa || '',
          grau:           docData.grau_atual ?? 0,
          dataGrau:       docData.data_ultimo_grau || '',
          status:         docData.status || '',
          statusExame:    docData.statusExame || '',
          aulasNoGrau:    docData.aulas_no_grau ?? 0,
          aulasRestantes: docData.aulas_restantes ?? null,
          metaGrau:       docData.meta_grau ?? 0,
          email:          docData.email || email,
          foto_url:       docData.foto_url || '',
          contrato_assinado: docData.contrato_assinado || false,
          cpf:            docData.cpf || '',
          plano:          docData.plano || '',
          rua:            docData.rua || '',
          numero:         docData.numero || '',
          bairro:         docData.bairro || '',
          cidade:         docData.cidade || '',
          estado:         docData.estado || '',
          data_contrato:  docData.data_contrato || '',
          data_inicio:    docData.data_inicio || '',
          categoria:      docData.categoria || '',
          resp_nome:      docData.resp_nome || '',
          resp_cpf:       docData.resp_cpf || '',
        }
      };
    }
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

async function fbTreinosSemana() {
  try {
    const snap = await getDocs(collection(db, 'sessoes'));
    const byDow = {};
    snap.forEach(d => {
      const s = d.data();
      if (!byDow[s.diaSemana]) byDow[s.diaSemana] = [];
      byDow[s.diaSemana].push({ horario: s.horario, nome: s.nome });
    });
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

async function fbListaPresenca(dataTreino, horario) {
  try {
    const q = query(
      collection(db, 'checkins'),
      where('data_treino', '==', dataTreino),
      where('horario', '==', horario)
    );
    const snap = await getDocs(q);

    const emails = [...new Set(
      snap.docs.map(d => d.data().email).filter(Boolean)
    )];

    const fotoMap = {};
    await Promise.all(emails.map(async (email) => {
      try {
        const aq = query(collection(db, 'alunos'), where('email', '==', email), limit(1));
        const as = await getDocs(aq);
        if (!as.empty) fotoMap[email] = as.docs[0].data().foto_url || '';
      } catch (_) {}
    }));

    const data = [];
    snap.forEach(d => {
      const item = d.data();
      data.push({
        linha:    d.id,
        nome:     item.nome,
        status:   item.status,
        email:    item.email || '',
        foto_url: fotoMap[item.email] || '',
      });
    });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

async function fbListaPresencaArquivo(dataTreino, horario) {
  try {
    const q = query(
      collection(db, 'checkins'),
      where('data_treino', '==', dataTreino),
      where('horario', '==', horario)
    );
    const snap = await getDocs(q);

    const emails = [...new Set(
      snap.docs.map(d => d.data().email).filter(Boolean)
    )];

    const fotoMap = {};
    await Promise.all(emails.map(async (email) => {
      try {
        const aq = query(collection(db, 'alunos'), where('email', '==', email), limit(1));
        const as = await getDocs(aq);
        if (!as.empty) fotoMap[email] = as.docs[0].data().foto_url || '';
      } catch (_) {}
    }));

    const data = [];
    snap.forEach(d => {
      const item = d.data();
      data.push({
        linha:    d.id,
        nome:     item.nome,
        status:   item.status,
        email:    item.email || '',
        foto_url: fotoMap[item.email] || '',
      });
    });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

async function fbCheckin(email, nome, horario, dataTreino, alunoId) {
  try {
    const qDia = query(
      collection(db, 'checkins'),
      where('email', '==', email),
      where('data_treino', '==', dataTreino)
    );
    const snapDia = await getDocs(qDia);

    const horariosAtivos = new Set();
    snapDia.forEach(d => {
      const item = d.data();
      if (!item.status || !item.status.includes('REPROVADO')) {
        horariosAtivos.add(item.horario);
      }
    });

    if (horariosAtivos.has(horario)) {
      return { ok: false, erro: 'Você já fez check-in para este treino! ❌' };
    }

    if (horariosAtivos.size >= 2) {
      return { ok: false, erro: 'Limite diário: você só pode fazer 2 check-ins por dia. ❌' };
    }

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

async function fbAprovar(linhaId) {
  try {
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
          const a         = alunoSnap.data();
          const faixaNorm = (a.faixa || '').replace(' e ', '/').replace(' E ', '/');
          const metaGrau  = a.meta_grau ?? ((a.categoria === 'Juvenil') ? 30 : (faixaNorm === 'Branca' ? 36 : 56));
          const grauAtual = a.grau_atual ?? 0;
          const novoAulasNoGrau = (a.aulas_no_grau ?? 0) + 1;

          try {
            if (novoAulasNoGrau >= metaGrau && metaGrau > 0) {
              if (grauAtual < MAX_GRAU_POR_FAIXA) {
                const novoGrau = grauAtual + 1;
                await updateDoc(alunoRef, {
                  grau_atual:       novoGrau,
                  aulas_no_grau:    0,
                  aulas_restantes:  metaGrau,
                  meta_grau:        metaGrau,
                  statusExame:      gerarStatus(faixaNorm, novoGrau),
                  data_ultimo_grau: hojeDataBR(),
                });
              } else {
                await updateDoc(alunoRef, {
                  aulas_restantes: 0,
                  statusExame:     gerarStatus(faixaNorm, MAX_GRAU_POR_FAIXA),
                });
              }
            } else {
              await updateDoc(alunoRef, {
                aulas_no_grau:   novoAulasNoGrau,
                aulas_restantes: Math.max(0, metaGrau - novoAulasNoGrau),
                statusExame:     gerarStatus(faixaNorm, grauAtual),
              });
            }
          } catch (permErr) {
            if (permErr.code === 'permission-denied') {
              return { ok: false, erro: 'Erro de permissão: verifique se Anonymous Auth está habilitado no Firebase Console.' };
            }
            throw permErr;
          }
        }
      }
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

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
          status:        item.status,
          horario:       item.horario || '',
          dataTreino:    item.data_treino || '',
          dataAprovacao: formatTimestamp(item.data_aprovacao)
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
let bioAction = 'unlock';

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
        { type: 'public-key', alg: -7   },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
      attestation: 'none',
    },
  });
  localStorage.setItem(LS_CREDENTIAL,  b64urlEncode(cred.rawId));
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
  ['cardLogin', 'cardContrato', 'cardAluno', 'cardAgendar', 'cardProf', 'cardBioLock', 'cardNoSupport', 'cardNotificacoes', 'cardSessao', 'cardProfSessao', 'cardSobre'].forEach(hide);
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
  const savedPage   = sessionStorage.getItem(SS_PAGE);
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
    const fotoUrl = localStorage.getItem('rv_foto_url') || '';
    alunoData = { nome, foto_url: fotoUrl };
    preencherCard(alunoData);
    showAlunoSkeleton();
    fbLogin(email)
      .then(r => {
        if (r && r.ok) {
          alunoData = r.data;
          preencherCard(alunoData);
          if (!alunoData.contrato_assinado) {
            mostrarTelaContrato(alunoData);
          } else {
            hide('cardContrato');
            show('cardAluno');
            show('mainNav');
          }
        }
      })
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
      sessionStorage.removeItem(SS_PAGE);
      showTab('Home');
    }
    checkBellBadge();
    return;
  }

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
let semanaCache  = null;
let presenceCache = {};
let semanaInFlight   = false;
let presencaInFlight = {};
let aSelDia      = null;
let aSelSessao   = null;
let pSelDia      = null;
let pSelSessao   = null;
let notifCache   = null;
let notifInFlight = false;

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

/* ── Navigation ───────────────────────────────────────────────── */
function showTab(tab) {
  sessionStorage.setItem(SS_PAGE, tab);
  sessionStorage.removeItem(SS_SESSAO);
  ['cardLogin', 'cardContrato', 'cardAluno', 'cardAgendar', 'cardProf', 'cardBioLock', 'cardNoSupport', 'cardNotificacoes', 'cardSessao', 'cardProfSessao', 'cardSobre'].forEach(hide);
  ['navHome', 'navAgendar', 'navSobre'].forEach(id => $(id).classList.remove('on'));

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
async function revalidateSemana(onSuccess) {
  if (semanaInFlight) return;
  semanaInFlight = true;
  try {
    const r = await fbTreinosSemana();
    if (r.ok) { semanaCache = { ts: Date.now(), data: r.data }; saveSemanaCache(r.data); onSuccess(r.data); }
  } catch (_) {}
  finally { semanaInFlight = false; }
}

async function loadSemana(ctx) {
  const rowId  = ctx === 'prof' ? 'profDiasRow' : 'diasRow';
  const cached = getCachedSemana();

  if (cached) {
    renderDias(ctx, cached);
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

  $(labelId).textContent = getMesAno();

  const treinosByDow = {};
  semana.forEach(d => { treinosByDow[d.diaSemana] = d.treinos || []; });

  const monthDays = getMonthDays().map(date => ({
    data:      formatDate(date),
    diaSemana: date.getDay(),
    nomeDia:   NOMES_DIA_PT[date.getDay()],
    treinos:   treinosByDow[date.getDay()] || [],
  }));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = formatDate(today);

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

  if (dia.treinos.length > 0) {
    lista.children[0].classList.add('active');
  }
}

/* ── Session screens ──────────────────────────────────────────── */
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

  const daysAgo    = diasDiferenca(sessao.data);
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
    } catch (_) {}
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

  presencaInFlight[k] = true;

  const cached = getCachedPresenca(sessao.data, sessao.horario);
  if (cached) {
    renderPresencaLista(ctx, cached, sessao);
    try {
      const r = await fbListaPresenca(sessao.data, sessao.horario);
      if (r.ok) {
        setCachedPresenca(sessao.data, sessao.horario, r.data || []);
        renderPresencaLista(ctx, r.data || [], sessao);
      }
    } catch (_) {}
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

      const avatarHtml = ctx === 'prof'
        ? (item.foto_url
            ? `<img src="${item.foto_url}" alt="" style="width:48px;height:48px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1.5px solid #444;" />`
            : `<div style="width:48px;height:48px;border-radius:50%;background:#2a2a2a;border:1.5px solid #444;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#888;flex-shrink:0;">${(item.nome||'?')[0].toUpperCase()}</div>`)
        : '';

      return `<div class="presenca-item">
        <div class="presenca-info" style="${ctx === 'prof' ? 'align-items:center;gap:10px;' : ''}">
          ${avatarHtml}
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
    if (!r.ok) {
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
    if (!r.ok) {
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

/* ── Notifications ────────────────────────────────────────────── */
function notifAprovTs(n) {
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
  return s;
}

/* ── Student card ─────────────────────────────────────────────── */
function preencherCard(d) {
  $('aNome').textContent  = d.nome  || '—';
  const faixaNorm = (d.faixa || '').replace(' e ', '/').replace(' E ', '/');
  $('aFaixa').textContent = faixaNorm || '—';
  const g = (d.grau != null && d.grau !== '') ? Number(d.grau) : null;
  $('aGrau').textContent = (g === 0) ? 'Iniciante' : (g != null ? String(g) : '—');
  $('aData').textContent  = d.dataGrau ? formatarDataBR(d.dataGrau) : '—';

  const statusEl = $('aStatus');
  statusEl.className = 'status';
  if (d.status === 'INATIVO') {
    statusEl.innerHTML   = 'INATIVO';
    statusEl.style.color = '#e74c3c';
  } else {
    statusEl.innerHTML   = (faixaNorm && g != null)
      ? gerarStatusHTML(faixaNorm, g)
      : (d.statusExame || d.status || '—');
    statusEl.style.color = '';
  }

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

  atualizarAvatar(d.fotoUrl || d.foto_url || '', d.nome || '');
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
  localStorage.removeItem('rv_foto_url');
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
  hide('cardProf');
  showTab('Home');
}

/* ── init ─────────────────────────────────────────── */
function init() {
  if (!webAuthnAvailable()) {
    ['cardLogin', 'cardAluno', 'cardAgendar', 'cardProf'].forEach(hide);
    hide('mainNav');
    show('cardNoSupport');
    return;
  }

  $('btnBioAction').addEventListener('click', onBioAction);

  $('btnLogin').addEventListener('click', loginGeneric);
  $('email').addEventListener('keydown', e => { if (e.key === 'Enter') loginGeneric(); });
  $('btnSair').addEventListener('click', logout);
  $('btnSessaoCheckin').addEventListener('click', fazerCheckin);
  $('btnSessaoDeletarCheckin').addEventListener('click', deletarCheckin);
  $('btnSessaoBack').addEventListener('click', () => {
    hide('cardSessao');
    hide('cardSobre');
    show('cardAgendar');
    show('mainNav');
  });
  $('btnBell').addEventListener('click', loadNotificacoes);
  $('btnNotifBack').addEventListener('click', () => showTab('Home'));

  $('btnProfSair').addEventListener('click', profLogout);
  $('btnProfSessaoBack').addEventListener('click', () => {
    hide('cardProfSessao');
    show('cardProf');
  });

  $('navHome').addEventListener('click',    () => showTab('Home'));
  $('navAgendar').addEventListener('click', () => showTab('Agendar'));

  $('navSobre').addEventListener('click', () => {
    sessionStorage.removeItem(SS_PAGE);
    ['cardAluno','cardAgendar','cardNotificacoes','cardSessao','cardSobre'].forEach(hide);
    ['navHome','navAgendar','navSobre'].forEach(id => $(id).classList.remove('on'));
    $('navSobre').classList.add('on');
    show('cardSobre');
  });

  $('btnSobreBack').addEventListener('click', () => {
    sessionStorage.removeItem(SS_PAGE);
    ['navHome','navAgendar','navSobre'].forEach(id => $(id).classList.remove('on'));
    $('navHome').classList.add('on');
    showTab('Home');
  });

  const fotoInput = document.getElementById('fotoInput');
  if (fotoInput) {
    fotoInput.addEventListener('change', async function () {
      const file = this.files && this.files[0];
      if (!file || !alunoData || !alunoData.id) return;
      if (file.size > 5 * 1024 * 1024) {
        alert('Imagem muito grande. Máximo 5 MB.');
        return;
      }
      const localUrl = URL.createObjectURL(file);
      atualizarAvatar(localUrl, alunoData.nome || '');
      try {
        const url = await uploadFotoPerfil(file, alunoData.id);
        alunoData.foto_url = url;
        atualizarAvatar(url, alunoData.nome || '');
      } catch (e) {
        atualizarAvatar(alunoData.foto_url || '', alunoData.nome || '');
        alert('Erro ao salvar foto. Tente novamente.');
      } finally {
        this.value = '';
      }
    });
  }

  enableDragScroll($('diasRow'));
  enableDragScroll($('profDiasRow'));

  document.getElementById('chkContratoLeitura').addEventListener('change', verificarBotaoContrato);
  const contratoInput    = document.getElementById('contratoInputAssinatura');
  const contratoTextoAss = document.getElementById('contratoTextoAssinatura');
  contratoInput.addEventListener('input', () => {
    const val = contratoInput.value.trim();
    contratoTextoAss.textContent = val || '—';
    verificarBotaoContrato();
  });
  document.getElementById('btnAssinarContrato').addEventListener('click', async () => {
    if (!alunoData) return;
    document.getElementById('btnAssinarContrato').disabled = true;
    document.getElementById('contratoInfo').textContent = 'Salvando assinatura…';
    try {
      await salvarAssinaturaContrato(alunoData);
      const snap = await getDoc(doc(db, 'alunos', alunoData.id));
      if (snap.exists()) {
        const d = snap.data();
        alunoData = {
          id:             snap.id,
          nome:           d.nome_aluno || '',
          nome_aluno:     d.nome_aluno || '',
          faixa:          d.faixa || '',
          grau:           d.grau_atual ?? 0,
          dataGrau:       d.data_ultimo_grau || '',
          status:         d.status || '',
          statusExame:    d.statusExame || '',
          aulasNoGrau:    d.aulas_no_grau ?? 0,
          aulasRestantes: d.aulas_restantes ?? null,
          metaGrau:       d.meta_grau ?? 0,
          email:          d.email || alunoData.email,
          foto_url:       d.foto_url || '',
          contrato_assinado: d.contrato_assinado || false,
        };
        preencherCard(alunoData);
      }
      document.getElementById('contratoInfo').textContent = '';
      hide('cardContrato');
      show('cardAluno');
      show('mainNav');
    } catch(e) {
      document.getElementById('contratoErr').textContent  = 'Erro ao salvar. Tente novamente.';
      document.getElementById('contratoInfo').textContent = '';
      document.getElementById('btnAssinarContrato').disabled = false;
    }
  });

  const email  = localStorage.getItem(LS_EMAIL);
  const nome   = localStorage.getItem(LS_NOME);
  const pEmail = localStorage.getItem(LS_PROF_EMAIL);
  const pNome  = localStorage.getItem(LS_PROF_NOME);
  const bioOk  = localStorage.getItem(LS_BIO_ATIVADA) === '1';
  const credId = localStorage.getItem(LS_CREDENTIAL);
  const bioTs    = parseInt(localStorage.getItem(LS_BIO_TS) || '0', 10);
  const bioGrace = Date.now() - bioTs < BIO_GRACE_MS;

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

  show('cardLogin');

} // fecha function init()

document.addEventListener('DOMContentLoaded', init);
