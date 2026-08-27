/* ================= CONFIG ================= */
const SONG_CANDIDATES = [
  "assets/song.mp3", "assets/song.ogg", "assets/song.wav", "assets/song.m4a"
];

/* ================= STATE ================= */
let notes = [];       // { time, lane }
let insertOrder = [];  // stack of note refs, buat undo
let offsetMs = -150;

/* ================= DOM ================= */
const $ = id => document.getElementById(id);
const audio = new Audio();
const playPauseBtn = $("playPauseBtn");
const restartBtn = $("restartBtn");
const timeDisplay = $("timeDisplay");
const offsetSlider = $("offsetSlider");
const offsetVal = $("offsetVal");
const noteCountEl = $("noteCount");
const noteListEl = $("noteList");
const undoBtn = $("undoBtn");
const clearBtn = $("clearBtn");
const downloadBtn = $("downloadBtn");
const statusEl = $("songStatusEditor");
const saveStatusEl = $("editorSaveStatus");

const LANE_LABEL = { up: "▲ Atas", left: "◀ Kiri", down: "▼ Bawah", right: "▶ Kanan" };

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

async function init() {
  const url = await findSong();
  if (!url) {
    statusEl.textContent = "Lagu belum ditemukan. Taruh dulu di assets/song.mp3, lalu refresh halaman ini.";
    statusEl.className = "statusMsg err";
    return;
  }
  audio.src = url;
  audio.addEventListener("loadedmetadata", () => {
    statusEl.textContent = `Lagu siap: ${url.split("/").pop()} (${formatTime(audio.duration)})`;
    statusEl.className = "statusMsg ok";
    playPauseBtn.disabled = false;
    restartBtn.disabled = false;
  });
  audio.addEventListener("timeupdate", updateTimeDisplay);
  audio.addEventListener("ended", () => { playPauseBtn.textContent = "▶ Play"; });
}

function formatTime(sec) {
  if (!isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}

function updateTimeDisplay() {
  timeDisplay.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration || 0)}`;
}

/* ================= TRANSPORT ================= */
playPauseBtn.addEventListener("click", () => {
  if (audio.paused) {
    audio.play();
    playPauseBtn.textContent = "⏸ Pause";
  } else {
    audio.pause();
    playPauseBtn.textContent = "▶ Play";
  }
});
restartBtn.addEventListener("click", () => {
  audio.currentTime = 0;
  updateTimeDisplay();
});

/* ================= OFFSET ================= */
offsetSlider.addEventListener("input", () => {
  offsetMs = parseInt(offsetSlider.value, 10);
  offsetVal.textContent = `${offsetMs} ms`;
});

/* ================= RECORD NOTES ================= */
function recordNote(lane) {
  if (audio.paused) return; // cuma catat kalau lagu lagi diputar
  const t = Math.max(0, audio.currentTime + offsetMs / 1000);
  const note = { time: Math.round(t * 1000) / 1000, lane };
  notes.push(note);
  insertOrder.push(note);
  notes.sort((a, b) => a.time - b.time);
  renderNoteList();
}

document.querySelectorAll(".lanePad").forEach(btn => {
  const lane = btn.dataset.lane;
  btn.addEventListener("pointerdown", (e) => { e.preventDefault(); recordNote(lane); });
});

const KEY_LANE_MAP = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
window.addEventListener("keydown", (e) => {
  const lane = KEY_LANE_MAP[e.key];
  if (lane) { e.preventDefault(); recordNote(lane); }
});

/* ================= LIST / UNDO / CLEAR ================= */
function renderNoteList() {
  noteCountEl.textContent = `${notes.length} notes`;
  undoBtn.disabled = insertOrder.length === 0;
  clearBtn.disabled = notes.length === 0;
  downloadBtn.disabled = notes.length === 0;

  noteListEl.innerHTML = notes.map((n, i) => `
    <div class="noteRow">
      <span class="lanePill lane-${n.lane}"></span>
      <span class="nTime">${formatTime(n.time)} — ${LANE_LABEL[n.lane]}</span>
      <button class="delBtn" data-idx="${i}">✕</button>
    </div>
  `).join("");

  noteListEl.querySelectorAll(".delBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.idx, 10);
      const removed = notes.splice(idx, 1)[0];
      insertOrder = insertOrder.filter(n => n !== removed);
      renderNoteList();
    });
  });
}

undoBtn.addEventListener("click", () => {
  const last = insertOrder.pop();
  if (!last) return;
  const idx = notes.indexOf(last);
  if (idx !== -1) notes.splice(idx, 1);
  renderNoteList();
});

clearBtn.addEventListener("click", () => {
  if (!confirm("Yakin hapus semua notes yang sudah dicatat?")) return;
  notes = [];
  insertOrder = [];
  renderNoteList();
});

/* ================= EXPORT / IMPORT ================= */
downloadBtn.addEventListener("click", () => {
  const data = JSON.stringify(notes, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "chart.json";
  a.click();
  URL.revokeObjectURL(url);
  saveStatusEl.textContent = "Terdownload! Taruh file ini di folder assets/ (timpa kalau sudah ada).";
  saveStatusEl.className = "statusMsg ok";
});

$("loadFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error("format salah");
    notes = data.filter(n => typeof n.time === "number" && LANE_LABEL[n.lane]);
    insertOrder = notes.slice();
    renderNoteList();
    saveStatusEl.textContent = `Berhasil load ${notes.length} notes dari file.`;
    saveStatusEl.className = "statusMsg ok";
  } catch (err) {
    saveStatusEl.textContent = "Gagal membaca file, pastikan itu chart.json yang valid.";
    saveStatusEl.className = "statusMsg err";
  }
});

init();
