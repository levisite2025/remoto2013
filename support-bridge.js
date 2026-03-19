const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

function createSupportBridge({ onConsentRequest }) {
  const actions = [
    {
      id: "open-downloads",
      label: "Abrir pasta Downloads",
      description: "Abre a pasta Downloads local para o cliente localizar arquivos de apoio.",
      run: () => openPath(path.join(os.homedir(), "Downloads")),
    },
    {
      id: "open-settings-network",
      label: "Abrir configuracoes de rede",
      description: "Abre a tela de configuracoes de rede do Windows para assistencia guiada.",
      run: () => runCommand("cmd", ["/c", "start", "ms-settings:network"]),
    },
    {
      id: "open-task-manager",
      label: "Abrir Gerenciador de Tarefas",
      description: "Abre o Gerenciador de Tarefas para diagnostico acompanhado pelo cliente.",
      run: () => runCommand("taskmgr.exe", []),
    },
    {
      id: "flush-dns",
      label: "Limpar cache DNS",
      description: "Executa ipconfig /flushdns para suporte de conectividade, com consentimento local.",
      run: () => runCommand("ipconfig", ["/flushdns"]),
    },
  ];

  return {
    getActions() {
      return actions.map(({ id, label, description }) => ({ id, label, description }));
    },
    async runAction(actionId, context) {
      const action = actions.find((item) => item.id === actionId);

      if (!action) {
        throw new Error("Acao assistida nao encontrada.");
      }

      const allowed = await onConsentRequest({
        ...action,
        context,
      });

      if (!allowed) {
        throw new Error("Acao negada localmente pelo cliente.");
      }

      return action.run(context);
    },
  };
}

async function openPath(targetPath) {
  await runCommand("explorer.exe", [targetPath]);
  return { message: `Pasta aberta: ${targetPath}` };
}

async function runCommand(command, args) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    windowsHide: true,
  });

  return {
    stdout: stdout?.trim() || "",
    stderr: stderr?.trim() || "",
  };
}

module.exports = {
  createSupportBridge,
};
