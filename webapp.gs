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

// ── ASAAS INTEGRATION ──────────────────────────────────────────────────────

var ASAAS_BASE = 'https://sandbox.asaas.com/api/v3';

function getAsaasKey_() {
  return PropertiesService.getScriptProperties().getProperty('ASAAS_API_KEY') || '';
}

function asaasFetch_(method, path, payload) {
  var key = getAsaasKey_();
  var options = {
    method: method,
    headers: {
      'access_token': key,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };
  if (payload) options.payload = JSON.stringify(payload);
  var resp = UrlFetchApp.fetch(ASAAS_BASE + path, options);
  try { return JSON.parse(resp.getContentText()); } catch(e) { return { errors: [{ description: resp.getContentText() }] }; }
}

// Criar ou buscar cliente no Asaas por email
function asaasUpsertCliente_(nome, email, telefone, cpf) {
  // Busca por email
  var busca = asaasFetch_('get', '/customers?email=' + encodeURIComponent(email));
  if (busca.data && busca.data.length > 0) {
    return { ok: true, customerId: busca.data[0].id };
  }
  // Cria novo
  var body = { name: nome, email: email };
  if (telefone) body.mobilePhone = telefone.replace(/\D/g, '');
  if (cpf) body.cpfCnpj = cpf.replace(/\D/g, '');
  var resp = asaasFetch_('post', '/customers', body);
  if (resp.id) return { ok: true, customerId: resp.id };
  var erro = (resp.errors && resp.errors[0]) ? resp.errors[0].description : JSON.stringify(resp);
  return { ok: false, erro: erro };
}

// ── Action: asaasVincular ──────────────────────────────────────────────────
// Cria cliente no Asaas e a cobrança/assinatura adequada ao plano
// Parâmetros esperados: alunoId, nome, email, telefone, cpf, plano, grupoFamiliar, temDesconto, dataContrato
function asaasVincular_(params) {
  try {
    var nome         = params.nome || '';
    var email        = params.email || '';
    var telefone     = params.telefone || '';
    var cpf          = params.cpf || '';
    var plano        = params.plano || '';
    var temDesconto  = params.temDesconto === 'true' || params.temDesconto === true;
    var dataContrato = params.dataContrato || new Date().toISOString().slice(0, 10);

    // Valores base
    var valores = { Recorrente: 200, Semestral: 220, Mensal: 240 };
    var valorBase = valores[plano] || 0;
    var valor = temDesconto ? Math.round(valorBase * 0.9 * 100) / 100 : valorBase;

    // Criar/buscar cliente
    var clienteResp = asaasUpsertCliente_(nome, email, telefone, cpf);
    if (!clienteResp.ok) return { ok: false, erro: 'Erro ao criar cliente: ' + clienteResp.erro };
    var customerId = clienteResp.customerId;

    var resultado = {};

    if (plano === 'Recorrente') {
      // Assinatura mensal recorrente no cartão
      var dueDate = dataContrato; // YYYY-MM-DD
      var sub = asaasFetch_('post', '/subscriptions', {
        customer: customerId,
        billingType: 'CREDIT_CARD',
        value: valor,
        nextDueDate: dueDate,
        cycle: 'MONTHLY',
        description: 'Mensalidade Recorrente – Riva BJJ'
      });
      if (sub.id) {
        resultado = { ok: true, customerId: customerId, assinatura_id: sub.id, tipo: 'assinatura', paymentLink: sub.invoiceUrl || '' };
      } else {
        var erro = (sub.errors && sub.errors[0]) ? sub.errors[0].description : JSON.stringify(sub);
        return { ok: false, erro: 'Erro ao criar assinatura: ' + erro };
      }

    } else if (plano === 'Semestral') {
      // Parcelamento em 6x no cartão
      var dueDate = dataContrato;
      var cobranca = asaasFetch_('post', '/payments', {
        customer: customerId,
        billingType: 'CREDIT_CARD',
        value: valor * 6,
        dueDate: dueDate,
        description: 'Semestral (6x) – Riva BJJ',
        installmentCount: 6,
        installmentValue: valor
      });
      if (cobranca.id) {
        resultado = { ok: true, customerId: customerId, cobranca_id: cobranca.id, tipo: 'parcelamento', paymentLink: cobranca.invoiceUrl || '' };
      } else {
        var erro = (cobranca.errors && cobranca.errors[0]) ? cobranca.errors[0].description : JSON.stringify(cobranca);
        return { ok: false, erro: 'Erro ao criar parcelamento: ' + erro };
      }

    } else if (plano === 'Mensal') {
      // Cobrança única — Pix ou Boleto conforme parâmetro formaPag
      var formaPag = params.formaPag || 'PIX'; // PIX ou BOLETO
      var billingType = formaPag.toUpperCase() === 'BOLETO' ? 'BOLETO' : 'PIX';
      var dueDate = dataContrato;
      var cobranca = asaasFetch_('post', '/payments', {
        customer: customerId,
        billingType: billingType,
        value: valor,
        dueDate: dueDate,
        description: 'Mensalidade Mensal – Riva BJJ'
      });
      if (cobranca.id) {
        var paymentLink = cobranca.invoiceUrl || cobranca.bankSlipUrl || '';
        if (billingType === 'PIX') {
          // Buscar QR Code do Pix
          var pixResp = asaasFetch_('get', '/payments/' + cobranca.id + '/pixQrCode');
          resultado = {
            ok: true,
            customerId: customerId,
            cobranca_id: cobranca.id,
            tipo: 'avista',
            paymentLink: paymentLink,
            pixCopiaECola: pixResp.payload || '',
            pixQrCodeImage: pixResp.encodedImage || ''
          };
        } else {
          resultado = { ok: true, customerId: customerId, cobranca_id: cobranca.id, tipo: 'avista', paymentLink: paymentLink };
        }
      } else {
        var erro = (cobranca.errors && cobranca.errors[0]) ? cobranca.errors[0].description : JSON.stringify(cobranca);
        return { ok: false, erro: 'Erro ao criar cobrança: ' + erro };
      }
    } else {
      return { ok: false, erro: 'Plano não reconhecido: ' + plano };
    }

    return resultado;
  } catch(err) {
    return { ok: false, erro: err.message };
  }
}

// ── Action: asaasStatus ────────────────────────────────────────────────────
// Consulta status da assinatura ou cobrança no Asaas
// Parâmetros: asaasId (pode ser customerId, assinatura_id ou cobranca_id), tipo (assinatura|cobranca|customer)
function asaasStatus_(params) {
  try {
    var tipo    = params.tipo || 'customer';
    var asaasId = params.asaasId || '';
    if (!asaasId) return { ok: false, erro: 'asaasId obrigatório' };

    if (tipo === 'assinatura') {
      // Buscar pagamentos da assinatura no mês/ano
      var mes = parseInt(params.mes || new Date().getMonth() + 1);
      var ano = parseInt(params.ano || new Date().getFullYear());
      var resp = asaasFetch_('get', '/payments?subscription=' + asaasId);
      if (!resp.data) return { ok: false, erro: 'Erro ao consultar Asaas' };
      // Filtrar pelo mês/ano
      var pagamento = null;
      for (var i = 0; i < resp.data.length; i++) {
        var p = resp.data[i];
        if (p.dueDate) {
          var d = new Date(p.dueDate);
          if (d.getMonth() + 1 === mes && d.getFullYear() === ano) {
            pagamento = p;
            break;
          }
        }
      }
      if (!pagamento) return { ok: true, status: 'PENDING', valor: 0, dataPagamento: '' };
      return {
        ok: true,
        status: pagamento.status, // CONFIRMED, PENDING, OVERDUE, RECEIVED
        valor: pagamento.value || 0,
        dataPagamento: pagamento.paymentDate || pagamento.clientPaymentDate || '',
        invoiceUrl: pagamento.invoiceUrl || ''
      };

    } else if (tipo === 'cobranca') {
      var resp = asaasFetch_('get', '/payments/' + asaasId);
      if (!resp.id) return { ok: false, erro: 'Cobrança não encontrada' };
      return {
        ok: true,
        status: resp.status,
        valor: resp.value || 0,
        dataPagamento: resp.paymentDate || resp.clientPaymentDate || '',
        invoiceUrl: resp.invoiceUrl || resp.bankSlipUrl || '',
        pixCopiaECola: resp.pixTransaction ? resp.pixTransaction.qrCode : ''
      };

    } else {
      // customer: buscar pagamentos do cliente no mês
      var mes = parseInt(params.mes || new Date().getMonth() + 1);
      var ano = parseInt(params.ano || new Date().getFullYear());
      var resp = asaasFetch_('get', '/payments?customer=' + asaasId + '&status=RECEIVED,CONFIRMED,PENDING,OVERDUE');
      if (!resp.data) return { ok: false, erro: 'Erro ao consultar Asaas' };
      var pagamento = null;
      for (var i = 0; i < resp.data.length; i++) {
        var p = resp.data[i];
        if (p.dueDate) {
          var d = new Date(p.dueDate);
          if (d.getMonth() + 1 === mes && d.getFullYear() === ano) {
            pagamento = p;
            break;
          }
        }
      }
      if (!pagamento) return { ok: true, status: 'PENDING', valor: 0 };
      return { ok: true, status: pagamento.status, valor: pagamento.value || 0, dataPagamento: pagamento.paymentDate || '' };
    }
  } catch(err) {
    return { ok: false, erro: err.message };
  }
}

// ── Action: asaasCancelarAssinatura ───────────────────────────────────────
function asaasCancelarAssinatura_(params) {
  try {
    var assinatura_id = params.assinatura_id || '';
    if (!assinatura_id) return { ok: false, erro: 'assinatura_id obrigatório' };
    asaasFetch_('delete', '/subscriptions/' + assinatura_id, null);
    // DELETE retorna 200 com body vazio ou { deleted: true }
    return { ok: true };
  } catch(err) {
    return { ok: false, erro: err.message };
  }
}

/*
  ── REGISTRAR NO routeAction_ DO ARQUIVO PRINCIPAL (código.gs / main.gs) ──
  Localizar a função routeAction_ (ou doPost/doGet) que roteie actions e
  adicionar os cases abaixo antes do "return { ok:false, erro:'Ação desconhecida' }":

  case 'asaasVincular':             result = asaasVincular_(params); break;
  case 'asaasStatus':               result = asaasStatus_(params); break;
  case 'asaasCancelarAssinatura':   result = asaasCancelarAssinatura_(params); break;

  Além disso, configurar a API key no Apps Script via:
  Arquivo → Propriedades do script → Propriedades → Adicionar: ASAAS_API_KEY = <sua_chave>
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
