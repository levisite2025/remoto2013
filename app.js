const state = {
  config: {
    appBaseUrl: window.location.origin,
    rtcIceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    supportLoginHint: "suporte",
  },
  authRole: null,
  displayName: "",
  room: null,
  pollCursor: 0,
  pollTimer: null,
  pollBusy: false,
  peerConnection: null,
  localStream: null,
  remoteStream: null,
};

const authViewEl = document.querySelector("#auth-view");
const supportViewEl = document.querySelector("#support-view");
const clientViewEl = document.querySelector("#client-view");
const supportLoginForm = document.querySelector("#support-login-form");
const clientLoginForm = document.querySelector("#client-login-form");
const createRoomForm = document.querySelector("#create-room-form");
const logoutSupportBtn = document.querySelector("#logout-support-btn");
const logoutClientBtn = document.querySelector("#logout-client-btn");
const currentRoomIdEl = document.querySelector("#current-room-id");
const connectionStatusEl = document.querySelector("#connection-status");
const supportUserBadgeEl = document.querySelector("#support-user-badge");
const clientUserBadgeEl = document.querySelector("#client-user-badge");
const supportRoomTitleEl = document.querySelector("#support-room-title");
const clientRoomTitleEl = document.querySelector("#client-room-title");
const summaryRoomCodeEl = document.querySelector("#summary-room-code");
const summaryCustomerEl = document.querySelector("#summary-customer");
const summaryDeviceEl = document.querySelector("#summary-device");
const joinLinkEl = document.querySelector("#join-link");
const sessionStatusEl = document.querySelector("#session-status");
const technicianPresenceEl = document.querySelector("#technician-presence");
const customerPresenceEl = document.querySelector("#customer-presence");
const clientRoomCodeEl = document.querySelector("#client-room-code");
const clientRoomStatusEl = document.querySelector("#client-room-status");
const peerStateEl = document.querySelector("#peer-state");
const remoteStageLabelEl = document.querySelector("#remote-stage-label");
const remoteScreenEl = document.querySelector("#remote-screen");
const remotePlaceholderEl = document.querySelector("#remote-placeholder");
const localScreenEl = document.querySelector("#local-screen");
const shareConsentCheckbox = document.querySelector("#share-consent-checkbox");
const startShareBtn = document.querySelector("#start-share-btn");
const stopShareBtn = document.querySelector("#stop-share-btn");
const copyRoomLinkBtn = document.querySelector("#copy-room-link-btn");
const closeRoomBtn = document.querySelector("#close-room-btn");

bootstrap().catch(failWith);

supportLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(supportLoginForm);

  try {
    const result = await api("/api/auth/support", {
      method: "POST",
      body: {
        displayName: requiredString(formData.get("displayName")),
        login: requiredString(formData.get("login")),
        password: requiredString(formData.get("password")),
      },
    });

    state.authRole = "technician";
    state.displayName = result.displayName || requiredString(formData.get("displayName"));
    supportLoginForm.reset();
    render();
  } catch (error) {
    failWith(error);
  }
});

clientLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(clientLoginForm);
  const roomId = requiredString(formData.get("roomId")).toUpperCase();
  const displayName = requiredString(formData.get("displayName"));

  try {
    await api(`/api/rooms/${roomId}/join`, {
      method: "POST",
      body: {
        role: "customer",
        name: displayName,
        diagnostics: collectDiagnostics(),
      },
    });

    state.authRole = "customer";
    state.displayName = displayName;
    state.pollCursor = 0;
    clientLoginForm.reset();
    await refreshRoom(roomId);
    startPolling();
    render();
  } catch (error) {
    failWith(error);
  }
});

createRoomForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (state.authRole !== "technician") {
    return;
  }

  const formData = new FormData(createRoomForm);

  try {
    const result = await api("/api/rooms", {
      method: "POST",
      body: {
        customerName: requiredString(formData.get("customerName")),
        deviceId: requiredString(formData.get("deviceId")),
        issue: requiredString(formData.get("issue")),
      },
    });

    await api(`/api/rooms/${result.room.id}/join`, {
      method: "POST",
      body: {
        role: "technician",
        name: state.displayName,
      },
    });

    createRoomForm.reset();
    state.pollCursor = 0;
    await refreshRoom(result.room.id);
    startPolling();
    render();
  } catch (error) {
    failWith(error);
  }
});

startShareBtn.addEventListener("click", async () => {
  if (state.authRole !== "customer") {
    return;
  }

  if (!shareConsentCheckbox.checked) {
    window.alert("Confirme a autorizacao antes de compartilhar a tela.");
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
  if (!state.room?.joinUrl) {
    return;
  }

  await copyText(state.room.joinUrl);
});

closeRoomBtn.addEventListener("click", async () => {
  if (!state.room || state.authRole !== "technician") {
    return;
  }

  try {
    await api(`/api/rooms/${state.room.id}/close`, { method: "POST" });
    clearRemoteScreen();
    closePeerConnection();
    await refreshRoom();
  } catch (error) {
    failWith(error);
  }
});

logoutSupportBtn.addEventListener("click", () => logout());
logoutClientBtn.addEventListener("click", () => logout());

window.addEventListener("beforeunload", () => {
  stopPolling();
  closePeerConnection();
  stopLocalTracks();
});

async function bootstrap() {
  await loadRuntimeConfig();
  supportLoginForm.elements.login.placeholder = `Ex.: ${state.config.supportLoginHint}`;
  render();
}

function logout() {
  stopPolling();
  closePeerConnection();
  stopLocalTracks();
  clearRemoteScreen();
  localScreenEl.srcObject = null;
  shareConsentCheckbox.checked = false;
  state.authRole = null;
  state.displayName = "";
  state.room = null;
  state.pollCursor = 0;
  render();
}

function startPolling() {
  stopPolling();
  tick();
  state.pollTimer = window.setInterval(tick, 1200);
}

function stopPolling() {
  if (!state.pollTimer) {
    return;
  }

  window.clearInterval(state.pollTimer);
  state.pollTimer = null;
}

async function tick() {
  if (!state.room || !state.authRole || state.pollBusy) {
    return;
  }

  state.pollBusy = true;

  try {
    const [eventsResult] = await Promise.all([
      api(`/api/rooms/${state.room.id}/events?role=${state.authRole}&cursor=${state.pollCursor}`),
      refreshRoom(),
    ]);

    state.pollCursor = eventsResult.cursor || state.pollCursor;

    for (const event of eventsResult.events || []) {
      await handleSignalEvent(event);
    }

    setConnectionStatus(state.peerConnection?.connectionState === "connected" ? "conectado" : "online");
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
      if (state.authRole === "technician") {
        await handleOffer(event.payload);
      }
      break;
    case "answer":
      if (state.authRole === "customer" && state.peerConnection) {
        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(event.payload));
      }
      break;
    case "ice":
      if (state.peerConnection && event.payload?.candidate) {
        await state.peerConnection.addIceCandidate(new RTCIceCandidate(event.payload.candidate));
      }
      break;
    case "share-stopped":
      clearRemoteScreen();
      closePeerConnection();
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
  await sendSignal("answer", peer.localDescription, "customer");
}

function createPeerConnection(targetRole) {
  const peer = new RTCPeerConnection({
    iceServers: state.config.rtcIceServers,
  });

  peer.onicecandidate = async (event) => {
    if (!event.candidate || !state.room || !state.authRole) {
      return;
    }

    try {
      await sendSignal("ice", { candidate: event.candidate }, targetRole);
    } catch (error) {
      console.error(error);
    }
  };

  peer.onconnectionstatechange = () => {
    peerStateEl.textContent = peer.connectionState || "preparando";
  };

  peer.ontrack = (event) => {
    state.remoteStream = event.streams[0];
    remoteScreenEl.srcObject = state.remoteStream;
    remotePlaceholderEl.classList.add("hidden");
    peerStateEl.textContent = peer.connectionState || "recebendo tela";
  };

  state.peerConnection = peer;
  peerStateEl.textContent = "preparando";
  return peer;
}

async function startScreenShare() {
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
  await sendSignal("offer", peer.localDescription, "technician");
}

async function stopScreenShare(notifyPeer) {
  if (notifyPeer && state.room && state.authRole === "customer") {
    await sendSignal("share-stopped", {}, "technician");
  }

  stopLocalTracks();
  localScreenEl.srcObject = null;

  if (state.authRole === "customer") {
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

  peerStateEl.textContent = "Sem conexao";
}

function clearRemoteScreen() {
  state.remoteStream = null;
  remoteScreenEl.srcObject = null;
  remotePlaceholderEl.classList.remove("hidden");
}

async function sendSignal(type, payload, targetRole) {
  if (!state.room || !state.authRole) {
    return;
  }

  await api(`/api/rooms/${state.room.id}/signal`, {
    method: "POST",
    body: {
      fromRole: state.authRole,
      targetRole,
      type,
      payload,
    },
  });
}

function render() {
  authViewEl.classList.toggle("hidden", Boolean(state.authRole));
  supportViewEl.classList.toggle("hidden", state.authRole !== "technician");
  clientViewEl.classList.toggle("hidden", state.authRole !== "customer");

  currentRoomIdEl.textContent = state.room?.id || "------";
  supportUserBadgeEl.textContent = state.displayName || "Suporte";
  clientUserBadgeEl.textContent = state.displayName || "Cliente";

  const room = state.room;
  supportRoomTitleEl.textContent = room ? `Sessao de ${room.customerName}` : "Aguardando";
  clientRoomTitleEl.textContent = room ? `Sessao ${room.id}` : "Sessao";
  summaryRoomCodeEl.textContent = room?.id || "------";
  summaryCustomerEl.textContent = room?.customerName || "Aguardando";
  summaryDeviceEl.textContent = room?.deviceId || "Aguardando";
  joinLinkEl.textContent = room?.joinUrl || "Crie uma sessao para gerar o link.";
  technicianPresenceEl.textContent = room?.participants?.technician?.name || "Aguardando";
  customerPresenceEl.textContent = room?.participants?.customer?.name || "Aguardando";
  clientRoomCodeEl.textContent = room?.id || "------";
  clientRoomStatusEl.textContent = room?.status || "Aguardando";

  sessionStatusEl.textContent = room
    ? room.status === "Encerrada"
      ? "Sessao encerrada."
      : room.participants?.customer
        ? "Cliente conectado. Aguardando compartilhamento."
        : "Aguardando entrada do cliente."
    : "Aguardando criacao de sessao.";

  remoteStageLabelEl.textContent = state.authRole === "customer"
    ? "O suporte visualiza esta tela remotamente"
    : "O suporte acompanha a tela do cliente";

  setConnectionStatus(state.authRole ? "pronto" : "offline");
  renderRoleControls();
}

function renderRoleControls() {
  const closed = state.room?.status === "Encerrada";
  const isCustomer = state.authRole === "customer";
  const isTechnician = state.authRole === "technician";

  startShareBtn.disabled = !isCustomer || closed;
  stopShareBtn.disabled = !isCustomer || closed;
  shareConsentCheckbox.disabled = !isCustomer || closed;
  copyRoomLinkBtn.disabled = !isTechnician || !state.room;
  closeRoomBtn.disabled = !isTechnician || !state.room || closed;
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

async function loadRuntimeConfig() {
  try {
    const config = await api("/api/config");
    state.config = {
      appBaseUrl: config.appBaseUrl || window.location.origin,
      rtcIceServers: Array.isArray(config.rtcIceServers) && config.rtcIceServers.length
        ? config.rtcIceServers
        : [{ urls: "stun:stun.l.google.com:19302" }],
      supportLoginHint: config.supportLoginHint || "suporte",
    };
  } catch (error) {
    console.error(error);
  }
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    window.prompt("Copie o conteudo abaixo:", value);
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

function requiredString(value) {
  return value?.toString().trim() || "";
}
