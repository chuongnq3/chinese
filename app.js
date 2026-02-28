// =====================================
// app.js - Flashcard HSK (ID-based)
// =====================================

// SETTINGS
const SETTINGS = {
  scoring: { correct: 20, wrong: -10, floor: 0 },
  autoNext: { enabled: true, delayMs: 5000 },
  defaultTypes: ["HSK1"],
  answersCount: 4,

  // UI behavior
  flipOnCorrect: true,          // đúng -> ẩn câu hỏi, chỉ show kết quả trong card
  showPinyinWhenAskNotPinyin: false, // hiện tại giữ false (pinyinText sẽ rỗng)
};

// Types for question/answer
const ASK_TYPES = ["VIETNAMESE", "GIẢN THỂ", "PINYIN"];
const DATA_URL = "hsk.json";

// State
let DATA = [];
let FILTERED_DATA = [];

let currentQuestion = null;
let correctId = null;
let askType = null;
let answerType = null;

let score = 0;
let answered = false;
let autoTimer = null;
let wrongOptionIds = new Set();
let qCount = 0;

// DOM (cache)
const DOM = {
  title: null,
  score: null,
  hanzi: null,
  pinyin: null,
  instruction: null,
  reveal: null,
  opts: [],
  btnHint: null,
  btnSkip: null,
  btnContinue: null,
  btnSpeak: null
};

// =====================================
// INIT
// =====================================

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheDom();
  bindActions();
  bindOptionClicks();

  const raw = await loadJson(DATA_URL);

  // Normalize: support ID / id, trim TYPE, coerce id to Number
  DATA = normalizeData(raw);

  applyTypeFilter(SETTINGS.defaultTypes);
  updateScore();

  nextQuestion();
}

function cacheDom() {
  DOM.title = document.getElementById("questionTitle");
  DOM.score = document.getElementById("scoreValue");
  DOM.hanzi = document.getElementById("hanziText");
  DOM.pinyin = document.getElementById("pinyinText");
  DOM.instruction = document.getElementById("instructionText");
  DOM.reveal = document.getElementById("answerReveal");
  DOM.opts = Array.from(document.querySelectorAll(".opt"));

  DOM.btnHint = document.querySelector("[data-action='hint']");
  DOM.btnSkip = document.querySelector("[data-action='skip']");
  DOM.btnContinue = document.querySelector("[data-action='continue']");
  DOM.btnSpeak = document.querySelector("[data-action='speak']");
}

async function loadJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return await res.json();
}

function normalizeData(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((it, idx) => {
      const idRaw = it.id ?? it.ID ?? (idx + 1);
      const id = Number(idRaw);
      return {
        ...it,
        id: Number.isFinite(id) ? id : (idx + 1),
        TYPE: String(it.TYPE ?? "").trim()
      };
    })
    .filter(it => Number.isFinite(it.id) && it.TYPE);
}

// =====================================
// FILTER
// =====================================

function applyTypeFilter(typeArray) {
  const types = (typeArray || []).map(x => String(x).trim());
  FILTERED_DATA = DATA.filter(item => types.includes(item.TYPE));

  // fallback nếu rỗng
  if (!Array.isArray(FILTERED_DATA) || FILTERED_DATA.length === 0) {
    FILTERED_DATA = DATA.slice();
  }
}

// =====================================
// UTIL
// =====================================

function randInt(n) {
  return Math.floor(Math.random() * n);
}

function randomItem(arr) {
  return arr[randInt(arr.length)];
}

function shuffle(arr) {
  // Fisher–Yates
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// =====================================
// RENDER HELPERS
// =====================================

function setTitle(text) {
  if (DOM.title) DOM.title.textContent = text;
}

function updateScore() {
  if (DOM.score) DOM.score.textContent = score;
}

function showQuestionUi() {
  if (!SETTINGS.flipOnCorrect) return;
  if (DOM.hanzi) DOM.hanzi.style.display = "";
  if (DOM.pinyin) DOM.pinyin.style.display = "";
  if (DOM.instruction) DOM.instruction.style.display = "";
}

function hideQuestionUi() {
  if (!SETTINGS.flipOnCorrect) return;
  if (DOM.hanzi) DOM.hanzi.style.display = "none";
  if (DOM.pinyin) DOM.pinyin.style.display = "none";
  if (DOM.instruction) DOM.instruction.style.display = "none";
}

// =====================================
// QUESTION ENGINE
// =====================================

function nextQuestion() {
  clearTimeout(autoTimer);

  // reset
  answered = false;
  wrongOptionIds.clear();
  clearReveal();
  showQuestionUi();

  // pick
  currentQuestion = randomItem(FILTERED_DATA);
  correctId = currentQuestion.id;

  askType = randomItem(ASK_TYPES);
  answerType = randomItem(ASK_TYPES.filter(t => t !== askType));

  qCount += 1;
  setTitle(`Câu ${qCount}`);

  renderQuestion();
  renderAnswers();
  updateInstruction();

  // enable options
  DOM.opts.forEach(o => {
    o.classList.remove("disabled", "is-wrong", "is-correct");
    o.style.visibility = "visible";
    o.style.display = "";
  });
}

function renderQuestion() {
  if (!currentQuestion) return;

  if (DOM.hanzi) DOM.hanzi.textContent = currentQuestion?.[askType] ?? "";

  // pinyin line: tuỳ setting (mặc định rỗng)
  if (DOM.pinyin) {
    if (SETTINGS.showPinyinWhenAskNotPinyin && askType !== "PINYIN") {
      DOM.pinyin.textContent = currentQuestion?.["PINYIN"] ?? "";
    } else {
      DOM.pinyin.textContent = "";
    }
  }
}

function buildAnswerRecords() {
  const need = SETTINGS.answersCount;

  const used = new Set();
  const picks = [];

  // 1) include correct
  picks.push(currentQuestion);
  used.add(correctId);

  // 2) distractors from FILTERED first
  const pool1 = FILTERED_DATA.filter(it => it.id !== correctId);
  shuffle(pool1);

  for (const it of pool1) {
    if (picks.length >= need) break;
    if (used.has(it.id)) continue;
    picks.push(it);
    used.add(it.id);
  }

  // 3) if still not enough -> from DATA (any type)
  if (picks.length < need) {
    const pool2 = DATA.filter(it => it.id !== correctId);
    shuffle(pool2);
    for (const it of pool2) {
      if (picks.length >= need) break;
      if (used.has(it.id)) continue;
      picks.push(it);
      used.add(it.id);
    }
  }

  return shuffle(picks);
}

function renderAnswers() {
  const records = buildAnswerRecords();

  DOM.opts.forEach((opt, index) => {
    const record = records[index];

    // Nếu không đủ record -> ẩn option
    if (!record) {
      opt.style.display = "none";
      opt.dataset.id = "";
      const label = opt.querySelector(".label");
      if (label) label.textContent = "";
      return;
    }

    opt.dataset.id = String(record.id);

    const label = opt.querySelector(".label");
    if (label) label.textContent = record?.[answerType] ?? "";
  });
}

function updateInstruction() {
  if (!DOM.instruction) return;

  if (askType === "VIETNAMESE" && answerType === "GIẢN THỂ") {
    DOM.instruction.textContent = "Chọn chữ Hán tương ứng với cụm từ tiếng Việt trên";
  } else if (askType === "VIETNAMESE" && answerType === "PINYIN") {
    DOM.instruction.textContent = "Chọn pinyin tương ứng với cụm từ tiếng Việt trên";
  } else if (askType === "GIẢN THỂ" && answerType === "VIETNAMESE") {
    DOM.instruction.textContent = "Chọn nghĩa tiếng Việt đúng của từ tiếng Trung trên";
  } else if (askType === "GIẢN THỂ" && answerType === "PINYIN") {
    DOM.instruction.textContent = "Chọn pinyin đúng của từ tiếng Trung trên";
  } else if (askType === "PINYIN" && answerType === "GIẢN THỂ") {
    DOM.instruction.textContent = "Chọn chữ Hán đúng với pinyin trên";
  } else {
    DOM.instruction.textContent = "Chọn nghĩa tiếng Việt đúng với pinyin trên";
  }
}

// =====================================
// OPTIONS CLICK
// =====================================

function bindOptionClicks() {
  DOM.opts.forEach(opt => {
    opt.addEventListener("click", () => onPickOption(opt));
  });
}

function onPickOption(opt) {
  if (answered) return;
  if (!opt || opt.classList.contains("disabled")) return;

  const pickedId = parseInt(opt.dataset.id, 10);
  if (!Number.isFinite(pickedId)) return;

  if (wrongOptionIds.has(pickedId)) return;

  if (pickedId === correctId) {
    handleCorrect(opt);
  } else {
    handleWrong(opt, pickedId);
  }
}

function handleWrong(opt, pickedId) {
  // score
  score = clamp(score + SETTINGS.scoring.wrong, SETTINGS.scoring.floor, Number.POSITIVE_INFINITY);
  updateScore();

  wrongOptionIds.add(pickedId);

  // mark & disable this option only
  opt.classList.add("is-wrong", "disabled");
}

function handleCorrect(opt) {
  // score
  score = score + SETTINGS.scoring.correct;
  updateScore();

  // mark correct
  opt.classList.add("is-correct");
  answered = true;

  // disable all options
  DOM.opts.forEach(o => o.classList.add("disabled"));

  // show reveal in card
  revealAnswer();

  // flip UI if enabled
  if (SETTINGS.flipOnCorrect) {
    hideQuestionUi();
  }

  // auto next
  if (SETTINGS.autoNext.enabled) {
    autoTimer = setTimeout(nextQuestion, SETTINGS.autoNext.delayMs);
  }
}

// =====================================
// REVEAL
// =====================================

function revealAnswer() {
  if (!DOM.reveal) return;

  const hanzi = currentQuestion?.["GIẢN THỂ"] ?? "";
  const pinyin = currentQuestion?.["PINYIN"] ?? "";
  const vi = currentQuestion?.["VIETNAMESE"] ?? "";
  const vd = currentQuestion?.["VD"] ?? "";

  DOM.reveal.innerHTML = `
    <div class="reveal-card">
      <h3>${escapeHtml(hanzi)}</h3>
      <p><b>Pinyin:</b> ${escapeHtml(pinyin)}</p>
      <p><b>Nghĩa:</b> ${escapeHtml(vi)}</p>
      ${vd ? `<p><b>Ví dụ:</b> ${escapeHtml(vd)}</p>` : ``}
    </div>
  `;
  DOM.reveal.style.display = "block";
}

function clearReveal() {
  if (!DOM.reveal) return;
  DOM.reveal.style.display = "none";
  DOM.reveal.innerHTML = "";
}

// =====================================
// ACTION BUTTONS
// =====================================

function bindActions() {
  if (DOM.btnHint) DOM.btnHint.addEventListener("click", onHint);
  if (DOM.btnSkip) DOM.btnSkip.addEventListener("click", onSkip);
  if (DOM.btnContinue) DOM.btnContinue.addEventListener("click", onContinue);
  if (DOM.btnSpeak) DOM.btnSpeak.addEventListener("click", onSpeak);
}

function onContinue() {
  nextQuestion();
}

function onSkip() {
  nextQuestion();
}

function onHint() {
  if (answered) return;

  // Hide one wrong option (not correct, not disabled, not hidden)
  const candidates = DOM.opts
    .filter(o => o.style.display !== "none")
    .filter(o => o.style.visibility !== "hidden")
    .filter(o => !o.classList.contains("disabled"))
    .filter(o => parseInt(o.dataset.id, 10) !== correctId);

  if (candidates.length === 0) return;

  shuffle(candidates);
  candidates[0].style.visibility = "hidden";
}

function onSpeak() {
  if (!currentQuestion) return;

  const text = currentQuestion["GIẢN THỂ"];
  if (!text) return;

  if (!("speechSynthesis" in window)) return;

  const u = new SpeechSynthesisUtterance(text);
  u.lang = "zh-CN";

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}