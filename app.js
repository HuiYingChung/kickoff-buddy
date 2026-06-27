/* ═══════════════════════════════════════════════════════════════
   KICKOFF BUDDY — app.js
   AI-powered World Cup companion for first-time fans.
   IBM June Challenge

   AI Collaboration:
   1. Brainstorm        → ChatGPT
   2. Architect & Build → IBM Bob (bob.ibm.com)
   3. Review, Debug,
      Refine, API,
      Security          → Claude Code

   APIs:
   • football-data.org  — live World Cup match data
   • OpenAI GPT-4o      — all AI explanations (via /api/ai proxy)

   Architecture:
   ┌──────────────────────────────────────────────────────┐
   │  UI functions  →  getAIResponse()                    │
   │                       │                              │
   │              USE_MOCK_AI?                            │
   │              ┌────────┴────────┐                    │
   │            true              false                   │
   │              │                  │                    │
   │        mockResponses       callOpenAI()              │
   │              │            (/api/ai proxy)            │
   │              └────────┬────────┘                    │
   │                  renderOutput()                      │
   └──────────────────────────────────────────────────────┘
═══════════════════════════════════════════════════════════════ */

"use strict";

/* ─────────────────────────────────────────────────────────────
   CONFIGURATION
───────────────────────────────────────────────────────────── */
const USE_MOCK_AI = false;

// API keys are kept server-side in proxy.js — do not add them here

/* ─────────────────────────────────────────────────────────────
   LIVE MATCH DATA — football-data.org API
───────────────────────────────────────────────────────────── */
let liveMatches = {};

async function fetchLiveMatches() {
  const res = await fetch('/api/matches');
  if (!res.ok) throw new Error(`Match data unavailable (${res.status})`);
  const json = await res.json();
  return json.matches || [];
}

function matchToData(m) {
  const home = m.homeTeam?.name || "TBD";
  const away = m.awayTeam?.name || "TBD";
  const dateStr = m.utcDate
    ? new Date(m.utcDate).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      })
    : "";
  const stageMap = {
    GROUP_STAGE: "Group Stage",
    ROUND_OF_16: "Round of 16",
    QUARTER_FINALS: "Quarter-Final",
    SEMI_FINALS: "Semi-Final",
    THIRD_PLACE: "Third Place",
    FINAL: "Final",
  };
  const isLive =
    m.status === "LIVE" || m.status === "IN_PLAY" || m.status === "PAUSED";
  const isFinished = m.status === "FINISHED";
  const scoreHome = m.score?.fullTime?.home;
  const scoreAway = m.score?.fullTime?.away;
  const htHome    = m.score?.halfTime?.home;
  const htAway    = m.score?.halfTime?.away;
  const hasScore  = (isLive || isFinished) && scoreHome != null;
  const hasHT     = htHome != null;
  return {
    id:           String(m.id),
    label:        `${home} vs ${away}`,
    stage:        stageMap[m.stage] || m.stage || "Group Stage",
    date:         dateStr,
    status:       m.status || "SCHEDULED",
    teamA:        home,
    teamB:        away,
    scoreA:       scoreHome ?? null,
    scoreB:       scoreAway ?? null,
    scoreDisplay: hasScore ? `${scoreHome}–${scoreAway}` : null,
    htDisplay:    hasHT ? `${htHome}–${htAway}` : null,
    isLive,
    isFinished,
    officialReminder: "Check fifa.com for official match information.",
  };
}

async function populateMatchDropdown() {
  const select = document.getElementById("match");
  if (!select) return;
  select.innerHTML = '<option value="">Loading live matches…</option>';
  try {
    const matches = await fetchLiveMatches();
    matches.sort((a, b) => new Date(a.date) - new Date(b.date));
    select.innerHTML = "";
    matches.forEach((m) => {
      const data = matchToData(m);
      liveMatches[data.id] = data;
      const opt = document.createElement("option");
      opt.value = data.id;
      const scoreLabel = data.scoreDisplay ? ` · ${data.scoreDisplay}` : "";
      const liveLabel = data.isLive ? " · LIVE" : "";
      opt.textContent = `${data.label} — ${data.stage} · ${data.date}${scoreLabel}${liveLabel}`;
      select.appendChild(opt);
    });
    if (matches.length === 0) {
      select.innerHTML = '<option value="">No matches found</option>';
    }
  } catch (e) {
    console.error("Match fetch failed:", e);
    select.innerHTML = '<option value="">Could not load matches</option>';
  }
}

/* ─────────────────────────────────────────────────────────────
   OPENAI INTEGRATION
───────────────────────────────────────────────────────────── */
async function callOpenAI(prompt) {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 900,
      temperature: 0.7,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`OpenAI: ${data.error.message}`);
  return data.choices[0].message.content;
}

/* ─────────────────────────────────────────────────────────────
   PROMPT BUILDER
   Constructs a structured prompt for OpenAI GPT-4o.
───────────────────────────────────────────────────────────── */
function buildPrompt(userContext, matchData, taskType, userQuestion) {
  const knowledgeMap = {
    none: "I know nothing about soccer",
    beginner: "I am a beginner",
    casual: "I am a casual fan",
  };
  const momentMap = {
    before: "before the match",
    during: "during the match",
    after: "after the match",
  };
  const contextMap = {
    home: "watching at home",
    bar: "watching at a bar or watch party",
    stadium: "attending the stadium in person",
    unsure: "not sure yet",
  };

  const scoreInfo = matchData.scoreDisplay
    ? `${matchData.teamA} ${matchData.scoreDisplay} ${matchData.teamB}`
    : "Not yet played";
  const statusInfo = matchData.isLive
    ? "LIVE now"
    : matchData.isFinished
      ? "Final result"
      : "Upcoming";

  return `
You are Kickoff Buddy, a warm, patient, beginner-friendly AI soccer companion.

USER PROFILE:
- Soccer knowledge: ${knowledgeMap[userContext.knowledge] || userContext.knowledge}
- Viewing moment: ${momentMap[userContext.moment] || userContext.moment}
- Viewing context: ${contextMap[userContext.viewContext] || userContext.viewContext}
- Main goal: ${userContext.goal}

MATCH: ${matchData.label} (${matchData.stage}, ${matchData.date})
- Status: ${statusInfo}
- Score: ${scoreInfo}

TASK TYPE: ${taskType}
USER QUESTION / INPUT: ${userQuestion || "None"}

INSTRUCTIONS:
1. Answer in very simple, warm, beginner-friendly language. No jargon without explanation.
2. Structure your response clearly with these sections where relevant:
   - Simple explanation
   - Why it matters
   - What to watch next
   - Beginner-friendly analogy (if helpful)
   - Confidence / official source note (if needed)
3. If you are uncertain about a specific real-world fact, say so clearly.
4. Never claim to know live scores, real-time events, or specific official decisions unless provided.
5. Do not predict match results. Do not replace referees or coaches.
6. When venue, ticketing, transit, or stadium policy details are asked about, remind the user to check official FIFA, venue, or ticketing sources.
7. Make the user feel welcome and confident, not embarrassed.

Respond now:`.trim();
}

/* ─────────────────────────────────────────────────────────────
   CENTRAL AI RESPONSE HANDLER
   All feature functions call this — not mock responses directly.
───────────────────────────────────────────────────────────── */
async function getAIResponse(taskType, userContext, matchData, userQuestion) {
  const prompt = buildPrompt(userContext, matchData, taskType, userQuestion);

  if (USE_MOCK_AI) {
    await delay(900 + Math.random() * 600);
    return getMockResponse(taskType, userContext, matchData, userQuestion);
  }

  const text = await callOpenAI(prompt);
  return aiTextToCard(text, matchData, userContext, taskType);
}

function aiTextToCard(text, matchData, userContext, taskType) {
  const labels = {
    guide: "Match Guide",
    ask: "Live Explainer",
    decision: "Decision Explainer",
    momentum: "Momentum Explainer",
    teams: "Team Finder",
    matchday: "Matchday Guide",
  };
  const html = escapeHTML(text)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/^#{1,3} (.+)$/gm, '<h4 class="result-section__title">$1</h4>')
    .replace(/\n\n+/g, "</p><p>")
    .replace(/^/, "<p>")
    .replace(/$/, "</p>");
  const body = `<div class="result-section"><div class="result-section__text">${html}</div></div>`;
  return ticketCard(
    matchData,
    userContext,
    labels[taskType] || "AI Response",
    body,
  );
}

/* ─────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────── */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getUserContext() {
  return {
    knowledge: document.getElementById("knowledge")?.value || "none",
    moment: document.getElementById("moment")?.value || "before",
    viewContext: document.getElementById("viewcontext")?.value || "home",
    goal: document.getElementById("goal")?.value || "understand_match",
  };
}

function getMatchData() {
  const matchId = document.getElementById("match")?.value;
  return (
    liveMatches[matchId] ||
    Object.values(liveMatches)[0] || {
      label: "Match",
      stage: "",
      date: "",
      teamA: "Home",
      teamB: "Away",
      officialReminder: "Check fifa.com for official match information.",
    }
  );
}

function showLoading(outputId, message = "Thinking…") {
  const el = document.getElementById(outputId);
  if (!el) return;
  el.classList.remove("hidden");
  el.innerHTML = `
    <div class="loading-card">
      <div class="loading-dots">
        <div class="loading-dots__dot"></div>
        <div class="loading-dots__dot"></div>
        <div class="loading-dots__dot"></div>
      </div>
      <p class="loading-text">${message}</p>
    </div>`;
}

function renderOutput(outputId, html) {
  const el = document.getElementById(outputId);
  if (!el) return;
  el.classList.remove("hidden");
  el.innerHTML = html;
}

function scrollToOutput(outputId) {
  const el = document.getElementById(outputId);
  if (el) setTimeout(() => scrollToEl(el), 100);
}

/* Build a scoreboard status bar for result cards */
function statusBar(items) {
  return items
    .map(
      ([label, value, cls]) =>
        `<div class="stub-field">
      <div class="result-card__stub-item">${label}</div>
      <div class="result-card__stub-value ${cls || ""}">${value}</div>
    </div>`,
    )
    .join("");
}

/* Wrap a result in the match-ticket card chrome */
function ticketCard(matchData, userContext, subtitle, bodyHTML) {
  const momentLabel = {
    before: "Before match",
    during: "During match",
    after: "After match",
  };
  const levelLabel = {
    none: "First-timer",
    beginner: "Beginner",
    casual: "Casual fan",
  };

  const statusLabel = matchData.isLive
    ? '<span class="score-status score-status--live">LIVE</span>'
    : matchData.isFinished
      ? '<span class="score-status">FINAL</span>'
      : '<span class="score-status score-status--upcoming">UPCOMING</span>';

  const scoreBlock = matchData.scoreDisplay ? `
    <div class="result-card__scoreboard">
      <div class="result-card__score-team">${matchData.teamA}</div>
      <div class="result-card__score-nums">
        <span class="result-card__score-num">${matchData.scoreA}</span>
        <span class="result-card__score-sep">–</span>
        <span class="result-card__score-num">${matchData.scoreB}</span>
      </div>
      <div class="result-card__score-team">${matchData.teamB}</div>
    </div>
    <div class="result-card__score-meta">
      ${statusLabel}
      ${matchData.htDisplay ? `<span class="score-ht">HT ${matchData.htDisplay}</span>` : ''}
    </div>` : `<div class="result-card__score-meta" style="margin-top:8px">${statusLabel}</div>`;

  return `
  <div class="result-card">
    <div class="result-card__ticket-header">
      <div class="result-card__ticket-main">
        <div class="result-card__title">${subtitle}</div>
        ${scoreBlock}
      </div>
      <div class="result-card__ticket-stub">
        ${statusBar([
          ["Stage", matchData.stage, ""],
          ["Mode", momentLabel[userContext.moment] || "", ""],
          ["Level", levelLabel[userContext.knowledge] || "", ""],
          ["AI", "GPT-4o", "stub-ai"],
        ])}
      </div>
    </div>
    <div class="result-card__body">${bodyHTML}</div>
  </div>`;
}

/* Build a simple result section block */
function rs(eyebrow, title, content) {
  return `
  <div class="result-section">
    <div class="result-section__eyebrow">${eyebrow}</div>
    <div class="result-section__title">${title}</div>
    <div class="result-section__text">${content}</div>
  </div>`;
}

/* Build a numbered watch list */
function watchList(items) {
  const rows = items
    .map(
      (item, i) => `
    <li class="watch-list__item">
      <div class="watch-list__num">${i + 1}</div>
      <div>
        <div class="watch-list__heading">${item.heading}</div>
        <div class="watch-list__desc">${item.desc}</div>
      </div>
    </li>`,
    )
    .join("");
  return `<ul class="watch-list">${rows}</ul>`;
}

/* Build a team recommendation card */
function teamCard(name, text) {
  return `<div class="team-card"><div class="team-card__name">${name}</div><div class="team-card__text">${text}</div></div>`;
}

/* Build an interactive checklist item */
function checklistItem(icon, heading, detail, id) {
  return `
  <div class="checklist__item" onclick="toggleCheck(this)" id="${id}">
    <div class="checklist__checkbox">
      <svg class="icon icon--xs checklist__checkbox-tick" aria-hidden="true">
        <use href="#icon-check"/>
      </svg>
    </div>
    <div class="checklist__icon">
      <svg class="icon icon--sm" aria-hidden="true"><use href="#icon-${icon}"/></svg>
    </div>
    <div class="checklist__content">
      <div class="checklist__heading">${heading}</div>
      <div class="checklist__detail">${detail}</div>
    </div>
  </div>`;
}

/* Notice box */
function noticeBox(text, type = "") {
  return `
  <div class="notice-box ${type ? "notice-box--" + type : ""}">
    <div class="notice-box__icon">
      <svg class="icon icon--sm" aria-hidden="true"><use href="#icon-source"/></svg>
    </div>
    <p class="notice-box__text">${text}</p>
  </div>`;
}

/* ─────────────────────────────────────────────────────────────
   TAB SYSTEM
───────────────────────────────────────────────────────────── */

/* Activate a tab without scrolling (used on init and from mobile menu) */
function activateTab(tabId) {
  document.querySelectorAll("section[data-tab]").forEach((s) => {
    s.classList.toggle("tab-active", s.dataset.tab === tabId);
  });
  document.querySelectorAll(".snav__tab").forEach((btn) => {
    const active = btn.dataset.tab === tabId;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active);
  });
  document.querySelectorAll(".snav__mobile-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
  document.querySelectorAll(".bottom-nav__btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
}

/* Scroll to an element, offsetting by the sticky nav so it's not obscured */
function scrollToEl(el) {
  if (!el) return;
  const nav = document.querySelector(".section-nav");
  const navHeight = nav ? nav.offsetHeight : 0;
  const top = el.getBoundingClientRect().top + window.scrollY - navHeight;
  window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

/* Switch tab and scroll to the first visible section (desktop tabs + mobile buttons) */
function switchTab(tabId) {
  closeNav();
  activateTab(tabId);
  const firstSection = document.querySelector(`section[data-tab="${tabId}"]`);
  scrollToEl(firstSection);
}

/* Navigate from hero CTAs: switch tab then scroll to a specific section */
function goToSection(tabId, sectionId) {
  activateTab(tabId);
  // rAF ensures the section is visible (display:block) before we measure its position
  requestAnimationFrame(() => scrollToEl(document.getElementById(sectionId)));
}

/* ─────────────────────────────────────────────────────────────
   NAV — HAMBURGER TOGGLE
───────────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.getElementById("snav-toggle");
  const nav = document.getElementById("section-nav");
  const menu = document.getElementById("snav-menu");

  if (toggle) {
    toggle.addEventListener("click", () => {
      const isOpen = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", isOpen);
      menu.setAttribute("aria-hidden", !isOpen);
    });
  }

  // Close nav when clicking outside
  document.addEventListener("click", (e) => {
    if (nav && !nav.contains(e.target)) closeNav();
  });

  // Initialise the first tab
  activateTab("before");
  // Load live World Cup matches from BALLDONTLIE API
  populateMatchDropdown();
});

function closeNav() {
  const nav = document.getElementById("section-nav");
  const toggle = document.getElementById("snav-toggle");
  const menu = document.getElementById("snav-menu");
  if (nav) nav.classList.remove("is-open");
  if (toggle) toggle.setAttribute("aria-expanded", "false");
  if (menu) menu.setAttribute("aria-hidden", "true");
}

/* ─────────────────────────────────────────────────────────────
   UI INTERACTION HELPERS
───────────────────────────────────────────────────────────── */

/* Single-select chip groups */
function selectChip(groupId, btn) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group
    .querySelectorAll(".chip-btn--select")
    .forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
}

/* Multi-select chip toggle */
function toggleMulti(btn) {
  btn.classList.toggle("selected");
}

/* Fill a textarea from a quick-button.
   targetId maps a logical name to the actual element id. */
function quickFill(targetId, text) {
  const idMap = { ask: "user-question", momentum: "momentum-input" };
  const el = document.getElementById(idMap[targetId] || targetId);
  if (el) {
    el.value = text;
    el.focus();
  }
}

/* Momentum meter shift */
function shiftMomentum(btn, pctA, description) {
  // Clamp to a valid percentage
  pctA = Math.max(0, Math.min(100, Number(pctA) || 50));
  const pctB = 100 - pctA;

  // Update chip selection
  const group = document.getElementById("momentum-chips");
  if (group)
    group
      .querySelectorAll(".chip-btn--select")
      .forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");

  // Update the meter
  const fillA = document.getElementById("momentum-fill-a");
  const fillB = document.getElementById("momentum-fill-b");
  const labelA = document.getElementById("momentum-pct-a");
  const labelB = document.getElementById("momentum-pct-b");
  const desc = document.getElementById("momentum-desc");

  if (fillA) fillA.style.width = pctA + "%";
  if (fillB) fillB.style.width = pctB + "%";
  if (labelA) labelA.textContent = pctA + "%";
  if (labelB) labelB.textContent = pctB + "%";
  if (desc) desc.textContent = description;
}

/* Checklist item toggle */
function toggleCheck(item) {
  item.classList.toggle("checked");
}

/* ─────────────────────────────────────────────────────────────
   FEATURE 1 — GENERATE MY MATCH GUIDE
───────────────────────────────────────────────────────────── */
async function generateGuide() {
  const userContext = getUserContext();
  const matchData = getMatchData();
  const outputId = "guide-output";

  showLoading(outputId, "Building your match guide…");
  scrollToOutput(outputId);

  try {
    renderOutput(
      outputId,
      await getAIResponse("guide", userContext, matchData, null),
    );
  } catch (e) {
    renderOutput(outputId, errorCard(e.message));
  }
}

/* ─────────────────────────────────────────────────────────────
   FEATURE 2 — ASK WHAT JUST HAPPENED
───────────────────────────────────────────────────────────── */
async function askWhatHappened() {
  const questionEl = document.getElementById("user-question");
  const question = questionEl?.value?.trim();
  if (!question) {
    questionEl?.focus();
    return;
  }

  const userContext = getUserContext();
  const matchData = getMatchData();
  const outputId = "ask-output";

  showLoading(outputId, "Looking that up for you…");
  scrollToOutput(outputId);

  try {
    renderOutput(
      outputId,
      await getAIResponse("ask", userContext, matchData, question),
    );
  } catch (e) {
    renderOutput(outputId, errorCard(e.message));
  }
}

/* ─────────────────────────────────────────────────────────────
   FEATURE 3 — DECISION EXPLAINER
───────────────────────────────────────────────────────────── */
async function explainDecision() {
  const selected = document.querySelector(
    "#decision-chips .chip-btn--select.selected",
  );
  const decision = selected?.dataset.value || "offside";

  const userContext = getUserContext();
  const matchData = getMatchData();
  const outputId = "decision-output";

  showLoading(outputId, "Explaining the decision…");
  scrollToOutput(outputId);

  try {
    renderOutput(
      outputId,
      await getAIResponse("decision", userContext, matchData, decision),
    );
  } catch (e) {
    renderOutput(outputId, errorCard(e.message));
  }
}

/* ─────────────────────────────────────────────────────────────
   FEATURE 4 — MOMENTUM & TACTICS
───────────────────────────────────────────────────────────── */
async function explainMomentum() {
  const situation =
    document.getElementById("momentum-input")?.value?.trim() ||
    "The match momentum has shifted.";

  const userContext = getUserContext();
  const matchData = getMatchData();
  const outputId = "momentum-output";

  showLoading(outputId, "Analysing the shift…");
  scrollToOutput(outputId);

  try {
    renderOutput(
      outputId,
      await getAIResponse("momentum", userContext, matchData, situation),
    );
  } catch (e) {
    renderOutput(outputId, errorCard(e.message));
  }
}

/* ─────────────────────────────────────────────────────────────
   FEATURE 5 — RECOMMEND TEAMS
───────────────────────────────────────────────────────────── */
async function recommendTeams() {
  const selected = [
    ...document.querySelectorAll("#team-prefs .chip-btn--multi.selected"),
  ].map((b) => b.dataset.value);
  const prefs = selected.length
    ? selected.join(", ")
    : "no specific preference";

  const userContext = getUserContext();
  const matchData = getMatchData();
  const outputId = "team-output";

  showLoading(outputId, "Finding your team…");
  scrollToOutput(outputId);

  try {
    renderOutput(
      outputId,
      await getAIResponse("teams", userContext, matchData, prefs),
    );
  } catch (e) {
    renderOutput(outputId, errorCard(e.message));
  }
}

/* ─────────────────────────────────────────────────────────────
   FEATURE 6 — MATCHDAY CHECKLIST
───────────────────────────────────────────────────────────── */
async function buildMatchdayChecklist() {
  const selected = document.querySelector(
    "#matchday-chips .chip-btn--select.selected",
  );
  const venue = selected?.dataset.value || "home";

  const userContext = { ...getUserContext(), viewContext: venue };
  const matchData = getMatchData();
  const outputId = "matchday-output";

  showLoading(outputId, "Building your checklist…");
  scrollToOutput(outputId);

  const venueLabel = {
    home: "home viewing",
    bar: "bar / watch party",
    stadium: "stadium",
  };
  const question = `Matchday checklist for: ${venueLabel[venue] || venue}`;

  try {
    renderOutput(
      outputId,
      await getAIResponse("matchday", userContext, matchData, question),
    );
  } catch (e) {
    renderOutput(outputId, errorCard(e.message));
  }
}

/* ─────────────────────────────────────────────────────────────
   ERROR CARD
───────────────────────────────────────────────────────────── */
/* Escape a string so it is safe to insert as HTML text content */
function escapeHTML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function errorCard(message) {
  return `
  <div class="result-card">
    <div class="result-card__ticket-header" style="background:#7a1a1a;">
      <div class="result-card__ticket-main">
        <div class="result-card__title">Something went wrong</div>
        <div class="result-card__match">Could not load AI response</div>
      </div>
    </div>
    <div class="result-card__body">
      <p style="color:var(--ref-red);font-size:0.88rem;">${escapeHTML(message)}</p>
      ${noticeBox("Please try again. If this keeps happening, check the browser console for details.", "info")}
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   MOCK RESPONSES
   Realistic, polished outputs used when USE_MOCK_AI = true.
   Set USE_MOCK_AI = false to use live OpenAI GPT-4o responses.
═══════════════════════════════════════════════════════════════ */
function getMockResponse(taskType, userContext, matchData, userQuestion) {
  switch (taskType) {
    case "guide":
      return mockGuide(userContext, matchData);
    case "ask":
      return mockAsk(userContext, matchData, userQuestion);
    case "decision":
      return mockDecision(userContext, matchData, userQuestion);
    case "momentum":
      return mockMomentum(userContext, matchData, userQuestion);
    case "teams":
      return mockTeams(userContext, userQuestion);
    case "matchday":
      return mockMatchday(userContext, matchData);
    default:
      return mockGuide(userContext, matchData);
  }
}

/* ── MOCK: MATCH GUIDE ──────────────────────────────────────── */
function mockGuide(userContext, matchData) {
  const body = `
    ${rs(
      "Simple Summary",
      `What is ${matchData.label} about?`,
      `<p>${matchData.beginnerAngle}</p>
       <p>This is a ${matchData.stage} match on ${matchData.date}. Both teams are trying to win — or at least not lose — to improve their chances of advancing in the tournament.</p>`,
    )}
    ${rs(
      "The Teams",
      `Who are you watching?`,
      `<p><strong>${matchData.teamA}:</strong> ${matchData.teamAStory}</p>
       <p><strong>${matchData.teamB}:</strong> ${matchData.teamBStory}</p>`,
    )}
    ${rs(
      "Styles",
      `How will they play?`,
      `<p>${matchData.styleContrast}</p>
       <p>Think of it like two different conversations — one team wants to keep talking slowly and carefully, the other wants to say one sharp thing and stop.</p>`,
    )}
    ${rs(
      "3 Things to Watch",
      "Focus on these",
      watchList([
        {
          heading: "Who controls the ball",
          desc: "The team that keeps possession longer usually feels more confident. Watch if one side seems to always be chasing.",
        },
        {
          heading: "How close the defending is",
          desc: "If defenders are right on attackers immediately, that's called pressing. If they drop back deep, they're sitting in a defensive block.",
        },
        {
          heading: "Reactions after goals",
          desc: "The moment a goal goes in tells you everything about momentum. Watch how both sets of players — and fans — respond.",
        },
      ]),
    )}
    ${rs(
      "Rules You May Need",
      "Quick guide",
      `<p><strong>Offside:</strong> An attacker cannot be further up the pitch than the last defender when the ball is played to them. It sounds complicated — see the Offside section on this page for a visual.</p>
       <p><strong>Yellow card:</strong> A warning for a foul or bad behaviour. Two yellows = automatic red card and the player is sent off.</p>
       <p><strong>Added time:</strong> The referee adds minutes at the end of each half for stoppages. This is why the game goes past 45 or 90 minutes.</p>`,
    )}
    ${rs(
      "Fan Culture",
      "How to participate",
      `<p>${matchData.culturalAngle}</p>
       <p>Clap when your team does something good. Groan when they give the ball away. Celebrate goals. Ask whoever you\'re with to explain things. There are no stupid questions.</p>`,
    )}
    ${rs(
      "Matchday Confidence",
      "You've got this",
      `<p>You don\'t need to know everything to enjoy a World Cup match. The energy, the tension, the moments of brilliance — these are felt, not understood. Trust your instincts.</p>`,
    )}
    ${noticeBox(`<strong>Official reminder:</strong> ${matchData.officialReminder}`, "info")}
  `;
  return ticketCard(matchData, userContext, "First-timer Match Guide", body);
}

/* ── MOCK: ASK WHAT HAPPENED ─────────────────────────────────── */
function mockAsk(userContext, matchData, question) {
  const q = (question || "").toLowerCase();

  let explanation, cause, why, watchNext;

  if (q.includes("offside")) {
    explanation =
      "Offside means an attacking player was in an illegal position when the ball was passed to them. Specifically, they were closer to the goal than the last defender at the moment the pass was made.";
    cause =
      "The player moved too early — they were ahead of the last defender before the ball was kicked.";
    why =
      "It prevents attackers from just standing next to the goalkeeper waiting for the ball. It keeps the game fair and forces teams to build attacks from deeper positions.";
    watchNext =
      "Look for the assistant referee (the official on the sideline) raising their flag. VAR may draw lines on screen to confirm the decision.";
  } else if (
    q.includes("goal canceled") ||
    q.includes("cancelled") ||
    q.includes("disallowed")
  ) {
    explanation =
      "The goal was ruled out — most likely for offside, handball, or a foul in the build-up that the referee or VAR spotted.";
    cause =
      "Either an attacker was in an offside position, a player handled the ball illegally, or a foul was committed that the referee missed live but VAR caught.";
    why =
      "Goals only count if they are scored within the rules. VAR reviews every goal to check these things, even if the celebration has already started.";
    watchNext =
      "Watch the screen in the stadium or the TV graphics — VAR lines will usually appear to show exactly what was checked.";
  } else if (q.includes("var")) {
    explanation =
      "VAR stands for Video Assistant Referee. It's a team of officials watching multiple camera angles in a separate room. When a big decision might have been wrong, they can alert the on-field referee to review it.";
    cause =
      "VAR only gets involved for four types of decisions: goals, penalty kicks, red cards, and cases of mistaken identity.";
    why =
      "It exists to correct clear and obvious errors. It's controversial because it can interrupt the flow of the game and take several minutes.";
    watchNext =
      "When VAR is being reviewed, the referee draws a rectangle with their fingers. Look for the TV icon graphic on screen.";
  } else if (q.includes("yellow")) {
    explanation =
      "A yellow card is a formal warning from the referee. The player's name goes into the referee's book — hence the phrase \"booked.\"";
    cause =
      "Common reasons: a bad tackle, time-wasting, dissent (arguing with the referee), or repeated fouling.";
    why =
      "Two yellow cards in the same match means an automatic red card and the player is sent off. If a player gets yellow cards across multiple matches, they can be suspended for future games.";
    watchNext =
      "Watch how the cautioned player behaves afterwards — they often have to be more careful, which can change how aggressively they play.";
  } else if (q.includes("substitut")) {
    explanation =
      "A substitution means a player is replaced by a teammate. The leaving player walks off; the new player comes on.";
    cause =
      "Coaches substitute to rest tired players, introduce fresh energy, change tactics, or respond to an injury.";
    why =
      "A well-timed substitution can completely change a match. Bringing on a faster, fresher player can unsettle a tiring defence.";
    watchNext =
      "Watch the new player's position and how the team's shape might change. Sometimes a substitution signals a coach is going for a win — or trying to protect a lead.";
  } else if (
    q.includes("90") ||
    q.includes("extra time") ||
    q.includes("injury time") ||
    q.includes("added time")
  ) {
    explanation =
      'A soccer match is 90 minutes, but the clock doesn\'t stop for injuries, substitutions, goal celebrations, or time-wasting. The referee tracks all these delays and adds them at the end — this is called "added time" or "injury time."';
    cause =
      "The fourth official (the official holding up a board on the sideline) shows a minimum number of added minutes. The referee can add even more if new delays happen.";
    why =
      "It ensures the full 90 minutes of actual play happen. In big tournaments, added time can feel like the longest minutes in sports.";
    watchNext =
      "The board held up by the fourth official shows the minimum extra minutes. The referee can always add more.";
  } else if (q.includes("momentum")) {
    explanation =
      "Momentum in soccer is the feeling that one team is in control — creating more chances, pressing higher, and making the other team look nervous.";
    cause =
      "Momentum can shift after a goal, a red card, a great save, a tactical substitution, or even a crowd roar at the right moment.";
    why =
      "Soccer is very psychological. A team that feels the game is going their way plays with more confidence, takes more risks, and often gets rewarded.";
    watchNext =
      "Watch which team is keeping the ball more and which goalkeeper is under pressure. The one doing more defending is usually losing momentum.";
  } else {
    explanation = `Great question. What you saw was likely a significant moment in the match — whether a decision, a tactical shift, or an emotional turning point.`;
    cause =
      "Soccer has many layers — referee decisions, tactical changes, individual moments of skill or error can all cause the match to suddenly feel different.";
    why =
      "Every moment in a close match carries weight. Teams, coaches, and fans are all constantly reading and reacting to what's happening.";
    watchNext =
      "Watch how both teams respond over the next few minutes. How they react to big moments often tells you more than the moment itself.";
  }

  const body = `
    ${rs(
      "Simple Explanation",
      escapeHTML(question) || "What just happened",
      `<p>${explanation}</p>`,
    )}
    ${rs("What may have caused it", "Context", `<p>${cause}</p>`)}
    ${rs("Why it matters", "Significance", `<p>${why}</p>`)}
    ${rs("What to watch next", "Keep an eye on…", `<p>${watchNext}</p>`)}
    ${noticeBox("For official rulings on specific decisions, always refer to the match broadcast, official FIFA communications, or the referee's post-match report.", "info")}
  `;
  return ticketCard(matchData, userContext, "Live Explainer", body);
}

/* ── MOCK: DECISION EXPLAINER ─────────────────────────────────── */
function mockDecision(userContext, matchData, decision) {
  const decisions = {
    offside: {
      title: "Offside",
      what: "The referee has ruled that an attacking player was in an offside position when the ball was played to them. They were closer to the goal than the last outfield defender at that moment.",
      checking:
        "VAR draws precise lines across the player's body and the last defender to check if even a shoulder or armpit is ahead of the line. This is why it takes time.",
      disagree:
        "Fans often disagree because the margins are millimetre-thin and the lines are drawn from an imperfect camera angle. A player can look onside to the naked eye but be fractionally offside by VAR.",
      need: "The exact position of every player at the precise moment the ball was played — which only video review can establish.",
      replay:
        "Watch where the attacker's body is relative to the last defender when the passer's foot contacts the ball — not where they end up.",
      trust:
        "VAR is trying to be accurate, but it operates on a tight margin of error. Reasonable people can disagree with individual calls.",
    },
    handball: {
      title: "Handball",
      what: "The referee has judged that the ball struck a player's hand or arm in a way that the rules consider illegal.",
      checking:
        "Not every hand-ball is a foul. The referee checks: Was the arm in an unnatural position? Did it make the player's body bigger? Was it deliberate? Some handballs directly in front of goal are automatic penalties regardless.",
      disagree:
        'The "natural position" rule is subjective. Fans and pundits often disagree on what counts as arms being in a "natural" position.',
      need: "Slow-motion footage from multiple angles, the position of the arm at the moment of contact, and the referee's interpretation of the rules.",
      replay:
        "Watch the position of the arm the moment the ball arrives — was it raised away from the body, or tucked in naturally?",
      trust:
        "Handball is one of the most debated rules in soccer. Even experts disagree. The AI cannot tell you if this specific call was correct.",
    },
    foul: {
      title: "Foul",
      what: "The referee judged that a player made illegal physical contact — charging, tripping, pushing, or striking an opponent without playing the ball.",
      checking:
        "Referees make these calls live and in real time. VAR can only intervene for a red-card level foul, not most yellow-card or free-kick fouls.",
      disagree:
        "Fouls involve physical contact and speed. What looks like a clean tackle from one angle can look bad from another. Referees are human.",
      need: "Multiple camera angles and slow motion — though even then, experienced analysts often disagree.",
      replay:
        "Watch the defender's feet: did they get the ball first? Did they follow through dangerously?",
      trust:
        "Most foul decisions are not reviewed by VAR. The on-field referee's call stands unless it's a clear and obvious error.",
    },
    yellow_card: {
      title: "Yellow Card",
      what: "The player has been formally cautioned. This goes in the referee's book. Two yellows in one match means an automatic red card and dismissal.",
      checking:
        "Yellow cards can be given for: dangerous tackles, time-wasting, dissent, encroachment at set pieces, or excessive celebration.",
      disagree:
        "Fans often feel the severity of the tackle doesn't match the card. Or they argue the referee is inconsistent — booking one player but ignoring a similar challenge from the other team.",
      need: "The specific incident, the referee's view angle, and whether the player has a history of cautions in the tournament.",
      replay:
        "Watch the intent and the force. Was it late? Was it high? Did the player get the ball or go straight for the player?",
      trust:
        "The referee is the sole judge on yellow card decisions. VAR cannot overturn a yellow card unless it should have been a red.",
    },
    red_card: {
      title: "Red Card",
      what: "The player has been sent off and must leave the pitch immediately. Their team plays the rest of the match with 10 players.",
      checking:
        "Red cards are given for: serious foul play, violent conduct, deliberate handball denying a goal, or a second yellow card. VAR can review red card decisions.",
      disagree:
        "Red cards are match-defining. Fans of the dismissed player's team often argue the tackle wasn't intentional or the VAR lines were wrong.",
      need: 'Slow-motion footage, the exact nature of the contact, and whether it meets the threshold for "serious foul play."',
      replay:
        "Watch the studs, the force, and whether the player had any chance to pull out of the challenge.",
      trust:
        "VAR reviews all potential red cards. If it was overturned or confirmed, that is the official ruling. The AI cannot reverse decisions.",
    },
    penalty: {
      title: "Penalty Kick",
      what: "A penalty kick is awarded when a foul, handball, or obstruction occurs inside the defensive penalty box. It's a one-on-one shot from 12 yards — the most high-pressure moment in soccer.",
      checking:
        "VAR reviews every penalty decision. The check covers: Did the foul actually happen inside the box? Was the contact intentional? Was the attacker diving (simulation)?",
      disagree:
        "Penalty decisions are enormously consequential. Fans argue about whether contact was genuine, whether the attacker went down too easily, and whether the incident was inside or outside the box.",
      need: "The exact location of the foul (in or out of the box?), and whether the contact was genuine or simulated.",
      replay:
        "Watch where the contact happens — is it inside the white penalty box lines? Does the attacker's fall seem proportionate to the contact?",
      trust:
        "Penalty decisions are reviewed by VAR. If given, it stands as the official ruling. The AI is not the referee.",
    },
    var: {
      title: "VAR Review",
      what: "The Video Assistant Referee is reviewing a decision. Officials in a separate room are watching multiple camera angles to check if the on-field decision was correct.",
      checking:
        "VAR only intervenes for: goals (offside, fouls in build-up), penalty decisions, red cards, and cases of mistaken identity. It cannot review yellow cards or most free kicks.",
      disagree:
        "VAR is widely debated. Supporters argue it kills the spontaneity of goal celebrations and that the margins are too thin to be meaningful. Others say it corrects clear injustices.",
      need: "Multiple camera angles, computer-generated offside lines, and an agreement between the VAR team and on-field referee.",
      replay:
        "Watch the TV screen for lines and graphics. The on-field referee may go to the pitchside monitor to review footage themselves.",
      trust:
        "VAR is an official match process. The final decision, once announced, is the official ruling. Kickoff Buddy cannot override it.",
    },
    goal_canceled: {
      title: "Goal Canceled",
      what: "The goal has been ruled out — it will not count. The most common reasons are: offside in the build-up, a foul before the ball was scored, or a handball.",
      checking:
        "Every goal is automatically reviewed by VAR. If there is any potential issue in the build-up, VAR will check it before confirming or canceling the goal.",
      disagree:
        "Canceled goals are devastating for fans of the scoring team. Disagreement usually centres on whether the offside was marginal, the foul was genuine, or the handball was intentional.",
      need: "The exact frame where the ball was played for an offside check, or multiple angles to confirm or deny a foul or handball.",
      replay:
        "Watch the build-up sequence from the start — not just the moment the ball crossed the line. The issue could be several passes earlier.",
      trust:
        "Once VAR confirms a goal is canceled, that decision is final. The match continues from that ruling. Kickoff Buddy cannot reinstate the goal.",
    },
  };

  const d = decisions[decision] || decisions.offside;

  const body = `
    ${rs("What this decision means", d.title, `<p>${d.what}</p>`)}
    ${rs(
      "What the referee or VAR is checking",
      "The process",
      `<p>${d.checking}</p>`,
    )}
    ${rs("Why fans may disagree", "The controversy", `<p>${d.disagree}</p>`)}
    ${rs(
      "What would be needed to know for certain",
      "Missing information",
      `<p>${d.need}</p>`,
    )}
    ${rs("What to watch in the replay", "Beginner tip", `<p>${d.replay}</p>`)}
    <div class="notice-box notice-box--info">
      <div class="notice-box__icon">
        <svg class="icon icon--sm" aria-hidden="true"><use href="#icon-var"/></svg>
      </div>
      <p class="notice-box__text"><strong>Trust &amp; transparency:</strong> ${d.trust} This is context and education — not an official ruling.</p>
    </div>
  `;
  return ticketCard(matchData, userContext, "Decision Explainer", body);
}

/* ── MOCK: MOMENTUM & TACTICS ─────────────────────────────────── */
function mockMomentum(userContext, matchData, situation) {
  const s = (situation || "").toLowerCase();

  let what, momentumReason, tactical, emotional, watchNext;

  if (s.includes("goal") || s.includes("scored")) {
    what =
      "A goal has been scored. This is the single biggest momentum shift in soccer.";
    momentumReason =
      "The scoring team now leads or extends their lead. Their players feel the game is going to plan. The conceding team faces immediate psychological pressure — they must now chase the match.";
    tactical =
      "The leading team may sit deeper to protect their advantage. The trailing team will push more players forward, which also opens space at the back.";
    emotional =
      "Confidence is contagious in soccer. A goal can make a nervous team suddenly look composed, and a composed team suddenly look vulnerable.";
    watchNext =
      "Watch how the conceding team responds in the next 5 minutes. Teams are most vulnerable immediately after conceding — they are often at their most determined, but also most disorganised.";
  } else if (s.includes("red card") || s.includes("sent off")) {
    what =
      "A player has been sent off. One team now plays with 10 players for the rest of the match.";
    momentumReason =
      "The team with 11 players has a huge numerical advantage. Possession, territory, and chance creation will likely shift significantly.";
    tactical =
      "The 10-player team will typically drop into a deep defensive shape — two banks of four or five — to make themselves hard to break down. They will prioritise organisation over attacking.";
    emotional =
      "Red cards create enormous tension. The reduced team's fans are furious; the opposing fans sense an opportunity. Watch how the reduced team rallies — sometimes a man-down galvanises a team.";
    watchNext =
      "See how the 10-player team reorganises. Who drops into defence? Does the coach immediately make a substitution to adjust the shape?";
  } else if (s.includes("substitut") || s.includes("sub")) {
    what =
      "A substitution has been made. A player has come off and a fresh one has come on.";
    momentumReason =
      "Fresh legs bring energy. If the match is tight, a well-chosen substitute can tilt the balance — adding pace, pressing, or creativity that the other team hasn't seen.";
    tactical =
      "Coaches use substitutions to change the formation, add a forward for more attack, or add a defender to protect a lead. The new player's position tells you the coach's intention.";
    emotional =
      "The crowd often reacts strongly to substitutions. If a key player is brought off, expect groans or cheers depending on how they've played.";
    watchNext =
      "Watch where the new player lines up and how it changes the team's shape. Does the team suddenly push higher, or do they drop back?";
  } else if (s.includes("press") || s.includes("pressing")) {
    what =
      "A team is pressing — they are aggressively chasing the ball high up the pitch rather than dropping back to defend.";
    momentumReason =
      "High pressing forces errors. When a team presses well, they win the ball in dangerous areas and create chances before the opposition can reorganise.";
    tactical =
      "Pressing is physically exhausting. Teams that press intensively often tire in the second half. The opponent's job is to play through the press — pass quickly and accurately under pressure.";
    emotional =
      "A successful press creates crowd noise and energy. Every interception or turnover feels like a mini-victory and builds momentum.";
    watchNext =
      "See if the pressed team is managing to play out or going long. If they keep giving the ball away, the pressing team will keep dominating.";
  } else if (s.includes("crowd") || s.includes("loud") || s.includes("noise")) {
    what =
      "The crowd has become notably louder. This is not just atmosphere — crowd noise directly affects players.";
    momentumReason =
      "Home supporters cheering can raise player adrenaline and mask communication. Away teams can struggle to hear each other, disrupting set plays and coordination.";
    tactical =
      "Coaches often use timeouts, goal kicks, or throw-ins to calm players and reset concentration when crowd noise is overwhelming.";
    emotional =
      "Crowd noise is one of the most underappreciated forces in sport. A stadium erupting can make a good team play like a great one for a spell.";
    watchNext =
      "Watch the goalkeeper and defensive line. Communication is harder when it's loud — defenders may step out of position or hesitate.";
  } else if (
    s.includes("tired") ||
    s.includes("fatigue") ||
    s.includes("legs")
  ) {
    what =
      "Players are showing signs of fatigue — slower movement, less pressing, more errors.";
    momentumReason =
      "The fresher team will dominate the final stages. Their passes will be sharper, their runs more frequent, and the tired team will make more defensive mistakes.";
    tactical =
      "This is when substitutions become critical. Coaches who have fresh players on the bench can change the game in the last 20 minutes.";
    emotional =
      "Tired players under pressure make emotional decisions — mistimed challenges, unnecessary bookings, or moments of frustration.";
    watchNext =
      "Watch the pressing intensity drop. Are attackers tracking back to defend? Is the defensive line losing its shape? These are signs of fatigue.";
  } else {
    what =
      "The match dynamic has shifted — one team appears to be in greater control or under more pressure than before.";
    momentumReason =
      "Momentum in soccer is rarely one single thing. It's a combination of confidence, tactical position, physical condition, and crowd energy all aligning for one side.";
    tactical =
      "The team in control will try to maintain the ball and force the other team to chase it. The team under pressure will try to disrupt rhythm — through fouls, set pieces, or a quick counter-attack.";
    emotional =
      "Watch the body language. Players who believe they can win stand taller, communicate more, and take risks. Players who feel the game slipping away become hesitant.";
    watchNext =
      "Keep watching for 5 more minutes. Momentum in soccer shifts again and again. The team that looks dominant now may be under pressure soon.";
  }

  const body = `
    ${rs("What may be happening", "Reading the moment", `<p>${what}</p>`)}
    ${rs(
      "Why momentum has shifted",
      "The explanation",
      `<p>${momentumReason}</p>`,
    )}
    ${rs(
      "Possible tactical reasons",
      "Coach's perspective",
      `<p>${tactical}</p>`,
    )}
    ${rs(
      "Emotional and pressure factors",
      "The human side",
      `<p>${emotional}</p>`,
    )}
    ${rs("What to watch next", "Stay focused on…", `<p>${watchNext}</p>`)}
    ${noticeBox("This is a contextual explanation. Actual tactical decisions depend on the specific teams and coaches involved — always watch what happens next rather than assuming.", "")}
  `;
  return ticketCard(
    matchData,
    userContext,
    "Momentum & Tactics Explainer",
    body,
  );
}

/* ── MOCK: TEAM RECOMMENDATIONS ──────────────────────────────── */
function mockTeams(userContext, prefs) {
  const p = (prefs || "").toLowerCase();

  const hasAny = (...terms) => terms.some((t) => p.includes(t));

  const teams = [];

  if (hasAny("underdog", "emotional", "cultural")) {
    teams.push({
      name: "Morocco",
      why: "Morocco became the first African nation to reach a World Cup semi-final in 2022 — one of the most emotional runs in tournament history. Their players, many born abroad to immigrant families, united an entire continent.",
      beginner:
        "For a beginner, Morocco are perfect to follow: organised, passionate, and underdogs against giant opponents. Every match feels meaningful.",
      watch:
        "Watch how they defend as a unit — all 11 players tracking back — then explode into counter-attacks at pace.",
    });
  }

  if (hasAny("beautiful", "teamwork", "possession", "attacking")) {
    teams.push({
      name: "Spain",
      why: 'Spain\'s "tiki-taka" style — short passes, ball retention, positional play — is considered by many coaches to be the most beautiful and effective system in modern soccer.',
      beginner:
        "Watching Spain is like watching a passing masterclass. Even beginners quickly spot the difference: they seem to never give the ball away.",
      watch:
        "Count how many passes they complete before taking a shot. It's often remarkable.",
    });
  }

  if (hasAny("famous", "players", "star")) {
    teams.push({
      name: "Brazil",
      why: "Brazil have produced more legendary players than any nation in history. Even if you don't know soccer, you've probably heard the names. Their current squad continues that tradition.",
      beginner:
        "Brazil matches are high-energy and full of individual skill moments that any beginner can appreciate immediately.",
      watch:
        "Watch individual players take on opponents one-on-one. Brazilian footballers are often taught to dribble before they're taught to pass.",
    });
  }

  if (hasAny("asian")) {
    teams.push({
      name: "Japan",
      why: "Japan have become Asia's most consistent World Cup performers and caused major upsets in 2022 (beating Germany and Spain). They combine European tactical discipline with Asian precision.",
      beginner:
        "Japan are satisfying to watch because they are very organised. You can see the system working — every player knows exactly where to be.",
      watch:
        "Watch their defensive shape — two banks of four — and how they spring into counter-attacks the moment they win the ball.",
    });
  }

  if (hasAny("americas", "argentina")) {
    teams.push({
      name: "Argentina",
      why: "Defending champions. Led by players widely considered among the greatest of their generation. Argentine fan culture — the scarves, the songs, the passion — is unlike anything else in world sport.",
      beginner:
        "You will never be bored watching Argentina. Even when they're not playing well, something extraordinary tends to happen.",
      watch:
        "Watch how the team builds attacks around their key players and how defenders respond to the creative players making runs.",
    });
  }

  if (hasAny("host", "local")) {
    teams.push({
      name: "The Host Nation",
      why: "The host nation always has a special energy at a World Cup. Their home crowd creates an atmosphere that lifts players to performances beyond their normal level.",
      beginner:
        "If you're attending matches or watching locally, cheering for the host is the easiest way to feel part of the shared experience.",
      watch:
        "Watch the crowd as much as the players. The home atmosphere in a World Cup is genuinely unlike any other sporting event.",
    });
  }

  if (hasAny("european", "defend", "disciplin")) {
    teams.push({
      name: "Italy or Germany",
      why: "Both nations have multiple World Cup titles and play with tactical discipline and organisation that even beginners can appreciate.",
      beginner:
        "Tactically structured teams are often easier to understand for beginners — the shape is clear, the roles are defined.",
      watch:
        "Watch the defensive shape — how they hold their line and how quickly they transition from defending to attacking.",
    });
  }

  // Fallback — ensure at least 2 recommendations are shown
  const fallbacks = [
    {
      name: "South Africa",
      why: "Playing on the continent where soccer is a way of life. Bafana Bafana carry enormous national hope.",
      beginner:
        "A great underdog story for first-time fans — the home continent's representative trying to prove themselves on the world stage.",
      watch: "Watch the crowd energy and how it drives the team's performance.",
    },
    {
      name: "Canada",
      why: "A golden generation breaking through on the world stage — young, athletic, hungry.",
      beginner:
        "Canada represent the exciting wave of teams that are reshaping world football. They are underdogs with genuine quality.",
      watch:
        "Watch their press and their pace in transition — they are at their best when the game is end-to-end.",
    },
  ];
  for (const fb of fallbacks) {
    if (teams.length >= 2) break;
    teams.push(fb);
  }

  const topTeams = teams.slice(0, 3); // max 3 recommendations

  const cards = topTeams
    .map((t) =>
      teamCard(
        t.name,
        `<p style="margin-bottom:8px">${t.why}</p>
     <p style="margin-bottom:8px"><strong>Why for a beginner:</strong> ${t.beginner}</p>
     <p><strong>What to watch:</strong> ${t.watch}</p>`,
      ),
    )
    .join("");

  const body = `
    ${rs(
      "Your team recommendations",
      "Based on what you told us",
      `<div class="team-cards">${cards}</div>`,
    )}
    ${noticeBox("You can support any team for any reason — personal connection, the kit colour, a player's story, or just a feeling. There are no wrong choices in fan culture.", "info")}
  `;
  return ticketCard(
    { label: "World Cup 2026", stage: "Fan Matching", date: "" },
    userContext,
    "Team Finder",
    body,
  );
}

/* ── MOCK: MATCHDAY CHECKLIST ─────────────────────────────────── */
function mockMatchday(userContext, matchData) {
  // venue is stored on the context object, set by buildMatchdayChecklist()
  const venue = userContext.viewContext || "home";
  const isStadium = venue === "stadium";
  const isBar = venue === "bar";

  let items = [];

  if (isStadium) {
    items = [
      {
        icon: "ticket",
        heading: "Confirm your ticket source",
        detail:
          "Only buy from official FIFA/venue channels or authorised resellers. Verify the barcode works before you leave home. Check fifa.com for official ticketing.",
      },
      {
        icon: "source",
        heading: "Check the official stadium guide",
        detail:
          "Every World Cup venue publishes a Fan Guide. It covers bag policy, prohibited items, and entry procedures. Find it on the official venue website.",
      },
      {
        icon: "transit",
        heading: "Plan your transport early",
        detail:
          "Match days are very busy. Check the local transit authority for match-day schedules. Consider arriving 30–45 minutes earlier than usual.",
      },
      {
        icon: "stadium",
        heading: "Arrive early — gates open 2–3 hours before kick-off",
        detail:
          "Long queues at security are normal. Build in extra time to find your seat, buy refreshments, and absorb the atmosphere without rushing.",
      },
      {
        icon: "bag",
        heading: "Check the bag policy",
        detail:
          "Most stadiums ban large bags. Confirm the specific size and type restrictions for your venue before you pack. Transparent bags are often required.",
      },
      {
        icon: "scarf",
        heading: "Dress for the occasion",
        detail:
          "Wear your team's colours if you have them — or neutral colours if you're not sure who to support. Comfortable shoes matter for stadium walks.",
      },
      {
        icon: "crowd",
        heading: "Prepare for crowd noise",
        detail:
          "A World Cup stadium is very loud. If you are noise-sensitive, ear protection is not embarrassing — it's sensible. Enjoy the sound but look after yourself.",
      },
      {
        icon: "source",
        heading: "Save official contacts",
        detail:
          "Save the venue's official helpline and the nearest medical point location. Know where your gate is before you go in.",
      },
    ];
  } else if (isBar) {
    items = [
      {
        icon: "ticket",
        heading: "Check if your venue needs a reservation",
        detail:
          "Popular bars and watch parties for big matches often require advance booking. Check the venue's website or call ahead.",
      },
      {
        icon: "transit",
        heading: "Plan transport home in advance",
        detail:
          "Busy match nights mean busy transport. Book a taxi or rideshare in advance, or know your last train/bus time before the match ends.",
      },
      {
        icon: "crowd",
        heading: "Arrive early for a good viewing spot",
        detail:
          "The best screens fill up fast. Arriving 30 minutes before kick-off gives you time to settle in and understand the setup.",
      },
      {
        icon: "scarf",
        heading: "Fan etiquette at a bar",
        detail:
          "Be respectful of people supporting different teams. World Cup bars bring together all kinds of fans. Celebrate your team, but keep it good-natured.",
      },
      {
        icon: "source",
        heading: "No spoilers for others",
        detail:
          "If you leave before the final whistle, remember others nearby may be watching the same match delayed. Be mindful.",
      },
      {
        icon: "crowd",
        heading: "Know it's okay to ask questions",
        detail:
          'Watch parties are social events. Asking "what just happened?" to someone next to you is completely normal. That\'s what Kickoff Buddy is for too.',
      },
    ];
  } else {
    // Home viewing
    items = [
      {
        icon: "source",
        heading: "Find an official broadcast channel",
        detail:
          "Check who holds the broadcast rights in your country for the World Cup. Illegal streams often fail at critical moments.",
      },
      {
        icon: "transit",
        heading: "Set your alarm for time zones",
        detail:
          "World Cup matches happen across multiple time zones. Check the kick-off time in your local time before the day.",
      },
      {
        icon: "crowd",
        heading: "Invite friends or family",
        detail:
          "Soccer is most enjoyable shared. Even if no one else knows the rules, the reactions are contagious.",
      },
      {
        icon: "scarf",
        heading: "Have Kickoff Buddy open",
        detail:
          'Keep this page open on a second screen or phone. Tap "Ask What Just Happened?" whenever you\'re confused — no embarrassment.',
      },
      {
        icon: "pitch",
        heading: "Read the Match Guide beforehand",
        detail:
          'Use the "Generate My Match Guide" section above before the match starts. It will give you the story and what to look for.',
      },
      {
        icon: "source",
        heading: "Follow official social channels",
        detail:
          "FIFA's official accounts post instant replays, stats, and explanations during matches.",
      },
    ];
  }

  const checklistHTML = `<div class="checklist">
    ${items.map((item, i) => checklistItem(item.icon, item.heading, item.detail, `cl-${i}`)).join("")}
  </div>`;

  const venueLabel = isStadium
    ? "Stadium"
    : isBar
      ? "Bar / Watch Party"
      : "Home viewing";

  const body = `
    ${rs(
      "Your checklist",
      `Prepared for: ${venueLabel}`,
      `<p style="margin-bottom:14px">Tap each item to check it off as you prepare.</p>
       ${checklistHTML}`,
    )}
    ${noticeBox(
      `<strong>Official sources reminder:</strong> Kickoff Buddy provides general guidance. For bag policies, venue rules, transit schedules, ticket validity, and safety information, always check the official FIFA website, your specific venue, and local transit authorities. These details change and vary by city and stadium.`,
      "",
    )}
  `;
  return ticketCard(
    matchData,
    userContext,
    `Matchday Confidence Guide — ${venueLabel}`,
    body,
  );
}
