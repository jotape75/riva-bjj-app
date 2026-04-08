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
