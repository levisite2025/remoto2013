const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const APP_BASE_URL = normalizeBaseUrl(process.env.APP_BASE_URL || `http://127.0.0.1:${PORT}`);
const RTC_ICE_SERVERS = parseIceServers(process.env.RTC_ICE_SERVERS);
const SUPPORT_LOGIN = process.env.SUPPORT_LOGIN || "novasupport";
const SUPPORT_PASSWORD = process.env.SUPPORT_PASSWORD || "Nova#8472";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const rooms = new Map();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, {
      error: "internal_error",
      message: error instanceof Error ? error.message : "Erro interno no servidor.",
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`NovaSupport Remote Desk ativo em ${APP_BASE_URL}`);
});

async function handleApi(req, res, url) {
  const segments = url.pathname.split("/").filter(Boolean);

  if (req.method === "POST" && url.pathname === "/api/rooms") {
    const body = await readJson(req);
    const room = createRoom(body);
    sendJson(res, 201, { room: serializeRoom(room) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/support") {
    const body = await readJson(req);

    if (
      requiredString(body.login) === SUPPORT_LOGIN &&
      requiredString(body.password) === SUPPORT_PASSWORD
    ) {
      sendJson(res, 200, {
        ok: true,
        role: "technician",
        displayName: requiredString(body.displayName) || "Tecnico",
      });
      return;
    }

    sendJson(res, 401, {
      error: "invalid_credentials",
      message: "Login de suporte invalido.",
    });
    return;
  }

  if (segments[1] === "rooms" && segments[2]) {
    const room = rooms.get(segments[2].toUpperCase());

    if (!room) {
      sendJson(res, 404, { error: "room_not_found", message: "Sala nao encontrada." });
      return;
    }

    if (req.method === "GET" && segments.length === 3) {
      sendJson(res, 200, { room: serializeRoom(room) });
      return;
    }

    if (req.method === "POST" && segments[3] === "join") {
      const body = await readJson(req);
      const participant = joinRoom(room, body);
      sendJson(res, 200, { room: serializeRoom(room), participant });
      return;
    }

    if (req.method === "POST" && segments[3] === "timeline") {
      const body = await readJson(req);
      addTimeline(room, {
        actor: body.actor || "sistema",
        text: body.text || "Evento registrado.",
        kind: body.kind || "note",
      });
      sendJson(res, 200, { room: serializeRoom(room) });
      return;
    }

    if (req.method === "POST" && segments[3] === "signal") {
      const body = await readJson(req);
      enqueueSignal(room, body);
      sendJson(res, 202, { ok: true, cursor: room.lastEventId });
      return;
    }

    if (req.method === "GET" && segments[3] === "events") {
      const role = url.searchParams.get("role");
      const cursor = Number(url.searchParams.get("cursor") || "0");
      const events = room.events.filter((event) => {
        if (event.id <= cursor) {
          return false;
        }

        if (event.targetRole && event.targetRole !== role) {
          return false;
        }

        return event.fromRole !== role;
      });

      sendJson(res, 200, {
        events,
        cursor: room.lastEventId,
      });
      return;
    }

    if (req.method === "POST" && segments[3] === "close") {
      room.status = "Encerrada";
      room.closedAt = new Date().toISOString();
      addTimeline(room, {
        actor: "tecnico",
        text: "Sala encerrada pelo tecnico.",
        kind: "system",
      });
      sendJson(res, 200, { room: serializeRoom(room) });
      return;
    }
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    sendJson(res, 200, {
      appBaseUrl: APP_BASE_URL,
      rtcIceServers: RTC_ICE_SERVERS,
      supportLoginHint: SUPPORT_LOGIN,
    });
    return;
  }

  sendJson(res, 404, { error: "not_found", message: "Rota nao encontrada." });
}

function serveStatic(req, res, url) {
  let targetPath = url.pathname === "/" ? "/index.html" : url.pathname;
  targetPath = path.normalize(targetPath).replace(/^(\.\.[/\\])+/, "");
  targetPath = targetPath.replace(/^[/\\]+/, "");
  const filePath = path.join(ROOT, targetPath);

  if (!filePath.startsWith(ROOT)) {
    sendText(res, 403, "Acesso negado.");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      if (error.code === "ENOENT") {
        sendText(res, 404, "Arquivo nao encontrado.");
        return;
      }

      sendText(res, 500, "Erro ao ler arquivo.");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function createRoom(payload) {
  const roomId = generateRoomId();
  const now = new Date().toISOString();
  const room = {
    id: roomId,
    customerName: requiredString(payload.customerName) || "Cliente sem nome",
    company: requiredString(payload.company),
    contact: requiredString(payload.contact),
    deviceId: requiredString(payload.deviceId),
    system: requiredString(payload.system) || "Windows",
    priority: requiredString(payload.priority) || "Normal",
    issue: requiredString(payload.issue) || "Solicitacao de suporte remoto.",
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    status: "Triagem",
    joinUrl: `${APP_BASE_URL}/?room=${roomId}`,
    participants: {
      technician: null,
      customer: null,
    },
    events: [],
    lastEventId: 0,
    timeline: [],
  };

  addTimeline(room, {
    actor: "sistema",
    text: "Sala criada e aguardando entrada do tecnico.",
    kind: "system",
  });

  rooms.set(roomId, room);
  return room;
}

function joinRoom(room, payload) {
  const role = payload.role === "customer" ? "customer" : "technician";
  const participant = {
    role,
    name: requiredString(payload.name) || (role === "technician" ? "Tecnico" : "Cliente"),
    joinedAt: new Date().toISOString(),
    diagnostics: payload.diagnostics || null,
  };

  room.participants[role] = participant;
  room.updatedAt = participant.joinedAt;

  if (role === "customer") {
    room.status = "Conexao";
    addTimeline(room, {
      actor: "cliente",
      text: `${participant.name} entrou na sala e confirmou presenca para o suporte.`,
      kind: "presence",
    });
  } else {
    addTimeline(room, {
      actor: "tecnico",
      text: `${participant.name} assumiu o atendimento.`,
      kind: "presence",
    });
  }

  return participant;
}

function addTimeline(room, entry) {
  const item = {
    id: `timeline-${room.timeline.length + 1}`,
    actor: entry.actor,
    text: entry.text,
    kind: entry.kind,
    createdAt: new Date().toISOString(),
  };

  room.timeline.unshift(item);
  room.updatedAt = item.createdAt;
}

function enqueueSignal(room, payload) {
  const event = {
    id: ++room.lastEventId,
    fromRole: payload.fromRole || "unknown",
    targetRole: payload.targetRole || null,
    type: payload.type || "message",
    payload: payload.payload || {},
    createdAt: new Date().toISOString(),
  };

  room.events.push(event);
  room.updatedAt = event.createdAt;

  if (payload.timelineText) {
    addTimeline(room, {
      actor: payload.fromRole === "customer" ? "cliente" : "tecnico",
      text: payload.timelineText,
      kind: payload.type === "chat" ? "chat" : "signal",
    });
  }
}

function serializeRoom(room) {
  return {
    id: room.id,
    customerName: room.customerName,
    company: room.company,
    contact: room.contact,
    deviceId: room.deviceId,
    system: room.system,
    priority: room.priority,
    issue: room.issue,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    closedAt: room.closedAt,
    status: room.status,
    joinUrl: `${APP_BASE_URL}/?room=${room.id}`,
    participants: room.participants,
    timeline: room.timeline,
  };
}

function generateRoomId() {
  let roomId = "";

  do {
    roomId = Math.floor(100000 + Math.random() * 900000).toString();
  } while (rooms.has(roomId));

  return roomId;
}

function requiredString(value) {
  return value?.toString().trim() || "";
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", (chunk) => {
      data += chunk;

      if (data.length > 1_000_000) {
        reject(new Error("Payload excede o limite suportado."));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("JSON invalido."));
      }
    });

    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function normalizeBaseUrl(value) {
  return String(value).trim().replace(/\/+$/, "");
}

function parseIceServers(value) {
  if (!value) {
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length ? parsed : [{ urls: "stun:stun.l.google.com:19302" }];
  } catch {
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }
}
