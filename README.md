# Unico Integra - Modulo de Gerenciamento de IAs

Servico Node.js para criar, atualizar e operar instancias de APIs de IA via PM2.

## Tipos suportados

- `alpha`
- `trier`

Cada tipo possui:

- diretorio proprio na VPS ou diretorio legado preservado
- repositorio proprio
- metadata propria por instancia (`instance.json`)

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
PORT=3100

APPS_DIR=./servicos_ias/
APPS_DIR_TRIER=./servicos_ias/trier

REPO_URL=https://github.com/UnicoContato/alpha7_IA_view.git
ALPHA_REPO_URL=https://github.com/UnicoContato/alpha7_IA_view.git
ALPHA_REPO_BRANCH=main
TRIER_REPO_URL=
TRIER_REPO_BRANCH=main

PORTA_INICIO=5300
PORTA_FIM=5399

CORS_ORIGIN=*
```

## Estrutura de diretorios

Exemplo:

```text
servicos_ias/
  cliente-a/
    .env
    instance.json
  trier/
    cliente-b/
      .env
      instance.json
```

O `alpha` usa diretamente `APPS_DIR`, preservando as APIs legadas ja existentes.
O `trier` usa `APPS_DIR_TRIER`.
O arquivo `instance.json` guarda o tipo, o nome, o diretorio e o nome do processo no PM2.

## Fluxo de criacao

Ao chamar `POST /api/ia/criar`, o modulo:

1. Identifica o `tipo` da instancia
2. Escolhe o repositorio e o diretorio daquele tipo
3. Reserva a primeira porta livre na faixa configurada
4. Clona o repositorio
5. Executa `npm install`
6. Cria o `.env` a partir de `.env.example` ou `.env.exemplo`, se existir
7. Mescla no `.env` as variaveis enviadas na API
8. Grava `instance.json`
9. Sobe a instancia com `pm2 start app.js --name ia-<tipo>-<nome>`

## Body de criacao

### Alpha

```json
{
  "tipo": "alpha",
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

### Trier

```json
{
  "tipo": "trier",
  "nome": "trier-farmacia-xyz",
  "env": {
    "TOKEN_TRIER": "abc",
    "API_URL": "https://cliente.exemplo.com"
  }
}
```

Se `tipo` nao for enviado, o modulo assume `alpha` por compatibilidade.
No caso de `alpha`, o diretorio usado e o proprio `APPS_DIR`.

## Listagem e integridade

`GET /api/ia/listar`

Tambem aceita filtro:

- `GET /api/ia/listar?tipo=alpha`
- `GET /api/ia/listar?tipo=trier`

Cada item retorna:

- `nome`
- `tipo`
- `nome_pm2`
- `diretorio`
- `status`
- `porta`
- `integridade`

Valores de `integridade`:

- `ok`
- `sem_pm2`
- `sem_diretorio`
- `inconsistente`
- `inexistente`

## Rotas principais

- `POST /api/ia/criar`
- `GET /api/ia/listar`
- `GET /api/ia/:nome/status`
- `GET /api/ia/:tipo/:nome/status`
- `GET /api/ia/:nome/logs?linhas=50`
- `GET /api/ia/:tipo/:nome/logs?linhas=50`
- `POST /api/ia/:nome/atualizar`
- `POST /api/ia/:tipo/:nome/atualizar`
- `POST /api/ia/atualizar-todas`
- `POST /api/ia/atualizar-todas?tipo=alpha`
- `POST /api/ia/atualizar-todas?tipo=trier`
- `POST /api/ia/:nome/reiniciar`
- `POST /api/ia/:tipo/:nome/reiniciar`
- `POST /api/ia/:nome/parar`
- `POST /api/ia/:tipo/:nome/parar`

## Fluxo de atualizacao

As atualizacoes sao processadas em fila, sempre uma instancia por vez.

Ao atualizar uma instancia, o modulo:

1. Localiza a instancia por `nome` e opcionalmente `tipo`
2. Verifica a integridade do diretorio
3. Valida se o repositorio local esta limpo
4. Executa `git pull --ff-only`
5. Compara os commits
6. Executa `npm ci --omit=dev` se `package.json`, `package-lock.json` ou `npm-shrinkwrap.json` mudarem
7. Reinicia no PM2 se houver processo registrado e commit novo

Se nao houver commit novo, a instancia nao e reiniciada.

## Atualizacao em lote

`POST /api/ia/atualizar-todas`

Tambem aceita filtro por tipo:

- `POST /api/ia/atualizar-todas?tipo=alpha`
- `POST /api/ia/atualizar-todas?tipo=trier`

A resposta retorna um relatorio por instancia com:

- `nome`
- `tipo`
- `sucesso`
- `atualizado`
- `reiniciado`
- `dependencias_atualizadas`
- `integridade`
- `commit_anterior`
- `commit_atual`
- `arquivos_alterados`
- `mensagem` ou `erro`
