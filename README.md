# riva-bjj-app
RivaBJJ frontend app

## Requisitos

- **HTTPS obrigatório** – o app está hospedado no GitHub Pages (HTTPS já ativo).
- **Biometria obrigatória** – o app exige WebAuthn/Passkeys para desbloquear.  
  Dispositivos compatíveis:
  - iPhone com **iOS 16 ou superior** (Safari — no iOS todos os navegadores usam o motor Safari/WebKit)
  - Android com biometria ativada e navegador atualizado (Chrome/Firefox)

## Como resetar a biometria

Se você trocar de dispositivo ou limpar o armazenamento do navegador, será necessário:

1. Fazer login novamente com seu **email**.
2. Registrar a biometria do novo dispositivo quando solicitado.

Caso queira forçar o re-registro no mesmo dispositivo: acesse as configurações do
navegador → Privacidade → Limpar dados do site para `jotape75.github.io`, recarregue
o app e faça login.

## Fluxo de autenticação

1. **Email** é informado na tela de login.
2. O app tenta login como **professor** (`profLoginEmail`) e, se falhar, como **aluno** (`loginEmail`).
3. No primeiro acesso no dispositivo, o app exige o **registro de passkey** (biometria).
4. Nas próximas aberturas, o app exige **autenticação via passkey** antes de exibir qualquer conteúdo.
5. O logout limpa a sessão mas mantém a passkey registrada; no próximo acesso basta autenticar com biometria.
