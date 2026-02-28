// =====================================
// app.js - Flashcard HSK (ID-based)
//  - Layout tuned for fixed iOS-like card height (via CSS)
//  - Auto-fit text (Duolingo/Quizlet style): shrink font to avoid height growth
//  - Answer compare by record id (ID/id)
// =====================================

// SETTINGS
const SETTINGS = {
  scoring: { correct: 20, wrong: -10, floor: 0 },
  autoNext: { enabled: true, delayMs: 5000 },

  // Types filter (you'll build UI later)
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
// AUTO-FIT TEXT (Duolingo/Quizlet-like)
//  - Ensures fixed-height containers don't grow.
//  - Shrinks font-size until content fits.
// =====================================

function resetInlineFont(el) {
  if (!el) return;
  el.style.fontSize = "";
  el.style.lineHeight = "";
}

function fits(el) {
  if (!el) return true;
  // tolerance 1px for rounding
  return el.scrollHeight <= el.clientHeight + 1;
}

function shrinkToFit(el, minPx, maxSteps = 16) {
  if (!SETTINGS.autoFit.enabled) return;
  if (!el) return;

  // If element has no layout yet, skip.
  const cs = window.getComputedStyle(el);
  let fontPx = parseFloat(cs.fontSize);
  if (!Number.isFinite(fontPx)) return;

  // If already fits, no work.
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

  // Question area: hanzi/pinyin/instruction
  shrinkToFit(DOM.hanzi, SETTINGS.autoFit.min.question, SETTINGS.autoFit.maxSteps);
  shrinkToFit(DOM.pinyin, SETTINGS.autoFit.min.pinyin, SETTINGS.autoFit.maxSteps);
  shrinkToFit(DOM.instruction, SETTINGS.autoFit.min.instruction, SETTINGS.autoFit.maxSteps);

  // Answers labels (each option)
  DOM.opts.forEach(opt => {
    const label = opt?.querySelector?.(".label");
    if (!label) return;
    shrinkToFit(label, SETTINGS.autoFit.min.answer, SETTINGS.autoFit.maxSteps);
  });
}

// Call after DOM changes; using RAF makes it more stable on mobile.
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

  // reset inline font so new content starts at CSS sizes
  resetInlineFont(DOM.hanzi);
  resetInlineFont(DOM.pinyin);
  resetInlineFont(DOM.instruction);
  DOM.opts.forEach(opt => resetInlineFont(opt?.querySelector?.(".label")));

  currentQuestion = randomItem(FILTERED_DATA);
  correctId = currentQuestion.id;

  askType = randomItem(ASK_TYPES);
  answerType = randomItem(ASK_TYPES.filter(t => t !== askType));

  qCount += 1;
  setTitle(`Câu ${qCount}`);

  renderQuestion();
  renderAnswers();
  updateInstruction();

  // reset option state
  DOM.opts.forEach(o => {
    o.classList.remove("disabled", "is-wrong", "is-correct");
    o.style.visibility = "visible";
    o.style.display = "";
  });

  // enforce fixed-height look: fit content into existing boxes
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

  // 1) from filtered
  const pool1 = FILTERED_DATA.filter(it => it.id !== correctId);
  shuffle(pool1);
  for (const it of pool1) {
    if (picks.length >= need) break;
    if (used.has(it.id)) continue;
    picks.push(it);
    used.add(it.id);
  }

  // 2) fallback from all data
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
//  - Wrong: -10 each time, mark red, lock only that option
//  - Correct: +20, mark green, lock all options, reveal in card,
//             auto next after delay (Continue button still works)
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

  // keep fixed height: label might wrap after class changes
  scheduleAutoFit();
}

function handleCorrect(opt) {
  score = score + SETTINGS.scoring.correct;
  updateScore();

  opt.classList.add("is-correct");
  answered = true;

  // lock all
  DOM.opts.forEach(o => o.classList.add("disabled"));

  // reveal in card
  revealAnswer();

  // flip: hide question lines so reveal gets full space (Duolingo-like)
  if (SETTINGS.flipOnCorrect) {
    hideQuestionUi();
  }

  scheduleAutoFit();

  if (SETTINGS.autoNext.enabled) {
    autoTimer = setTimeout(nextQuestion, SETTINGS.autoNext.delayMs);
  }
}

// =====================================
// REVEAL
//  - Render compact structure to fit fixed height
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

  // ✅ dùng class để hiện overlay (không dùng style.display)
  DOM.reveal.classList.add("is-visible");

  // Fit reveal content too
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

  // ✅ tắt overlay bằng class
  DOM.reveal.classList.remove("is-visible");
  DOM.reveal.innerHTML = "";
}

// =====================================
// ACTION BUTTONS
//  - Hint: hide one wrong option (not correct, not disabled, not hidden)
//  - Skip: go next (no penalty for now)
//  - Continue: go next immediately
//  - Speak: speechSynthesis on simplified text
// =====================================

function bindActions() {
  if (DOM.btnHint) DOM.btnHint.addEventListener("click", onHint);
  if (DOM.btnSkip) DOM.btnSkip.addEventListener("click", onSkip);
  if (DOM.btnContinue) DOM.btnContinue.addEventListener("click", onContinue);
  if (DOM.btnSpeak) DOM.btnSpeak.addEventListener("click", onSpeak);

  // Keep the fixed-height fit stable on rotate / resize (vh-based layout)
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
