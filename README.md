# NovaSupport Remote Desk

App de suporte remoto com:

- criacao de salas por PIN
- entrada de tecnico e cliente pelo navegador
- chat de suporte
- compartilhamento de tela com consentimento
- modo desktop com Electron
- preparo para deploy online no Render

## Rodar localmente

```powershell
npm install
node server.js
```

Abra `http://localhost:3000`.

## Rodar desktop

```powershell
npm install
npm run desktop
```

## Deploy online

Consulte [DEPLOY_ONLINE.md](./DEPLOY_ONLINE.md).

## Publicar no GitHub

```powershell
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/SEU-REPO.git
git push -u origin main
```
