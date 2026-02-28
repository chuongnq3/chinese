// =====================================
// app.js - Flashcard HSK (ID-based)
//  - Fixed-height iOS-like card (CSS)
//  - Auto-fit text (shrink to fit)
//  - Answer compare by record id (ID/id)
//  - ✅ Reads user settings from localStorage (setting.html)
// =====================================

// ===============================
// SETTINGS (DEFAULT)
// ===============================
const SETTINGS = {
  scoring: { correct: 20, wrong: -10, floor: 0 },
  autoNext: { enabled: true, delayMs: 5000 },

  // Types filter (wired to settings page via localStorage)
  defaultTypes: ["HSK1"],
  answersCount: 4,

  // UI behavior
  flipOnCorrect: true,                 // đúng -> ẩn câu hỏi, show result trong card
  showPinyinWhenAskNotPinyin: false,   // mặc định không show pinyin phụ đề

  // Auto-fit text (shrink to fit fixed heights)
  autoFit: {
    enabled: true,

    // min font sizes (px) to stop shrinking
    min: {
      question: 22,   // hanzi / question line min
      pinyin: 12,
      instruction: 11,
      answer: 12
    },

    // max shrink steps (avoid infinite loops)
    maxSteps: 22
  }
};

// localStorage key shared with setting.html
const SETTINGS_STORAGE_KEY = "FC_SETTINGS_V1";

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
  btnSpeak: null,

  hanziBox: null
};

// =====================================
// INIT
// =====================================
document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheDom();
  bindActions();
  bindOptionClicks();

  // ✅ Apply saved settings BEFORE loading data / starting questions
  applySavedUserSettings();

  const raw = await loadJson(DATA_URL);
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

  DOM.hanziBox = DOM.hanzi?.closest(".hanzi-box") || null;
}

async function loadJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return await res.json();
}

// Normalize: support ID / id, trim TYPE, coerce id to Number
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
// USER SETTINGS (from setting.html)
// =====================================

function tryJsonParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function sanitizeTypes(arr) {
  const out = (Array.isArray(arr) ? arr : [])
    .map(x => String(x ?? "").trim())
    .filter(Boolean);

  // guard: must keep at least 1 type
  return out.length ? out : SETTINGS.defaultTypes.slice();
}

function applySavedUserSettings() {
  const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!raw) return;

  const saved = tryJsonParse(raw);
  if (!saved || typeof saved !== "object") return;

  // expected payload (from setting.html):
  // {
  //   autoNext: boolean,
  //   autoNextDelay: number (seconds),
  //   flipOnCorrect: boolean,
  //   defaultTypes: string[]
  // }

  if (typeof saved.autoNext === "boolean") {
    SETTINGS.autoNext.enabled = saved.autoNext;
  }

  if (saved.autoNextDelay != null) {
    const sec = Number(saved.autoNextDelay);
    if (Number.isFinite(sec)) {
      const secClamped = clamp(sec, 1, 30);
      SETTINGS.autoNext.delayMs = Math.round(secClamped * 1000);
    }
  }

  if (typeof saved.flipOnCorrect === "boolean") {
    SETTINGS.flipOnCorrect = saved.flipOnCorrect;
  }

  if (saved.defaultTypes != null) {
    SETTINGS.defaultTypes = sanitizeTypes(saved.defaultTypes);
  }
}

// =====================================
// FILTER
// =====================================

function applyTypeFilter(typeArray) {
  const types = (typeArray || []).map(x => String(x).trim()).filter(Boolean);
  FILTERED_DATA = DATA.filter(item => types.includes(item.TYPE));

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
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
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
// AUTO-FIT TEXT (Duolingo/Quizlet-like)
// =====================================

function resetInlineFont(el) {
  if (!el) return;
  el.style.fontSize = "";
  el.style.lineHeight = "";
}

function fits(el) {
  if (!el) return true;
  return el.scrollHeight <= el.clientHeight + 1;
}

function shrinkToFit(el, minPx, maxSteps = 16) {
  if (!SETTINGS.autoFit.enabled) return;
  if (!el) return;

  const cs = window.getComputedStyle(el);
  let fontPx = parseFloat(cs.fontSize);
  if (!Number.isFinite(fontPx)) return;

  if (fits(el)) return;

  let steps = 0;
  while (!fits(el) && fontPx > minPx && steps < maxSteps) {
    fontPx -= 1;
    el.style.fontSize = `${fontPx}px`;
    steps += 1;
  }
}

function autoFitAll() {
  if (!SETTINGS.autoFit.enabled) return;

  shrinkToFit(DOM.hanzi, SETTINGS.autoFit.min.question, SETTINGS.autoFit.maxSteps);
  shrinkToFit(DOM.pinyin, SETTINGS.autoFit.min.pinyin, SETTINGS.autoFit.maxSteps);
  shrinkToFit(DOM.instruction, SETTINGS.autoFit.min.instruction, SETTINGS.autoFit.maxSteps);

  DOM.opts.forEach(opt => {
    const label = opt?.querySelector?.(".label");
    if (!label) return;
    shrinkToFit(label, SETTINGS.autoFit.min.answer, SETTINGS.autoFit.maxSteps);
  });
}

function scheduleAutoFit() {
  if (!SETTINGS.autoFit.enabled) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      autoFitAll();
    });
  });
}

// =====================================
// QUESTION ENGINE
// =====================================

function nextQuestion() {
  clearTimeout(autoTimer);

  answered = false;
  wrongOptionIds.clear();

  clearReveal();
  showQuestionUi();

  resetInlineFont(DOM.hanzi);
  resetInlineFont(DOM.pinyin);
  resetInlineFont(DOM.instruction);
  DOM.opts.forEach(opt => resetInlineFont(opt?.querySelector?.(".label")));

  // Safety: ensure filter uses current setting (if user changed and came back)
  applyTypeFilter(SETTINGS.defaultTypes);

  currentQuestion = randomItem(FILTERED_DATA);
  correctId = currentQuestion.id;

  askType = randomItem(ASK_TYPES);
  answerType = randomItem(ASK_TYPES.filter(t => t !== askType));

  qCount += 1;
  setTitle(`Câu ${qCount}`);

  renderQuestion();
  renderAnswers();
  updateInstruction();

  DOM.opts.forEach(o => {
    o.classList.remove("disabled", "is-wrong", "is-correct");
    o.style.visibility = "visible";
    o.style.display = "";
  });

  scheduleAutoFit();
}

function renderQuestion() {
  if (!currentQuestion) return;

  if (DOM.hanzi) {
    DOM.hanzi.textContent = currentQuestion?.[askType] ?? "";
  }

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

  picks.push(currentQuestion);
  used.add(correctId);

  const pool1 = FILTERED_DATA.filter(it => it.id !== correctId);
  shuffle(pool1);
  for (const it of pool1) {
    if (picks.length >= need) break;
    if (used.has(it.id)) continue;
    picks.push(it);
    used.add(it.id);
  }

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
  score = clamp(score + SETTINGS.scoring.wrong, SETTINGS.scoring.floor, Number.POSITIVE_INFINITY);
  updateScore();

  wrongOptionIds.add(pickedId);
  opt.classList.add("is-wrong", "disabled");

  scheduleAutoFit();
}

function handleCorrect(opt) {
  score = score + SETTINGS.scoring.correct;
  updateScore();

  opt.classList.add("is-correct");
  answered = true;

  DOM.opts.forEach(o => o.classList.add("disabled"));

  revealAnswer();

  if (SETTINGS.flipOnCorrect) {
    hideQuestionUi();
  }

  scheduleAutoFit();

  // ✅ apply autoNext settings chosen by user
  if (SETTINGS.autoNext.enabled) {
    clearTimeout(autoTimer);
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

  if (DOM.hanziBox) DOM.hanziBox.classList.add("is-reveal");

  DOM.reveal.innerHTML = `
    <div class="reveal-card">
      <div class="reveal-hanzi">${escapeHtml(hanzi)}</div>
      <div class="reveal-row"><b>Pinyin:</b> <span>${escapeHtml(pinyin)}</span></div>
      <div class="reveal-row"><b>Nghĩa:</b> <span>${escapeHtml(vi)}</span></div>
      ${vd ? `<div class="reveal-row"><b>Ví dụ:</b> <span>${escapeHtml(vd)}</span></div>` : ``}
    </div>
  `;

  DOM.reveal.classList.add("is-visible");

  const revealHanzi = DOM.reveal.querySelector(".reveal-hanzi");
  if (revealHanzi) {
    resetInlineFont(revealHanzi);
    shrinkToFit(revealHanzi, 18, SETTINGS.autoFit.maxSteps);
  }

  const rows = Array.from(DOM.reveal.querySelectorAll(".reveal-row"));
  rows.forEach(row => {
    resetInlineFont(row);
    shrinkToFit(row, 11, SETTINGS.autoFit.maxSteps);
  });

  scheduleAutoFit();
}

function clearReveal() {
  if (!DOM.reveal) return;

  if (DOM.hanziBox) DOM.hanziBox.classList.remove("is-reveal");
  DOM.reveal.classList.remove("is-visible");
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

  window.addEventListener("resize", () => scheduleAutoFit(), { passive: true });
}

function onContinue() {
  nextQuestion();
}

function onSkip() {
  nextQuestion();
}

function onHint() {
  if (answered) return;

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
