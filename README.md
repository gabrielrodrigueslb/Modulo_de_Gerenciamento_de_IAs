# Unico Integra - Modulo de Gerenciamento de IAs

Servico Node.js para criar e gerenciar instancias de IAs via PM2 na VPS.

## Instalacao

```bash
git clone <este-repo>
cd unico-integra-ia
npm install
cp .env.example .env
# edite o .env com as configuracoes do servidor gerenciador
node app.js
```

## Variaveis de ambiente do gerenciador

```env
# Porta deste servidor gerenciador
PORT=3100

# Diretorio onde as instancias de IA serao criadas
APPS_DIR=./servicos_ias/

# Repositorio que sera clonado para cada nova instancia
REPO_URL=https://github.com/UnicoContato/alpha7_IA_view.git

# Faixa reservada para as instancias criadas
PORTA_INICIO=5300
PORTA_FIM=5399

# CORS do modulo gerenciador
CORS_ORIGIN=*
```

## Fluxo de criacao

Ao chamar `POST /api/ia/criar`, o modulo faz exatamente este fluxo:

1. Clona o repositorio configurado em `REPO_URL`
2. Testa uma a uma as portas entre `PORTA_INICIO` e `PORTA_FIM` e reserva a primeira livre
3. Executa `npm install` dentro da pasta clonada
4. Cria `.env` a partir de `.env.example` ou `.env.exemplo`, se existir
5. Mescla no `.env` as variaveis enviadas na API
6. Libera a porta reservada e sobe a instancia com `pm2 start app.js --name <nome>`

Se o repositorio clonado nao tiver arquivo de exemplo, o modulo cria o `.env`
somente com as variaveis recebidas pela API.

## Endpoint principal

### Criar instancia

`POST /api/ia/criar`

Body minimo:

```json
{
  "nome": "alpha7-farmacia-xyz",
  "openai_api_key": "sk-...",
  "db_host": "127.0.0.1",
  "db_port": 5432,
  "db_name": "meu_banco",
  "db_user": "usuario",
  "db_password": "senha",
  "unidade_negocio_id": 65984
}
```

Tambem e possivel enviar variaveis extras para completar o `.env` do projeto
clonado:

```json
{
  "nome": "alpha7-farmacia-xyz",
  "openai_api_key": "sk-...",
  "db_host": "127.0.0.1",
  "db_name": "meu_banco",
  "db_user": "usuario",
  "db_password": "senha",
  "env": {
    "CLIENTE_ID": "123",
    "WEBHOOK_URL": "https://exemplo.com/webhook"
  }
}
```

Resposta:

```json
{
  "sucesso": true,
  "mensagem": "Instancia \"alpha7-farmacia-xyz\" criada com sucesso.",
  "porta": 5300
}
```

## Outros endpoints

- `GET /api/ia/listar`
- `GET /api/ia/:nome/status`
- `GET /api/ia/:nome/logs?linhas=50`
- `POST /api/ia/:nome/atualizar`
- `POST /api/ia/atualizar-todas`
- `POST /api/ia/:nome/reiniciar`
- `POST /api/ia/:nome/parar`

## Fluxo de atualizacao

As atualizacoes sao processadas em fila, sempre uma instancia por vez. Isso vale
tanto para atualizar uma instancia especifica quanto para o endpoint em lote.

Ao chamar `POST /api/ia/:nome/atualizar`, o modulo executa:

1. Verifica se a pasta da instancia existe
2. Verifica se o repositorio local esta limpo (`git status --porcelain`)
3. Executa `git pull --ff-only`
4. Compara o commit anterior com o atual
5. Se `package.json`, `package-lock.json` ou `npm-shrinkwrap.json` mudarem, executa `npm ci --omit=dev`
6. Se houve novo commit, executa `pm2 restart <nome>` e `pm2 save`

Se nao houver commit novo, a instancia nao e reiniciada.

### Atualizar todas

`POST /api/ia/atualizar-todas`

Resposta exemplo:

```json
{
  "sucesso": true,
  "total": 2,
  "atualizadas": 1,
  "falhas": 0,
  "resultados": [
    {
      "nome": "alpha7-a",
      "sucesso": true,
      "atualizado": true,
      "reiniciado": true,
      "dependencias_atualizadas": false,
      "commit_anterior": "abc123",
      "commit_atual": "def456",
      "arquivos_alterados": [
        "src/app.js"
      ],
      "mensagem": "Instancia \"alpha7-a\" atualizada com sucesso."
    },
    {
      "nome": "alpha7-b",
      "sucesso": true,
      "atualizado": false,
      "reiniciado": false,
      "dependencias_atualizadas": false,
      "commit_anterior": "zzz999",
      "commit_atual": "zzz999",
      "arquivos_alterados": [],
      "mensagem": "Instancia \"alpha7-b\" ja estava atualizada."
    }
  ]
}
```
