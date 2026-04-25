const alphabet = "abcdefghijklmnopqrstuvwxyz".split("");
const state = {
  playerId: localStorage.getItem("cibcHangmanPlayerId") || "",
  playerName: localStorage.getItem("cibcHangmanPlayerName") || "",
  game: null
};

const els = {
  landingPage: document.querySelector("#landingPage"),
  gamePage: document.querySelector("#gamePage"),
  nameInput: document.querySelector("#nameInput"),
  joinButton: document.querySelector("#joinButton"),
  joinMessage: document.querySelector("#joinMessage"),
  hostTools: document.querySelector("#hostTools"),
  hostWordInput: document.querySelector("#hostWordInput"),
  customRoundButton: document.querySelector("#customRoundButton"),
  resetButton: document.querySelector("#resetButton"),
  onlineCount: document.querySelector("#onlineCount"),
  word: document.querySelector("#word"),
  message: document.querySelector("#message"),
  keyboard: document.querySelector("#keyboard"),
  figure: document.querySelector("#figure"),
  logoutButton: document.querySelector("#logoutButton"),
  roundInfo: document.querySelector("#roundInfo"),
  roundTitle: document.querySelector("#roundTitle"),
  players: document.querySelector("#players"),
  activityText: document.querySelector("#activityText"),
  capacity: document.querySelector("#capacity"),
  hostNotice: document.querySelector("#hostNotice")
};

els.nameInput.value = state.playerName;

function api(path, payload) {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).then(async response => {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  });
}

function currentPlayer(game) {
  return game.players.find(player => player.id === state.playerId);
}

function renderKeyboard(game) {
  els.keyboard.innerHTML = "";
  const me = currentPlayer(game);
  const outOfTries = Boolean(me && me.misses >= game.maxMisses);

  for (const letter of alphabet) {
    const button = document.createElement("button");
    button.className = "key";
    button.textContent = letter.toUpperCase();
    button.type = "button";

    if (game.guesses.includes(letter)) {
      button.classList.add(game.maskedWord.includes(letter) ? "hit" : "miss");
    }

    button.disabled = !me || outOfTries || game.status !== "playing" || game.guesses.includes(letter);
    button.addEventListener("click", () => guess(letter));
    els.keyboard.appendChild(button);
  }
}

function renderWord(maskedWord) {
  els.word.innerHTML = "";
  if (!maskedWord) {
    const waiting = document.createElement("span");
    waiting.className = "waiting-word";
    waiting.textContent = "Host chooses the word";
    els.word.appendChild(waiting);
    return;
  }

  for (const word of maskedWord.split(" ")) {
    const group = document.createElement("span");
    group.className = "word-group";

    for (const letter of word) {
      const slot = document.createElement("span");
      slot.className = "letter-slot";
      slot.textContent = letter === "_" ? "" : letter;
      group.appendChild(slot);
    }

    els.word.appendChild(group);
  }
}

function renderPlayers(players) {
  els.players.innerHTML = "";
  for (const player of players) {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    const meta = document.createElement("span");
    name.textContent = `${player.name}${player.id === state.playerId ? " (you)" : ""}`;
    if (player.isHost) name.textContent += " - Host";
    meta.className = "score";
    meta.textContent = `${player.score} pts | ${player.missesLeft} left`;
    item.append(name, meta);
    els.players.appendChild(item);
  }
}

function statusMessage(game) {
  const me = currentPlayer(game);
  if (!me) return "Enter your name to join the room.";
  if (game.status === "waiting") return game.hostId === state.playerId
    ? "Choose a word to start the game."
    : "Waiting for the host to choose a word.";
  if (game.status === "won") return `${game.winnerName} solved it: ${game.answer.toUpperCase()}.`;
  if (game.status === "lost") return `The word was ${game.answer.toUpperCase()}. Host will choose the next word.`;
  if (me.misses >= game.maxMisses) return "You used all 5 missed tries for this round.";
  if (game.lastGuess) {
    const result = game.lastGuess.hit ? "found" : "missed";
    return `${game.lastGuess.playerName} ${result} ${game.lastGuess.letter.toUpperCase()}.`;
  }
  return "Guess together. Each player has 5 missed tries.";
}

function render(game) {
  state.game = game;
  const online = game.players.length;
  const host = game.players.find(player => player.isHost);
  const isHost = Boolean(state.playerId && game.hostId === state.playerId);
  const me = currentPlayer(game);

  els.landingPage.hidden = Boolean(me);
  els.gamePage.hidden = !me;
  els.onlineCount.textContent = online;
  els.capacity.textContent = online >= game.maxPlayers ? "Room full" : "Room open";
  els.hostTools.hidden = !isHost;
  els.hostNotice.textContent = host ? `${host.name} is hosting this room.` : "Join to become host.";
  els.figure.className = `flower figure miss-${me ? me.misses : 0}`;
  els.roundTitle.textContent = `Round ${game.round}`;
  els.roundInfo.textContent = me ? `${me.missesLeft} of ${game.maxMisses} missed tries left` : "Join to play";
  els.message.textContent = statusMessage(game);

  renderWord(game.maskedWord);
  renderKeyboard(game);
  renderPlayers(game.players);

  if (game.lastGuess) {
    const icon = game.lastGuess.hit ? "Hit" : "Miss";
    els.activityText.textContent = `${icon}: ${game.lastGuess.playerName} guessed ${game.lastGuess.letter.toUpperCase()}`;
  } else {
    els.activityText.textContent = "No guesses yet.";
  }
}

async function join() {
  try {
    const name = els.nameInput.value.trim();
    const data = await api("/api/join", { name, playerId: state.playerId });
    state.playerId = data.playerId;
    state.playerName = name || "Player";
    localStorage.setItem("cibcHangmanPlayerId", state.playerId);
    localStorage.setItem("cibcHangmanPlayerName", state.playerName);
    connectEvents();
    render(data.state);
  } catch (error) {
    els.joinMessage.textContent = error.message;
  }
}

async function guess(letter) {
  try {
    await api("/api/guess", { playerId: state.playerId, letter });
  } catch (error) {
    els.message.textContent = error.message;
  }
}

async function customRound() {
  try {
    const word = els.hostWordInput.value.trim();
    const data = await api("/api/new-round", { playerId: state.playerId, word });
    els.hostWordInput.value = "";
    render(data.state);
  } catch (error) {
    els.message.textContent = error.message;
  }
}

async function resetGame() {
  try {
    const data = await api("/api/reset", { playerId: state.playerId });
    els.hostWordInput.value = "";
    render(data.state);
  } catch (error) {
    els.message.textContent = error.message;
  }
}

async function logout() {
  const oldPlayerId = state.playerId;
  if (eventSource) eventSource.close();
  state.playerId = "";
  state.playerName = "";
  localStorage.removeItem("cibcHangmanPlayerId");
  localStorage.removeItem("cibcHangmanPlayerName");
  els.nameInput.value = "";

  try {
    const data = await api("/api/logout", { playerId: oldPlayerId });
    render(data.state);
  } catch (error) {
    els.landingPage.hidden = false;
    els.gamePage.hidden = true;
    els.joinMessage.textContent = "You logged out. Enter your name to join again.";
  }
}

let eventSource;
function connectEvents() {
  if (eventSource) eventSource.close();
  const query = state.playerId ? `?playerId=${encodeURIComponent(state.playerId)}` : "";
  eventSource = new EventSource(`/events${query}`);
  eventSource.onmessage = event => render(JSON.parse(event.data));
  eventSource.onerror = () => {
    if (!els.gamePage.hidden) els.message.textContent = "Reconnecting to the room...";
  };
}

els.joinButton.addEventListener("click", join);
els.logoutButton.addEventListener("click", logout);
els.customRoundButton.addEventListener("click", customRound);
els.resetButton.addEventListener("click", resetGame);
els.nameInput.addEventListener("keydown", event => {
  if (event.key === "Enter") join();
});
els.hostWordInput.addEventListener("keydown", event => {
  if (event.key === "Enter") customRound();
});

window.addEventListener("keydown", event => {
  if (!state.game || event.target === els.nameInput || event.target === els.hostWordInput) return;
  const me = currentPlayer(state.game);
  const letter = event.key.toLowerCase();
  if (me && /^[a-z]$/.test(letter) && !state.game.guesses.includes(letter)) {
    guess(letter);
  }
});

fetch("/api/state")
  .then(response => response.json())
  .then(render)
  .finally(connectEvents);
