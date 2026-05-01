const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_PLAYERS = 300;
const MAX_MISSES = 5;

const clients = new Map();
const players = new Map();
let hostId = null;

const game = {
  round: 0,
  word: "",
  guesses: new Set(),
  status: "waiting",
  musicOn: false,
  musicVolume: 0.35,
  winnerId: null,
  lastGuess: null
};

function sanitizeCustomWord(word) {
  return String(word || "")
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
}

function ensureHost() {
  if (hostId && players.get(hostId)?.online && isHostName(players.get(hostId).name)) return;
  const nextHost = onlinePlayers().find(player => isHostName(player.name));
  hostId = nextHost ? nextHost.id : null;
}

function isHostName(name) {
  return /^sukumar/i.test(String(name || "").trim());
}

function startCustomRound(word) {
  const customWord = sanitizeCustomWord(word);
  if (customWord.replace(/ /g, "").length < 3) {
    return { ok: false, error: "Host word must be at least 3 letters." };
  }
  game.round += 1;
  game.word = customWord;
  game.guesses = new Set();
  game.status = "playing";
  game.winnerId = null;
  game.lastGuess = null;
  for (const player of players.values()) {
    player.misses = 0;
    player.streak = 0;
    player.wrongGuesses = new Set();
  }
  return { ok: true };
}

function resetGame() {
  game.round = 0;
  game.word = "";
  game.guesses = new Set();
  game.status = "waiting";
  game.winnerId = null;
  game.lastGuess = null;
  for (const player of players.values()) {
    player.score = 0;
    player.streak = 0;
    player.misses = 0;
    player.wrongGuesses = new Set();
  }
}

function endGame() {
  resetGame();
  game.round = 0;
  game.musicOn = false;
  game.musicVolume = 0.35;
  players.clear();
  hostId = null;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 10000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function cleanName(name) {
  return String(name || "")
    .replace(/[^\w .'-]/g, "")
    .trim()
    .slice(0, 22) || "Player";
}

function onlinePlayers() {
  return [...players.values()]
    .filter(player => player.online)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function maskedWord() {
  if (!game.word) return "";
  return game.word
    .split("")
    .map(letter => (letter === " " || game.guesses.has(letter) ? letter : "_"))
    .join("");
}

function publicState(viewerId = "") {
  ensureHost();
  const revealed = maskedWord();
  const winner = game.winnerId ? players.get(game.winnerId) : null;
  const viewer = players.get(viewerId);
  return {
    maxPlayers: MAX_PLAYERS,
    maxMisses: MAX_MISSES,
    round: game.round,
    maskedWord: revealed,
    wordLength: game.word.length,
    guesses: [...game.guesses].sort(),
    wrongGuesses: viewer ? [...(viewer.wrongGuesses || new Set())].sort() : [],
    status: game.status,
    musicOn: game.musicOn,
    musicVolume: game.musicVolume,
    answer: game.word && (game.status === "lost" || game.status === "won") ? game.word : null,
    winnerName: winner ? winner.name : null,
    lastGuess: game.lastGuess,
    hostId,
    players: onlinePlayers().map(({ id, name, score, streak, online, misses = 0 }) => ({
      id,
      name,
      score,
      streak,
      misses: id === viewerId ? misses : 0,
      missesLeft: id === viewerId ? Math.max(0, MAX_MISSES - misses) : null,
      online,
      isHost: id === hostId
    }))
  };
}

function broadcast() {
  for (const client of clients.values()) {
    client.res.write(`data: ${JSON.stringify(publicState(client.playerId))}\n\n`);
  }
}

function handleGuess(playerId, letter) {
  const player = players.get(playerId);
  if (!player || !player.online) {
    return { ok: false, error: "Join the game before guessing." };
  }
  if (game.status !== "playing") {
    return { ok: false, error: "The host needs to choose a word first." };
  }
  if ((player.misses || 0) >= MAX_MISSES) {
    return { ok: false, error: "You used all 5 missed tries for this round." };
  }

  const guess = String(letter || "").toLowerCase().match(/[a-z]/)?.[0];
  if (!guess) return { ok: false, error: "Choose a letter A-Z." };
  if (game.guesses.has(guess)) {
    return { ok: false, error: `${guess.toUpperCase()} was already guessed.` };
  }

  if (game.word.includes(guess)) {
    game.guesses.add(guess);
    game.lastGuess = { letter: guess, playerName: player.name, hit: true };
    player.score += 2;
    player.streak += 1;
  } else {
    player.wrongGuesses = player.wrongGuesses || new Set();
    if (player.wrongGuesses.has(guess)) {
      return { ok: false, error: `${guess.toUpperCase()} is already one of your missed letters.` };
    }
    player.wrongGuesses.add(guess);
    player.misses = (player.misses || 0) + 1;
    player.streak = 0;
  }

  if (!maskedWord().includes("_")) {
    game.status = "won";
    game.winnerId = player.id;
    player.score += 8;
    player.streak += 1;
  } else if (onlinePlayers().every(current => (current.misses || 0) >= MAX_MISSES)) {
    game.status = "lost";
    for (const current of players.values()) current.streak = 0;
  }

  broadcast();
  return { ok: true };
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".svg": "image/svg+xml"
    }[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

async function handleApi(req, res) {
  try {
    if (req.method === "GET" && req.url.startsWith("/api/state")) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      sendJson(res, 200, publicState(url.searchParams.get("playerId") || ""));
      return;
    }

    if (req.method === "POST" && req.url === "/api/join") {
      const body = await readBody(req);
      const existingId = String(body.playerId || "");
      const name = cleanName(body.name);
      let id = existingId && players.has(existingId) ? existingId : crypto.randomUUID();
      let player = players.get(id);

      if (!player && onlinePlayers().length >= MAX_PLAYERS) {
        sendJson(res, 429, { ok: false, error: "This room is full. Try again later." });
        return;
      }

      if (!player) {
        player = { id, name, score: 0, streak: 0, misses: 0, wrongGuesses: new Set(), online: true };
        players.set(id, player);
      }

      player.name = name;
      player.online = true;
      player.wrongGuesses = player.wrongGuesses || new Set();
      ensureHost();
      broadcast();
      sendJson(res, 200, { ok: true, playerId: id, state: publicState(id) });
      return;
    }

    if (req.method === "POST" && req.url === "/api/guess") {
      const body = await readBody(req);
      const result = handleGuess(String(body.playerId || ""), body.letter);
      sendJson(res, result.ok ? 200 : 400, result);
      return;
    }

    if (req.method === "POST" && req.url === "/api/logout") {
      const body = await readBody(req);
      const playerId = String(body.playerId || "");
      if (players.has(playerId)) {
        players.delete(playerId);
        if (hostId === playerId) hostId = null;
        ensureHost();
        broadcast();
      }
      sendJson(res, 200, { ok: true, state: publicState() });
      return;
    }

    if (req.method === "POST" && req.url === "/api/new-round") {
      const body = await readBody(req);
      const playerId = String(body.playerId || "");
      if (!players.has(playerId)) {
        sendJson(res, 403, { ok: false, error: "Join the game before starting a round." });
        return;
      }

      ensureHost();
      if (playerId !== hostId) {
        sendJson(res, 403, { ok: false, error: "Only the host can choose the word." });
        return;
      }

      const result = startCustomRound(body.word);
      if (!result.ok) {
        sendJson(res, 400, result);
        return;
      }

      broadcast();
      sendJson(res, 200, { ok: true, state: publicState(playerId) });
      return;
    }

    if (req.method === "POST" && req.url === "/api/reset") {
      const body = await readBody(req);
      const playerId = String(body.playerId || "");
      ensureHost();
      if (!players.has(playerId)) {
        sendJson(res, 403, { ok: false, error: "Join the game before resetting." });
        return;
      }
      if (playerId !== hostId) {
        sendJson(res, 403, { ok: false, error: "Only the host can reset the game." });
        return;
      }
      resetGame();
      broadcast();
      sendJson(res, 200, { ok: true, state: publicState(playerId) });
      return;
    }

    if (req.method === "POST" && req.url === "/api/music") {
      const body = await readBody(req);
      const playerId = String(body.playerId || "");
      ensureHost();
      if (!players.has(playerId)) {
        sendJson(res, 403, { ok: false, error: "Join the game before changing music." });
        return;
      }
      if (playerId !== hostId) {
        sendJson(res, 403, { ok: false, error: "Only the host can control music." });
        return;
      }
      game.musicOn = Boolean(body.musicOn);
      if (Number.isFinite(Number(body.musicVolume))) {
        game.musicVolume = Math.max(0, Math.min(1, Number(body.musicVolume)));
      }
      broadcast();
      sendJson(res, 200, { ok: true, state: publicState(playerId) });
      return;
    }

    if (req.method === "POST" && req.url === "/api/end") {
      const body = await readBody(req);
      const playerId = String(body.playerId || "");
      ensureHost();
      if (!players.has(playerId)) {
        sendJson(res, 403, { ok: false, error: "Join the game before ending it." });
        return;
      }
      if (playerId !== hostId) {
        sendJson(res, 403, { ok: false, error: "Only the host can end the game." });
        return;
      }
      endGame();
      broadcast();
      sendJson(res, 200, { ok: true, state: publicState() });
      return;
    }

    sendJson(res, 404, { ok: false, error: "Unknown API route." });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: "Bad request." });
  }
}

function handleEvents(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const playerId = url.searchParams.get("playerId");
  if (playerId && players.has(playerId)) {
    players.get(playerId).online = true;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write(`data: ${JSON.stringify(publicState(playerId))}\n\n`);

  const clientId = crypto.randomUUID();
  clients.set(clientId, { res, playerId });
  req.on("close", () => {
    clients.delete(clientId);
    if (playerId && players.has(playerId)) {
      setTimeout(() => {
        const hasOpenClient = [...clients.values()].some(client => client.playerId === playerId);
        if (!hasOpenClient && players.has(playerId)) {
          players.get(playerId).online = false;
          ensureHost();
          broadcast();
        }
      }, 3000);
    }
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/events")) {
    handleEvents(req, res);
    return;
  }
  if (req.url.startsWith("/api/")) {
    handleApi(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`CIBC Hangman Party is running at http://localhost:${PORT}`);
});
