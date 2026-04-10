# Instruções para o Apps Script – Páginas de Gerenciamento de Alunos

## Visão Geral

As páginas `cadastroaluno.html` e `alunos.html` utilizam quatro novas actions no Apps Script:

| Action | Descrição |
|---|---|
| `verificarSenha` | Valida a senha do professor |
| `cadastrarAluno` | Insere um novo aluno na aba **Alunos** |
| `listarAlunos` | Retorna todos os alunos cadastrados |
| `alterarStatusAluno` | Ativa ou desativa um aluno pelo `id` |

---

## Passo 1 – Abrir o Apps Script

1. Abra a planilha no Google Sheets.
2. No menu superior, clique em **Extensões → Apps Script**.
3. O editor será aberto.

---

## Passo 2 – Adicionar a Senha do Professor

No início do arquivo (ou em um arquivo separado), adicione a constante com a senha:

```javascript
// ── Configuração da senha do professor ────────────────────────
const SENHA_PROFESSOR = 'Rivabjj2026!@#';
```

> ⚠️ A senha fica **apenas no servidor** (Apps Script). Nunca aparece no código HTML publicado no GitHub.

---

## Passo 3 – Adicionar as Funções Novas

Cole o código abaixo no editor do Apps Script (pode ser no mesmo arquivo `.gs` ou em um novo arquivo):

```javascript
// ── Verificar Senha do Professor ──────────────────────────────
function verificarSenha(params) {
  if (params.senha === SENHA_PROFESSOR) {
    return { ok: true, token: Session.getTemporaryActiveUserKey() };
  }
  return { ok: false, erro: 'Senha incorreta.' };
}

// ── Cadastrar Aluno ───────────────────────────────────────────
function cadastrarAluno(params) {
  try {
    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName('Alunos');
    if (!aba) return { ok: false, erro: 'Aba "Alunos" não encontrada.' };

    const ultimaLinha = aba.getLastRow();
    const novoId      = ultimaLinha; // linha 1 = cabeçalho, então o id = lastRow

    const faixa       = params.faixa      || 'Branca';
    const grau_atual  = Number(params.grau_atual) || 0;
    const meta_grau   = faixa.toLowerCase() === 'branca' ? 36 : 56;
    const aulas_no_grau    = 0;
    const aulas_restantes  = meta_grau;
    const data_ultimo_grau = params.data_ultimo_grau || '';
    const statusExame      = '';

    aba.appendRow([
      novoId,                   // A – id
      params.nome   || '',      // B – nome_aluno
      'ATIVO',                  // C – status
      faixa,                    // D – faixa
      grau_atual,               // E – grau_atual
      aulas_no_grau,            // F – aulas_no_grau
      aulas_restantes,          // G – aulas_restantes
      meta_grau,                // H – meta_grau
      data_ultimo_grau,         // I – data_ultimo_grau
      statusExame,              // J – statusExame
      params.email  || '',      // K – email
    ]);

    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// ── Listar Alunos ─────────────────────────────────────────────
function listarAlunos(params) {
  try {
    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName('Alunos');
    if (!aba) return { ok: false, erro: 'Aba "Alunos" não encontrada.' };

    const dados = aba.getDataRange().getValues();
    // Linha 1 = cabeçalho, pular
    const alunos = dados.slice(1).map(row => ({
      id:             row[0],
      nome_aluno:     row[1],
      status:         row[2],
      faixa:          row[3],
      grau_atual:     row[4],
      aulas_no_grau:  row[5],
      aulas_restantes:row[6],
      meta_grau:      row[7],
      data_ultimo_grau: row[8],
      statusExame:    row[9],
      email:          row[10],
    })).filter(a => a.nome_aluno); // ignora linhas vazias

    return { ok: true, alunos };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// ── Alterar Status do Aluno ───────────────────────────────────
function alterarStatusAluno(params) {
  try {
    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName('Alunos');
    if (!aba) return { ok: false, erro: 'Aba "Alunos" não encontrada.' };

    const id     = String(params.id);
    const status = params.status === 'ATIVO' ? 'ATIVO' : 'INATIVO';
    const dados  = aba.getDataRange().getValues();

    for (let i = 1; i < dados.length; i++) {
      if (String(dados[i][0]) === id) {
        aba.getRange(i + 1, 3).setValue(status); // coluna C = status
        return { ok: true };
      }
    }

    return { ok: false, erro: 'Aluno não encontrado.' };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}
```

---

## Passo 4 – Adicionar os Casos no Roteador `doGet`

No seu arquivo principal que contém a função `doGet`, **adicione os novos casos** dentro do `switch` ou `if/else` existente:

```javascript
function doGet(e) {
  const params = e.parameter;
  const action = params.action || '';
  const cb     = params.callback || '';

  let result;

  switch (action) {
    // ... seus cases existentes ...

    case 'verificarSenha':
      result = verificarSenha(params);
      break;

    case 'cadastrarAluno':
      result = cadastrarAluno(params);
      break;

    case 'listarAlunos':
      result = listarAlunos(params);
      break;

    case 'alterarStatusAluno':
      result = alterarStatusAluno(params);
      break;

    default:
      result = { ok: false, erro: 'Action desconhecida.' };
  }

  const json = JSON.stringify(result);
  const output = cb
    ? ContentService.createTextOutput(`${cb}(${json})`)
        .setMimeType(ContentService.MimeType.JAVASCRIPT)
    : ContentService.createTextOutput(json)
        .setMimeType(ContentService.MimeType.JSON);

  return output;
}
```

> ℹ️ Se o seu `doGet` já usa um padrão diferente (ex: `if/else if`), adapte adicionando os novos blocos seguindo o mesmo padrão que já existe.

---

## Passo 5 – Reimplantar o Apps Script

Após salvar as alterações, é **obrigatório** reimplantar para que as mudanças entrem em vigor:

1. No editor do Apps Script, clique em **Implantar → Gerenciar implantações**.
2. Clique no ícone de edição (lápis) na implantação existente.
3. Em **Versão**, selecione **"Nova versão"**.
4. Clique em **Implantar**.
5. Copie a nova URL (se mudou) e atualize em `cadastroaluno.html` e `alunos.html` se necessário.

> ✅ A URL geralmente **não muda** ao reimplantar uma implantação existente — apenas a versão interna é atualizada.

---

## Resumo das Colunas da Aba "Alunos"

| Coluna | Campo |
|---|---|
| A | id |
| B | nome_aluno |
| C | status |
| D | faixa |
| E | grau_atual |
| F | aulas_no_grau |
| G | aulas_restantes |
| H | meta_grau |
| I | data_ultimo_grau |
| J | statusExame |
| K | email |

**meta_grau automático:** Branca = 36 · Todas as outras faixas = 56
