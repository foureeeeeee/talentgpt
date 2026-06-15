# TalentGPT

An AI-powered recruitment intelligence platform built on Claude. TalentGPT goes beyond keyword matching — it analyses candidates across skills, potential, psychology, risk, and team fit, giving HR teams deep, evidence-based insight at every stage of the hiring pipeline.

---

## Features

### Dashboard
- Upload CVs as PDF, plain text, or LinkedIn URL
- AI scoring across six lenses: All-Round, Skills, Experience, Impact, Education, Culture, Leadership
- Pipeline stages: New → Screened → Phone Screen → Interview → Offer
- Blind Review Mode — hide names for unbiased screening
- **Spark Points** — one-sentence flash point per candidate generated instantly
- Clone Search — find candidates similar to a reference profile
- JD Bias Audit — scan job descriptions for exclusionary language
- Recruiter Email — auto-generate shortlist email for hiring managers
- Hiring Report — full structured report across all candidates
- Prompt Injection Detection — flags manipulation attempts in CVs

### Analysis Panel (13 modules)
| Module | What it does |
|---|---|
| Candidate Snapshot | Executive summary: skills, experience, achievements, risk indicators |
| Job Match Analysis | CV vs JD scoring across 5 dimensions with hiring recommendation |
| Potential Assessment | Explicit + implicit signal detection; infers skills never stated |
| HR Risk Assessment | Employment gaps, job hopping, unsupported claims, career direction |
| Org Psychology | MBTI, Big Five, communication style, department fit scores |
| Interview Questions | Personalised technical, behavioural, situational, and risk questions |
| Compensation Intel | Salary bands, negotiation leverage, market positioning |
| Ethical Rejection | Honest, actionable feedback with improvement roadmap |
| AI Verification Audit | Stress-tests every claim — verified, weak, or suspicious |
| Candidate Ranking | Weighted cross-candidate comparison with hiring recommendation |
| Team Optimization | Team balance, synergy, role assignments, gap analysis |
| Similarity Agent | Keyword + AI search across analysis results |
| Retention & Flight Risk | Tenure patterns, flight risk score, retention strategies |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS |
| Backend | Express.js (served by `tsx`) |
| AI | Anthropic Claude — `claude-sonnet-4-6` (complex modules), `claude-haiku-4-5` (fast modules) |
| PDF parsing | PDF.js (`pdfjs-dist`) + native Claude document API |
| Icons | Lucide React |
| Markdown | `react-markdown` + `remark-gfm` |

---

## Getting Started

### Prerequisites
- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com/)

### Installation

```bash
git clone https://github.com/foureeeeeee/talentgpt.git
cd talentgpt
npm install
```

### Configuration

Copy the example env file and add your API key:

```bash
cp .env.example .env
```

Open `.env` and set:

```
ANTHROPIC_API_KEY=your_key_here
```

### Run locally

```bash
npm run dev
```

The app runs at **http://localhost:3000**.

---

## Project Structure

```
talentgpt/
├── server.ts              # Express server — all API endpoints + Claude calls
├── src/
│   ├── App.tsx            # Root component, phase routing (dashboard → input → analysis)
│   ├── types.ts           # Shared TypeScript types
│   ├── components/
│   │   ├── Dashboard.tsx        # Candidate management, scoring, pipeline
│   │   ├── AnalysisResults.tsx  # 13-module analysis panel + mind maps
│   │   ├── InputSection.tsx     # CV upload (PDF, text, LinkedIn)
│   │   ├── Sidebar.tsx          # Module navigation
│   │   ├── ReportModal.tsx      # Hiring report viewer
│   │   └── TeamModal.tsx        # Team optimization viewer
├── chrome-extension/      # Chrome extension scaffold
├── public/                # Static assets (PDF.js worker)
└── .env.example           # Environment variable template
```

---

## Key API Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/analyze` | Run any of the 13 analysis modules |
| `POST /api/score-candidates` | AI scoring with dimension breakdown |
| `POST /api/spark-points` | Generate candidate flash points |
| `POST /api/jd-bias-audit` | Scan JD for bias patterns |
| `POST /api/clone-search` | Find candidates similar to a reference |
| `POST /api/ai-search` | Semantic candidate search |
| `POST /api/search-similarity` | AI-powered similarity agent search |
| `POST /api/generate-report` | Full hiring report |
| `POST /api/generate-email` | Recruiter shortlist email |
| `POST /api/team-formation` | Team composition analysis |
| `POST /api/spark-points` | One-sentence candidate flash points |

---

## Security

- All CV content is treated as untrusted external data
- Prompt injection patterns are detected and flagged automatically
- API keys are never exposed to the client
- `.env` is gitignored — never committed

---

## License

MIT
