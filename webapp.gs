// ── loginProfessor: valida email na aba Professores + senha compartilhada
// Adicionar no doGet router:
// } else if (action === "loginProfessor") {
//   result = loginProfessor_(e.parameter);
// }

function loginProfessor_(params) {
  try {
    var email = (params.email || "").toString().trim().toLowerCase();
    var senha = (params.senha || "").toString().trim();

    if (senha !== SENHA_PROFESSOR) {
      return { ok: false, erro: "Senha incorreta" };
    }

    var planilha = SpreadsheetApp.openById(PLANILHA_ID);
    var aba = planilha.getSheetByName("Professores");
    if (!aba) return { ok: false, erro: "Aba Professores não encontrada" };

    var dados = aba.getDataRange().getValues();
    for (var i = 1; i < dados.length; i++) {
      var emailPlanilha = (dados[i][1] || "").toString().trim().toLowerCase();
      if (emailPlanilha === email) {
        return { ok: true, token: "rv_prof_ok", nome: dados[i][0] };
      }
    }

    return { ok: false, erro: "Email não cadastrado" };
  } catch(err) {
    return { ok: false, erro: err.message };
  }
}

// ── Adicionar esta action no routeAction_, antes do return { ok:false, erro:"Ação desconhecida" }

/*
  case 'notificacoes': {
    const email = (params.email || '').trim().toLowerCase();
    if (!email) return { ok: false, erro: 'Email obrigatório.' };

    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const aba   = ss.getSheetByName('Checkins');
    if (!aba) return { ok: false, erro: 'Aba Checkins não encontrada.' };

    const dados = aba.getDataRange().getValues();
    // Colunas (0-based): A=0 email, C=2 horário, E=4 data treino, G=6 status, I=8 data aprovação
    const hoje        = new Date();
    const limite30    = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000);
    const notifs      = [];

    for (let i = 1; i < dados.length; i++) {
      const row          = dados[i];
      const rowEmail     = (row[0] || '').toString().trim().toLowerCase();
      const horario      = (row[2] || '').toString().trim();
      const dataTreino   = (row[4] || '').toString().trim();
      const status       = (row[6] || '').toString().trim().toUpperCase();
      const dataAprovRaw = row[8];

      if (rowEmail !== email) continue;
      if (status !== 'VALIDADO' && status !== 'REPROVADO') continue;

      // Filtra últimos 30 dias com base na data de aprovação
      let dataAprovDate = null;
      if (dataAprovRaw instanceof Date) {
        dataAprovDate = dataAprovRaw;
      } else if (dataAprovRaw) {
        dataAprovDate = new Date(dataAprovRaw);
      }
      if (!dataAprovDate || isNaN(dataAprovDate.getTime())) continue;
      if (dataAprovDate < limite30) continue;

      // Formata data + hora de aprovação: "08/04/2026 • 14:23"
      const d  = String(dataAprovDate.getDate()).padStart(2, '0');
      const m  = String(dataAprovDate.getMonth() + 1).padStart(2, '0');
      const y  = dataAprovDate.getFullYear();
      const hh = String(dataAprovDate.getHours()).padStart(2, '0');
      const mm = String(dataAprovDate.getMinutes()).padStart(2, '0');
      const dataAprovacao = `${d}/${m}/${y} • ${hh}:${mm}`;

      notifs.push({
        id:             dataTreino + '|' + horario,
        dataTreino,
        horario,
        status,
        dataAprovacao,
        _ts: dataAprovDate.getTime(),
      });
    }

    // Ordena da mais recente para mais antiga
    notifs.sort((a, b) => b._ts - a._ts);
    notifs.forEach(n => delete n._ts);

    return { ok: true, data: notifs };
  }
*/

// ── Adicionar esta action no routeAction_, antes do return { ok:false, erro:"Ação desconhecida" }
/*
  if (action === "listaPresencaArquivo") {
    return { ok: true, data: getListaPresencaArquivo(normStr(p.data), normStr(p.horario)) };
  }
*/

function getListaPresencaArquivo(dataTreino, horarioTreino) {
  var planilha = SpreadsheetApp.openById(PLANILHA_ID);
  var aba      = planilha.getSheetByName("Checkins_Arquivo");
  if (!aba || aba.getLastRow() < 2) return [];

  var dados    = aba.getDataRange().getValues();
  var dataNorm = normStr(dataTreino);
  var horNorm  = normStr(horarioTreino);

  var lista = [];
  for (var i = 1; i < dados.length; i++) {
    if (normData(dados[i][4]) === dataNorm && normStr(dados[i][2]) === horNorm) {
      lista.push({
        linha:  i + 1,
        nome:   normStr(dados[i][1]),
        status: normStr(dados[i][6]) || "PENDENTE ⏳"
      });
    }
  }
  return lista;
}

// ── Trigger mensal: configurar manualmente no Apps Script
// Time-driven → Month timer → Day 1
// A verificação de data abaixo é uma salvaguarda para execuções manuais acidentais.
function limparArquivo() {
  var hoje = new Date();
  if (hoje.getDate() !== 1) return;

  var planilha = SpreadsheetApp.openById(PLANILHA_ID);
  var aba      = planilha.getSheetByName("Checkins_Arquivo");
  if (!aba || aba.getLastRow() < 2) return;

  // Mantém só o header (linha 1)
  var header = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues();
  aba.clearContents();
  aba.getRange(1, 1, 1, header[0].length).setValues(header);

  SpreadsheetApp.flush();
  Logger.log("✅ Checkins_Arquivo limpo para o novo mês.");
}

// ── cadastrarAluno_: salva nas colunas A–K (existentes) + L–P (novos campos)
// Substituir a função cadastrarAluno_ no arquivo principal do projeto
/*
function cadastrarAluno_(params) {
  try {
    var planilha = SpreadsheetApp.openById(PLANILHA_ID);
    var aba      = planilha.getSheetByName("Alunos");
    var dados    = aba.getDataRange().getValues();
    var ultimoId = 0;
    for (var i = 1; i < dados.length; i++) {
      var idVal = Number(dados[i][0]);
      if (idVal > ultimoId) ultimoId = idVal;
    }
    var novoId   = ultimoId + 1;
    var faixa    = params.faixa || "Branca";
    var grau     = Number(params.grau_atual) || 0;
    var metaGrau    = (faixa === "Branca") ? 36 : 56;
    var dataGrau    = params.data_ultimo_grau || "";
    var aulasNoGrau = Number(params.aulas_no_grau) || 0;
    var restantes   = Math.max(metaGrau - aulasNoGrau, 0);
    aba.appendRow([
      novoId,
      params.nome  || "",
      "ATIVO",
      faixa,
      grau,
      aulasNoGrau,
      restantes,
      metaGrau,
      dataGrau,
      gerarStatus(faixa, grau, restantes),
      params.email || "",
      params.telefone || "",        // L
      params.cpf || "",             // M
      params.data_nasc || "",       // N
      params.data_inicio || "",     // O
      params.categoria || "Adulto"  // P
    ]);
    SpreadsheetApp.flush();
    return { ok: true, id: novoId };
  } catch(err) {
    return { ok: false, erro: err.message };
  }
}
*/

// ── listarAlunos_: retornar também os novos campos L–P
// Substituir a função listarAlunos_ no arquivo principal do projeto
/*
function listarAlunos_() {
  try {
    var planilha = SpreadsheetApp.openById(PLANILHA_ID);
    var aba      = planilha.getSheetByName("Alunos");
    var dados    = aba.getDataRange().getValues();
    var alunos   = [];
    for (var i = 1; i < dados.length; i++) {
      var row = dados[i];
      if (!row[1]) continue;
      alunos.push({
        id:               row[0],
        nome_aluno:       row[1],
        status:           row[2],
        faixa:            row[3],
        grau_atual:       row[4],
        aulas_no_grau:    row[5],
        aulas_restantes:  row[6],
        meta_grau:        row[7],
        data_ultimo_grau: row[8],
        statusExame:      row[9],
        email:            row[10],
        telefone:         row[11],
        cpf:              row[12],
        data_nasc:        row[13],
        data_inicio:      row[14],
        categoria:        row[15]
      });
    }
    return { ok: true, alunos: alunos };
  } catch(err) {
    return { ok: false, erro: err.message };
  }
}
*/

// ── trocarFaixa_: troca a faixa do aluno e zera aulas/grau
// Adicionar no arquivo principal do projeto + registrar no routeAction_:
//   case 'trocarFaixa': result = trocarFaixa_(params); break;
function trocarFaixa_(params) {
  try {
    var planilha = SpreadsheetApp.openById(PLANILHA_ID);
    var aba      = planilha.getSheetByName("Alunos");
    var dados    = aba.getDataRange().getValues();
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][0]) === String(params.id)) {
        var novaFaixa = params.novaFaixa || "Branca";
        var metaGrau  = (novaFaixa === "Branca") ? 36 : 56;
        aba.getRange(i+1, 4).setValue(novaFaixa);   // faixa
        aba.getRange(i+1, 5).setValue(0);            // grau_atual = 0
        aba.getRange(i+1, 6).setValue(0);            // aulas_no_grau = 0
        aba.getRange(i+1, 7).setValue(metaGrau);     // aulas_restantes
        aba.getRange(i+1, 8).setValue(metaGrau);     // meta_grau
        aba.getRange(i+1, 10).setValue(gerarStatus(novaFaixa, 0, metaGrau)); // statusExame
        SpreadsheetApp.flush();
        return { ok: true };
      }
    }
    return { ok: false, erro: "Aluno não encontrado" };
  } catch(err) {
    return { ok: false, erro: err.message };
  }
}
