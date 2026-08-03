# KejaHub

A student housing platform connecting Kenyan university students with
landlords for affordable accommodation near campus.

## Tech Stack

| Layer          | Technology                                                    |
| -------------- | ------------------------------------------------------------- |
| Runtime        | Node.js                                                       |
| Framework      | Express 5                                                     |
| View Engine    | EJS                                                           |
| Database       | SQLite (via better-sqlite3, WAL mode)                         |
| Authentication | express-session + bcryptjs                                    |
| File Uploads   | Multer + sharp (resize/re-encode), pluggable local/S3 storage |
| Email          | Nodemailer over Gmail SMTP                                    |
| Security       | Helmet, express-rate-limit, CSRF tokens                       |
| Sessions       | session-file-store (file-backed)                              |
| CSS            | Vanilla CSS (single stylesheet)                               |
| JavaScript     | Vanilla JS (no frontend frameworks)                           |
| Logging        | Structured JSON via `backend/utils/logger.js`, per-request id |
| Testing        | node:test + supertest + jsdom, 90% line coverage gate in CI   |

## Getting Started

### Prerequisites

- Node.js 18+ installed
- npm (bundled with Node.js)

### Install & Run

```bash
# Install dependencies
npm install

# Copy and fill in environment variables
cp .env.example .env

# Start the server
npm start

# Or with auto-restart on file changes
npm run dev
```

The app runs at `http://localhost:3000` (configurable via `PORT` in `.env`).

> **First run:** The database is created automatically. Seed data (sample
> users, houses, bookings, reviews) is inserted once on fresh startup.
> It is **never inserted when `NODE_ENV=production`**, since every demo account
> shares a single password. Set `SEED_PASSWORD` in `.env` to choose it; leave it
> unset and a random one is generated and printed to the console on first run.

Health check: `GET /healthz` returns `{"status":"ok","uptime":…}`.

## Environment Variables

Copy `.env.example` to `.env` and fill it in. The server throws on startup if
`SESSION_SECRET` or `ADMIN_PASSWORD` is missing, and additionally if `APP_URL`,
`SMTP_USER`, or `SMTP_PASS` is missing when `NODE_ENV=production`.

| Variable         | Required      | Description                                                                                                                                                                       |
| ---------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`           | No            | HTTP port (default: `3000`)                                                                                                                                                       |
| `SESSION_SECRET` | Yes           | Signs the session cookie. Use 32+ random characters                                                                                                                               |
| `ADMIN_PASSWORD` | Yes           | Password for `admin@kejahub.com`, applied **only** when the database is first created                                                                                             |
| `APP_URL`        | In production | Public base URL used to build email links. Required when `NODE_ENV=production`, because trusting the `Host` header would let an attacker redirect reset links to their own domain |
| `SMTP_USER`      | In production | Gmail address that sends transactional mail                                                                                                                                       |
| `SMTP_PASS`      | In production | Gmail **App Password** (16 characters). Blank in development means reset links log to the console                                                                                 |
| `SMTP_FROM`      | No            | From header (default: `KejaHub <SMTP_USER>`)                                                                                                                                      |
| `NODE_ENV`       | No            | Set to `production` to enable secure cookies, `trust proxy`, HSTS, and disable demo seeding                                                                                       |
| `SEED`           | No            | Set to `true` to force demo data even in production (staging only)                                                                                                                |
| `DB_PATH`        | No            | Override the SQLite file location                                                                                                                                                 |
| `STORAGE_DRIVER` | No            | `local` (default, writes to `uploads/`) or `s3`                                                                                                                                   |
| `S3_BUCKET`      | With `s3`     | Bucket name                                                                                                                                                                       |
| `S3_REGION`      | With `s3`     | Bucket region                                                                                                                                                                     |
| `S3_ENDPOINT`    | No            | Custom endpoint for S3-compatible services (R2, Spaces, MinIO); leave unset for AWS                                                                                               |
| `S3_PUBLIC_URL`  | With `s3`     | Base URL images are served from, e.g. a CDN in front of the bucket                                                                                                                |

Generate a session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

### Email verification

New registrations start with `email_verified = 0` and are redirected to
`/verify-email/pending` until they click the link. Student and landlord routes
are gated behind `requireVerified`, so an unverified user can log in but
cannot use the app until they verify. Booking activity also sends mail:
requesting a viewing or booking notifies the landlord, and accepting or
declining notifies the student. Seeded demo accounts are pre-verified.

### Email setup (Gmail SMTP)

Password reset, email verification, and booking notifications are sent this way.

1. On the sending Google account, enable **2-Step Verification**.
2. Create an **App Password** at <https://myaccount.google.com/apppasswords>
   (a normal account password will be rejected by Gmail).
3. Put it in `SMTP_PASS`. The 4×4 spaced format Google shows is accepted as-is.

With `SMTP_PASS` blank, the app still runs and reset links are printed to the
server console and shown in the UI, which is how local development works. The
email itself uses the KejaHub palette and is table-based so it renders in
Outlook; see `backend/utils/mailer.js`.

## Sample Logins

Demo accounts are development only and are never seeded in production.

| Role     | Email                | Password                   |
| -------- | -------------------- | -------------------------- |
| Admin    | `admin@kejahub.com`  | _set via `ADMIN_PASSWORD`_ |
| Student  | `brian@student.com`  | _set via `SEED_PASSWORD`_  |
| Student  | `amina@student.com`  | _set via `SEED_PASSWORD`_  |
| Student  | `kevin@student.com`  | _set via `SEED_PASSWORD`_  |
| Landlord | `james@landlord.com` | _set via `SEED_PASSWORD`_  |
| Landlord | `grace@landlord.com` | _set via `SEED_PASSWORD`_  |

`ADMIN_PASSWORD` only applies when the database is first created. If
`SEED_PASSWORD` is unset, the generated password is printed on first run.

## Project Structure

```text
kejahub/
├── backend/
│   ├── controllers/        # authController, studentController,
│   │                       # landlordController, adminController
│   ├── middleware/
│   │   ├── auth.js         # requireLogin, requireRole
│   │   ├── csrf.js         # csrfProtection (global) + csrfVerify (multipart)
│   │   ├── upload.js       # Multer config: 5 MB/file, jpeg|png|webp, temp dir
│   │   └── noCache.js      # no-store headers for authenticated areas
│   ├── storage/
│   │   ├── index.js        # Picks local or s3 via STORAGE_DRIVER
│   │   ├── local.js        # Disk storage under uploads/, traversal-guarded
│   │   └── s3.js           # S3-compatible storage (AWS, R2, Spaces, MinIO)
│   ├── utils/
│   │   ├── validateHouse.js   # Server-side listing validation + amenity list
│   │   ├── houseImages.js     # Photo ordering, cover, cap, upload pipeline
│   │   ├── imageProcessing.js # sharp resize/re-encode (main + thumbnail)
│   │   └── mailer.js          # Gmail SMTP + branded email template
│   ├── routes/             # authRoutes, studentRoutes, landlordRoutes, adminRoutes
│   ├── migrations/         # Versioned schema migrations, tracked in schema_migrations
│   ├── database.js         # better-sqlite3 setup, base schema, indexes, seed data, runs migrations
│   ├── app.js               # Express app: middleware, routes, error handler
│   └── index.js            # Bootstrap: initDB(), listen, signal handlers
├── frontend/
│   ├── public/
│   │   ├── css/style.css   # Global stylesheet + design tokens
│   │   ├── js/             # toast.js, validation.js, photo-manager.js,
│   │   │                   # lightbox.js, skeleton.js, dates.js, confirm.js, nav.js
│   │   └── images/         # Static images
│   └── views/
│       ├── auth/           # login, register, forgot-password, reset-password
│       ├── student/        # dashboard, search, house-detail, bookings, profile
│       ├── landlord/       # dashboard, add-house, edit-house, house-detail, profile
│       ├── admin/          # dashboard, listings, users, reports, bookings, analytics
│       ├── partials/       # nav-student, nav-landlord, nav-admin
│       ├── home.ejs
│       └── 404.ejs
├── tests/
│   ├── unit/               # Pure functions and middleware, run against a real in-memory db
│   ├── integration/        # supertest against the full app, one file per controller
│   ├── frontend/           # jsdom-driven tests for frontend/public/js/**
│   └── helpers/            # Shared test app bootstrap, agent, fixtures
├── .github/workflows/ci.yml # Lint, test with a 90%/75% coverage gate, dependency audit
├── uploads/houses/         # Landlord-uploaded photos (runtime, gitignored, local driver only)
├── .sessions/              # File-backed session store (runtime, gitignored)
├── .env                    # Environment variables (not committed)
├── .env.example            # Template with every supported variable
└── package.json
```

## Listing Photos

Landlords manage photos from **Edit Listing** (`/landlord/house/:id/edit`).
Everything happens in one multipart form submit, so there are no separate image
endpoints, which keeps the CSRF and ownership model identical to the rest of
the app.

| Action                   | How                                                       |
| ------------------------ | --------------------------------------------------------- |
| Upload many at once      | Drag onto the dropzone or browse; up to 10 per listing    |
| Remove before submitting | Click the × on a staged thumbnail                         |
| Delete an existing photo | Tick its checkbox, then save                              |
| Set the cover            | Choose its **Cover** radio                                |
| Reorder                  | Drag a tile, or use the ← → buttons (keyboard accessible) |

Enforced server-side: a maximum of **10 photos per listing** (not per upload),
5 MB per file, and `jpeg`/`png`/`webp` only. Submitted image ids are always
filtered to ones belonging to that listing, so a crafted POST cannot touch
another landlord's photos. Files uploaded during a failed submission are
deleted rather than orphaned, and deleting a listing, as landlord _or_ admin,
removes its files (and thumbnails) from storage.

Every upload is resized and re-encoded before it is stored: EXIF is stripped,
the long edge capped at 1600px, re-encoded to webp at quality 80, plus a
400px thumbnail used on dashboard, search and booking cards. Storage itself
goes through `backend/storage`, which is either the local filesystem or an
S3-compatible bucket, chosen with `STORAGE_DRIVER` (see Environment Variables).

`house_images.sort_order` stores the display order; `is_primary` flags the
cover. Every query selects the cover as
`ORDER BY is_primary DESC, sort_order ASC, id ASC LIMIT 1`, so a listing always
has a thumbnail even if the flagged cover was deleted.

## Development

```bash
npm test              # full suite: unit, integration, frontend
npm run test:coverage # same, plus a per-file coverage table
npm run lint           # eslint
npm run format          # prettier --write
```

CI (`.github/workflows/ci.yml`) runs lint, prettier, the test suite on Node 22
and 24 with a 90% line / 75% branch coverage gate, and `npm audit` on every
push and pull request against `main`.

**Admin review happens once, at creation.** Later edits, including photo
changes, go live immediately and stay visible to students. Editing a
_rejected_ listing is the one exception: that counts as a resubmission and
returns it to `pending`.
