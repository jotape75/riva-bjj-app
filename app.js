const API_BASE = "https://script.google.com/macros/s/AKfycbyJ8HXBfo48xctXE7G96-kyg8bcuDmuWrS8VqeOuVL77WGmuJXsuQoJCNr4hALEdh-1fw/exec";

const el = (id) => document.getElementById(id);

function normCpf(cpfRaw){
  return (cpfRaw || "").toString().replace(/\D/g,"").slice(0,11);
}
function maskCpf(cpfRaw){
  const c = normCpf(cpfRaw);
  if (c.length !== 11) return cpfRaw || "";
  return `${c.slice(0,3)}.${c.slice(3,6)}.${c.slice(6,9)}-${c.slice(9)}`;
}

function setErr(msg){ el("err").textContent = msg || ""; }
function setInfo(msg){ el("info").textContent = msg || ""; }

function showAlunoCard(show){
  el("cardAluno").classList.toggle("hidden", !show);
}

function renderAluno(a){
  el("aNome").textContent  = a.nome || "—";
  el("aFaixa").textContent = a.faixa || "—";
  el("aGrau").textContent  = (a.grau != null ? `${a.grau} / 4` : "—");
  el("aAulas").textContent = (a.aulasNoGrau != null ? `${a.aulasNoGrau} aulas` : "—");
  el("aData").textContent  = a.dataGrau || "—";
  el("aStatus").textContent = a.statusExame || a.status || "—";
}

/**
 * ✅ JSONP (evita CORS do Apps Script)
 * Espera resposta do Apps Script no formato:
 *   callback({ ok: true, data: {...} })
 */
function apiLoginCpf(cpf){
  return new Promise((resolve, reject) => {
    const cbName = "__rv_cb_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);

    const cleanup = () => {
      try { delete window[cbName]; } catch {}
      if (script && script.parentNode) script.parentNode.removeChild(script);
      if (timer) clearTimeout(timer);
    };

    window[cbName] = (resp) => {
      cleanup();
      resolve(resp);
    };

    const url = `${API_BASE}?action=loginCpf&cpf=${encodeURIComponent(cpf)}&callback=${encodeURIComponent(cbName)}`;

    const script = document.createElement("script");
    script.src = url;
    script.async = true;

    script.onerror = () => {
      cleanup();
      reject(new Error("Falha ao carregar API (JSONP)."));
    };

    // timeout de segurança
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Tempo esgotado ao consultar a API."));
    }, 15000);

    document.head.appendChild(script);
  });
}

async function login(){
  setErr(""); setInfo("Carregando...");
  const cpf = normCpf(el("cpf").value);
  el("cpf").value = maskCpf(cpf);

  if (cpf.length !== 11) {
    setInfo("");
    setErr("CPF deve ter 11 dígitos.");
    return;
  }

  try {
    const resp = await apiLoginCpf(cpf);

    // resp = { ok: true|false, data: {...} }  (ou { ok:false, erro:"..." })
    const data = resp && resp.data ? resp.data : null;

    if (!resp || resp.ok !== true || (data && data.erro)) {
      showAlunoCard(false);
      setInfo("");
      setErr((data && data.erro) ? data.erro : (resp && resp.erro) ? resp.erro : "Erro ao autenticar.");
      return;
    }

    localStorage.setItem("rv_cpf", cpf);
    localStorage.setItem("rv_user", JSON.stringify(data));
    renderAluno(data);
    showAlunoCard(true);
    setInfo("OK ✅");
  } catch (e) {
    showAlunoCard(false);
    setInfo("");
    setErr(e.message || "Erro ao conectar.");
  }
}

function sair(){
  localStorage.removeItem("rv_cpf");
  localStorage.removeItem("rv_user");
  showAlunoCard(false);
  setErr("");
  setInfo("Saiu.");
}

function restore(){
  const cpf = localStorage.getItem("rv_cpf");
  if (cpf) el("cpf").value = maskCpf(cpf);
  const u = localStorage.getItem("rv_user");
  if (u) {
    try {
      const obj = JSON.parse(u);
      renderAluno(obj);
      showAlunoCard(true);
    } catch {}
  }
}

// UI
el("btnLogin").addEventListener("click", login);
el("btnSair").addEventListener("click", sair);
el("btnAtualizar").addEventListener("click", login);

el("cpf").addEventListener("input", (e) => {
  const c = normCpf(e.target.value);
  e.target.value = maskCpf(c);
});

el("navReload").addEventListener("click", () => location.reload());
el("navHome").addEventListener("click", () => window.scrollTo({top:0,behavior:"smooth"}));

restore();
