# Firebase Migration Guide

This document describes how to migrate the Riva BJJ app backend from Google Apps Script + Google Sheets to Firebase (Firestore + Firebase Authentication).

---

## Firestore Collection Structures

### `alunos`
Each document represents a student:
```json
{
  "nome_aluno": "João Silva",
  "email": "joao@example.com",
  "status": "ATIVO",
  "faixa": "Azul",
  "grau_atual": 2,
  "aulas_no_grau": 25,
  "aulas_restantes": 15,
  "meta_grau": 40,
  "data_ultimo_grau": "2024-01-15",
  "statusExame": "",
  "telefone": "11999999999",
  "cpf": "000.000.000-00",
  "data_nasc": "1990-05-20",
  "data_inicio": "2023-01-10",
  "data_contrato": "2023-01-10",
  "categoria": "Adulto",
  "plano": "Mensal",
  "grupo_familiar": "",
  "criadoEm": "<serverTimestamp>"
}
```

### `professores`
Each document represents a professor (used for email-based login in the student app):
```json
{
  "nome": "Professor Carlos",
  "email": "carlos@rivabjj.com"
}
```
> **Note:** Professor authentication uses Firebase Auth. The `professores` collection is only used to resolve display names from email.

### `checkins`
Each document represents a class check-in:
```json
{
  "email": "joao@example.com",
  "nome": "João Silva",
  "horario": "07:00",
  "data_treino": "2025-06-10",
  "status": "PENDENTE ⏳",
  "data_aprovacao": null,
  "arquivado": false,
  "criadoEm": "<serverTimestamp>"
}
```
Status values: `"PENDENTE ⏳"`, `"VALIDADO ✓"`, `"REPROVADO ✗"`

### `sessoes`
Each document represents a scheduled class session:
```json
{
  "diaSemana": 2,
  "horario": "07:00",
  "nome": "Fundamentos"
}
```
`diaSemana` follows JavaScript convention: 0=Sunday, 1=Monday, ..., 6=Saturday.

### `pagamentos`
Each document represents a monthly payment record:
```json
{
  "alunoId": "<firestore-doc-id>",
  "nome": "João Silva",
  "valor": 200.00,
  "data": "2025-06-01",
  "formaPagamento": "pix",
  "mes": 6,
  "ano": 2025,
  "criadoEm": "<serverTimestamp>"
}
```

---

## Steps to Populate Firestore from Google Sheets

### 1. Export Google Sheets data

Export each sheet as CSV:
- **Alunos** sheet → `alunos.csv`
- **Professores** sheet → `professores.csv`
- **Sessoes** sheet → `sessoes.csv`
- **Checkins** sheet → `checkins.csv`
- **Pagamentos** sheet → `pagamentos.csv`

### 2. Install Firebase CLI and tools

```bash
npm install -g firebase-tools
firebase login
firebase use rivabjj-a477b
```

### 3. Import alunos

Write a Node.js script or use the Firebase Admin SDK to import each row from `alunos.csv` into the `alunos` collection, mapping columns to the field names shown above.

Example with Node.js + `@google-cloud/firestore`:
```javascript
const { Firestore } = require('@google-cloud/firestore');
const csv = require('csv-parse/sync');
const fs = require('fs');

const db = new Firestore({ projectId: 'rivabjj-a477b' });

const rows = csv.parse(fs.readFileSync('alunos.csv'), { columns: true });
for (const row of rows) {
  await db.collection('alunos').add({
    nome_aluno: row['Nome'],
    email: row['Email'].toLowerCase().trim(),
    status: row['Status'] || 'ATIVO',
    faixa: row['Faixa'] || 'Branca',
    grau_atual: parseInt(row['Grau Atual']) || 0,
    aulas_no_grau: parseInt(row['Aulas no Grau']) || 0,
    aulas_restantes: parseInt(row['Aulas Restantes']) || 0,
    meta_grau: parseInt(row['Meta Grau']) || 40,
    data_ultimo_grau: row['Data Último Grau'] || '',
    telefone: row['Telefone'] || '',
    cpf: row['CPF'] || '',
    data_nasc: row['Data Nasc'] || '',
    data_inicio: row['Data Início'] || '',
    categoria: row['Categoria'] || 'Adulto',
    plano: row['Plano'] || '',
  });
}
```

### 4. Import sessoes

Map each class schedule row from your sheets to the `sessoes` collection. The `diaSemana` field must use JS day numbers (0=Sunday...6=Saturday).

### 5. Import checkins (optional)

Historical check-ins can be imported with `arquivado: true` so they appear in the archive view. Active/recent check-ins should have `arquivado: false`.

---

## Creating Professor Users in Firebase Auth

Professors log in to the administrative portal (`administrativo.html`) using Firebase Authentication (Email/Password).

### Using Firebase Console:
1. Go to [Firebase Console](https://console.firebase.google.com/) → Project `rivabjj-a477b`
2. Navigate to **Authentication** → **Users**
3. Click **Add user**
4. Enter professor email and a secure password
5. Click **Add user**

### Using Firebase CLI / Admin SDK:
```javascript
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

initializeApp();
const auth = getAuth();

await auth.createUser({
  email: 'professor@rivabjj.com',
  password: 'SecurePassword123!',
  displayName: 'Professor Carlos',
});
```

### Add to `professores` collection:
After creating the Firebase Auth user, also add a document to the `professores` Firestore collection so their name resolves in the student-facing app:
```json
{
  "email": "professor@rivabjj.com",
  "nome": "Professor Carlos"
}
```

---

## Firestore Security Rules

The rules are in `firestore.rules`. Deploy them with:
```bash
firebase deploy --only firestore:rules
```

Key rules:
- **alunos**: Public read (students look themselves up by email); authenticated write only (professors update progress when approving check-ins)
- **professores**: Public read (student app resolves professor name by email); authenticated write only
- **checkins**: Public read and create (students check in without Firebase Auth); authenticated update/delete only (professor approves/rejects via `administrativo.html`)
- **sessoes**: Public read (training schedules visible in student app); authenticated write only
- **pagamentos**: Authenticated read/write only (sensitive financial data)

### Future improvements (production hardening via Custom Claims)

Once Firebase Custom Claims (`role: 'professor'` / `role: 'admin'`) are configured, the rules can be tightened:

- **alunos update**: restrict to `request.auth.token.role == 'professor' || 'admin'`
- **checkins create**: require auth after migrating student login to Firebase Auth
- **checkins update/delete**: restrict to `request.auth.token.role == 'professor' || 'admin'`
- **pagamentos read**: restrict to own document (`request.auth.uid == resource.data.uid`) or admin

See the comments inside `firestore.rules` for exact rule snippets.

---

## Required Firestore Indexes

The `fbNotificacoes` query requires a composite index on the `checkins` collection:
- Fields: `email` (ASC), `status` (ASC), `data_aprovacao` (DESC)

Create it in the Firebase Console under **Firestore** → **Indexes** → **Composite**, or deploy via `firestore.indexes.json`.
