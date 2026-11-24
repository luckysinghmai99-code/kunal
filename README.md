# RAILDESIGN AI

AI design and coding portal. Describe a website or app in English or Hindi; the platform plans it, designs it, writes the files, tests them, and packages a ZIP.

This is a working Node.js application with **zero npm dependencies** (Node built-ins only), so it installs without a download step.

## What is included

- **Public website**: home, features, AI Design Studio, templates, pricing, about, contact, login, signup, forgot/reset password, terms, privacy. Light and dark themes, responsive layouts, animated train track background (low opacity, pointer-events disabled).
- **Authentication**: signup, login, logout, forgot and reset password (single-use, one-hour links), profile, password change, persistent 30-day HttpOnly sessions stored as hashes, login rate limiting.
- **Token wallet**: 50 one-time starter tokens per account, reservations before work, settlement of actual usage, unused tokens returned, balances can never go negative, full ledger with before/after balances, idempotent credits.
- **Dynamic pricing**: derived from pages, components, images, backend, database, integrations, animations, testing and export, plus a complexity score. Prompt length contributes only a small factor.
- **Razorpay**: order creation through the Razorpay REST API, checkout signature verification, webhook verification on the raw body, idempotent crediting, failed-payment and refund handling. Keys come from environment variables only.
- **Six engines** (`src/engines/`):
  1. Prompt Intelligence: English, Hindi and mixed briefs to a structured spec; follow-up edits keep prior context.
  2. Design Intelligence: palette, typography scale, navigation, section layout per page.
  3. Frontend Coding: writes `index.html`, `styles.css`, `content.js`, `app.js` (hash router, safe DOM rendering).
  4. Backend and Database: dependency-free API server and SQL migrations when the project needs them.
  5. Testing and Auto-Fix: compiles scripts, checks links and content, repairs broken navigation, re-tests. A project is marked passed only when every check passes.
  6. Export and Deployment: ZIP with README, Dockerfile, `.env.example`, `.gitignore`, SVG logo. Blocks export if a live secret pattern is found; excludes `.env` and secret-named files.
- **Orchestrator**: runs the six stages in order, retries each stage once, keeps logs and progress on each job, and resumes failed jobs from the first incomplete stage, reserving only the remaining cost.
- **Projects**: create, rename, duplicate, delete, live sandboxed preview (desktop/tablet/mobile), file editing with path validation, version snapshots with restore, ZIP download.
- **Admin**: stats, users, manual token grants with a required reason, editable token packages.
- **Security**: scrypt password hashing, hashed session tokens, JSON-only request bodies for state-changing calls (CSRF hardening), security headers and a Content-Security-Policy, path traversal protection, ownership checks on every project and job, webhook signature checks.
- **Tests**: 58 automated tests (engines, wallet, auth, payments, HTTP end to end), run with `npm test`.
- **Deployment**: `Dockerfile`, `docker-compose.yml`, `.env.example`.

## What is not included yet (be aware before you rely on it)

- **PNG, JPG and PDF export** need a headless browser to render pages. Only SVG and ZIP are produced here.
- **Publishing / live URLs**: the publish endpoint returns a clear error until a deployment provider adapter is added. No fake URLs are generated.
- **Live Razorpay payments** are implemented against the documented API but have not been tested against your real account. Test with Razorpay test keys first.
- **LLM-enhanced prompt understanding**: Engine 01 is deterministic and fully working offline. A hosted-model refinement step is not wired in this build.
- **Generated output is static**: the frontend engine produces HTML/CSS/JS, not React or Next.js projects.
- **Email delivery**: password reset links are written to `data/outbox.log` in development. Connect an email provider before production.
- **Storage**: the database is a JSON document file with atomic writes. It suits a single server process. Move to PostgreSQL before running multiple instances (see below).
- **Background queue**: generation runs synchronously within the request. Long projects should move to a worker queue.

## Requirements

- Node.js 20 or newer (Node 22 recommended). No `npm install` is needed.
- Optional: Docker and Docker Compose.

## Local setup

```bash
cp .env.example .env          # then edit .env
npm test                      # run the 58 tests
npm start                     # http://localhost:3000
```

Open `http://localhost:3000`, sign up, and you receive 50 starter tokens. To use the admin area, put your email in `ADMIN_EMAILS` before signing up.

## Configure Razorpay

1. Create test keys in the Razorpay dashboard.
2. Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `.env`.
3. For webhooks, set `RAZORPAY_WEBHOOK_SECRET` and point a Razorpay webhook at `https://YOUR-DOMAIN/api/webhooks/razorpay`. Enable `payment.captured`, `payment.failed` and `refund.processed`.
4. Restart the server. Until the keys are set, the wallet still works, but checkout returns a clear "not configured" error.

Never commit `.env`. Rotate keys if they are ever exposed.

## Docker

```bash
cp .env.example .env
docker compose up --build
```

Data persists in the `raildesign-data` volume.

## Deployment checklist

- Serve over HTTPS and set `COOKIE_SECURE=1` and `APP_URL=https://your-domain`.
- Set `NODE_ENV=production`.
- Put a reverse proxy (Nginx, Caddy) in front and forward `X-Forwarded-*` headers if you add IP-based limits.
- Back up the `data/` directory (or the Docker volume) regularly.
- Connect an email provider for password reset.
- Configure Razorpay live keys only after testing in test mode.

## Scaling path

The JSON store is isolated behind `src/lib/store.js` and the service layer. To move to PostgreSQL, replace the `Store` implementation and convert the collections in `src/lib/migrations.js` into tables. The service signatures stay the same.

## Project layout

```
src/
  server.js              HTTP server, sessions, security headers, static files
  config.js              environment configuration
  lib/                   http helpers, crypto, store, migrations, ZIP writer
  services/              auth, wallet, pricing, projects, generation, payments, admin
  engines/               01 prompt, 02 design, 03 frontend, 04 backend,
                         05 testing, 06 export, index.js (orchestrator)
  routes/api.js          API route table
public/                  website and dashboard (HTML, CSS, JS)
tests/                   engine, wallet, auth, payments and API tests
data/                    runtime data (created automatically, git-ignored)
Dockerfile, docker-compose.yml, .env.example, package.json
```

## API overview

| Method | Path | Purpose |
|---|---|---|
| POST | /api/auth/signup, /login, /logout | Accounts and sessions |
| POST | /api/auth/forgot, /reset | Password reset |
| GET/PUT | /api/me, PUT /api/me/password | Profile |
| GET | /api/wallet | Balance, reservations, ledger |
| GET | /api/packages | Token packages |
| POST | /api/payments/orders, /confirm | Razorpay checkout |
| POST | /api/webhooks/razorpay | Razorpay webhook (raw body) |
| GET/POST | /api/projects | List and create projects |
| GET/PATCH/DELETE | /api/projects/:id | Project detail, rename, delete |
| POST | /api/projects/:id/duplicate | Copy a project |
| POST | /api/projects/:id/estimate | Price a prompt (no charge) |
| POST | /api/projects/:id/generate | Run the six-engine pipeline |
| GET | /api/projects/:id/jobs, /api/jobs/:id | Job progress and logs |
| POST | /api/jobs/:id/resume | Resume a failed job |
| GET/PUT | /api/projects/:id/file | Read or save a file |
| POST | /api/projects/:id/versions/:n/restore | Restore a version |
| GET | /api/projects/:id/preview/* | Sandboxed live preview |
| GET | /api/projects/:id/export | Download ZIP |
| GET/PUT | /api/admin/* | Admin stats, users, grants, packages |
| POST | /api/contact | Contact form |

## Security notes

- Passwords: scrypt with a random salt. Session and reset tokens are random and stored as SHA-256 hashes.
- Payments: tokens are credited only after the Razorpay signature is verified on the server. Keys never reach the browser (only the public key ID is sent to checkout).
- Generated projects: the preview runs under a sandbox Content-Security-Policy. Generated JavaScript renders user text with `textContent`.
- Export: the ZIP is blocked if it contains patterns that look like live keys.
