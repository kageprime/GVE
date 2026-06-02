# Lumina Knowledgebase

A comprehensive, browsable documentation of the Lumina Generative Visual Intelligence Engine.

## Contents

### Core Documentation
- **[index.html](index.html)** - Main entry point with project overview
- **[architecture.html](architecture.html)** - System architecture, data flows, and component interactions
- **[quickstart.html](quickstart.html)** - 5-minute setup guide

### API Reference
- **[api-rest.html](api-rest.html)** - REST API endpoints and request/response formats
- **[api-websocket.html](api-websocket.html)** - WebSocket events and message protocols

### Data & Models
- **[data-models.html](data-models.html)** - Complete data structure reference
- **[skills.html](skills.html)** - Skill system and registry documentation

### Operations
- **[configuration.html](configuration.html)** - Environment variables and deployment
- **[troubleshooting.html](troubleshooting.html)** - Common issues and solutions

## Browse

```bash
cd knowledgebase
python3 serve.py
```

Opens at http://localhost:8080

## Project Overview

**Lumina** is a generative visual intelligence engine that creates complex 3D scenes, 2D sketches, data visualizations, and cinematic animations from natural language prompts.

### Key Features
- **Natural Language to Visuals** — Describe what you want, get a working scene or video
- **Multi-Skill Pipeline** — Three.js (3D), p5.js (2D), D3.js (data viz), Anime.js (motion), Manim (cinematic video)
- **Real-Time Streaming** — Watch code generate and render live
- **Agentic Iteration** — Autonomous quality scoring, patching, and retry loops
- **Secure Execution** — Isolated Daytona sandboxes for non-JS runtimes; JS renders client-side
- **Version Control** — Save, compare, undo, redo, and restore scene versions and artifacts
- **Multi-Provider LLM** — Failover across Moonshot, Fireworks (Kimi/DeepSeek), Groq, Gemini, and Gradient
- **Clerk Authentication** — Sign-in required for sessions; dev bypass available

### Architecture
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

## Technology Stack

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
| LLM | Moonshot, Fireworks (Kimi/DeepSeek), Groq, Gemini, Gradient |
| State Sync | WebSocket + Zustand |

## Project Structure

```
├── apps/
│   ├── server/          # Express + WebSocket backend (TypeScript, ESM)
│   │   └── server/      # Core logic: routes, agents, skills, sandbox, state, db
│   ├── web/             # React 19 + Vite frontend (TypeScript, Tailwind v4)
│   │   ├── src/pages/   # Chat, Scenes, Sessions, Tasks, Profile, Auth
│   │   ├── src/stores/  # Zustand state management
│   │   └── src/routes/  # TanStack Router setup
│   └── landing/         # Marketing landing page (React 19 + Vite + Tailwind v3)
├── packages/
│   ├── shared/           # @visual-runtime/shared — shared types + API client
│   └── sandbox-pool/     # @visual-runtime/sandbox-pool — Daytona SDK integration
└── knowledgebase/        # This knowledgebase
```

## License

Part of the Lumina project.