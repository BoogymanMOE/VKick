# Tech Stack & Architecture

## Constraints that shape every decision here
- Solo builder using an AI coding agent, near full-time capacity
- Must work in Iran: no reliance on Google Play/Apple billing, no assumption of unrestricted API access from Iranian IPs (a VPN may be needed for outbound calls to some services during development)
- Zero ongoing cost for v1 wherever possible (ESPN's unofficial API is free; avoid paid services until there's real usage to justify them)
- Primary distribution is Telegram — architecture should treat Telegram as a first-class client, not an afterthought

## High-level architecture
```
ESPN public API (unofficial)
        |
   [Polling Service] -- normalizes data --> [Database]
                                                  |
                                          [Backend API]
                                            /        \
                                  [Telegram Bot]   [Web App]
                                  (notifications,   (pickers, predictions,
                                   quick actions)    leaderboards, full experience)
```

## Backend
- **Language/framework:** Node.js (TypeScript) with a lightweight framework (Express or Fastify) — wide ecosystem, easy to find AI-agent training data for, good fit for both the polling service and the API layer
- **Database:** PostgreSQL — relational fits this data well (teams/players/matches/favorites are all relational), and it's free to self-host or use a free tier (e.g. Supabase, Neon) during v1
- **ORM:** Prisma — makes schema migrations and type-safe queries straightforward, easy for an AI agent to work with since the schema is declarative
- **Job scheduling:** a simple cron-based job runner (node-cron, or a hosted cron trigger) for the ESPN polling service — no need for a heavy queue system at v1 scale

## Frontend (Web App)
- **Framework:** React (with Vite) — fits the club picker, timeline and league tables well; large ecosystem
- **Styling:** Tailwind CSS — fast to iterate with an AI agent, no design system overhead needed yet
- **State:** React Query (TanStack Query) for server state (matches, favorites, ratings) — avoids building a custom caching layer

## Telegram Integration
- **Telegram Mini App:** the web app is loaded inside Telegram via the Mini Apps platform (Telegram WebApp SDK) for the primary in-Telegram experience
- **Telegram Bot:** a separate lightweight bot process (using a library like `node-telegram-bot-api` or `grammY`) handles notifications (goal alerts, lineup-drop/sub-window reminders, rating-window opens, deadline warnings) and simple commands — kept separate from the Mini App's web code so notification logic doesn't get tangled with UI code

## Hosting (v1, low/no cost)
- Backend + polling service: a low-cost VPS (or a free-tier platform like Railway/Render) — avoid serverless for the polling service since it needs to run on a schedule reliably
- Database: free tier of a managed Postgres provider (Supabase/Neon) to start; migrate to self-hosted or paid tier once there's real load
- Web app: static hosting (Vercel/Netlify free tier, or bundled with the backend)

## Data flow: ESPN normalization layer (critical)
Do not let raw ESPN response shapes leak into the rest of the app. The polling service's only job is:
1. Fetch from ESPN
2. Map ESPN's fields into our own `data-model.md` schema
3. Write to our database

If ESPN changes their response shape, only this one layer needs to change — nothing downstream (scoring engine, ratings, timeline rendering) should ever read raw ESPN JSON directly.

## What we are explicitly NOT using for v1
- No native mobile app (iOS/Android) — Telegram + web only
- No microservices — a single backend service is enough at this scale
- No paid sports data API — ESPN's free unofficial endpoint covers v1 entirely
- No message queue / event bus — cron-based polling is sufficient until proven otherwise
