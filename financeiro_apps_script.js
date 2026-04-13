// ============================================================
// financeiro_apps_script.js
// Funções para o módulo Financeiro do Riva BJJ App.
//
// INSTRUÇÕES DE USO:
//   1. Abra o Apps Script do projeto (vinculado à planilha do Riva BJJ).
//   2. Copie as funções abaixo para o arquivo principal (webapp.gs ou Code.gs).
//   3. No roteador doGet / routeAction_, adicione os casos indicados.
//   4. Verifique se a aba "Financeiro" existe na planilha; ela será criada
//      automaticamente na primeira chamada a registrarPagamento_.
//   5. Faça um novo Deploy da Web App (Execute as: Me, Access: Anyone).
// ============================================================

// ── Roteador: adicionar antes do return de "Ação desconhecida" ──
/*
  case 'getFinanceiro':
    result = getFinanceiro_(params);
    break;
  case 'registrarPagamento':
    result = registrarPagamento_(params);
    break;
*/

// ── Estrutura da aba "Financeiro" ──────────────────────────────
// Colunas: A=ID | B=AlunoID | C=Nome | D=Valor | E=Data | F=FormaPagamento | G=Mes | H=Ano

// ── getFinanceiro_: lista alunos com status de pagamento do mês ─
// Retorna todos os alunos ativos da aba "Alunos" cruzando com
// os registros de pagamento da aba "Financeiro" para o mês/ano.

// Dia do mês em que a mensalidade vence (pode ser ajustado conforme regra da academia)
var DIA_VENCIMENTO_MENSALIDADE = 10;
function getFinanceiro_(params) {
  try {
    var mes = parseInt(params.mes) || (new Date().getMonth() + 1);
    var ano = parseInt(params.ano) || new Date().getFullYear();

    var planilha   = SpreadsheetApp.openById(PLANILHA_ID);
    var abaAlunos  = planilha.getSheetByName("Alunos");
    if (!abaAlunos) return { ok: false, erro: "Aba Alunos não encontrada" };

    var abaFin = planilha.getSheetByName("Financeiro");

    // Monta mapa de pagamentos do mês: alunoId -> registro
    var pagamentos = {};
    if (abaFin && abaFin.getLastRow() > 1) {
      var dadosFin = abaFin.getDataRange().getValues();
      for (var i = 1; i < dadosFin.length; i++) {
        var row = dadosFin[i];
        // Colunas: 0=ID, 1=AlunoID, 2=Nome, 3=Valor, 4=Data, 5=FormaPagamento, 6=Mes, 7=Ano
        if (parseInt(row[6]) === mes && parseInt(row[7]) === ano) {
          var aId = String(row[1]).trim();
          pagamentos[aId] = {
            valor:          row[3],
            dataPagamento:  row[4] instanceof Date
                              ? Utilities.formatDate(row[4], Session.getScriptTimeZone(), "yyyy-MM-dd")
                              : String(row[4]),
            formaPagamento: row[5]
          };
        }
      }
    }

    // Lista alunos ativos e determina status
    var dadosAlunos = abaAlunos.getDataRange().getValues();
    var hoje        = new Date();
    var alunos      = [];

    for (var j = 1; j < dadosAlunos.length; j++) {
      var aRow   = dadosAlunos[j];
      if (!aRow[1]) continue;
      var status = String(aRow[2] || '').toUpperCase();
      if (status !== 'ATIVO') continue;

      var alunoId  = String(aRow[0]).trim();
      var nome     = String(aRow[1]).trim();
      var email    = String(aRow[10] || '').trim();

      // Valor da mensalidade armazenado na coluna Q (índice 16) se existir
      var valorMensalidade = aRow[16] ? parseFloat(aRow[16]) : 0;

      var pag = pagamentos[alunoId];
      var statusPagamento;
      if (pag) {
        statusPagamento = 'pago';
      } else {
        // Vencido se já passamos do dia de vencimento do mês
        var dataVenc      = new Date(ano, mes - 1, DIA_VENCIMENTO_MENSALIDADE);
        statusPagamento   = hoje > dataVenc ? 'vencido' : 'pendente';
      }

      alunos.push({
        id:              alunoId,
        nome:            nome,
        email:           email,
        valorMensalidade: valorMensalidade,
        statusPagamento:  statusPagamento,
        valor:            pag ? pag.valor          : null,
        dataPagamento:    pag ? pag.dataPagamento   : null,
        formaPagamento:   pag ? pag.formaPagamento  : null
      });
    }

    // Ordena: pagos por último, depois por nome
    alunos.sort(function(a, b) {
      var ordemStatus = { pendente: 0, vencido: 1, pago: 2 };
      var diff = (ordemStatus[a.statusPagamento] || 0) - (ordemStatus[b.statusPagamento] || 0);
      if (diff !== 0) return diff;
      return a.nome.localeCompare(b.nome);
    });

    return { ok: true, alunos: alunos };
  } catch(err) {
    return { ok: false, erro: err.message };
  }
}

// ── registrarPagamento_: salva pagamento na aba "Financeiro" ───
function registrarPagamento_(params) {
  try {
    var alunoId      = String(params.alunoId || '').trim();
    var valor        = parseFloat(params.valor) || 0;
    var data         = String(params.data || '').trim();
    var formaPag     = String(params.formaPagamento || 'pix').trim().toLowerCase();
    var mes          = parseInt(params.mes)  || (new Date().getMonth() + 1);
    var ano          = parseInt(params.ano)  || new Date().getFullYear();

    if (!alunoId)   return { ok: false, erro: 'alunoId obrigatório' };
    if (valor <= 0) return { ok: false, erro: 'valor inválido' };
    if (!data)      return { ok: false, erro: 'data obrigatória' };

    var planilha = SpreadsheetApp.openById(PLANILHA_ID);

    // Cria aba Financeiro se não existir
    var abaFin = planilha.getSheetByName("Financeiro");
    if (!abaFin) {
      abaFin = planilha.insertSheet("Financeiro");
      abaFin.appendRow(['ID', 'AlunoID', 'Nome', 'Valor', 'Data', 'FormaPagamento', 'Mes', 'Ano']);
    }

    // Busca nome do aluno
    var abaAlunos = planilha.getSheetByName("Alunos");
    var nomeAluno = '';
    if (abaAlunos) {
      var dadosAlunos = abaAlunos.getDataRange().getValues();
      for (var i = 1; i < dadosAlunos.length; i++) {
        if (String(dadosAlunos[i][0]).trim() === alunoId) {
          nomeAluno = String(dadosAlunos[i][1]).trim();
          break;
        }
      }
    }

    // Remove pagamento anterior do mesmo aluno/mês/ano se existir
    var dadosFin = abaFin.getDataRange().getValues();
    for (var k = dadosFin.length - 1; k >= 1; k--) {
      if (
        String(dadosFin[k][1]).trim() === alunoId &&
        parseInt(dadosFin[k][6]) === mes &&
        parseInt(dadosFin[k][7]) === ano
      ) {
        abaFin.deleteRow(k + 1);
      }
    }

    // Gera novo ID
    var ultimoId = 0;
    dadosFin = abaFin.getDataRange().getValues();
    for (var m = 1; m < dadosFin.length; m++) {
      var idVal = parseInt(dadosFin[m][0]) || 0;
      if (idVal > ultimoId) ultimoId = idVal;
    }
    var novoId = ultimoId + 1;

    abaFin.appendRow([novoId, alunoId, nomeAluno, valor, data, formaPag, mes, ano]);
    SpreadsheetApp.flush();

    return { ok: true, id: novoId };
  } catch(err) {
    return { ok: false, erro: err.message };
  }
}
