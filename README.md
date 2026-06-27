# Kickoff Buddy ⚽

**AI-powered World Cup companion for first-time fans.**

> *IBM June Challenge Submission — built with IBM Bob, refined with Claude Code.*

---

## The Problem

The FIFA World Cup 2026 will be the largest in history — 48 teams, 3 host countries, and an estimated 5 billion viewers worldwide. For hundreds of millions of those viewers, it will be their **first time watching soccer**.

First-time fans face a steep barrier:
- Rules like offside and VAR feel impossible to follow in real time
- Referee decisions cause confusion and frustration
- The tactical and momentum shifts that make the game beautiful go unnoticed
- Matchday logistics (stadiums, bag policies, fan culture) are opaque and stressful

Existing soccer resources assume you already know the basics. **There is no companion tool designed specifically for the newcomer watching live.**

---

## Our Solution

**Kickoff Buddy** is a real-time, AI-powered companion that helps complete beginners understand and enjoy the World Cup — without embarrassment, without jargon, and without having to pause the match to search for answers.

### Six core features:

| Feature | What it does |
|---|---|
| **Match Guide** | Generates a personalised pre-match briefing based on the user's knowledge level |
| **Ask What Just Happened** | Answers any plain-English question about a live moment |
| **Decision Explainer** | Explains offside, VAR, handball, red cards, penalties in beginner terms |
| **Momentum & Tactics** | Reads match momentum shifts — goals, red cards, substitutions, pressing |
| **Choose My Team** | Recommends teams to support based on the fan's personality and preferences |
| **Matchday Confidence Guide** | Personalised checklist for home, bar, or stadium — with official source reminders |

---

## AI & Technical Approach

### AI Collaboration Workflow

This project was built using a **three-stage AI workflow**:

1. **Brainstorm** — [ChatGPT](https://chatgpt.com) was used to explore the problem space, identify user pain points, and generate initial feature concepts.

2. **Architect & Build** — [IBM Bob](https://bob.ibm.com) (IBM's AI assistant) was used to write the full website architecture, front-end structure, UI design, feature logic, and the initial API integration framework. IBM Bob is the **core IBM AI technology** powering this submission.

3. **Review, Debug, Refine & Security** — [Claude Code](https://claude.ai/code) (Anthropic) was used to review the codebase, fix bugs, refine the user experience, complete the API connections, and perform a security audit.

### Live APIs

| API | Purpose |
|---|---|
| [football-data.org](https://www.football-data.org) | Live World Cup match data — fixtures, scores, status |
| [OpenAI GPT-4o](https://openai.com) | All AI-generated explanations, guides, and recommendations |

All API calls are routed through a **server-side Node.js proxy** (`proxy.js`) so that API keys are never exposed in the browser or the public codebase.

### Tech Stack

- **Frontend**: Vanilla HTML, CSS, JavaScript — no framework, no build step
- **Backend**: Node.js HTTP server (proxy.js) — handles all external API calls
- **AI**: OpenAI GPT-4o via server-side proxy
- **Match data**: football-data.org v4 API
- **Built with**: IBM Bob, Claude Code, ChatGPT

---

## Why This Matters

**The World Cup 2026 is an unprecedented opportunity.**

For the first time, the tournament comes to North America — the United States, Canada, and Mexico — markets with enormous populations of casual and first-time sports fans. These are people who will watch because their country is hosting, because their friends are watching, or because the spectacle is impossible to ignore. They are not soccer fans. Yet.

Kickoff Buddy meets them exactly where they are:
- **No soccer knowledge required** — every explanation assumes zero background
- **Real-time and contextual** — answers are shaped by which match the user is watching and when
- **Honest about uncertainty** — the AI never fabricates live scores or official rulings; it always points users to official sources for those
- **Inclusive by design** — the tone is warm, never condescending, never assuming the user "should" already know

The goal is not to replace the broadcast or the referee. It is to make the experience of watching a World Cup match for the first time feel welcoming, not alienating — and to turn a passive viewer into a fan.

---

## Running Locally

### Prerequisites
- Node.js 18 or higher
- API keys for [football-data.org](https://www.football-data.org) and [OpenAI](https://platform.openai.com)

### Setup

```bash
git clone https://github.com/YOUR_USERNAME/kickoff-buddy.git
cd kickoff-buddy
npm install
```

Create a `.env` file in the project root (see `.env.example`):

```
FOOTBALL_DATA_KEY=your_football_data_key_here
OPENAI_API_KEY=your_openai_key_here
PORT=3001
```

Start the server:

```bash
npm start
```

Open [http://localhost:3001](http://localhost:3001) in your browser.

> **Note:** API keys are never stored in the codebase. They are loaded from environment variables server-side and never sent to the browser.

---

## Project Structure

```
kickoff-buddy/
├── index.html        # Full single-page app
├── styles.css        # All styling
├── app.js            # Client-side logic, AI response handling, UI
├── proxy.js          # Node.js server — proxies all external API calls
├── package.json
├── .env.example      # Template for required environment variables
└── .gitignore        # Excludes .env and node_modules
```

---

*IBM June Challenge · June 2026*
