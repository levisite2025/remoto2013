const state = {
  config: {
    appBaseUrl: window.location.origin,
    rtcIceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  },
  room: null,
  role: null,
  displayName: "",
  pollCursor: 0,
  pollTimer: null,
  pollBusy: false,
  peerConnection: null,
  localStream: null,
  remoteStream: null,
};

const createRoomForm = document.querySelector("#create-room-form");
const joinRoomForm = document.querySelector("#join-room-form");
const liveRoomEl = document.querySelector("#live-room");
const roomTitleEl = document.querySelector("#room-title");
const roleBadgeEl = document.querySelector("#role-badge");
const summaryRoomCodeEl = document.querySelector("#summary-room-code");
const summaryCustomerEl = document.querySelector("#summary-customer");
const summaryStatusEl = document.querySelector("#summary-status");
const summaryPriorityEl = document.querySelector("#summary-priority");
const currentRoomIdEl = document.querySelector("#current-room-id");
const connectionStatusEl = document.querySelector("#connection-status");
const technicianPresenceEl = document.querySelector("#technician-presence");
const customerPresenceEl = document.querySelector("#customer-presence");
const peerStateEl = document.querySelector("#peer-state");
const diagnosticsBoxEl = document.querySelector("#diagnostics-box");
const desktopHostStatusEl = document.querySelector("#desktop-host-status");
const desktopSystemInfoEl = document.querySelector("#desktop-system-info");
const desktopActionsEl = document.querySelector("#desktop-actions");
const chatLogEl = document.querySelector("#chat-log");
const timelineListEl = document.querySelector("#timeline-list");
const timelineTotalEl = document.querySelector("#timeline-total");
const remoteScreenEl = document.querySelector("#remote-screen");
const localScreenEl = document.querySelector("#local-screen");
const remotePlaceholderEl = document.querySelector("#remote-placeholder");
const shareConsentCheckbox = document.querySelector("#share-consent-checkbox");
const startShareBtn = document.querySelector("#start-share-btn");
const stopShareBtn = document.querySelector("#stop-share-btn");
const copyRoomLinkBtn = document.querySelector("#copy-room-link-btn");
const closeRoomBtn = document.querySelector("#close-room-btn");
const chatForm = document.querySelector("#chat-form");

let desktopHostReady = false;
let desktopSystemInfo = null;
let desktopActions = [];

bootstrap().catch(failWith);

createRoomForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(createRoomForm);
  const technicianName = requiredString(formData.get("technicianName"));

  try {
    setConnectionStatus("criando");

    const result = await api("/api/rooms", {
      method: "POST",
      body: {
        customerName: requiredString(formData.get("customerName")),
        company: requiredString(formData.get("company")),
        contact: requiredString(formData.get("contact")),
        deviceId: requiredString(formData.get("deviceId")),
        system: requiredString(formData.get("system")),
        priority: requiredString(formData.get("priority")),
        issue: `${requiredString(formData.get("issue"))} | ${requiredString(formData.get("mode"))}`,
      },
    });

    await enterRoom(result.room.id, "technician", technicianName);
    createRoomForm.reset();
  } catch (error) {
    failWith(error);
  }
});

joinRoomForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(joinRoomForm);
  const roomId = requiredString(formData.get("roomId")).toUpperCase();
  const name = requiredString(formData.get("customerJoinName"));
  const note = requiredString(formData.get("joinNote"));

  try {
    await enterRoom(roomId, "customer", name);

    if (note) {
      await addTimeline(`${name}: ${note}`, "note");
    }

    joinRoomForm.reset();
    shareConsentCheckbox.checked = false;
  } catch (error) {
    failWith(error);
  }
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!state.room || !state.role) {
    return;
  }

  const formData = new FormData(chatForm);
  const message = requiredString(formData.get("message"));

  if (!message) {
    return;
  }

  try {
    await sendSignal("chat", {
      senderName: state.displayName,
      message,
    }, null, `${state.displayName}: ${message}`);

    chatForm.reset();
    await refreshRoom();
  } catch (error) {
    failWith(error);
  }
});

startShareBtn.addEventListener("click", async () => {
  if (state.role !== "customer") {
    window.alert("Somente o cliente pode iniciar o compartilhamento da propria tela.");
    return;
  }

  if (!shareConsentCheckbox.checked) {
    window.alert("Confirme o consentimento antes de compartilhar a tela.");
    return;
  }

  try {
    await startScreenShare();
  } catch (error) {
    failWith(error);
  }
});

stopShareBtn.addEventListener("click", async () => {
  try {
    await stopScreenShare(true);
  } catch (error) {
    failWith(error);
  }
});

copyRoomLinkBtn.addEventListener("click", async () => {
  if (!state.room) {
    return;
  }

  const success = await copyText(state.room.joinUrl);
  if (!success) {
    return;
  }

  if (state.role === "technician") {
    await addTimeline("Link da sala copiado para compartilhar com o cliente.", "action");
  }
});

closeRoomBtn.addEventListener("click", async () => {
  if (!state.room || state.role !== "technician") {
    return;
  }

  try {
    await api(`/api/rooms/${state.room.id}/close`, { method: "POST" });
    await stopScreenShare(false);
    closePeerConnection();
    await refreshRoom();
  } catch (error) {
    failWith(error);
  }
});

window.addEventListener("beforeunload", () => {
  stopPolling();
  closePeerConnection();
  stopLocalTracks();
});

async function bootstrap() {
  await loadRuntimeConfig();
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get("room");

  if (roomId) {
    joinRoomForm.elements.roomId.value = roomId;
  }

  render();
}

async function enterRoom(roomId, role, name) {
  const payload = {
    role,
    name,
    diagnostics: role === "customer" ? collectDiagnostics() : null,
  };

  await api(`/api/rooms/${roomId}/join`, {
    method: "POST",
    body: payload,
  });

  state.role = role;
  state.displayName = name;
  state.pollCursor = 0;

  showLiveRoom();
  await loadDesktopHost();
  await refreshRoom(roomId);
  startPolling();
}

function showLiveRoom() {
  liveRoomEl.classList.remove("hidden");
  liveRoomEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function startPolling() {
  stopPolling();
  tick();
  state.pollTimer = window.setInterval(tick, 1200);
}

function stopPolling() {
  if (state.pollTimer) {
    window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function tick() {
  if (!state.room || !state.role || state.pollBusy) {
    return;
  }

  state.pollBusy = true;

  try {
    const [eventsResult] = await Promise.all([
      api(`/api/rooms/${state.room.id}/events?role=${state.role}&cursor=${state.pollCursor}`),
      refreshRoom(),
    ]);

    state.pollCursor = eventsResult.cursor || state.pollCursor;

    for (const event of eventsResult.events || []) {
      await handleSignalEvent(event);
    }

    setConnectionStatus(state.peerConnection?.connectionState === "connected" ? "peer conectado" : "conectado");
  } catch (error) {
    setConnectionStatus("erro");
    console.error(error);
  } finally {
    state.pollBusy = false;
  }
}

async function refreshRoom(roomId = state.room?.id) {
  if (!roomId) {
    render();
    return;
  }

  const result = await api(`/api/rooms/${roomId}`);
  state.room = result.room;
  render();
}

async function handleSignalEvent(event) {
  switch (event.type) {
    case "offer":
      if (state.role === "technician") {
        await handleOffer(event.payload);
      }
      break;
    case "answer":
      if (state.role === "customer" && state.peerConnection) {
        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(event.payload));
      }
      break;
    case "ice":
      if (state.peerConnection && event.payload?.candidate) {
        await state.peerConnection.addIceCandidate(new RTCIceCandidate(event.payload.candidate));
      }
      break;
    case "share-stopped":
      if (state.role === "technician") {
        clearRemoteScreen();
        closePeerConnection();
      }
      break;
    case "chat":
      await refreshRoom();
      break;
    default:
      break;
  }
}

async function handleOffer(offer) {
  closePeerConnection();
  const peer = createPeerConnection("customer");
  await peer.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);

  await sendSignal("answer", peer.localDescription, "customer", "Tecnico aceitou a conexao de video.");
}

function createPeerConnection(targetRole) {
  const peer = new RTCPeerConnection({
    iceServers: state.config.rtcIceServers,
  });

  peer.onicecandidate = async (event) => {
    if (!event.candidate || !state.room || !state.role) {
      return;
    }

    try {
      await sendSignal("ice", { candidate: event.candidate }, targetRole, null);
    } catch (error) {
      console.error(error);
    }
  };

  peer.onconnectionstatechange = () => {
    renderPeerState(peer.connectionState || "novo");
  };

  peer.ontrack = (event) => {
    state.remoteStream = event.streams[0];
    remoteScreenEl.srcObject = state.remoteStream;
    remotePlaceholderEl.classList.add("hidden");
    renderPeerState(peer.connectionState || "midia recebida");
  };

  state.peerConnection = peer;
  renderPeerState("preparando");
  return peer;
}

async function startScreenShare() {
  if (!state.room || state.role !== "customer") {
    return;
  }

  await stopScreenShare(false);

  state.localStream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
  });

  localScreenEl.srcObject = state.localStream;

  for (const track of state.localStream.getTracks()) {
    track.addEventListener("ended", () => {
      stopScreenShare(true).catch(console.error);
    }, { once: true });
  }

  const peer = createPeerConnection("technician");

  state.localStream.getTracks().forEach((track) => {
    peer.addTrack(track, state.localStream);
  });

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);

  await sendSignal("offer", peer.localDescription, "technician", "Cliente iniciou o compartilhamento de tela.");
}

async function stopScreenShare(notifyPeer) {
  if (notifyPeer && state.room && state.role === "customer") {
    await sendSignal("share-stopped", {}, "technician", "Cliente encerrou o compartilhamento de tela.");
  }

  stopLocalTracks();
  localScreenEl.srcObject = null;

  if (state.role === "customer") {
    closePeerConnection();
  }
}

function stopLocalTracks() {
  if (!state.localStream) {
    return;
  }

  state.localStream.getTracks().forEach((track) => track.stop());
  state.localStream = null;
}

function closePeerConnection() {
  if (state.peerConnection) {
    state.peerConnection.onicecandidate = null;
    state.peerConnection.ontrack = null;
    state.peerConnection.close();
    state.peerConnection = null;
  }

  renderPeerState("sem peer");
}

function clearRemoteScreen() {
  state.remoteStream = null;
  remoteScreenEl.srcObject = null;
  remotePlaceholderEl.classList.remove("hidden");
}

async function sendSignal(type, payload, targetRole, timelineText) {
  if (!state.room || !state.role) {
    return;
  }

  await api(`/api/rooms/${state.room.id}/signal`, {
    method: "POST",
    body: {
      fromRole: state.role,
      targetRole,
      type,
      payload,
      timelineText,
    },
  });
}

async function addTimeline(text, kind) {
  if (!state.room) {
    return;
  }

  await api(`/api/rooms/${state.room.id}/timeline`, {
    method: "POST",
    body: {
      actor: state.role === "customer" ? "cliente" : "tecnico",
      text,
      kind,
    },
  });

  await refreshRoom();
}

function render() {
  const room = state.room;

  currentRoomIdEl.textContent = room?.id || "------";
  roomTitleEl.textContent = room ? `Sessao ${room.customerName}` : "Sessao remota";
  roleBadgeEl.textContent = state.role ? roleLabel(state.role) : "Nao conectado";

  summaryRoomCodeEl.textContent = room?.id || "------";
  summaryCustomerEl.textContent = room?.customerName || "Aguardando";
  summaryStatusEl.textContent = room?.status || "Triagem";
  summaryPriorityEl.textContent = room?.priority || "Normal";

  technicianPresenceEl.textContent = room?.participants?.technician?.name || "Aguardando";
  customerPresenceEl.textContent = room?.participants?.customer?.name || "Aguardando";

  renderDiagnostics(room?.participants?.customer?.diagnostics || null);
  renderDesktopHost();
  renderTimeline(room?.timeline || []);
  renderChat(room?.timeline || []);
  renderRoleControls();
}

async function loadDesktopHost() {
  if (!window.desktopHost?.isAvailable) {
    desktopHostReady = false;
    desktopSystemInfo = null;
    desktopActions = [];
    renderDesktopHost();
    return;
  }

  try {
    desktopHostReady = await window.desktopHost.isAvailable();
    if (!desktopHostReady) {
      renderDesktopHost();
      return;
    }

    const [systemInfo, actions] = await Promise.all([
      window.desktopHost.getSystemInfo(),
      window.desktopHost.getSafeActions(),
    ]);

    desktopSystemInfo = systemInfo;
    desktopActions = actions;
    renderDesktopHost();
  } catch (error) {
    console.error(error);
    desktopHostReady = false;
    desktopSystemInfo = null;
    desktopActions = [];
    renderDesktopHost();
  }
}

function renderDiagnostics(diagnostics) {
  if (!diagnostics) {
    diagnosticsBoxEl.innerHTML = `
      <p class="mini-label">Diagnostico do cliente</p>
      <div class="empty-inline">Entrando como cliente, este painel sera preenchido automaticamente.</div>
    `;
    return;
  }

  diagnosticsBoxEl.innerHTML = `
    <p class="mini-label">Diagnostico do cliente</p>
    <div class="diagnostics-grid">
      <div><span>Navegador</span><strong>${escapeHtml(diagnostics.userAgent)}</strong></div>
      <div><span>Idioma</span><strong>${escapeHtml(diagnostics.language)}</strong></div>
      <div><span>Plataforma</span><strong>${escapeHtml(diagnostics.platform)}</strong></div>
      <div><span>Resolucao</span><strong>${escapeHtml(diagnostics.screen)}</strong></div>
      <div><span>Viewport</span><strong>${escapeHtml(diagnostics.viewport)}</strong></div>
      <div><span>Online</span><strong>${diagnostics.online ? "Sim" : "Nao"}</strong></div>
    </div>
  `;
}

function renderDesktopHost() {
  if (!desktopHostReady) {
    desktopHostStatusEl.textContent = "Recursos locais avancados ficam disponiveis quando o app roda em Electron.";
    desktopSystemInfoEl.classList.add("hidden");
    desktopActionsEl.classList.add("hidden");
    desktopSystemInfoEl.innerHTML = "";
    desktopActionsEl.innerHTML = "";
    return;
  }

  desktopHostStatusEl.textContent = "Modo desktop ativo. Acoes locais exigem confirmacao no computador do cliente.";

  if (desktopSystemInfo) {
    desktopSystemInfoEl.classList.remove("hidden");
    desktopSystemInfoEl.innerHTML = `
      <div><span>Host</span><strong>${escapeHtml(desktopSystemInfo.hostname)}</strong></div>
      <div><span>Usuario</span><strong>${escapeHtml(desktopSystemInfo.username)}</strong></div>
      <div><span>Sistema</span><strong>${escapeHtml(`${desktopSystemInfo.platform} ${desktopSystemInfo.release}`)}</strong></div>
      <div><span>Arquitetura</span><strong>${escapeHtml(desktopSystemInfo.arch)}</strong></div>
      <div><span>CPU logica</span><strong>${escapeHtml(String(desktopSystemInfo.cpus))}</strong></div>
      <div><span>Memoria</span><strong>${escapeHtml(desktopSystemInfo.memoryGb)}</strong></div>
    `;
  }

  if (!desktopActions.length) {
    desktopActionsEl.classList.add("hidden");
    desktopActionsEl.innerHTML = "";
    return;
  }

  desktopActionsEl.classList.remove("hidden");
  desktopActionsEl.innerHTML = desktopActions
    .map((action) => `
      <button type="button" class="ghost-btn desktop-action-btn" data-action-id="${escapeHtml(action.id)}">
        ${escapeHtml(action.label)}
      </button>
    `)
    .join("");

  desktopActionsEl.querySelectorAll(".desktop-action-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.desktopHost?.runAction) {
        return;
      }

      const actionId = button.getAttribute("data-action-id");
      if (!actionId) {
        return;
      }

      button.disabled = true;

      try {
        const result = await window.desktopHost.runAction(actionId, {
          roomId: state.room?.id || "",
          role: state.role || "",
        });

        if (!result.ok) {
          throw new Error(result.error || "Falha ao executar acao local.");
        }

        if (state.room && state.role) {
          await addTimeline(`Acao local assistida executada: ${actionId}.`, "action");
        }
      } catch (error) {
        failWith(error);
      } finally {
        button.disabled = false;
      }
    });
  });
}

function renderTimeline(entries) {
  timelineTotalEl.textContent = `${entries.length} evento(s)`;

  if (!entries.length) {
    timelineListEl.innerHTML = '<div class="empty-inline">A timeline compartilhada aparecera aqui.</div>';
    return;
  }

  timelineListEl.innerHTML = entries
    .map((entry) => `
      <article class="timeline-item">
        <div class="timeline-marker timeline-${escapeHtml(entry.kind || "system")}"></div>
        <div>
          <strong>${escapeHtml(entry.actor || "sistema")}</strong>
          <p>${escapeHtml(entry.text)}</p>
          <small>${formatDate(entry.createdAt)}</small>
        </div>
      </article>
    `)
    .join("");
}

function renderChat(entries) {
  const chatEntries = entries.filter((entry) => entry.kind === "chat");

  if (!chatEntries.length) {
    chatLogEl.innerHTML = '<div class="empty-inline">As mensagens da sessao aparecerao aqui.</div>';
    return;
  }

  chatLogEl.innerHTML = chatEntries
    .slice()
    .reverse()
    .map((entry) => `
      <article class="chat-bubble ${entry.actor === "cliente" ? "from-customer" : "from-technician"}">
        <strong>${escapeHtml(entry.actor)}</strong>
        <p>${escapeHtml(entry.text)}</p>
        <small>${formatDate(entry.createdAt)}</small>
      </article>
    `)
    .join("");
}

function renderRoleControls() {
  const isCustomer = state.role === "customer";
  const isTechnician = state.role === "technician";
  const closed = state.room?.status === "Encerrada";

  shareConsentCheckbox.disabled = !isCustomer || closed;
  startShareBtn.disabled = !isCustomer || closed;
  stopShareBtn.disabled = !isCustomer || closed;
  closeRoomBtn.disabled = !isTechnician || closed;
  copyRoomLinkBtn.disabled = !state.room;
  chatForm.querySelector("button").disabled = !state.room || closed;
  chatForm.querySelector("textarea").disabled = !state.room || closed;
  desktopActionsEl.querySelectorAll("button").forEach((button) => {
    button.disabled = !desktopHostReady || !state.room || closed;
  });
}

function renderPeerState(value) {
  peerStateEl.textContent = value;
}

function setConnectionStatus(value) {
  connectionStatusEl.textContent = value;
}

function collectDiagnostics() {
  return {
    userAgent: navigator.userAgent,
    language: navigator.language || "Nao informado",
    platform: navigator.platform || "Nao informado",
    screen: `${window.screen.width}x${window.screen.height}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    online: navigator.onLine,
  };
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    window.prompt("Copie o conteudo abaixo:", value);
    return false;
  }
}

async function loadRuntimeConfig() {
  try {
    const config = await api("/api/config");
    state.config = {
      appBaseUrl: config.appBaseUrl || window.location.origin,
      rtcIceServers: Array.isArray(config.rtcIceServers) && config.rtcIceServers.length
        ? config.rtcIceServers
        : [{ urls: "stun:stun.l.google.com:19302" }],
    };
  } catch (error) {
    console.error(error);
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Falha na requisicao.");
  }

  return data;
}

function failWith(error) {
  console.error(error);
  window.alert(error instanceof Error ? error.message : "Ocorreu um erro ao executar a acao.");
}

function roleLabel(role) {
  return role === "customer" ? "Cliente" : "Tecnico";
}

function requiredString(value) {
  return value?.toString().trim() || "";
}

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
