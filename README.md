# NexusAI — Custom AI Tools & Agent Workflow Platform

A production-ready platform for dynamically building, deploying, and orchestrating custom AI tools, LangGraph reasoning workflows, and asynchronous webhooks.

---

## 🏗️ Architecture Overview

The repository is structured as a monorepo consisting of:

* **Backend (`/backend`)**:
  * **Framework**: Django 6 + Django REST Framework + Daphne (ASGI) + Django Channels.
  * **Database**: Supabase PostgreSQL (direct pooler connection via `psycopg2-binary`).
  * **Agent Workflow Engine**: LangGraph state machine with 4 distinct nodes:
    1. `tool_selector`: Determines the optimal ordered sequence of execution tools.
    2. `tool_planner`: Generates structured execution plans conforming to tool schemas.
    3. `hitl_gatekeeper`: Human-in-the-loop safety interceptor with WebSocket & email notifications.
    4. `tool_executor`: Resilient sequential executor with per-item validation and non-blocking failure alerts.
  * **Webhook Ingestion**:
    * Supabase Postgres-backed asynchronous job queue (`WebhookEventJob`) returning `< 25ms` HTTP 202 responses.
    * Endpoint rate limiting (60 req/min sliding window).
    * Idempotency key deduplication with SHA-256 canonical payload hashing fallback.
  * **Logging & Observability**: Centralized `AppLogger` service with step progression and `CriticalErrorLog` persistence.

* **Frontend (`/frontend`)**:
  * **Framework**: React 19 + TypeScript.
  * **Build Tool**: Vite 8.
  * **Styling**: Tailwind CSS v4 (configured via `@tailwindcss/vite` and `@import "tailwindcss"`).

---

## 📂 Project Structure

```text
Custom AI Tools/
├── backend/                        # Django backend & LangGraph engine
│   ├── core/                       # ASGI/WSGI settings & configuration
│   ├── tools/                      # Core AI tool management, models & APIs
│   │   ├── services/
│   │   │   ├── graph_engine.py     # LangGraph workflow engine & checkpointer
│   │   │   ├── general_tools.py    # Registered execution tools (Email, API, etc.)
│   │   │   ├── app_logger.py       # Centralized logger & error tracking
│   │   │   ├── webhook_queue.py    # Background worker execution queue
│   │   │   └── notification_service.py # WebSockets & email alert dispatcher
│   │   ├── views_agent.py          # Agent execution & HITL approval views
│   │   ├── views_webhooks.py       # Inbound webhook ingestion & queue
│   │   ├── models.py               # CustomTool, Deployments, WebhookEventJob, etc.
│   │   └── urls.py                 # REST API endpoints
│   ├── manage.py
│   └── pyproject.toml
│
├── frontend/                       # Vite + React + Tailwind CSS v4
│   ├── src/
│   │   ├── App.tsx                 # Main application component
│   │   ├── index.css               # Tailwind CSS v4 import
│   │   └── main.tsx
│   ├── vite.config.ts              # Vite configuration with @tailwindcss/vite
│   ├── package.json
│   └── tsconfig.json
│
├── .gitignore                      # Monorepo git ignore rules
└── README.md
```

---

## 🚀 Getting Started

### 1. Backend Setup

```bash
cd backend

# Install dependencies (using uv or pip)
uv sync
# OR: pip install -r requirements.txt

# Run database migrations (Supabase PostgreSQL)
uv run python manage.py migrate

# Start the ASGI development server
uv run python manage.py runserver 8000
```

### 2. Frontend Setup

```bash
cd frontend

# Install Node dependencies
npm install

# Start the Vite development server
npm run dev
```

The frontend will be available at `http://127.0.0.1:5173/` and will communicate with the Django backend at `http://127.0.0.1:8000/`.

---

## 🔒 Security & Resilience Highlights

1. **State Machine Idempotency**: Webhook duplicates are caught before triggering LLMs or external tools.
2. **Postgres-Backed Queue**: Fast `HTTP 202` response acknowledgment without requiring an external Redis service.
3. **Database Checkpointing**: LangGraph state is stored in the database (`LangGraphCheckpointModel`), allowing seamless resumption after human approval.
4. **Production Observability**: Any graph or integration failures are captured in the `CriticalErrorLog` table with full execution context and caller metadata.
