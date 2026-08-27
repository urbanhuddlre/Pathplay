import { saveScore, fetchTopScores } from "./leaderboard.js";

/* ================= CONFIG ================= */
const SONG_CANDIDATES = [
  "assets/song.mp3", "assets/song.ogg", "assets/song.wav", "assets/song.m4a"
];
const CHART_URL = "assets/chart.json"; 
const SONG_TITLE = "Naykilla - MMG (My Mine Gueh)";

const NOTE_TRAVEL_TIME = 1.25; 
const HIT_WINDOW_PERFECT = 0.06;
const HIT_WINDOW_GOOD = 0.16;
const HIT_WINDOW_BAD = 0.20;
const MISS_GRACE = 0.20; 

const BTN_BOTTOM = 26;   // px, jarak tombol bulat dari bawah lane (samain sama style.css)
const BTN_RADIUS = 44;   // px, setengah dari .laneBtn width/height
const NOTE_RADIUS = 31;  // px, setengah dari .note width/height

/* ================= STATE ================= */
let audioCtx = null;
let audioBuffer = null;
let songUrl = null;
let chartNotes = null;
let usingManualChart = false;

let activeNotes = [];   // { time, lane, el, judged }
let noteQueue = [];     // notes not yet spawned, sorted by time
let spawnIdx = 0;

let score = 0, combo = 0, maxCombo = 0;
let perfectCount = 0, goodCount = 0, badCount = 0, missCount = 0, totalNotes = 0;

let rafId = null;
let songDuration = 0;
let isPaused = false;

/* ================= DOM ================= */
const $ = id => document.getElementById(id);
const screens = {
  menu: $("menuScreen"),
  countdown: $("countdownScreen"),
  game: $("gameScreen"),
  result: $("resultScreen"),
  leaderboard: $("leaderboardScreen"),
};
const audioEl = $("songAudio");

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove("active"));
  screens[name].classList.add("active");
}

/* ================= LOAD SONG ================= */
async function findSong() {
  for (const url of SONG_CANDIDATES) {
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (res.ok) return url;
    } catch (e) { /* try next */ }
  }
  return null;
}

async function loadSong() {
  $("songStatus").textContent = "Loading...";
  songUrl = await findSong();
  if (!songUrl) {
    $("songStatus").textContent = "Song not found...";
    return;
  }
  audioEl.src = songUrl;

  try {
    // 1) Coba pakai chart manual (assets/chart.json) kalau ada — hasil dari Chart Editor.
    const manual = await tryLoadManualChart();
    if (manual) {
      chartNotes = manual;
      usingManualChart = true;
      showSongReady();
      $("startBtn").disabled = false;
      return;
    }

    // 2) Kalau tidak ada, analisis otomatis dari lagunya.
    $("songStatus").textContent = "Loading...";
    const res = await fetch(songUrl);
    const arrBuf = await res.arrayBuffer();
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioBuffer = await audioCtx.decodeAudioData(arrBuf);

    chartNotes = await window.BeatDetect.analyze(audioBuffer, "hard");
    usingManualChart = false;

    showSongReady();
    $("startBtn").disabled = false;
  } catch (err) {
    console.error(err);
    $("songStatus").textContent = "Song not found...";
  }
}

function showSongReady() {
  // Tampilkan judul lagu sebagai teks berjalan (marquee).
  $("songStatus").innerHTML = `<span class="marqueeText">${escapeHtml(SONG_TITLE)}</span>`;
}

async function tryLoadManualChart() {
  try {
    const res = await fetch(CHART_URL, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;
    // validasi bentuk data
    const valid = data.every(n => typeof n.time === "number" && ["up","down","left","right"].includes(n.lane));
    return valid ? data : null;
  } catch (e) {
    return null;
  }
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* ================= DURASI LAGU (buat progress bar) ================= */
audioEl.addEventListener("loadedmetadata", () => {
  songDuration = audioEl.duration || 0;
});

/* ================= GAME FLOW ================= */
$("startBtn").addEventListener("click", startCountdown);
$("viewLeaderboardBtn").addEventListener("click", () => openLeaderboard("menu"));
$("closeLeaderboardBtn").addEventListener("click", () => showScreen(cameFrom));
$("backToMenuBtn").addEventListener("click", () => { resetToMenu(); });
$("saveScoreBtn").addEventListener("click", onSaveScore);
$("pauseBtn").addEventListener("click", pauseGame);
$("resumeBtn").addEventListener("click", resumeGame);

function pauseGame() {
  if (isPaused) return;
  isPaused = true;
  audioEl.pause();
  cancelAnimationFrame(rafId);
  $("pauseOverlay").classList.add("show");
}

function resumeGame() {
  if (!isPaused) return;
  isPaused = false;
  $("pauseOverlay").classList.remove("show");
  audioEl.play();
  rafId = requestAnimationFrame(gameLoop);
}

let cameFrom = "menu";
async function openLeaderboard(from) {
  cameFrom = from;
  showScreen("leaderboard");
  const listEl = $("leaderboardList");
  listEl.innerHTML = `<div class="lbLoading">Memuat…</div>`;
  try {
    const scores = await fetchTopScores(30);
    renderLeaderboard(scores);
  } catch (err) {
    console.error(err);
    listEl.innerHTML = `<div class="lbLoading">Gagal memuat leaderboard. Sudah setup Firebase belum? (lihat README.md)</div>`;
  }
}

function renderLeaderboard(scores) {
  const listEl = $("leaderboardList");
  if (!scores.length) {
    listEl.innerHTML = `<div class="lbLoading">Belum ada skor. Jadilah yang pertama!</div>`;
    return;
  }
  listEl.innerHTML = scores.map((s, i) => {
    const rankClass = i === 0 ? "top1" : i === 1 ? "top2" : i === 2 ? "top3" : "";
    return `<div class="lbRow ${rankClass}">
      <span class="lbRank">${i + 1}</span>
      <span class="lbName">${escapeHtml(s.name)}</span>
      <span class="lbScore">${s.score}</span>
    </div>`;
  }).join("");
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function startCountdown() {
  showScreen("countdown");
  let n = 3;
  const el = $("countdownNum");
  el.textContent = n;
  el.style.animation = "none"; void el.offsetWidth; el.style.animation = "";
  const iv = setInterval(() => {
    n--;
    if (n <= 0) {
      clearInterval(iv);
      el.textContent = "Mulai!";
      setTimeout(startGame, 500);
    } else {
      el.textContent = n;
      el.style.animation = "none"; void el.offsetWidth; el.style.animation = "";
    }
  }, 800);
}

function startGame() {
  score = 0; combo = 0; maxCombo = 0;
  perfectCount = 0; goodCount = 0; badCount = 0; missCount = 0;
  activeNotes = [];
  noteQueue = (chartNotes || []).slice().sort((a, b) => a.time - b.time);
  totalNotes = noteQueue.length;
  spawnIdx = 0;
  isPaused = false;
  $("pauseOverlay").classList.remove("show");

  document.querySelectorAll(".laneTrack .note").forEach(n => n.remove());
  updateHud();

  showScreen("game");
  audioEl.currentTime = 0;
  audioEl.play();

  rafId = requestAnimationFrame(gameLoop);
}

function updateHud() {
  $("scoreVal").textContent = Math.round(score);
  const judged = perfectCount + goodCount + badCount + missCount;
  const acc = judged === 0 ? 100 : ((perfectCount * 100 + goodCount * 60 + badCount * 20) / (judged * 100)) * 100;
  $("accVal").textContent = `${acc.toFixed(1)}%`;
}

function gameLoop() {
  const t = audioEl.currentTime;
  const travel = NOTE_TRAVEL_TIME;

  // spawn upcoming notes
  while (spawnIdx < noteQueue.length && noteQueue[spawnIdx].time - travel <= t) {
    spawnNote(noteQueue[spawnIdx]);
    spawnIdx++;
  }

  // update active notes positions
  for (let i = activeNotes.length - 1; i >= 0; i--) {
    const note = activeNotes[i];
    const track = document.getElementById(`track-${note.lane}`);
    const trackH = track.clientHeight;
    const hitCenterY = trackH - BTN_BOTTOM - BTN_RADIUS; // titik tengah tombol bulat
    const progress = (t - (note.time - travel)) / travel;
    const y = progress * hitCenterY - NOTE_RADIUS;
    note.el.style.top = `${y}px`;

    if (!note.judged && (t - note.time) > MISS_GRACE) {
      judgeNote(note, "miss");
    }
    if (note.judged && (t - note.time) > MISS_GRACE + 0.05) {
      note.el.remove();
      activeNotes.splice(i, 1);
    }
  }

  // progress bar
  if (songDuration > 0) {
    $("songProgressBar").style.width = `${Math.min(100, (t / songDuration) * 100)}%`;
  }

  if (audioEl.ended || (spawnIdx >= noteQueue.length && activeNotes.length === 0 && t > 0.5 && audioEl.paused)) {
    endGame();
    return;
  }

  rafId = requestAnimationFrame(gameLoop);
}

function spawnNote(note) {
  const track = document.getElementById(`track-${note.lane}`);
  const el = document.createElement("div");
  el.className = "note";
  el.style.top = "-40px";
  track.appendChild(el);
  note.el = el;
  note.judged = false;
  activeNotes.push(note);
}

function judgeNote(note, forcedJudge) {
  note.judged = true;
  let judge = forcedJudge;
  if (!forcedJudge) {
    const diff = Math.abs(audioEl.currentTime - note.time);
    if (diff <= HIT_WINDOW_PERFECT) judge = "perfect";
    else if (diff <= HIT_WINDOW_GOOD) judge = "good";
    else if (diff <= HIT_WINDOW_BAD) judge = "bad";
    else judge = "bad"; // jaga-jaga, harusnya nggak kesini
  }

  if (judge === "perfect") {
    perfectCount++;
    combo++;
    const mult = 1 + Math.min(1, Math.floor(combo / 10) * 0.1);
    score += 300 * mult;
  } else if (judge === "good") {
    goodCount++;
    combo++;
    const mult = 1 + Math.min(1, Math.floor(combo / 10) * 0.1);
    score += 100 * mult;
  } else if (judge === "bad") {
    badCount++;
    combo = 0;
    score += 30;
  } else {
    missCount++;
    combo = 0;
  }
  maxCombo = Math.max(maxCombo, combo);
  showJudgeText(judge);
  updateHud();
}

function showJudgeText(judge) {
  const el = $("judgeText");
  el.classList.remove("show");
  void el.offsetWidth; // force reflow so the animation restarts even on repeat judgements
  el.textContent = judge === "perfect" ? "PERFECT!" : judge === "good" ? "GOOD" : judge === "bad" ? "BAD" : "MISS";
  el.className = `judgeText ${judge}`;
  void el.offsetWidth;
  el.classList.add("show");
}

/* ---------- input handling ---------- */
function tryHitLane(lane) {
  const t = audioEl.currentTime;
  let best = null, bestDiff = Infinity;
  for (const note of activeNotes) {
    if (note.lane !== lane || note.judged) continue;
    const diff = Math.abs(t - note.time);
    if (diff < bestDiff) { bestDiff = diff; best = note; }
  }
  if (best && bestDiff <= HIT_WINDOW_BAD) {
    judgeNote(best);
  } else {
    // ngetuk tapi nggak ada note di jangkauan — tetap kasih feedback "BAD"
    // biar setiap tombol dipencet selalu ada responnya, tanpa ngaruh ke skor/combo.
    showJudgeText("bad");
  }
}

document.querySelectorAll(".laneBtn").forEach(btn => {
  const lane = btn.dataset.lane;
  const press = (e) => { e.preventDefault(); btn.classList.add("pressed"); flashLane(lane); tryHitLane(lane); };
  const release = () => btn.classList.remove("pressed");
  btn.addEventListener("pointerdown", press);
  btn.addEventListener("pointerup", release);
  btn.addEventListener("pointerleave", release);
});

function flashLane(lane) {
  const laneEl = document.querySelector(`.lane[data-lane="${lane}"]`);
  if (!laneEl) return;
  laneEl.classList.remove("flash");
  void laneEl.offsetWidth; // restart animasi/transition kalau ditekan cepat berulang
  laneEl.classList.add("flash");
  clearTimeout(laneEl._flashTimeout);
  laneEl._flashTimeout = setTimeout(() => laneEl.classList.remove("flash"), 160);
}

const KEY_LANE_MAP = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
window.addEventListener("keydown", (e) => {
  if (!screens.game.classList.contains("active")) return;
  const lane = KEY_LANE_MAP[e.key];
  if (lane) {
    e.preventDefault();
    document.querySelector(`.laneBtn[data-lane="${lane}"]`).classList.add("pressed");
    flashLane(lane);
    tryHitLane(lane);
  }
});
window.addEventListener("keyup", (e) => {
  const lane = KEY_LANE_MAP[e.key];
  if (lane) document.querySelector(`.laneBtn[data-lane="${lane}"]`).classList.remove("pressed");
});

/* ---------- end game ---------- */
function endGame() {
  cancelAnimationFrame(rafId);
  audioEl.pause();

  $("finalScore").textContent = Math.round(score);
  const judged = perfectCount + goodCount + badCount + missCount;
  const acc = judged === 0 ? 100 : ((perfectCount * 100 + goodCount * 60 + badCount * 20) / (judged * 100)) * 100;
  $("finalAcc").textContent = `${acc.toFixed(1)}%`;
  $("finalCombo").textContent = maxCombo;
  $("finalJudges").textContent = `${perfectCount} / ${goodCount} / ${badCount} / ${missCount}`;

  $("saveStatus").textContent = "";
  $("saveStatus").className = "saveStatus";
  $("playerName").value = "";
  $("saveScoreWrap").style.display = "flex";

  showScreen("result");
}

async function onSaveScore() {
  const name = $("playerName").value.trim();
  if (!name) {
    $("saveStatus").textContent = "Isi nama dulu ya~";
    $("saveStatus").className = "saveStatus err";
    return;
  }
  $("saveScoreBtn").disabled = true;
  $("saveStatus").textContent = "Menyimpan...";
  $("saveStatus").className = "saveStatus";
  try {
    const judged = perfectCount + goodCount + badCount + missCount;
    const acc = judged === 0 ? 100 : ((perfectCount * 100 + goodCount * 60 + badCount * 20) / (judged * 100)) * 100;
    await saveScore({ name, score, accuracy: acc, maxCombo });
    $("saveStatus").textContent = "Skor tersimpan!";
    $("saveStatus").className = "saveStatus ok";
    $("saveScoreWrap").style.display = "none";
    setTimeout(() => openLeaderboard("result"), 600);
  } catch (err) {
    console.error(err);
    $("saveStatus").textContent = "Gagal menyimpan. Sudah setup Firebase? (lihat README.md)";
    $("saveStatus").className = "saveStatus err";
  } finally {
    $("saveScoreBtn").disabled = false;
  }
}

function resetToMenu() {
  showScreen("menu");
}

/* ================= INIT ================= */
loadSong();
