import { db } from "./firebase-config.js";
import {
  collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const SCORES_COLLECTION = "scores";

/**
 * Simpan skor baru ke Firestore.
 * @param {{name:string, score:number, accuracy:number, maxCombo:number}} data
 */
export async function saveScore(data) {
  const name = String(data.name || "Anonim").slice(0, 16).trim() || "Anonim";
  const payload = {
    name,
    score: Math.max(0, Math.round(data.score)),
    accuracy: Math.round(data.accuracy * 100) / 100,
    maxCombo: Math.max(0, Math.round(data.maxCombo)),
    createdAt: serverTimestamp(),
  };
  const ref = collection(db, SCORES_COLLECTION);
  await addDoc(ref, payload);
}

/**
 * Ambil top N skor tertinggi, urut descending.
 * @param {number} topN
 */
export async function fetchTopScores(topN = 20) {
  const ref = collection(db, SCORES_COLLECTION);
  const q = query(ref, orderBy("score", "desc"), limit(topN));
  const snap = await getDocs(q);
  const out = [];
  snap.forEach(doc => out.push(doc.data()));
  return out;
}

// Dibuat bisa diakses langsung dari app.js non-module lewat window juga,
// tapi app.js kita tulis sebagai module supaya bisa import langsung.
window.__leaderboard = { saveScore, fetchTopScores };
