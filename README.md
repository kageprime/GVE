# Lumina GVI Engine

Lumina is a generative visual intelligence engine that creates complex 3D scenes, 2D sketches, data visualizations, and cinematic animations from natural language prompts.

## What It Does

Transform plain English descriptions into interactive visualizations and media:

- "Show me how a neural network processes data"
- "Visualize the solar system with accurate orbits"
- "Demonstrate Brownian motion in particles"
- "Create a cinematic animation explaining P vs NP"

Lumina understands your intent, selects the appropriate skill, generates executable code, validates it, and renders the result in real-time.

## How It Works

1. **Parse** — Understand the natural language goal and extract entities
2. **Select** — Choose the best-fit visualization skill (3D, 2D, data viz, motion graphics, or video)
3. **Generate** — Create working code via an LLM pipeline with provider failover
4. **Validate** — Check syntax, API compliance, and runtime safety
5. **Execute** — Run in isolated Daytona sandboxes (Python/Manim) or client-side (JS skills)
6. **Analyze** — Score quality across static, runtime, visual, and semantic dimensions
7. **Sync** — Stream results back to your workspace via WebSocket

## Features

- **Natural Language to Visuals** — Describe what you want, get a working scene or video
- **Multi-Skill Pipeline** — Three.js (3D), p5.js (2D), D3.js (data viz), Anime.js (motion), Manim (cinematic video)
- **Real-Time Streaming** — Watch code generate and render live
- **Agentic Iteration** — Autonomous quality scoring, patching, and retry loops
- **Secure Execution** — Isolated Daytona sandboxes for non-JS runtimes; JS renders client-side
- **Version Control** — Save, compare, undo, redo, and restore scene versions and artifacts
- **Multi-Provider LLM** — Failover across Moonshot, Fireworks (Kimi/DeepSeek), Groq, Gemini, and Gradient
- **Clerk Authentication** — Sign-in required for sessions; dev bypass available

## Quick Start

```bash
npm install
```

Configure `apps/server/server/.env`:

```bash
# Required for sandbox/runtime execution
DAYTONA_API_KEY=your_daytona_api_key
DAYTONA_ORGANIZATION_ID=your_daytona_org_id

# Required for LLM generation
MOONSHOT_API_KEY=your_moonshot_api_key

# Optional fallback providers
# GROQ_API_KEY=
# GEMINI_API_KEY=
# FIREWORKS_API_KEY=

# Clerk auth (frontend + backend)
VITE_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
CLERK_SECRET_KEY=your_clerk_secret_key

# Server config
PORT=8000
NODE_ENV=development
```

Run:

```bash
npm run dev:server   # Express + WebSocket backend on :8000
npm run dev:web      # React frontend on :5173
```

Open http://localhost:5173

## Architecture

```
User Prompt
    ↓
Intent Parser → Skill Selector → Agent Orchestrator (LangGraph)
    ↓
Code Generator → Validator → Quality Analyzer → (Autonomous Patcher)
    ↓
Skill Runtime → Daytona Sandbox (Manim/Python) or Client Renderer (JS)
    ↓
State Sync → WebSocket → React Frontend
```

| Layer | Responsibility |
|-------|----------------|
| **Router** | Parses intent, manages context, selects skills, routes quality tiers |
| **Agent** | Builds prompts, generates code, validates output, orchestrates retry loops |
| **Skills** | Three.js, p5.js, D3.js, Anime.js, Manim definitions and runtime helpers |
| **Sandbox** | Daytona-backed isolated execution for Python/Manim; JS runs client-side |
| **Quality** | Static scoring, runtime profiling, visual richness, semantic alignment |

## Repository Layout

```
├── apps/
│   ├── server/          # Express + WebSocket backend (TypeScript, ESM)
│   │   ├── server/      # Core logic: routes, agents, skills, sandbox, state, db
│   │   └── scripts/     # Regression and soak tests
│   ├── web/             # React 19 + Vite frontend (TypeScript, Tailwind v4)
│   │   ├── src/pages/   # Chat, Scenes, Sessions, Tasks, Profile, Auth
│   │   ├── src/stores/  # Zustand state management
│   │   └── src/routes/  # TanStack Router setup
│   └── landing/         # Marketing landing page (React 19 + Vite + Tailwind v3)
├── packages/
│   ├── shared/           # @visual-runtime/shared — shared types + API client
│   └── sandbox-pool/     # @visual-runtime/sandbox-pool — Daytona SDK integration
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, TanStack Router, Zustand |
| Landing | React 19, TypeScript, Vite, Tailwind CSS v3, GSAP |
| Backend | Express 5, WebSocket, TypeScript (ESM), LangGraph, SQLite |
| Auth | Clerk (`@clerk/express` + `@clerk/clerk-react`) |
| 3D / 2D | Three.js, p5.js, D3.js, Anime.js |
| Video | Manim (Python, Daytona sandbox) |
| Sandbox | Daytona |
| Database | SQLite (`better-sqlite3`) + Supabase (cloud) |
| LLM | Moonshot, Fireworks, Groq, Gemini, Gradient |
| State Sync | WebSocket + Zustand |

## License

MIT
