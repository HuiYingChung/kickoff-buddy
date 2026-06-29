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

   APIs & AI roles:
   • football-data.org  — live World Cup match data (events as ground truth)
   • IBM Granite (watsonx.ai) — /api/ai — the EXPLAINER. Writes every final
       answer the user reads, for all six features. Single on-screen voice.
   • OpenAI GPT-4o (web search) — /api/ai-search — the FACT-CHECKER. For the
       match-explanation features it gathers verified current 2026 facts
       first; those are then handed to Granite to explain.

   Per-feature routing:
   • guide / ask / decision / momentum → GPT-4o fact-check → Granite explains
       (hybrid — every match explanation reflects the live 2026 reality).
   • teams / matchday → Granite only (don't hinge on live match state).

   Architecture:
   ┌────────────────────────────────────────────────────────────┐
   │  UI functions  →  getAIResponse()                          │
   │                       │                                    │
   │              USE_MOCK_AI?                                  │
   │              ┌────────┴────────┐                          │
   │            true              false                         │
   │              │                  │                          │
   │        mockResponses     SEARCH_TASKS?                     │
   │              │          ┌───────┴────────┐                 │
   │              │        yes                no                │
   │              │         │                  │                │
   │              │  Stage 1: GPT-4o     (skip fact-check)      │
   │              │  callOpenAIWithSearch       │               │
   │              │  (/api/ai-search)           │               │
   │              │         │                   │               │
   │              │         └──── verifiedFacts ┘               │
   │              │                  │                          │
   │              │         Stage 2: callGranite (/api/ai)      │
   │              └────────┬─────────┘                          │
   │                  renderOutput()                            │
   └────────────────────────────────────────────────────────────┘
═══════════════════════════════════════════════════════════════ */

"use strict";

/* ─────────────────────────────────────────────────────────────
   CONFIGURATION
───────────────────────────────────────────────────────────── */
const USE_MOCK_AI = false;

// API keys/credentials are kept server-side (proxy.js locally, api/*.js on
// Vercel) — never add them here.

// ── AI providers ──────────────────────────────────────────────
// This app uses TWO AI providers, chosen per feature:
//   • IBM Granite (via watsonx.ai)  → /api/ai        (chat, no search)
//   • OpenAI                        → /api/ai-search (web search)
// The Granite model is configured server-side (WATSONX_MODEL_ID).
const OPENAI_MODEL       = "gpt-4o";        // model for the search endpoint
const OPENAI_MODEL_LABEL = "GPT-4o";        // label on search-based cards
const GRANITE_LABEL      = "IBM Granite";   // AI badge — Granite is the single voice
// Shown as a small footer note when GPT-4o web search actually fed the answer.
const SEARCH_PROVENANCE  = 'Live facts verified via <strong>GPT-4o</strong> web search — explained by <strong>IBM Granite</strong>';
// Shown on the matchday checklist when GPT-4o web search supplied the official links.
const MATCHDAY_LINKS_PROVENANCE = 'Official links found via <strong>GPT-4o</strong> web search — checklist written by <strong>IBM Granite</strong>';
// NOTE: if you change OPENAI_MODEL, verify it supports the Responses API
// `web_search_preview` tool used by /api/ai-search.

// Two-model division of labour (this app is for the LIVE 2026 World Cup):
//   • GPT-4o (web search) is the FACT-CHECKER — it gathers the current 2026
//     match reality (form, what just happened, live state, changing facts).
//   • IBM Granite (watsonx) is the EXPLAINER — it explains the soccer rules,
//     principles, and established facts, and uses GPT-4o's verified facts to
//     ground the answer in THIS 2026 match. Granite is the single voice shown.
// Every match-explanation feature is hybrid: GPT-4o verifies, Granite explains.
// These tasks use the MATCH fact-finder (buildFactFindingPrompt, fed the events).
// teams and matchday(focused) also run a GPT-4o search, but via their own prompts
// (team form / official links) — see useSearch in getAIResponse, not this Set.
const SEARCH_TASKS = new Set(["guide", "ask", "decision", "momentum"]);

// Updated per request in getAIResponse so each result card shows the right
// provider. Safe because a card renders synchronously to completion.
let currentAILabel = GRANITE_LABEL;
// Optional provenance line shown under the card body (HTML). Empty = no line.
let currentAIProvenance = "";

/* ─────────────────────────────────────────────────────────────
   LIVE MATCH DATA — football-data.org API
───────────────────────────────────────────────────────────── */
let liveMatches = {};
const matchEventCache = {};

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
        year: "numeric",
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
    // Sort by kickoff time. Raw API objects expose `utcDate`, not `date`.
    matches.sort((a, b) => new Date(a.utcDate || 0) - new Date(b.utcDate || 0));
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
   TEAM FIXTURES — recent results + next match per team
   Used to enrich the "Choose My Team" recommendation cards.
───────────────────────────────────────────────────────────── */

// Raw WC fixtures, fetched once and reused across recommendation cards.
let allMatchesCache = null;
// Team names from the most recent "Choose My Team" result. The Matchday guide
// lets the fan pick one of these so its checklist can focus on that team's
// next match. Empty until recommendTeams() has produced a result.
let recommendedTeams = [];
async function ensureAllMatches() {
  if (allMatchesCache) return allMatchesCache;
  try {
    allMatchesCache = await fetchLiveMatches();
  } catch (e) {
    console.warn("Could not load fixtures for team cards:", e);
    allMatchesCache = [];
  }
  return allMatchesCache;
}

// Normalise a team name for fuzzy matching (lowercase, strip accents & spaces).
function normTeam(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");
}

// A recommendation heading may be "Italy or Germany" or "The Host Nation".
// Split it into candidate team names we can match against the fixtures.
function teamNameVariants(title) {
  return String(title || "")
    .split(/\bor\b|\/|,|&/i)
    .map((s) => s.replace(/^the\s+/i, "").trim())
    .filter(Boolean);
}

const STAGE_SHORT = {
  GROUP_STAGE: "Group",
  ROUND_OF_16: "R16",
  QUARTER_FINALS: "QF",
  SEMI_FINALS: "SF",
  THIRD_PLACE: "3rd Place",
  FINAL: "Final",
};

function fmtFixtureDate(utc, withTime) {
  if (!utc) return "";
  const d = new Date(utc);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  if (!withTime) return date;
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${date} · ${time}`;
}

// Given a recommendation heading, return that team's recent results + next match.
function getTeamFixtures(title, matches) {
  const variants = teamNameVariants(title).map(normTeam).filter((v) => v.length >= 3);
  if (!variants.length || !Array.isArray(matches) || !matches.length) return null;

  const isTeam = (name) => {
    const n = normTeam(name);
    if (!n) return false;
    return variants.some(
      (v) =>
        n === v ||
        (v.length >= 4 && n.includes(v)) ||
        (n.length >= 4 && v.includes(n)),
    );
  };

  const involved = matches.filter(
    (m) => isTeam(m.homeTeam && m.homeTeam.name) || isTeam(m.awayTeam && m.awayTeam.name),
  );
  if (!involved.length) return null;

  const oriented = involved.map((m) => {
    const isHome = isTeam(m.homeTeam && m.homeTeam.name);
    const opp = (isHome ? m.awayTeam : m.homeTeam) || {};
    const score = m.score && m.score.fullTime ? m.score.fullTime : {};
    const sf = isHome ? score.home : score.away;
    const sa = isHome ? score.away : score.home;
    const finished = m.status === "FINISHED";
    const live = ["LIVE", "IN_PLAY", "PAUSED"].includes(m.status);
    let result = null;
    if (finished && sf != null && sa != null) {
      result = sf > sa ? "W" : sf < sa ? "L" : "D";
    }
    return {
      opp: opp.name || "TBD",
      sf,
      sa,
      finished,
      live,
      result,
      utc: m.utcDate,
      stage: STAGE_SHORT[m.stage] || "",
      raw: m,
    };
  });

  const byDate = (a, b) => new Date(a.utc || 0) - new Date(b.utc || 0);
  const played = oriented.filter((o) => o.finished || o.live).sort(byDate);
  const upcoming = oriented.filter((o) => !o.finished && !o.live).sort(byDate);

  return { played: played.slice(-3), next: upcoming[0] || null };
}

// Build the small fixtures block shown inside a recommendation card.
function teamFixturesHtml(title, matches) {
  const fx = getTeamFixtures(title, matches);
  if (!fx || (!fx.played.length && !fx.next)) return "";

  let html = '<div class="team-card__fixtures">';

  if (fx.played.length) {
    html += '<div class="fixtures__label">Recent matches</div>';
    html += fx.played
      .map((o) => {
        const score = o.sf != null && o.sa != null ? `${o.sf}–${o.sa}` : "–";
        const badge = o.live
          ? '<span class="fx-badge fx-badge--live">LIVE</span>'
          : o.result
            ? `<span class="fx-badge fx-badge--${o.result.toLowerCase()}">${o.result}</span>`
            : "";
        const meta = `${fmtFixtureDate(o.utc)}${o.stage ? " · " + o.stage : ""}`;
        return `<div class="fixtures__row">
          <span class="fx-opp">vs ${escapeHTML(o.opp)}</span>
          <span class="fx-score">${score}</span>
          ${badge}
          <span class="fx-meta">${meta}</span>
        </div>`;
      })
      .join("");
  }

  if (fx.next) {
    const meta = `${fmtFixtureDate(fx.next.utc, true)}${fx.next.stage ? " · " + fx.next.stage : ""}`;
    html += '<div class="fixtures__label">Next match</div>';
    html += `<div class="fixtures__row fixtures__row--next">
      <span class="fx-opp">vs ${escapeHTML(fx.next.opp)}</span>
      <span class="fx-meta">${meta}</span>
    </div>`;
  }

  html += "</div>";
  return html;
}

/* ─────────────────────────────────────────────────────────────
   OPENAI INTEGRATION
───────────────────────────────────────────────────────────── */
// Granite (IBM watsonx.ai) — the explainer. Writes the final answer for every
// feature; on live tasks the prompt already contains GPT-4o's verified facts.
async function callGranite(prompt) {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: prompt }],
      max_tokens: 900,
      temperature: 0.7,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`AI: ${data.error.message}`);
  return data.choices?.[0]?.message?.content ?? "";
}

async function callOpenAIWithSearch(prompt) {
  const res = await fetch("/api/ai-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: prompt,
      max_output_tokens: 1200,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`OpenAI: ${data.error.message}`);
  const output = data.output || [];
  const msgItem = output.find((o) => o.type === "message");
  const textItem = msgItem?.content?.find((c) => c.type === "output_text");
  if (!textItem?.text) throw new Error("No response received from AI.");
  return textItem.text;
}

/* ─────────────────────────────────────────────────────────────
   STAGE 1 — FACT-CHECKER PROMPT (GPT-4o + web search)
   Builds a prompt whose ONLY job is to gather verified, current facts about
   THIS match. GPT-4o does NOT write the beginner explanation — it produces a
   short factual brief that Granite (Stage 2) then explains. This is the
   "what actually happened" half of the two-model split.
───────────────────────────────────────────────────────────── */
function buildFactFindingPrompt(matchData, taskType, userQuestion, events = null) {
  const scoreInfo = matchData.scoreDisplay
    ? `${matchData.teamA} ${matchData.scoreDisplay} ${matchData.teamB}`
    : "Not yet played";
  const statusInfo = matchData.isLive
    ? "LIVE now"
    : matchData.isFinished
      ? "Final result"
      : "Upcoming";

  const focusMap = {
    guide:    `a pre-match briefing: the two teams' recent form and results, key players, any notable injuries or suspensions, what is at stake for each, and — if the match has already kicked off or finished — the actual current/final state`,
    ask:      `the user's question: "${userQuestion}"`,
    decision: `this referee or VAR decision / incident: "${userQuestion}"`,
    momentum: `the current momentum or tactical situation: "${userQuestion}"`,
  };
  const focus = focusMap[taskType] || `: "${userQuestion}"`;

  return `
You are a soccer FACT-CHECKER for one specific World Cup match. Your ONLY job is
to gather verified, current facts — you are NOT writing anything for an end user.

MATCH: ${matchData.label} (${matchData.stage}, ${matchData.date})
- Status: ${statusInfo}
- Score: ${scoreInfo}

${buildMatchEventsContext(events)}

WHAT TO FIND: facts relevant to ${focus}

INSTRUCTIONS:
- Use web search to confirm what actually happened in THIS match — especially
  anything not already in the CONFIRMED MATCH EVENTS above (e.g. VAR reviews,
  cancelled goals, specific incidents). Prefer BBC Sport, ESPN, FIFA.com,
  Reuters, or AP.
- Report ONLY verified facts. After each, note the source in parentheses.
- If you cannot confirm something, list it under UNCONFIRMED — never guess.
- Do NOT explain rules, give tips, or write prose for a beginner. Output a
  short factual brief only.

OUTPUT FORMAT (keep under ~150 words):
VERIFIED FACTS:
- <fact> (source: <site>)
UNCONFIRMED:
- <thing you could not confirm>`.trim();
}

/* ─────────────────────────────────────────────────────────────
   STAGE 1 (Choose My Team) — TEAM FACT-FINDING PROMPT (GPT-4o + search)
   Gathers CURRENT 2026-tournament facts about candidate teams that fit the
   fan's stated preferences, so Granite recommends from live form rather than
   only its training memory. Produces a factual brief, not recommendations.
───────────────────────────────────────────────────────────── */
function buildTeamFactFindingPrompt(prefs) {
  return `
You are a soccer FACT-CHECKER helping match a first-time fan to FIFA World Cup 2026
teams. Your ONLY job is to gather verified, CURRENT facts about the 2026 tournament —
you are NOT writing recommendations, rankings, or advice for the end user.

THE FAN'S STATED PREFERENCES: "${prefs}"

WHAT TO FIND — for the World Cup 2026 as it stands RIGHT NOW, surface candidate teams
whose situation fits those preferences. Gather facts for the SPECIFIC dimensions the
fan selected, each with concrete current detail:
- current group standing / knockout progress and recent results (with scores);
- star / standout players (for "famous players");
- playing STYLE shown so far, described specifically — attacking, defensive / organised,
  or possession & passing ("beautiful teamwork") — never just "good" or "strong";
- storylines: underdog runs, emotional stories, and a team's cultural / historical
  significance or fan culture (for "strong cultural story");
- host-nation status (USA, Canada, Mexico) and confederation (AFC / CONMEBOL / CONCACAF /
  UEFA), so region and host preferences can be honoured exactly.
Prioritise the dimensions the fan actually chose. For any region or host preference, every
candidate you list for it MUST belong to that region / host group.

INSTRUCTIONS:
- Use web search for the CURRENT 2026 state; today's date matters — report the latest
  results, not past tournaments. Prefer FIFA.com, BBC Sport, ESPN, Reuters, or AP.
- Report ONLY verified facts, each with its source in parentheses.
- Cover a RANGE of candidate teams (aim for 5–8) so the recommender has options.
- Do NOT recommend, rank, or write beginner prose. Output a short factual brief only.

OUTPUT FORMAT (keep under ~200 words):
VERIFIED FACTS:
- <team>: <standing / result / style / storyline relevant to the preferences> (source: <site>)
UNCONFIRMED:
- <anything you could not confirm>`.trim();
}

/* ─────────────────────────────────────────────────────────────
   STAGE 1 (matchday) — OFFICIAL LINK FINDER (GPT-4o + web search)
   Gathers a short list of verified, OFFICIAL, SAFE links relevant to the
   user's viewing context. Strictly excludes scalpers, gambling, phishing,
   and illegal-stream sites. Granite (Stage 2) embeds these into the checklist.
───────────────────────────────────────────────────────────── */
// Only these domains may appear as official links in the Matchday guide. Any
// other URL the fact-checker returns is dropped, so a wrong or guessed link is
// never shown. Broadcast/transit links vary by region and are the main source
// of bad URLs — we point users to verify those themselves instead. Extend this
// list only with domains you trust as primary/official sources.
const ALLOWED_LINK_DOMAINS = ["fifa.com"];

function isAllowedLinkDomain(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ALLOWED_LINK_DOMAINS.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return false;
  }
}

// Strip any non-allow-listed URLs from the fact-checker's OFFICIAL LINKS block
// before it reaches Granite. Drops a whole line if it carries a disallowed URL,
// and makes "none found" explicit when nothing official survives.
function sanitizeOfficialLinks(facts) {
  if (!facts) return facts;
  const findUrls = (s) => s.match(/https?:\/\/[^\s)]+/g) || [];
  const kept = facts.split("\n").filter((line) => {
    const urls = findUrls(line);
    return urls.length === 0 || urls.every(isAllowedLinkDomain);
  });
  let out = kept.join("\n").trim();
  if (findUrls(out).length === 0) {
    out = /OFFICIAL LINKS/i.test(out)
      ? out.replace(/OFFICIAL LINKS:[\s\S]*$/i, "OFFICIAL LINKS: none found")
      : out + "\nOFFICIAL LINKS: none found";
  }
  return out.trim();
}

function buildLinkFindingPrompt(matchData, userContext) {
  const ctx = userContext.viewContext;
  const venueLabel = ctx === "stadium" ? "attending in person at the stadium"
    : ctx === "bar" ? "watching at a bar / public watch party"
    : "watching at home";
  return `
You are a research assistant finding OFFICIAL, SAFE web links for a fan preparing
for one specific FIFA World Cup 2026 match. You are NOT writing advice — only
gathering verified links.

MATCH: ${matchData.label} (${matchData.stage}, ${matchData.date})
FAN'S CONTEXT: ${venueLabel}.
FAN SUPPORTS: ${userContext.supportedTeam || "no specific team"}.

STEP 1 — Use web search to identify the host stadium and host city for this match.
STEP 2 — Find the most relevant OFFICIAL links for this fan's context:
- FIFA: the official fifa.com match/venue page or stadium fan guide (bag policy, gates, rules).
- Transit (if at stadium): the host city's OFFICIAL public-transit authority site and match-day travel info.
- Tickets (if at stadium): ONLY the official FIFA ticketing portal or FIFA-authorised resale.
- Broadcast (if at bar/home): the OFFICIAL rights-holding broadcaster, or FIFA's official "where to watch" page if the region is unknown.

STRICT SOURCE RULES — this is critical:
- ONLY official, primary, reputable sources: FIFA.com, the official stadium/venue site, official city-government transit authorities, official rights-holding broadcasters.
- NEVER include ticket scalpers/touts or non-FIFA secondary resellers, gambling/betting/odds sites, unofficial or pirated streams, phishing, or unofficial fan/blog sites.
- Only output a URL you actually found and verified via web search. Do NOT guess or construct URLs. If a category cannot be found, OMIT it — never fabricate.
- Prefer the canonical https homepage of the official resource if a deep link is uncertain.

OUTPUT FORMAT (only categories you actually verified, one per line; use real https URLs):
OFFICIAL LINKS:
- FIFA match/venue: <label> — <https url>
- Stadium fan guide: <label> — <https url>
- Host-city transit: <label> — <https url>
- Official tickets: <label> — <https url>
- Official broadcast: <label> — <https url>
If nothing could be verified, output exactly: OFFICIAL LINKS: none found`.trim();
}

/* ─────────────────────────────────────────────────────────────
   STAGE 2 — EXPLAINER PROMPT (IBM Granite / watsonx)
   Constructs the structured prompt that Granite turns into the final answer.
   For live tasks it receives `verifiedFacts` from Stage 1 as ground truth.
───────────────────────────────────────────────────────────── */
function buildPrompt(userContext, matchData, taskType, userQuestion, events = null, verifiedFacts = null) {
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

  // Today's real date, so the AI never invents a year and can reason about
  // whether the match is upcoming, live, or already played.
  const todayStr = new Date().toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });

  // Reconcile the viewer's chosen moment with the match's real status, so the
  // AI doesn't treat an already-played match as if it were still upcoming.
  const realMoment = matchData.isLive ? "during" : matchData.isFinished ? "after" : "before";
  const momentMismatch =
    matchData.id && userContext.moment && userContext.moment !== realMoment
      ? `IMPORTANT — STATUS MISMATCH: The viewer selected "${momentMap[userContext.moment] || userContext.moment}", but this match is actually "${statusInfo}". Acknowledge the real status in one short, friendly line — never pretend the match is still upcoming if it has already kicked off or finished. If it is already decided and they wanted a pre-match feel, say it has already been played and avoid leading with the final score unless they ask.`
      : "";

  // A real match is only attached for match-centric tasks (and for a focused
  // matchday). When absent, the match block is omitted entirely so a generic
  // venue checklist never references an unrelated fixture.
  const hasMatch = !!matchData.id;
  const matchBlock = hasMatch
    ? `MATCH: ${matchData.label} (${matchData.stage}, ${matchData.date})
- Status: ${statusInfo}
- Score: ${scoreInfo}

${buildMatchEventsContext(events)}
`
    : "";

  // Venue-specific checklist topics so each venue produces a distinct, relevant
  // list. Only the stadium gets tickets / bag policy / transit.
  const venueTopics = {
    home: [
      "Find the official broadcast or stream",
      "Check kickoff time in your time zone",
      "Set up a comfortable viewing space",
      "A 60-second rules cheat-sheet",
      "Make it social — who to watch with",
    ],
    bar: [
      "Find a bar showing the match",
      "Arrive early for a good spot",
      "Ordering and tab etiquette",
      "Cheering and crowd etiquette",
      "Plan how you'll get home",
    ],
    stadium: [
      "Confirm tickets via official channels",
      "Check the stadium bag policy",
      "Plan transit and arrive early",
      "Security and gate entry",
      "What to wear (team colours)",
      "Crowd noise and atmosphere",
    ],
  };
  const mdTopics = venueTopics[userContext.viewContext] || venueTopics.home;

  const taskInstructions = {
    guide: `
TASK: Generate a personalised beginner match guide for this specific match.
FOCUS ON:
1. Introduce the two teams in simple terms — who they are, their playing style, and what is at stake for each in this match.
2. Tailor the depth to the user's knowledge level (${knowledgeMap[userContext.knowledge] || userContext.knowledge}).
3. Give exactly 3 specific things to watch for in THIS match — not generic soccer tips.
4. Briefly explain the 1–2 rules most relevant to this match's context.
5. Close with a short, warm note that makes the user feel ready and excited.
DO NOT: Predict the result of an unplayed match. Do not invent a date, year, or score — use only the MATCH details above. Do not give a generic soccer lesson — everything must connect to this match. If the match is already live or finished, open by acknowledging that honestly instead of pretending it is upcoming.
RESPONSE FORMAT — output these ## section headings in this exact order, no extras:
## Match Overview
## The Two Teams
## Playing Styles
## 3 Things to Watch
## Rules You May Need
## You're Ready
For "## 3 Things to Watch" only, format each item as: 1. **Heading**: Description`,

    ask: `
TASK: Answer the user's specific question, using confirmed match event data where relevant.
THE USER ASKED: "${userQuestion}"
CRITICAL — USE CONFIRMED EVENTS: Cross-reference the CONFIRMED MATCH EVENTS above before answering.
- If the user is asking about a specific event (e.g. "why was there a yellow card?"), check whether that event is in the confirmed data. If it is, reference the actual details (minute, player, team). If it is NOT, say clearly "I cannot confirm that happened in this match" and explain the concept educationally instead.
- If the user asks about VAR or a cancelled goal, say you cannot confirm those from available data.
- If the user asks a general soccer question not tied to a specific event, answer educationally.
FOCUS ON:
1. Answer EXACTLY what the user asked.
2. If the event is confirmed, explain what happened and what caused it with the real details.
3. Explain why it matters.
4. Tell the user what to watch for next.
DO NOT: Invent specific details about events not in the confirmed data. Stay on the question.
RESPONSE FORMAT — output these ## section headings in this exact order, no extras:
## Simple Explanation
## What Caused It
## Why It Matters
## What to Watch Next`,

    decision: `
TASK: Help the user understand a referee or VAR decision, using confirmed match event data.
THE DECISION: "${userQuestion}"
CRITICAL — FACT-CHECK FIRST: Before explaining, cross-reference the CONFIRMED MATCH EVENTS above.
- Yellow card / Red card: Check if any bookings are listed. If none, say clearly "No cards were issued in this match" before explaining what a card means in general.
- Substitution: Check if substitutions are listed. If none, say "No substitutions have been made yet."
- Goal cancelled / VAR review: These are NOT tracked in the data. State honestly that you cannot confirm this from available data, and direct the user to the official broadcast or FIFA report.
- Game past 90': Check the match status. If FINISHED and score is available, the game has ended — infer if added time occurred from context.
In ALL cases: be honest if the event did not happen or cannot be confirmed, then offer to explain what it would mean educationally.
DO NOT: Claim any decision happened if it is not in the confirmed events. Do not invent details.
RESPONSE FORMAT — output these ## section headings in this exact order, no extras:
## What This Decision Means
## What the Referee Is Checking
## Why Fans Disagree
## What to Watch in the Replay
## Trust & Transparency`,

    momentum: `
TASK: Explain the momentum or tactical shift, grounded in confirmed match events.
THE SITUATION: "${userQuestion}"
CRITICAL — GROUND YOUR ANSWER IN FACTS: Use the CONFIRMED MATCH EVENTS above to anchor your explanation.
- If goals, substitutions, or cards have occurred, reference them as concrete reasons for any momentum shift (e.g. "a substitution at 65' by Team X" or "the red card at 72' changed the game").
- If no events have been recorded yet, say the match data shows no major events yet and explain momentum shifts in general terms.
- Do not invent events that are not in the confirmed data.
FOCUS ON:
1. What is visibly happening, connected to confirmed events where possible.
2. Why momentum has shifted — using real data points from the match.
3. What each coach is likely thinking given the actual match situation.
4. What to watch for next.
DO NOT: Predict the result. Do not reference events that are not in the confirmed data as if they happened.
RESPONSE FORMAT — output these ## section headings in this exact order, no extras:
## What's Happening
## Why Momentum Has Shifted
## The Tactical Picture
## The Human Side
## What to Watch Next`,

    teams: `
TASK: Recommend 2–3 World Cup teams that suit this specific user's interests and personality.
THE USER'S PREFERENCES: "${userQuestion}"
HARD CONSTRAINT: every team you recommend MUST satisfy these preferences. If the user named a region, confederation, or the host nation, recommend ONLY teams from that group and NEVER one from outside it:
- "an Asian team" -> only AFC (Asian) nations.
- "a team from the Americas" -> only CONMEBOL or CONCACAF nations.
- "a European powerhouse" -> only UEFA (European) nations.
- "a host nation" -> only the United States, Canada, or Mexico.
If a preference combines a region with a style (e.g. "Asian team" + "attacking style"), every pick must match the region first, then the style. If two different regions are chosen, give at least one pick from each. If two opposing styles are chosen (e.g. defensive discipline + attacking style), either pick teams that genuinely blend both or cover each style with at least one pick.
${/host/i.test(userQuestion) ? `FACT: World Cup 2026 is co-hosted by the United States, Canada, and Mexico.\n` : ""}FOCUS ON:
1. Match the recommendations directly to what the user told you — explain WHY each team suits THEM personally.
2. For each team, give a concrete "what to watch for" tip that a beginner can act on immediately.
3. Keep recommendations personal and specific, not a history textbook.
4. If VERIFIED LIVE FACTS about the 2026 tournament are provided above, prefer teams they cover and ground any claim about current form, results, or who's playing well in those facts — do not rely on memory for the current tournament, and never invent a result or standing. General personality/style fit can still draw on your soccer knowledge.
5. End with a brief note that any choice is valid — there are no wrong teams to support.
DO NOT: List every team. Do not give long historical lectures. Do not recommend a team that clearly does not match the user's stated preferences.
RESPONSE FORMAT — one ## heading per recommended team (the team name only), then exactly three lines:
**Why this team:** [why it suits this specific user]
**Why for a beginner:** [beginner-friendly tip]
**What to watch:** [one concrete watching tip]
Final section: ## Any Team is Valid`,

    matchday: `
TASK: Build a concise, practical matchday checklist tailored to a ${contextMap[userContext.viewContext] || userContext.viewContext} experience.
THE CONTEXT: "${userQuestion}"
REQUIRED ITEMS — output ONE "## heading" per item below, in this order, and NO other items. They are specific to this venue:
${mdTopics.map((t, i) => `${i + 1}. ${t}`).join("\n")}
FOR EACH ITEM: a short heading (4–6 words) then 1–2 sentences of concrete, actionable detail for THIS venue. Be specific and brief — do not pad.
${userContext.supportedTeam ? `TEAM: The fan supports ${userContext.supportedTeam}. Where it fits naturally, tailor an item to them (their colours to wear, or their next match's city / stadium / kickoff if given above) — but use ONLY specifics provided above or in the verified facts; never invent a venue, city, date, or result.` : ""}
DO NOT: add items not listed above; include tickets, bag policy, or transit for a home or bar viewer; explain general soccer rules; or repeat the same advice across items.
RESPONSE FORMAT — one ## heading per required item above (in order), one short paragraph each. Final section: ## Official Sources Reminder
LINKS: The verified facts above may contain an "OFFICIAL LINKS" list. When an item relates to one of those links, embed it inline as a markdown link, e.g. [FIFA match page](https://www.fifa.com/...). In ## Official Sources Reminder, list those official links as markdown links. Use ONLY URLs that appear verbatim in that list — never invent, alter, or shorten a URL. If the list says "none found" or is absent, include NO links and simply remind the user to check the official FIFA site (fifa.com), their venue, the official broadcaster, and local transit authorities themselves.`,
  };

  const specificInstructions = taskInstructions[taskType] || `
TASK: Answer the user's input in the most helpful, beginner-friendly way for a soccer context.
USER INPUT: "${userQuestion || "None"}"`;

  // Live tasks are fed web-verified facts gathered by GPT-4o (Stage 1).
  const hasSearch = SEARCH_TASKS.has(taskType);
  const verifiedBlock = verifiedFacts
    ? `VERIFIED LIVE FACTS (gathered and web-checked for you by a fact-checker — treat these as confirmed ground truth, on equal footing with the events above):
${verifiedFacts}
`
    : "";
  const searchRule = hasSearch
    ? `- Your ground truth is the CONFIRMED MATCH EVENTS and the VERIFIED LIVE FACTS above — they were already gathered and web-verified for you. Base every claim about what happened in this match ONLY on those. You do NOT have live web access yourself, so do not promise to look anything up.
- If neither the events nor the verified facts cover what is being asked, say so honestly and explain the underlying concept instead of guessing.`
    : `- Base your answer on the match context and confirmed events above plus general soccer knowledge. Do NOT invent specific live facts (scores, incidents, line-ups) that are not in the confirmed data — if something cannot be confirmed, say so honestly.`;

  return `
You are Kickoff Buddy, a warm, patient, beginner-friendly AI soccer companion.

USER PROFILE:
- Soccer knowledge: ${knowledgeMap[userContext.knowledge] || userContext.knowledge}
- Viewing moment: ${momentMap[userContext.moment] || userContext.moment}
- Viewing context: ${contextMap[userContext.viewContext] || userContext.viewContext}
- Main goal: ${userContext.goal}

TODAY'S DATE: ${todayStr}. This is the live FIFA World Cup 2026. Treat all dates and the year accordingly — never state a different year.

${matchBlock}${verifiedBlock}${momentMismatch ? momentMismatch + "\n\n" : ""}${specificInstructions}

GENERAL RULES (apply to every response):
- Answer exactly what was asked — nothing more, nothing less — and stay factual.
- DIVISION OF LABOUR: Your job is to explain the soccer rules, principles, and established facts, and to make this 2026 match understandable for a beginner. Every live/changing fact about this match — the date, year, score, events, team form, current state — must come ONLY from the MATCH details, CONFIRMED MATCH EVENTS, and VERIFIED LIVE FACTS above. Never invent any of them; never guess a year or a result.
- Never claim an event happened unless it appears in the CONFIRMED MATCH EVENTS or the VERIFIED LIVE FACTS above. If something cannot be confirmed, say so plainly, then explain the underlying concept so the user still learns something.
- SCOPE: only answer questions about soccer, this match, the World Cup, the rules, or the matchday experience. If the input is off-topic (homework, coding, politics, weather, recipes, general chit-chat, etc.), do not answer it — briefly say it's outside Kickoff Buddy's scope and steer back to the match.
- Write in simple, warm, beginner-friendly language. Always explain jargon when you use it.
${searchRule}
- Make the user feel welcome and confident — never embarrassed for not knowing something.

Respond now:`.trim();
}

/* ─────────────────────────────────────────────────────────────
   CENTRAL AI RESPONSE HANDLER
   All feature functions call this — not mock responses directly.
───────────────────────────────────────────────────────────── */
async function getAIResponse(taskType, userContext, matchData, userQuestion) {
  if (USE_MOCK_AI) {
    await delay(900 + Math.random() * 600);
    return getMockResponse(taskType, userContext, matchData, userQuestion);
  }

  const events = matchData.id ? await fetchMatchEvents(matchData.id) : null;

  // Two-model split for live tasks (ask/decision/momentum):
  //   Stage 1 — GPT-4o + web search gathers the verified "what happened" facts.
  //   Stage 2 — IBM Granite explains them for a beginner (single voice shown).
  // Matchday also uses GPT-4o web search — but to gather official, safe LINKS
  // (FIFA/venue, transit, tickets, broadcast) rather than match facts.
  // Choose My Team also runs a Stage-1 web search — but to gather the CURRENT
  // 2026-tournament context (standings, form, who's playing well) that fits the
  // fan's preferences, so Granite recommends from live facts, not just memory.
  const isMatchday = taskType === "matchday";
  const isTeams = taskType === "teams";
  // Matchday only searches the web when it is FOCUSED on a specific match (the
  // fan picked a recommended team that has an upcoming fixture). A generic venue
  // checklist needs no match-specific links — those only added noise and wrong
  // links before.
  const matchdaySearch = isMatchday && userContext.matchFocused;
  const useSearch = SEARCH_TASKS.has(taskType) || matchdaySearch || isTeams;

  let verifiedFacts = null;
  if (useSearch) {
    try {
      const factPrompt = matchdaySearch
        ? buildLinkFindingPrompt(matchData, userContext)
        : isTeams
          ? buildTeamFactFindingPrompt(userQuestion)
          : buildFactFindingPrompt(matchData, taskType, userQuestion, events);
      verifiedFacts = await callOpenAIWithSearch(factPrompt);
      // Drop any link that is not an official, allow-listed domain so a wrong or
      // guessed URL can never reach the user.
      if (matchdaySearch) verifiedFacts = sanitizeOfficialLinks(verifiedFacts);
    } catch (e) {
      // Graceful degradation: if GPT-4o web search is unavailable, Granite still
      // answers using the official football-data.org events alone (no links).
      console.warn("GPT-4o web search unavailable; Granite will proceed without it.", e);
      verifiedFacts = null;
    }
  }

  // Granite is always the explainer and the single voice — the AI badge always
  // reads "IBM Granite". GPT-4o's contribution is credited in a small footer
  // line, shown only when its verified facts/links actually fed the answer.
  currentAILabel = GRANITE_LABEL;
  currentAIProvenance = !verifiedFacts
    ? ""
    : isMatchday ? MATCHDAY_LINKS_PROVENANCE : SEARCH_PROVENANCE;

  const prompt = buildPrompt(userContext, matchData, taskType, userQuestion, events, verifiedFacts);
  const text = await callGranite(prompt);
  // Team recommendations show each team's recent results + next match, so make
  // sure the WC fixtures are loaded before we render the cards synchronously.
  if (taskType === "teams") await ensureAllMatches();
  return aiTextToCard(text, matchData, userContext, taskType);
}

/* ─────────────────────────────────────────────────────────────
   AI RESPONSE RENDERING — task-specific parsers & renderers
───────────────────────────────────────────────────────────── */

/* Split AI text on ## headings → [{ title, content }] */
function parseSections(text) {
  const sections = [];
  let current = null;
  for (const line of text.split("\n")) {
    const m = line.match(/^## (.+)$/);
    if (m) {
      if (current) sections.push({ title: current.title, content: current.buf.join("\n").trim() });
      current = { title: m[1].trim(), buf: [] };
    } else if (current) {
      current.buf.push(line);
    }
  }
  if (current) sections.push({ title: current.title, content: current.buf.join("\n").trim() });
  return sections;
}

/* Safe markdown → HTML (bold, italic, paragraphs) */
function mdToHtml(text) {
  return linkify(escapeHTML(text))
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/\n\n+/g, "</p><p>")
    .replace(/\n/g, "<br>")
    .replace(/^/, "<p>")
    .replace(/$/, "</p>");
}

/* Convert markdown links [label](url) and bare URLs into safe anchors.
   Only http(s) URLs are allowed (blocks javascript: etc.); links open in a new
   tab with no referrer. Operates on already-escaped text. */
function linkify(escaped) {
  const safe = (url) => /^https?:\/\//i.test(url);
  const anchor = (label, url) =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`;
  // [label](url)
  let out = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, label, url) =>
    safe(url) ? anchor(label, url) : label);
  // bare URLs (not already inside an href attribute)
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, url) => {
    const clean = url.replace(/[.,]+$/, "");
    return safe(clean) ? pre + anchor(clean, clean) : m;
  });
  return out;
}

/* Parse "1. **Heading**: Description" list → [{ heading, desc }] */
function parseWatchList(text) {
  const items = [];
  let current = null;
  for (const line of text.split("\n")) {
    const m = line.match(/^\d+\.\s+\*\*(.*?)\*\*[:\-–]?\s*(.*)/);
    if (m) {
      if (current) items.push(current);
      current = { heading: m[1].trim(), desc: m[2].trim() };
    } else if (current && line.trim()) {
      current.desc += " " + line.trim();
    }
  }
  if (current) items.push(current);
  return items;
}

/* Robustly parse a matchday checklist from whatever markdown the model returns.
   Handles "## heading", "### subheading", "1. **Title:** detail" and "- **Title:** detail".
   Returns { blocks: [{kind:'item'|'subhead', heading, detail}], note }. */
function parseMatchdayBlocks(raw) {
  const blocks = [];
  const noteBuf = [];
  let current = null;
  let inNote = false;

  const flush = () => { if (current) { blocks.push(current); current = null; } };
  const splitHeading = (body) => {
    const bold = body.match(/^\*\*(.+?)\*\*\s*[:：]?\s*(.*)$/);
    if (bold) return { heading: bold[1].replace(/[:：]\s*$/, "").trim(), detail: bold[2].trim() };
    const colon = body.match(/^([^:：]{2,48})[:：]\s+(.*)$/);
    if (colon) return { heading: colon[1].trim(), detail: colon[2].trim() };
    return { heading: body.trim(), detail: "" };
  };

  for (const rawLine of raw.split("\n")) {
    const trimmed = rawLine.trim();
    const heading = trimmed.match(/^#{2,6}\s+(.*)$/);

    if (heading && /official|source|reminder/i.test(heading[1])) { flush(); inNote = true; continue; }
    if (inNote) { if (trimmed) noteBuf.push(trimmed.replace(/^#{2,6}\s+/, "")); continue; }
    if (!trimmed) continue;

    if (heading) { flush(); blocks.push({ kind: "subhead", heading: heading[1].trim(), detail: "" }); continue; }

    const item = trimmed.match(/^(?:\d+[.)]|[-*•])\s+(.*)$/);
    if (item) { flush(); current = { kind: "item", ...splitHeading(item[1]) }; continue; }

    if (current) current.detail = (current.detail ? current.detail + " " : "") + trimmed;
  }
  flush();
  return { blocks, note: noteBuf.join(" ").trim() || null };
}

/* Dispatcher — routes to the correct task renderer */
function aiTextToCard(text, matchData, userContext, taskType) {
  const sections = parseSections(text);
  switch (taskType) {
    case "guide":    return renderGuide(sections, text, matchData, userContext);
    case "ask":      return renderAsk(sections, text, matchData, userContext);
    case "decision": return renderDecision(sections, text, matchData, userContext);
    case "momentum": return renderMomentum(sections, text, matchData, userContext);
    case "teams":    return renderTeams(sections, text, matchData, userContext);
    case "matchday": return renderMatchday(sections, text, matchData, userContext);
    default:         return renderGeneric(text, matchData, userContext);
  }
}

/* ── Guide: overview + teams + styles + watch list + rules + encouragement ── */
function renderGuide(sections, raw, matchData, userContext) {
  const body = sections.map((s) => {
    if (/3 things/i.test(s.title)) {
      const items = parseWatchList(s.content);
      return rs("", s.title, items.length ? watchList(items) : mdToHtml(s.content));
    }
    return rs("", s.title, mdToHtml(s.content));
  }).join("") || `<div class="result-section"><div class="result-section__text">${mdToHtml(raw)}</div></div>`;
  return ticketCard(matchData, userContext, "Match Guide", body);
}

/* ── Ask: direct answer → cause → significance → what to watch ── */
function renderAsk(sections, raw, matchData, userContext) {
  const body =
    (sections.map((s) => rs("", s.title, mdToHtml(s.content))).join("") ||
      `<div class="result-section"><div class="result-section__text">${mdToHtml(raw)}</div></div>`) +
    noticeBox("For official rulings on specific decisions, always refer to the match broadcast or official FIFA communications.", "info");
  return ticketCard(matchData, userContext, "Live Explainer", body);
}

/* ── Decision: meaning + process + controversy + replay tip + trust notice ── */
function renderDecision(sections, raw, matchData, userContext) {
  const mainSections = sections.filter((_, i) => i < 4);
  const trustSection = sections.find((s) => /trust/i.test(s.title));
  const main =
    mainSections.map((s) => rs("", s.title, mdToHtml(s.content))).join("") ||
    `<div class="result-section"><div class="result-section__text">${mdToHtml(raw)}</div></div>`;
  const trust = trustSection
    ? `<div class="notice-box notice-box--info">
        <div class="notice-box__icon"><svg class="icon icon--sm" aria-hidden="true"><use href="#icon-var"/></svg></div>
        <p class="notice-box__text"><strong>Trust &amp; transparency:</strong> ${escapeHTML(trustSection.content.replace(/\n+/g, " "))} This is context and education — not an official ruling.</p>
      </div>`
    : noticeBox("This is educational context — not an official ruling. The referee’s decision stands.", "info");
  return ticketCard(matchData, userContext, "Decision Explainer", main + trust);
}

/* ── Momentum: what's happening + why + tactics + human side + watch next ── */
function renderMomentum(sections, raw, matchData, userContext) {
  const body =
    (sections.map((s) => rs("", s.title, mdToHtml(s.content))).join("") ||
      `<div class="result-section"><div class="result-section__text">${mdToHtml(raw)}</div></div>`) +
    noticeBox("This is contextual explanation. Actual tactical decisions depend on the specific teams and coaches involved.", "");
  return ticketCard(matchData, userContext, "Momentum & Tactics Explainer", body);
}

/* ── Teams: one teamCard per team + note ── */
function renderTeams(sections, raw, matchData, userContext) {
  const isNote = (s) => /any team|valid|no wrong/i.test(s.title + " " + s.content);
  const teamSections = sections.filter((s) => !isNote(s));
  const noteSection  = sections.find((s) => isNote(s));
  // Remember the recommended teams so the Matchday guide can offer them.
  recommendedTeams = teamSections.map((s) => s.title);
  renderMatchdayTeamPicker();
  const cards = teamSections
    .map((s) =>
      teamCard(
        escapeHTML(s.title),
        mdToHtml(s.content) + teamFixturesHtml(s.title, allMatchesCache || []),
      ),
    )
    .join("");
  const noteHtml = noteSection
    ? noticeBox(escapeHTML(noteSection.content), "info")
    : noticeBox("You can support any team for any reason. There are no wrong choices in fan culture.", "info");
  const body =
    rs("Your team recommendations", "Based on what you told us", `<div class="team-cards">${cards || mdToHtml(raw)}</div>`) +
    noteHtml;
  return ticketCard({ label: "World Cup 2026", stage: "Fan Matching", date: "" }, userContext, "Team Finder", body);
}

/* ── Matchday: interactive checklist + official sources notice ── */
function renderMatchday(sections, raw, matchData, userContext) {
  const isNote = (s) => /official|source|reminder/i.test(s.title);
  const checkSections = sections.filter((s) => !isNote(s));
  const noteSection   = sections.find((s) =>  isNote(s));
  const iconFor = (title) => {
    if (/ticket|book/i.test(title))              return "ticket";
    if (/transport|transit|travel|alarm/i.test(title)) return "transit";
    if (/crowd|noise|atmospher/i.test(title))    return "crowd";
    if (/bag|pack/i.test(title))                 return "bag";
    if (/dress|wear|kit|scarf/i.test(title))     return "scarf";
    if (/stadium|arrive|gate|early/i.test(title)) return "stadium";
    if (/broadcast|stream|channel|tv/i.test(title)) return "source";
    if (/pitch|kickoff|guide|read/i.test(title)) return "pitch";
    return "source";
  };
  let noteText = noteSection ? noteSection.content : null;
  let checklistHTML;
  if (checkSections.length >= 2) {
    // Model followed the "one ## heading per item" format.
    checklistHTML = `<div class="checklist">${checkSections.map((s, i) =>
      checklistItem(iconFor(s.title), escapeHTML(s.title), mdToHtml(s.content), `ai-cl-${i}`)
    ).join("")}</div>`;
  } else {
    // Fallback: model returned a numbered/bulleted list — parse it into items.
    const { blocks, note } = parseMatchdayBlocks(raw);
    if (note) noteText = note;
    const itemCount = blocks.filter((b) => b.kind === "item").length;
    if (itemCount >= 2) {
      let n = 0;
      checklistHTML = `<div class="checklist">${blocks.map((b) => {
        if (b.kind === "subhead") {
          return /^(matchday|your )?checklist/i.test(b.heading)
            ? ""
            : `<div class="checklist__subhead">${escapeHTML(b.heading)}</div>`;
        }
        return checklistItem(iconFor(b.heading), escapeHTML(b.heading), mdToHtml(b.detail), `ai-cl-${n++}`);
      }).join("")}</div>`;
    } else {
      checklistHTML = `<div class="result-section__text">${mdToHtml(raw)}</div>`;
    }
  }
  const noteHtml = noteText
    ? noticeBox(mdToHtml(noteText), "")
    : noticeBox("For bag policies, venue rules, transit schedules, and ticket validity, always check the official FIFA website, your specific venue, and local transit authorities.", "");
  const venueCtx = userContext.viewContext;
  const venue = venueCtx === "stadium" ? "Stadium" : venueCtx === "bar" ? "Bar / Watch Party" : "Home Viewing";
  const body =
    rs("Your checklist", `Prepared for: ${venue}`,
      `<p style="margin-bottom:14px">Tap each item to check it off as you prepare.</p>${checklistHTML}`
    ) + noteHtml;
  return ticketCard(matchData, userContext, `Matchday Confidence Guide — ${venue}`, body);
}

/* ── Generic fallback ── */
function renderGeneric(text, matchData, userContext) {
  const body = `<div class="result-section"><div class="result-section__text">${mdToHtml(text)}</div></div>`;
  return ticketCard(matchData, userContext, "AI Response", body);
}

/* ─────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────── */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ─────────────────────────────────────────────────────────────
   MATCH EVENT DATA — fetch, parse, format for AI prompt
───────────────────────────────────────────────────────────── */

async function fetchMatchEvents(matchId) {
  if (matchEventCache[matchId]) return matchEventCache[matchId];
  try {
    const res = await fetch(`/api/match/${matchId}`);
    if (!res.ok) return null;
    const data = await res.json();
    const parsed = parseMatchEvents(data);
    matchEventCache[matchId] = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function parseMatchEvents(data) {
  const status = data.status || "SCHEDULED";
  const isPlayed = ["FINISHED", "LIVE", "IN_PLAY", "PAUSED"].includes(status);
  return {
    isPlayed,
    goals: (data.goals || []).map((g) => ({
      minute: g.minute,
      extra:  g.minuteExtra || null,
      team:   g.team?.name  || "?",
      scorer: g.scorer?.name || "Unknown",
      type:   g.type || "REGULAR",
    })),
    bookings: (data.bookings || []).map((b) => ({
      minute: b.minute,
      team:   b.team?.name   || "?",
      player: b.player?.name || "Unknown",
      card:   b.card,
    })),
    substitutions: (data.substitutions || []).map((s) => ({
      minute:    s.minute,
      team:      s.team?.name      || "?",
      playerIn:  s.playerIn?.name  || "?",
      playerOut: s.playerOut?.name || "?",
    })),
  };
}

function buildMatchEventsContext(events) {
  if (!events) {
    return "CONFIRMED MATCH EVENTS: Could not load event data. Do not claim any specific event occurred.";
  }
  if (!events.isPlayed) {
    return "CONFIRMED MATCH EVENTS: This match has not started yet — no events have occurred.";
  }

  const lines = ["CONFIRMED MATCH EVENTS (from official API — treat these as facts):"];

  if (events.goals.length === 0) {
    lines.push("- Goals: None recorded in this match.");
  } else {
    events.goals.forEach((g) => {
      const time = g.extra ? `${g.minute}+${g.extra}'` : `${g.minute}'`;
      lines.push(`- Goal: ${time} — ${g.scorer} (${g.team})`);
    });
  }

  if (events.bookings.length === 0) {
    lines.push("- Yellow/Red cards: None issued in this match.");
  } else {
    events.bookings.forEach((b) => {
      const name =
        b.card === "YELLOW"      ? "Yellow card" :
        b.card === "RED"         ? "Red card"    :
        b.card === "YELLOW_RED"  ? "Second yellow (red)" : b.card;
      lines.push(`- ${name}: ${b.minute}' — ${b.player} (${b.team})`);
    });
  }

  if (events.substitutions.length === 0) {
    lines.push("- Substitutions: None recorded in this match.");
  } else {
    events.substitutions.forEach((s) => {
      lines.push(`- Substitution: ${s.minute}' — ${s.playerIn} on for ${s.playerOut} (${s.team})`);
    });
  }

  lines.push(
    "- VAR decisions and cancelled goals are NOT tracked in this data — if asked about these, state clearly you cannot confirm them from available data."
  );

  return lines.join("\n");
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
          ["AI", currentAILabel, "stub-ai"],
        ])}
      </div>
    </div>
    <div class="result-card__body">${bodyHTML}</div>
    ${currentAIProvenance ? `<div class="result-card__provenance">${currentAIProvenance}</div>` : ""}
  </div>`;
}

/* Build a simple result section block.
   eyebrow + title are always plain text (often AI-generated), so they are
   HTML-escaped here. content is pre-rendered HTML and passed through. */
function rs(eyebrow, title, content) {
  // Skip the small eyebrow label when it's empty or just repeats the title —
  // each section then shows a single clean heading instead of two stacked ones.
  const showEyebrow =
    eyebrow && eyebrow.trim() &&
    eyebrow.trim().toLowerCase() !== String(title).trim().toLowerCase();
  return `
  <div class="result-section">
    ${showEyebrow ? `<div class="result-section__eyebrow">${escapeHTML(eyebrow)}</div>` : ""}
    <div class="result-section__title">${escapeHTML(title)}</div>
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
  // Load live World Cup matches from the football-data.org API
  populateMatchDropdown();
  // Initialise the matchday icon grid for the default venue (home).
  renderMatchdayIcons("home");
  // Interactive offside explainer.
  initOffsideLab();
  // Momentum meter (drag + stackable events) and tactical board.
  initMomentumDrag();
  renderMomentumMeter();
  renderTimeline();
  initTacticalBoard();
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
  // Keep the decorative matchday icon grid in sync with the chosen venue.
  if (groupId === "matchday-chips") renderMatchdayIcons(btn.dataset.value);
}

/* Render the decorative matchday icon grid for the selected venue, so the
   preview icons match the checklist the fan will actually get. */
const MATCHDAY_ICON_SETS = {
  home: [
    ["source", "Broadcast"],
    ["pitch", "Kickoff time"],
    ["check", "Rules cheat-sheet"],
    ["crowd", "Watch together"],
  ],
  bar: [
    ["crowd", "Find a bar"],
    ["stadium", "Arrive early"],
    ["scarf", "Etiquette"],
    ["transit", "Get home"],
  ],
  stadium: [
    ["ticket", "Ticket"],
    ["bag", "Bag policy"],
    ["transit", "Transit"],
    ["stadium", "Stadium gate"],
    ["scarf", "What to wear"],
    ["crowd", "Crowd noise"],
  ],
};
function renderMatchdayIcons(venue) {
  const grid = document.getElementById("matchday-icons");
  if (!grid) return;
  const set = MATCHDAY_ICON_SETS[venue] || MATCHDAY_ICON_SETS.home;
  grid.innerHTML = set
    .map(
      ([icon, label], i) =>
        `<div class="matchday-icon-item${i === set.length - 1 ? " matchday-icon-item--last" : ""}">
          <div class="matchday-icon-wrap"><svg class="icon icon--md"><use href="#icon-${icon}"/></svg></div>
          <div class="matchday-icon-label">${label}</div>
        </div>`,
    )
    .join("");
}

/* Populate the Matchday "which team are you supporting?" picker from the most
   recent Choose My Team result. Hidden until there are recommendations. */
function renderMatchdayTeamPicker() {
  const block = document.getElementById("matchday-team-block");
  const strip = document.getElementById("matchday-teams");
  if (!block || !strip) return;
  if (!recommendedTeams.length) {
    strip.innerHTML = "";
    block.classList.add("hidden");
    return;
  }
  strip.innerHTML = recommendedTeams
    .map(
      (name, i) =>
        `<button class="chip-btn chip-btn--select${i === 0 ? " selected" : ""}" data-value="${escapeHTML(name)}" onclick="selectChip('matchday-teams',this)">
          <svg class="icon icon--xs" aria-hidden="true"><use href="#icon-pitch"/></svg> ${escapeHTML(name)}
        </button>`,
    )
    .join("");
  block.classList.remove("hidden");
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

/* ─────────────────────────────────────────────────────────────
   MOMENTUM METER — stackable events + draggable control
   Control value = % in Team A's favour (0–100, 50 = even).
───────────────────────────────────────────────────────────── */

const MOMENTUM_EVENTS = {
  goalA:  { label: "Team A goal",  delta:  20, icon: "pitch",    desc: "Team A scores. Confidence surges; Team B must reorganise and chase the game." },
  goalB:  { label: "Team B goal",  delta: -20, icon: "pitch",    desc: "Team B scores. The swing flips — Team A now has to react and reopen the game." },
  redA:   { label: "Red card (A)", delta: -27, icon: "red-card", desc: "Team A goes down to 10 men — they must defend deeper and can attack far less." },
  subA:   { label: "A makes a sub",delta:  11, icon: "arrow",    desc: "Fresh legs from Team A's bench inject energy and can change the tactical picture." },
  pressA: { label: "A high press", delta:  13, icon: "arrow",    desc: "Team A presses high, forcing Team B back and winning the ball in dangerous areas." },
  crowd:  { label: "Crowd lifts A",delta:   8, icon: "crowd",    desc: "A roaring home crowd lifts Team A's adrenaline and can unsettle the visitors." },
  tiredA: { label: "A tiring",     delta: -12, icon: "player",   desc: "Team A's legs are heavy late on; the fresher side starts to take over." },
};

const MOMENTUM = { value: 50, events: [], dragging: false };

const clampPct = (n) => Math.max(0, Math.min(100, Math.round(n)));

function renderMomentumMeter() {
  const pctA = clampPct(MOMENTUM.value);
  const pctB = 100 - pctA;
  const fillA  = document.getElementById("momentum-fill-a");
  const fillB  = document.getElementById("momentum-fill-b");
  const labelA = document.getElementById("momentum-pct-a");
  const labelB = document.getElementById("momentum-pct-b");
  const handle = document.getElementById("momentum-handle");
  const bar    = document.getElementById("momentum-bar");
  if (fillA) fillA.style.width = pctA + "%";
  if (fillB) fillB.style.width = pctB + "%";
  if (labelA) labelA.textContent = pctA + "%";
  if (labelB) labelB.textContent = pctB + "%";
  if (handle) handle.style.left = pctA + "%";
  if (bar) bar.setAttribute("aria-valuenow", pctA);
}

function addMomentumEvent(key, btn) {
  const ev = MOMENTUM_EVENTS[key];
  if (!ev) return;
  MOMENTUM.value = clampPct(MOMENTUM.value + ev.delta);
  MOMENTUM.events.push({ key });
  renderMomentumMeter();
  renderTimeline();
  const desc = document.getElementById("momentum-desc");
  if (desc) desc.textContent = ev.desc;
  if (btn) {
    btn.classList.add("just-added");
    setTimeout(() => btn.classList.remove("just-added"), 450);
  }
}

function renderTimeline() {
  const list  = document.getElementById("momentum-timeline-list");
  const empty = document.getElementById("momentum-timeline-empty");
  const reset = document.getElementById("momentum-reset");
  if (!list) return;
  const has = MOMENTUM.events.length > 0;
  if (empty) empty.hidden = has;
  if (reset) reset.hidden = !has;

  let running = 50;
  list.innerHTML = MOMENTUM.events
    .map((e, i) => {
      if (e.manual) {
        running = e.value;
        return `<li class="momentum-timeline__item momentum-timeline__item--manual">
          <span class="momentum-timeline__num">${i + 1}</span>
          <span class="momentum-timeline__txt">You set the meter by hand</span>
          <span class="momentum-timeline__pct">${running}% A</span>
        </li>`;
      }
      const ev = MOMENTUM_EVENTS[e.key];
      running = clampPct(running + ev.delta);
      const sign = ev.delta > 0 ? "+" : "";
      const dir = ev.delta > 0 ? "a" : "b";
      return `<li class="momentum-timeline__item">
        <span class="momentum-timeline__num">${i + 1}</span>
        <svg class="icon icon--xs" aria-hidden="true"><use href="#icon-${ev.icon}"/></svg>
        <span class="momentum-timeline__txt">${ev.label}</span>
        <span class="momentum-timeline__delta momentum-timeline__delta--${dir}">${sign}${ev.delta}</span>
        <span class="momentum-timeline__pct">${running}% A</span>
      </li>`;
    })
    .join("");
}

function resetMomentum() {
  MOMENTUM.value = 50;
  MOMENTUM.events = [];
  renderMomentumMeter();
  renderTimeline();
  const desc = document.getElementById("momentum-desc");
  if (desc) desc.textContent =
    "Tap an event below — or drag the meter — to explore the momentum shift.";
}

function initMomentumDrag() {
  const bar = document.getElementById("momentum-bar");
  if (!bar) return;
  const pctFromEvent = (clientX) => {
    const r = bar.getBoundingClientRect();
    return clampPct(((clientX - r.left) / r.width) * 100);
  };
  const setManual = (pct) => {
    MOMENTUM.value = pct;
    const last = MOMENTUM.events[MOMENTUM.events.length - 1];
    if (last && last.manual) last.value = pct;
    else MOMENTUM.events.push({ manual: true, value: pct });
    renderMomentumMeter();
    renderTimeline();
    const desc = document.getElementById("momentum-desc");
    if (desc) desc.textContent =
      pct > 55 ? "You see Team A on top — press Explain the Shift for the likely why."
      : pct < 45 ? "You see Team B on top — press Explain the Shift for the likely why."
      : "You read it as evenly poised — press Explain the Shift for the likely why.";
  };
  bar.addEventListener("pointerdown", (e) => {
    MOMENTUM.dragging = true;
    bar.setPointerCapture?.(e.pointerId);
    bar.classList.add("is-dragging");
    setManual(pctFromEvent(e.clientX));
  });
  bar.addEventListener("pointermove", (e) => {
    if (MOMENTUM.dragging) setManual(pctFromEvent(e.clientX));
  });
  const end = (e) => {
    if (!MOMENTUM.dragging) return;
    MOMENTUM.dragging = false;
    bar.classList.remove("is-dragging");
    bar.releasePointerCapture?.(e.pointerId);
  };
  bar.addEventListener("pointerup", end);
  bar.addEventListener("pointercancel", end);
  bar.addEventListener("keydown", (e) => {
    let d = 0;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") d = 3;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") d = -3;
    else if (e.key === "Home") return setManual(0);
    else if (e.key === "End") return setManual(100);
    if (d) { e.preventDefault(); setManual(clampPct(MOMENTUM.value + d)); }
  });
}

function momentumStorySummary() {
  if (!MOMENTUM.events.length) return "";
  const parts = MOMENTUM.events.map((e) =>
    e.manual ? `viewer set control to ${e.value}% Team A`
             : MOMENTUM_EVENTS[e.key].label,
  );
  return `Match events in order: ${parts.join(" → ")}. ` +
    `Current match-control meter reads ${clampPct(MOMENTUM.value)}% Team A / ${100 - clampPct(MOMENTUM.value)}% Team B.`;
}

/* ─────────────────────────────────────────────────────────────
   TACTICAL BOARD — switchable formations, game plans, tooltips
───────────────────────────────────────────────────────────── */

const ROLE_INFO = {
  GK:  "Goalkeeper — last line of defence; starts attacks with the ball at their feet.",
  RB:  "Right-back — defends the right flank and overlaps to support attacks.",
  LB:  "Left-back — defends the left flank and overlaps to support attacks.",
  CB:  "Centre-back — the central defensive wall; heads clearances and marks strikers.",
  RWB: "Right wing-back — covers the whole right flank, defending and attacking.",
  LWB: "Left wing-back — covers the whole left flank, defending and attacking.",
  DM:  "Defensive midfielder — shields the back line and breaks up opposition attacks.",
  CM:  "Central midfielder — the engine; links defence and attack and controls tempo.",
  RM:  "Right midfielder — provides width and crosses from the right.",
  LM:  "Left midfielder — provides width and crosses from the left.",
  AM:  "Attacking midfielder — creates chances between the lines behind the strikers.",
  RW:  "Right winger — hugs the touchline to beat defenders and deliver crosses.",
  LW:  "Left winger — hugs the touchline to beat defenders and deliver crosses.",
  ST:  "Striker — the main goal threat, leading the line up front.",
};

const FORMATIONS_A = {
  "433": [
    [24,115,"GK"],
    [68,68,"RB"],[68,95,"CB"],[68,132,"CB"],[68,159,"LB"],
    [120,80,"CM"],[120,115,"CM"],[120,150,"CM"],
    [162,75,"RW"],[162,115,"ST"],[162,155,"LW"],
  ],
  "4231": [
    [24,115,"GK"],
    [64,68,"RB"],[64,95,"CB"],[64,132,"CB"],[64,159,"LB"],
    [100,100,"DM"],[100,130,"DM"],
    [140,72,"RW"],[140,115,"AM"],[140,158,"LW"],
    [170,115,"ST"],
  ],
  "442": [
    [24,115,"GK"],
    [64,68,"RB"],[64,95,"CB"],[64,132,"CB"],[64,159,"LB"],
    [112,68,"RM"],[112,98,"CM"],[112,132,"CM"],[112,162,"LM"],
    [158,98,"ST"],[158,135,"ST"],
  ],
  "352": [
    [24,115,"GK"],
    [58,80,"CB"],[58,115,"CB"],[58,150,"CB"],
    [104,60,"RWB"],[104,92,"CM"],[104,115,"CM"],[104,138,"CM"],[104,170,"LWB"],
    [156,98,"ST"],[156,135,"ST"],
  ],
};

const FORMATION_B = [
  [336,115,"GK"],
  [292,68,"RB"],[292,95,"CB"],[292,132,"CB"],[292,159,"LB"],
  [242,68,"RM"],[242,95,"CM"],[242,132,"CM"],[242,159,"LM"],
  [200,95,"ST"],[200,135,"ST"],
];

const SHAPE_LABEL = { "433":"4-3-3", "4231":"4-2-3-1", "442":"4-4-2", "352":"3-5-2" };

const GAME_PLANS = {
  balanced: { dx: 0,   squeeze: 0,   overlay: "pass",
    note: "Balanced shape — Team A holds its lines and looks to control possession." },
  press:    { dx: 30,  squeeze: 0,   overlay: "press",
    note: "High press — Team A pushes up to win the ball high and pen Team B in." },
  counter:  { dx: -24, squeeze: 0,   overlay: "counter",
    note: "Counter-attack — Team A sits a touch deeper, then springs forward fast on the break." },
  bus:      { dx: -34, squeeze: 0.5, overlay: "block",
    note: "Parking the bus — Team A drops into a deep, compact block to protect the lead." },
};

const BOARD = { ready: false, formation: "433", plan: "balanced", dots: [], anim: null };

const SVG_NS = "http://www.w3.org/2000/svg";

function makePlayer(parent, x, y, code, fill) {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "tac-player");
  g.setAttribute("transform", `translate(${x},${y})`);
  g.setAttribute("tabindex", "0");
  g.setAttribute("role", "img");
  g.setAttribute("aria-label", `${code}: ${ROLE_INFO[code] || code}`);
  const c = document.createElementNS(SVG_NS, "circle");
  c.setAttribute("r", "8");
  c.setAttribute("fill", fill);
  c.setAttribute("stroke", "#fff");
  c.setAttribute("stroke-width", "1.5");
  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("text-anchor", "middle");
  t.setAttribute("y", "2.3");
  t.setAttribute("fill", "#fff");
  t.setAttribute("font-size", "5.4");
  t.setAttribute("font-family", "monospace");
  t.setAttribute("font-weight", "bold");
  t.textContent = code;
  g.appendChild(c);
  g.appendChild(t);
  parent.appendChild(g);
  return { el: g, code };
}

function planPositions(base) {
  const plan = GAME_PLANS[BOARD.plan];
  return base.map(([x, y, code]) => {
    if (code === "GK") return [x, y, code];
    const nx = Math.max(16, Math.min(168, x + plan.dx));
    const ny = plan.squeeze ? 115 + (y - 115) * (1 - plan.squeeze) : y;
    return [nx, ny, code];
  });
}

function renderBoardOverlay() {
  const ov = document.getElementById("tac-overlay");
  if (!ov) return;
  ov.innerHTML = "";
  const plan = GAME_PLANS[BOARD.plan].overlay;
  const add = (tag, attrs) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    ov.appendChild(el);
    return el;
  };
  if (plan === "press") {
    add("path", { class: "anim-press-line", d: "M150,115 L235,115", fill: "none",
      stroke: "rgba(240,200,0,0.7)", "stroke-width": "1.8", "stroke-dasharray": "5,4",
      "marker-end": "url(#presshead)" });
    add("text", { x: "176", y: "108", fill: "rgba(240,200,0,0.85)",
      "font-size": "6", "font-family": "monospace" }).textContent = "PRESS";
  } else if (plan === "counter") {
    add("path", { d: "M70,150 Q140,150 178,118", fill: "none",
      stroke: "rgba(255,255,255,0.7)", "stroke-width": "1.8", "marker-end": "url(#arrowhead)" });
    add("text", { x: "96", y: "165", fill: "rgba(255,255,255,0.8)",
      "font-size": "6", "font-family": "monospace" }).textContent = "BREAK";
  } else if (plan === "block") {
    add("rect", { x: "30", y: "70", width: "70", height: "90", fill: "rgba(26,110,219,0.16)",
      stroke: "rgba(26,110,219,0.5)", "stroke-width": "1", "stroke-dasharray": "4,3" });
    add("text", { x: "34", y: "66", fill: "rgba(255,255,255,0.75)",
      "font-size": "6", "font-family": "monospace" }).textContent = "LOW BLOCK";
  } else {
    add("path", { d: "M168,113 Q178,100 190,107", fill: "none",
      stroke: "rgba(255,255,255,0.6)", "stroke-width": "1.8", "marker-end": "url(#arrowhead)" });
  }
}

function layoutBoard(animate) {
  const targets = planPositions(FORMATIONS_A[BOARD.formation]);
  if (BOARD.anim) cancelAnimationFrame(BOARD.anim);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const starts = BOARD.dots.map((d) => {
    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(d.el.getAttribute("transform"));
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : [targets[0][0], targets[0][1]];
  });
  BOARD.dots.forEach((d, i) => {
    const code = targets[i][2];
    d.code = code;
    d.el.querySelector("text").textContent = code;
    d.el.setAttribute("aria-label", `${code}: ${ROLE_INFO[code] || code}`);
  });
  if (!animate || reduce) {
    BOARD.dots.forEach((d, i) =>
      d.el.setAttribute("transform", `translate(${targets[i][0]},${targets[i][1]})`));
    renderBoardOverlay();
    return;
  }
  const dur = 480, t0 = performance.now();
  const stepFn = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    BOARD.dots.forEach((d, i) => {
      const x = starts[i][0] + (targets[i][0] - starts[i][0]) * e;
      const y = starts[i][1] + (targets[i][1] - starts[i][1]) * e;
      d.el.setAttribute("transform", `translate(${x.toFixed(1)},${y.toFixed(1)})`);
    });
    if (k < 1) BOARD.anim = requestAnimationFrame(stepFn);
    else { BOARD.anim = null; renderBoardOverlay(); }
  };
  renderBoardOverlay();
  BOARD.anim = requestAnimationFrame(stepFn);
}

function updateBoardText() {
  const title = document.getElementById("board-title");
  if (title) title.textContent = `TACTICAL BOARD — ${SHAPE_LABEL[BOARD.formation]} vs 4-4-2`;
  const explain = document.getElementById("board-explain");
  if (explain) {
    const shapeNote = {
      "433": "Team A's 4-3-3 commits three forwards and a midfield three — width and attacking threat.",
      "4231": "Team A's 4-2-3-1 double-pivot screens the defence while the No.10 feeds a lone striker.",
      "442": "Team A's 4-4-2 is compact and balanced, with two banks of four and a strike pair.",
      "352": "Team A's 3-5-2 packs midfield and uses wing-backs for width against the 4-4-2.",
    }[BOARD.formation];
    explain.textContent = `${shapeNote} ${GAME_PLANS[BOARD.plan].note}`;
  }
}

function setFormation(key, btn) {
  if (!FORMATIONS_A[key]) return;
  BOARD.formation = key;
  document.querySelectorAll("#formation-chips .chip-btn--select")
    .forEach((b) => b.classList.remove("selected"));
  if (btn) btn.classList.add("selected");
  layoutBoard(true);
  updateBoardText();
}

function setScenario(key, btn) {
  if (!GAME_PLANS[key]) return;
  BOARD.plan = key;
  document.querySelectorAll("#scenario-chips .chip-btn--select")
    .forEach((b) => b.classList.remove("selected"));
  if (btn) btn.classList.add("selected");
  layoutBoard(true);
  updateBoardText();
}

function initBoardTooltip(svg) {
  const tip = document.getElementById("board-tooltip");
  const wrap = svg.closest(".tactical-board");
  if (!tip || !wrap) return;
  const show = (g) => {
    tip.textContent = g.getAttribute("aria-label");
    tip.hidden = false;
    const gr = g.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    tip.style.left = (gr.left - wr.left + wrap.scrollLeft + gr.width / 2) + "px";
    tip.style.top = (gr.top - wr.top - 6) + "px";
  };
  const hide = () => { tip.hidden = true; };
  svg.addEventListener("pointerover", (e) => {
    const g = e.target.closest(".tac-player"); if (g) show(g);
  });
  svg.addEventListener("pointerout", (e) => {
    const g = e.target.closest(".tac-player"); if (g) hide();
  });
  svg.addEventListener("focusin", (e) => {
    const g = e.target.closest(".tac-player"); if (g) show(g);
  });
  svg.addEventListener("focusout", hide);
}

function initTacticalBoard() {
  const svg = document.getElementById("tac-svg");
  const gA = document.getElementById("tac-a");
  const gB = document.getElementById("tac-b");
  if (!svg || !gA || !gB) return;
  FORMATION_B.forEach(([x, y, code]) => makePlayer(gB, x, y, code, "#b56a00"));
  BOARD.dots = FORMATIONS_A["433"].map(([x, y, code]) => makePlayer(gA, x, y, code, "#1a6edb"));
  BOARD.ready = true;
  layoutBoard(false);
  updateBoardText();
  initBoardTooltip(svg);
}

/* ─────────────────────────────────────────────────────────────
   INTERACTIVE OFFSIDE EXPLAINER
   Drag the attacker / last defender, get a live verdict, press
   Play to animate the pass, or pick a scenario.
───────────────────────────────────────────────────────────── */

const OFFSIDE = {
  ready: false,
  attX: 560, defX: 600,
  ATT_Y: 150, DEF_Y: 252,
  PASSER: { x: 305, y: 218 },
  ATT_MIN: 360, ATT_MAX: 840,
  DEF_MIN: 470, DEF_MAX: 800,
  playing: false,
  els: {},
};

const OFFSIDE_SCENARIOS = {
  onside:  { att: 520, def: 600 },
  level:   { att: 600, def: 600 },
  offside: { att: 700, def: 590 },
  var:     { att: 606, def: 600 },
};

function clampNum(x, min, max) { return Math.max(min, Math.min(max, x)); }

function initOffsideLab() {
  const svg = document.getElementById("offside-svg");
  if (!svg) return;
  const e = OFFSIDE.els;
  e.attacker      = document.getElementById("off-attacker");
  e.attackerCircle= document.getElementById("off-attacker-circle");
  e.verdict       = document.getElementById("off-attacker-verdict");
  e.defender      = document.getElementById("off-defender");
  e.line          = document.getElementById("off-line");
  e.lineLabel     = document.getElementById("off-line-label");
  e.lineSub       = document.getElementById("off-line-sub");
  e.passLine      = document.getElementById("off-pass-line");
  e.ball          = document.getElementById("off-ball");
  e.badge         = document.getElementById("off-badge");
  e.hint          = document.getElementById("off-hint");
  if (!e.attacker || !e.defender) return;
  OFFSIDE.ready = true;

  let active = null;
  const svgX = (clientX) => {
    const r = svg.getBoundingClientRect();
    return (clientX - r.left) / r.width * 900;
  };
  const onDown = (which) => (ev) => {
    active = which;
    svg.classList.add("is-dragging");
    svg.setPointerCapture?.(ev.pointerId);
    ev.preventDefault();
  };
  const onMove = (ev) => {
    if (!active || OFFSIDE.playing) return;
    const x = svgX(ev.clientX);
    if (active === "att") OFFSIDE.attX = clampNum(x, OFFSIDE.ATT_MIN, OFFSIDE.ATT_MAX);
    else OFFSIDE.defX = clampNum(x, OFFSIDE.DEF_MIN, OFFSIDE.DEF_MAX);
    renderOffside();
  };
  const onUp = (ev) => {
    if (!active) return;
    active = null;
    svg.classList.remove("is-dragging");
    svg.releasePointerCapture?.(ev.pointerId);
  };
  e.attacker.addEventListener("pointerdown", onDown("att"));
  e.defender.addEventListener("pointerdown", onDown("def"));
  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerup", onUp);
  svg.addEventListener("pointerleave", onUp);
  renderOffside();
}

function renderOffside() {
  if (!OFFSIDE.ready) return;
  const e = OFFSIDE.els;
  const { attX, defX, ATT_Y, DEF_Y } = OFFSIDE;
  e.attacker.setAttribute("transform", `translate(${attX},${ATT_Y})`);
  e.defender.setAttribute("transform", `translate(${defX},${DEF_Y})`);
  e.line.setAttribute("x1", defX);
  e.line.setAttribute("x2", defX);
  e.lineLabel.setAttribute("x", defX + 4);
  e.lineSub.setAttribute("x", defX + 4);

  const diff = attX - defX;           // >0 means ahead of the last defender
  const offside = diff > 1;
  const color = offside ? "#e84040" : "#36c270";
  e.attackerCircle.setAttribute("stroke", color);
  e.verdict.setAttribute("fill", color);
  e.verdict.textContent = offside ? "OFFSIDE ✗" : diff < -2 ? "ONSIDE ✓" : "LEVEL ✓";
  if (e.badge) {
    e.badge.textContent = offside ? "OFFSIDE" : "ONSIDE";
    e.badge.classList.toggle("is-off", offside);
    e.badge.classList.toggle("is-on", !offside);
  }
  if (e.hint) {
    e.hint.textContent = offside
      ? "The attacker is ahead of the last defender at the moment of the pass — offside."
      : Math.abs(diff) <= 2
        ? "The attacker is level with the last defender — level counts as onside."
        : "The attacker is behind the last defender — a legal position.";
  }
  // Reset the ball/pass-line until the user presses Play.
  if (!OFFSIDE.playing && e.ball && e.passLine) {
    e.ball.setAttribute("cx", OFFSIDE.PASSER.x);
    e.ball.setAttribute("cy", OFFSIDE.PASSER.y);
    e.passLine.setAttribute("opacity", "0");
  }
}

function setOffsideScenario(name, btn) {
  const s = OFFSIDE_SCENARIOS[name];
  if (!s) return;
  OFFSIDE.attX = s.att;
  OFFSIDE.defX = s.def;
  document.querySelectorAll(".offside-scn").forEach((b) => b.classList.remove("is-active"));
  if (btn) btn.classList.add("is-active");
  renderOffside();
  playOffsidePass();
}

function playOffsidePass() {
  if (!OFFSIDE.ready || OFFSIDE.playing) return;
  const e = OFFSIDE.els;
  const { PASSER, attX, ATT_Y } = OFFSIDE;
  e.passLine.setAttribute("x1", PASSER.x);
  e.passLine.setAttribute("y1", PASSER.y);
  e.passLine.setAttribute("x2", attX);
  e.passLine.setAttribute("y2", ATT_Y);
  e.passLine.setAttribute("opacity", "1");

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    e.ball.setAttribute("cx", attX);
    e.ball.setAttribute("cy", ATT_Y);
    flashOffsideBadge();
    return;
  }
  OFFSIDE.playing = true;
  const startX = PASSER.x, startY = PASSER.y, dur = 650, t0 = performance.now();
  function step(now) {
    const k = Math.min(1, (now - t0) / dur);
    const ease = 1 - Math.pow(1 - k, 2);
    e.ball.setAttribute("cx", startX + (attX - startX) * ease);
    e.ball.setAttribute("cy", startY + (ATT_Y - startY) * ease);
    if (k < 1) requestAnimationFrame(step);
    else { OFFSIDE.playing = false; flashOffsideBadge(); }
  }
  requestAnimationFrame(step);
}

function flashOffsideBadge() {
  const badge = OFFSIDE.els.badge;
  if (!badge) return;
  badge.classList.remove("is-flash");
  void badge.offsetWidth;
  badge.classList.add("is-flash");
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

  const outputId = "ask-output";

  if (isOffTopic(question)) {
    renderOutput(outputId, warningCard(question));
    scrollToOutput(outputId);
    return;
  }

  const userContext = getUserContext();
  const matchData = getMatchData();

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
  const rawInput = document.getElementById("momentum-input")?.value?.trim();

  const outputId = "momentum-output";

  if (rawInput && isOffTopic(rawInput)) {
    renderOutput(outputId, warningCard(rawInput));
    scrollToOutput(outputId);
    return;
  }

  // Combine the interactive state (event stack, meter, board) with any free text.
  const story = typeof momentumStorySummary === "function" ? momentumStorySummary() : "";
  const board = (typeof BOARD !== "undefined" && BOARD.ready)
    ? `Team A is set up in a ${SHAPE_LABEL[BOARD.formation]} playing a "${BOARD.plan}" game plan against Team B's 4-4-2.`
    : "";
  const situation =
    [story, board, rawInput].filter(Boolean).join(" ") ||
    "The match momentum has shifted.";

  const userContext = getUserContext();
  const matchData = getMatchData();

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
const PREF_LABELS = {
  underdog: "an underdog story",
  famous_players: "famous star players",
  host_country: "a host nation (USA, Canada, or Mexico)",
  beautiful_teamwork: "beautiful teamwork and passing",
  cultural_story: "a strong cultural story",
  asian_team: "an Asian team (AFC confederation only)",
  americas_team: "a team from the Americas (CONMEBOL or CONCACAF)",
  european: "a European powerhouse (UEFA)",
  defensive: "defensive discipline",
  attacking: "an attacking style",
  emotional_story: "an emotional story",
};

async function recommendTeams() {
  const selected = [
    ...document.querySelectorAll("#team-prefs .chip-btn--multi.selected"),
  ].map((b) => b.dataset.value);
  const prefs = selected.length
    ? selected.map((v) => PREF_LABELS[v] || v.replace(/_/g, " ")).join("; ")
    : "no specific preference";

  const userContext = getUserContext();
  const matchData = getMatchData();
  const outputId = "team-output";

  showLoading(outputId, "Checking the latest 2026 form…");
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

  // Optional: the team the fan picked from their Choose My Team recommendations.
  const teamBtn = document.querySelector(
    "#matchday-teams .chip-btn--select.selected",
  );
  const supportedTeam = teamBtn?.dataset.value || "";

  const outputId = "matchday-output";
  showLoading(outputId, "Building your checklist…");
  scrollToOutput(outputId);

  // The guide is GENERIC to the venue by default — deliberately NOT tied to any
  // match, so it stays relevant and never drags in an unrelated match's facts
  // or links. It focuses on a specific match ONLY when the fan picked a
  // recommended team (the picker above) that has an upcoming fixture — then the
  // venue and that team's next match line up together.
  let matchData = { label: "World Cup 2026", stage: "Matchday prep", date: "" };
  let nextMatchLabel = "";
  let matchFocused = false;
  if (supportedTeam) {
    await ensureAllMatches();
    const fx = getTeamFixtures(supportedTeam, allMatchesCache || []);
    if (fx && fx.next && fx.next.raw) {
      matchData = matchToData(fx.next.raw);
      nextMatchLabel = `${matchData.label} on ${matchData.date} (${matchData.stage})`;
      matchFocused = true;
    }
  }

  const userContext = {
    ...getUserContext(),
    viewContext: venue,
    supportedTeam,
    matchFocused,
  };

  const venueLabel = {
    home: "home viewing",
    bar: "bar / watch party",
    stadium: "stadium",
  };
  let question = `Matchday checklist for: ${venueLabel[venue] || venue}`;
  if (supportedTeam) {
    question += matchFocused
      ? `. The fan supports ${supportedTeam}; their next match is ${nextMatchLabel}.`
      : `. The fan supports ${supportedTeam} (no upcoming fixture found — keep advice general to the team and venue).`;
  }

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

/* ─────────────────────────────────────────────────────────────
   OFF-TOPIC GUARD
───────────────────────────────────────────────────────────── */
function isOffTopic(text) {
  const t = (text || "").toLowerCase();
  const blocked = [
    /\bhomework\b|\bassignment\b|\bdo my \w+\b/,
    /\bmath\b|\balgebra\b|\bcalculus\b|\bequation\b|\bgeometry\b/,
    /\brecipe\b|\bcooking?\b|\bbak(e|ing)\b|\bingredient\b/,
    /\bweather\b|\btemperature\b|\bforecast\b|\bclimate\b/,
    /\bpolitics\b|\belection\b|\bpresident\b|\bgovernment\b/,
    /\bstock market\b|\bcrypto\b|\bbitcoin\b/,
    /\btranslat(e|ion)\b/,
    /\btell me a joke\b|\bwrite me a\b|\bhelp me write\b/,
    /\bwho are you\b|\bwhat are you\b|\bare you an ai\b/,
    /\bwrite.*code\b|\bcode for me\b|\bprogramm/,
  ];
  return blocked.some((p) => p.test(t));
}

function warningCard(question) {
  return `
  <div class="result-card">
    <div class="result-card__ticket-header" style="background:#7a5200;">
      <div class="result-card__ticket-main">
        <div class="result-card__title">Outside Kickoff Buddy's scope</div>
        <div class="result-card__match" style="opacity:0.75;">${escapeHTML(question)}</div>
      </div>
    </div>
    <div class="result-card__body">
      ${noticeBox(
        "Kickoff Buddy only answers questions about <strong>soccer rules, match events, tactics, and the World Cup experience</strong>. This question doesn't appear to be about the match.",
        "info"
      )}
      <p style="margin-top:12px;font-size:0.88rem;color:var(--ref-neutral-60,#888);">
        Try something like: <em>Why was that offside?</em> &nbsp;·&nbsp; <em>What just happened with the red card?</em> &nbsp;·&nbsp; <em>Why did the goal get cancelled?</em>
      </p>
    </div>
  </div>`;
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
  recommendedTeams = topTeams.map((t) => t.name);
  renderMatchdayTeamPicker();

  const cards = topTeams
    .map((t) =>
      teamCard(
        t.name,
        `<p style="margin-bottom:8px">${t.why}</p>
     <p style="margin-bottom:8px"><strong>Why for a beginner:</strong> ${t.beginner}</p>
     <p><strong>What to watch:</strong> ${t.watch}</p>` +
          teamFixturesHtml(t.name, allMatchesCache || []),
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
