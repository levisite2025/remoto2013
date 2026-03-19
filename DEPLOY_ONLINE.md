# Deploy Online

## O que esta pronto

O app agora suporta:

- URL publica configuravel via `APP_BASE_URL`
- bind de rede via `HOST` e `PORT`
- configuracao de STUN/TURN via `RTC_ICE_SERVERS`
- links de sala absolutos para compartilhamento externo
- deploy por container com `Dockerfile`

## Variaveis de ambiente

### Minimo

```powershell
$env:HOST="0.0.0.0"
$env:PORT="3000"
$env:APP_BASE_URL="https://suporte.seudominio.com"
node server.js
```

### WebRTC para internet publica

Sem TURN, o compartilhamento pode falhar em varias redes.

Exemplo:

```powershell
$env:RTC_ICE_SERVERS='[
  {"urls":"stun:stun.l.google.com:19302"},
  {"urls":"turn:turn.seudominio.com:3478","username":"novasupport","credential":"sua_senha_forte"}
]'
node server.js
```

## Requisitos para funcionar online

1. Hospedar o servidor em uma VPS ou cloud.
2. Publicar atras de HTTPS.
3. Apontar um dominio para o servidor.
4. Configurar proxy reverso para a porta Node.
5. Configurar um servidor TURN para redes restritas.

## Exemplo com proxy reverso

O Node pode continuar na porta `3000` e o proxy publicar `https://suporte.seudominio.com`.

## Deploy com Docker

### Build local

```powershell
docker build -t novasupport-remote-desk .
```

### Rodar localmente em modo producao

```powershell
docker run --rm -p 3000:3000 ^
  -e HOST=0.0.0.0 ^
  -e PORT=3000 ^
  -e APP_BASE_URL=https://suporte.seudominio.com ^
  novasupport-remote-desk
```

## Render

Use um `Web Service` com deploy por Docker.

O projeto ja inclui [render.yaml](C:\Users\levi.araujo\Downloads\Nova pasta\render.yaml), entao voce pode subir com Blueprint.

- Root directory: pasta do projeto
- Build method: `Dockerfile`
- Port: `3000`
- Variaveis:
  - `HOST=0.0.0.0`
  - `PORT=3000`
  - `APP_BASE_URL=https://seu-servico.onrender.com` ou seu dominio
  - `RTC_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.seudominio.com:3478","username":"novasupport","credential":"senha"}]`

### Passo a passo no Render

1. Envie o projeto para um repositorio GitHub.
2. No Render, escolha `New +` -> `Blueprint`.
3. Conecte o repositorio.
4. O Render lera o `render.yaml` automaticamente.
5. Defina manualmente:
   - `APP_BASE_URL`
   - `RTC_ICE_SERVERS`
6. Aguarde o primeiro deploy.
7. Abra `/api/config` na URL publica para confirmar a configuracao.

### Exemplo de APP_BASE_URL

```text
https://novasupport-remote-desk.onrender.com
```

### Exemplo de RTC_ICE_SERVERS

```json
[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.seudominio.com:3478","username":"novasupport","credential":"senha"}]
```

## Railway

Use deploy por Docker ou a deteccao automatica do projeto Node.

- Porta interna: `3000`
- Variaveis:
  - `HOST=0.0.0.0`
  - `PORT=3000`
  - `APP_BASE_URL=https://seu-app.up.railway.app` ou seu dominio
  - `RTC_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.seudominio.com:3478","username":"novasupport","credential":"senha"}]`

## VPS Ubuntu

### 1. Instalar Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

### 2. Subir o container

```bash
docker build -t novasupport-remote-desk .
docker run -d --name novasupport \
  -p 3000:3000 \
  -e HOST=0.0.0.0 \
  -e PORT=3000 \
  -e APP_BASE_URL=https://suporte.seudominio.com \
  -e RTC_ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.seudominio.com:3478","username":"novasupport","credential":"senha"}]' \
  novasupport-remote-desk
```

### 3. Publicar com Nginx

Proxy reverso para `127.0.0.1:3000` com HTTPS.

### 4. Ativar HTTPS

Use Let's Encrypt para o dominio publico.

## Teste rapido

1. Suba o servidor com `APP_BASE_URL` apontando para o dominio real.
2. Abra a pagina publica.
3. Crie uma sala como tecnico.
4. Entre de outro navegador ou outro dispositivo usando o link gerado.
5. Teste chat e compartilhamento de tela.

## Limites atuais

- nao ha login/autenticacao por usuario
- salas usam codigo simples de 6 digitos
- a sinalizacao esta em memoria e reinicia quando o servidor reinicia
- ainda nao ha banco de dados nem persistencia de sessoes

## Proximo nivel recomendado

- autenticar tecnicos
- persistir salas em banco
- expirar salas automaticamente
- registrar auditoria persistente
- trocar polling por WebSocket
- adicionar TURN proprio em producao
