# Único Integra — Módulo de Gerenciamento de IAs

Módulo Node.js (ES Modules) para criar e gerenciar instâncias de IAs via PM2 na VPS, sem necessidade de acesso SSH direto.

---

## Instalação

```bash
git clone <este-repo>
cd unico-integra-ia
npm install
cp .env.example .env
# edite o .env com suas configurações
node src/app.js
```

---

## Variáveis de ambiente (.env)

```env
# Porta deste servidor (Único Integra)
PORT=3100

# Diretório onde as instâncias de IA serão instaladas na VPS
APPS_DIR=/apps/ias

# URL fixa do repositório da IA — nunca exposta ao cliente da API
REPO_URL=https://github.com/UnicoContato/alpha7_IA_view.git

# Faixa de portas reservada para as instâncias de IA
# Cada nova instância recebe automaticamente a próxima porta livre nessa faixa
PORTA_INICIO=5300
PORTA_FIM=5399
```

---

## Gerenciamento de portas

As portas são alocadas **automaticamente** — o suporte não precisa informar nenhuma porta ao criar uma instância. O servidor faz dupla verificação:

1. Consulta o PM2 para identificar portas já declaradas pelos processos ativos
2. Testa no sistema operacional via socket TCP para confirmar que a porta está realmente livre

A faixa padrão `5300–5399` suporta até 100 instâncias simultâneas. Para expandir, basta ajustar `PORTA_INICIO` e `PORTA_FIM` no `.env`.

---

## Endpoints

### Criar instância
`POST /api/ia/criar`

Clona o repositório, cria o `.env`, instala dependências, aloca uma porta automaticamente e sobe no PM2.

**Body:**
```json
{
  "nome": "alpha7-farmacia-xyz",
  "openai_api_key": "sk-...",
  "db_host": "localhost",
  "db_port": 5432,
  "db_name": "meu_banco",
  "db_user": "usuario",
  "db_password": "senha",
  "unidade_negocio_id": 65984
}
```

> `repo_url` e `porta` **não são informados pelo cliente** — ficam fixos no `.env` do servidor.

**Resposta 201:**
```json
{
  "sucesso": true,
  "mensagem": "Instância \"alpha7-farmacia-xyz\" criada com sucesso.",
  "porta": 5300
}
```

---

### Listar instâncias
`GET /api/ia/listar`

**Resposta 200:**
```json
{
  "instancias": [
    { "nome": "alpha7-farmacia-xyz", "status": "online", "porta": "5300" },
    { "nome": "alpha7-farmacia-abc", "status": "online", "porta": "5301" }
  ]
}
```

---

### Status da instância
`GET /api/ia/:nome/status`

**Resposta 200:**
```json
{
  "nome": "alpha7-farmacia-xyz",
  "pm2_id": 0,
  "status": "online",
  "uptime": 1711234567890,
  "reinicializacoes": 0,
  "memoria_mb": 87,
  "cpu_percent": 0.2,
  "porta": "5300"
}
```

---

### Logs da instância
`GET /api/ia/:nome/logs?linhas=50`

**Resposta 200:**
```json
{
  "nome": "alpha7-farmacia-xyz",
  "linhas": [
    "2026-03-23 10:00:01: Servidor rodando na porta 5300",
    "2026-03-23 10:00:05: [BUSCA] Termo: \"dipirona\""
  ]
}
```

---

### Reiniciar instância
`POST /api/ia/:nome/reiniciar`

**Resposta 200:**
```json
{ "sucesso": true, "mensagem": "Instância \"alpha7-farmacia-xyz\" reiniciada." }
```

---

### Parar instância
`POST /api/ia/:nome/parar`

**Resposta 200:**
```json
{ "sucesso": true, "mensagem": "Instância \"alpha7-farmacia-xyz\" parada." }
```

---

## Estrutura do projeto

```
unico-integra-ia/
├── src/
│   ├── app.js                    # Entry point
│   ├── routes/
│   │   └── iaRoutes.js           # Todos os endpoints
│   ├── services/
│   │   └── pm2Service.js         # Lógica de clone, PM2, logs
│   └── utils/
│       ├── portaManager.js       # Alocação automática de portas
│       └── validacao.js          # Validação dos campos obrigatórios
├── .env.example
├── package.json
└── README.md
```