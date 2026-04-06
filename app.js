const API_BASE = "https://script.google.com/macros/s/AKfycbyBLlVjEvO35RufIh6pH9XOOTDXuj_BMrNHAJfdw9I-reScWX31dsVdOFJna1ZbJVqX/exec";

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

async function apiLoginCpf(cpf){
  const url = `${API_BASE}?action=loginCpf&cpf=${encodeURIComponent(cpf)}`;
  const res = await fetch(url, { method:"GET", mode:"cors", cache:"no-store" });
  if (!res.ok) throw new Error(`Erro HTTP ${res.status}`);
  return await res.json();
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
    const data = await apiLoginCpf(cpf);
    if (data.erro) {
      showAlunoCard(false);
      setInfo("");
      setErr(data.erro);
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
