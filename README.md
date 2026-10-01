# JobApp

A deployable job board for job seekers and hiring teams. Job seekers can create an account, discover roles, apply, and follow application status. Employers create an account and company profile in one self-serve flow, publish roles, and manage applicants. The old API-key-based “Register Company” step is removed.

## Features

- Responsive job discovery with job-title/company/skill and location search.
- Job seeker signup/login, applications, application status tracking, and a private job-alert inbox.
- Self-serve employer signup with company profile details; there is no separate company-registration queue or API-key step.
- Employer workspace to publish roles, review applicants, update application status, and remove a post.
- Publishing a role creates in-app alerts for job seekers who opted in at signup. If SMTP is configured, the same opt-in group receives email alerts.
- Password hashing, signed expiring bearer tokens, role-scoped API access, auth rate limiting, request validation, Helmet headers, and SQLite persistence.
- Single-service production mode serves both the built React app and API from the same Node process.

## Requirements

- Node.js 20 or later and npm.

## Run locally

```bash
cp .env.example .env
npm install
npm run dev
```

The frontend is available at `http://localhost:5173`; the API runs at `http://localhost:3000`. Vite forwards `/api` requests to the local API. Local SQLite data is stored in `data/jobs.db` and is ignored by Git.

For local production-mode verification:

```bash
npm run build
npm start
```

The combined app is then available at `http://localhost:3000`. Set a unique `JWT_SECRET` before using any non-local deployment. `JWT_SECRET` is mandatory when `NODE_ENV=production`.

## Job-alert email delivery

In-app notifications work without an email provider. To also send email, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` in the deployment environment. Users choose whether to opt in to new-job emails during job-seeker signup. Emails are only sent to opted-in accounts.

## Deploy to Render

This repository includes a `render.yaml` blueprint for a single Node web service and a mounted persistent disk for SQLite. In Render, create a new Blueprint deployment from the repository and review the service and storage plan before confirming. The blueprint builds the frontend, starts the API/static server, sets a generated `JWT_SECRET`, uses `/var/data/jobs.db`, and checks `/api/health`.

If deploying elsewhere, build the frontend with `npm ci && npm run build`, then run `npm start`. Configure `NODE_ENV=production`, a strong random `JWT_SECRET`, and `DB_PATH` pointing to durable storage. The filesystem must be persistent because SQLite stores the accounts, jobs, applications, and notifications. An ephemeral serverless filesystem will lose application data on restart.

A `Dockerfile` is included for container-based deployments. Provide a mounted volume at `/var/data` and set `DB_PATH=/var/data/jobs.db` for persistent data.

## Environment variables

See [`.env.example`](.env.example). Only SMTP values are optional for in-app job notifications; email delivery needs an SMTP account. Production must provide a persistent data path and JWT secret.

## Checks

```bash
npm run lint
npm test
npm run build
```
