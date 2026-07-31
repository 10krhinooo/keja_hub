# KejaHub

A student housing platform connecting Kenyan university students with
landlords for affordable accommodation near campus.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js |
| Framework | Express 5 |
| View Engine | EJS |
| Database | SQLite (via sql.js, file-persisted) |
| Authentication | express-session + bcryptjs |
| File Uploads | Multer (disk storage) |
| Email | Nodemailer over Gmail SMTP |
| Security | Helmet, express-rate-limit, CSRF tokens |
| Sessions | session-file-store (file-backed) |
| CSS | Vanilla CSS (single stylesheet) |
| JavaScript | Vanilla JS (no frontend frameworks) |

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
> shares the password `password123`.

### Production checklist

- [ ] `NODE_ENV=production`, which enables secure cookies, `trust proxy`, HSTS, and blocks demo seeding
- [ ] `SESSION_SECRET` set to 32+ random characters
- [ ] `ADMIN_PASSWORD` set **before** the database is first created
- [ ] `APP_URL` set to the public URL, or reset links point at localhost
- [ ] `SMTP_PASS` set, or password reset silently does nothing for users
- [ ] Persistent storage mounted for `uploads/`, `.sessions/`, and the `.db` file

Health check: `GET /healthz` returns `{"status":"ok","uptime":…}`.

## Environment Variables

Copy `.env.example` to `.env` and fill it in. The server throws on startup if
`SESSION_SECRET` or `ADMIN_PASSWORD` is missing, and additionally if `APP_URL`,
`SMTP_USER`, or `SMTP_PASS` is missing when `NODE_ENV=production`.

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No | HTTP port (default: `3000`) |
| `SESSION_SECRET` | Yes | Signs the session cookie. Use 32+ random characters |
| `ADMIN_PASSWORD` | Yes | Password for `admin@kejahub.com`, applied **only** when the database is first created |
| `APP_URL` | In production | Public base URL used to build email links. Required when `NODE_ENV=production`, because trusting the `Host` header would let an attacker redirect reset links to their own domain |
| `SMTP_USER` | In production | Gmail address that sends transactional mail |
| `SMTP_PASS` | In production | Gmail **App Password** (16 characters). Blank in development means reset links log to the console |
| `SMTP_FROM` | No | From header (default: `KejaHub <SMTP_USER>`) |
| `NODE_ENV` | No | Set to `production` to enable secure cookies, `trust proxy`, HSTS, and disable demo seeding |
| `SEED` | No | Set to `true` to force demo data even in production (staging only) |
| `DB_PATH` | No | Override the SQLite file location |

Generate a session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

### Email setup (Gmail SMTP)

Password reset is the only transactional email today.

1. On the sending Google account, enable **2-Step Verification**.
2. Create an **App Password** at <https://myaccount.google.com/apppasswords>
   (a normal account password will be rejected by Gmail).
3. Put it in `SMTP_PASS`. The 4×4 spaced format Google shows is accepted as-is.

With `SMTP_PASS` blank, the app still runs and reset links are printed to the
server console and shown in the UI, which is how local development works. The
email itself uses the KejaHub palette and is table-based so it renders in
Outlook; see `backend/utils/mailer.js`.

## Sample Logins

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@kejahub.com` | *(set via `ADMIN_PASSWORD` env var)* |
| Student | `brian@student.com` | `password123` |
| Student | `amina@student.com` | `password123` |
| Student | `kevin@student.com` | `password123` |
| Landlord | `james@landlord.com` | `password123` |
| Landlord | `grace@landlord.com` | `password123` |

## Project Structure

```text
kejahub/
├── backend/
│   ├── controllers/        # authController, studentController,
│   │                       # landlordController, adminController
│   ├── middleware/
│   │   ├── auth.js         # requireLogin, requireRole
│   │   ├── csrf.js         # csrfProtection (global) + csrfVerify (multipart)
│   │   ├── upload.js       # Multer config: 5 MB/file, jpeg|png|webp
│   │   └── noCache.js      # no-store headers for authenticated areas
│   ├── utils/
│   │   ├── validateHouse.js # Server-side listing validation + amenity list
│   │   ├── houseImages.js   # Photo ordering, cover, cap, file cleanup
│   │   └── mailer.js        # Gmail SMTP + branded email template
│   ├── routes/             # authRoutes, studentRoutes, landlordRoutes, adminRoutes
│   ├── database.js         # sql.js setup, schema, migrations, indexes, seed data
│   └── index.js            # Express app entry point
├── frontend/
│   ├── public/
│   │   ├── css/style.css   # Global stylesheet + design tokens
│   │   ├── js/             # toast.js, validation.js, photo-manager.js,
│   │   │                   # lightbox.js, skeleton.js, dates.js
│   │   └── images/         # Static images
│   └── views/
│       ├── auth/           # login, register, forgot-password, reset-password
│       ├── student/        # dashboard, search, house-detail, bookings, profile
│       ├── landlord/       # dashboard, add-house, edit-house, house-detail, profile
│       ├── admin/          # dashboard, listings, users, reports, bookings, analytics
│       ├── partials/       # nav-student, nav-landlord, nav-admin
│       ├── home.ejs
│       └── 404.ejs
├── uploads/houses/         # Landlord-uploaded photos (runtime, gitignored)
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

| Action | How |
| --- | --- |
| Upload many at once | Drag onto the dropzone or browse; up to 10 per listing |
| Remove before submitting | Click the × on a staged thumbnail |
| Delete an existing photo | Tick its checkbox, then save |
| Set the cover | Choose its **Cover** radio |
| Reorder | Drag a tile, or use the ← → buttons (keyboard accessible) |

Enforced server-side: a maximum of **10 photos per listing** (not per upload),
5 MB per file, and `jpeg`/`png`/`webp` only. Submitted image ids are always
filtered to ones belonging to that listing, so a crafted POST cannot touch
another landlord's photos. Files uploaded during a failed submission are
deleted rather than orphaned, and deleting a listing, as landlord *or* admin,
removes its files from disk.

`house_images.sort_order` stores the display order; `is_primary` flags the
cover. Every query selects the cover as
`ORDER BY is_primary DESC, sort_order ASC, id ASC LIMIT 1`, so a listing always
has a thumbnail even if the flagged cover was deleted.

**Admin review happens once, at creation.** Later edits, including photo
changes, go live immediately and stay visible to students. Editing a
*rejected* listing is the one exception: that counts as a resubmission and
returns it to `pending`.

## Known Limitations

- **No migration tool:** Schema changes are applied as idempotent
  `ALTER TABLE … ADD COLUMN` statements wrapped in try/catch in
  `database.js` (see `rejection_reason` and `sort_order`). There is no
  versioned migration history or down-migration.
- **Single process only:** sql.js holds the whole database in memory and
  rewrites the entire file on save. The app cannot be clustered or scaled
  horizontally, and save cost grows with database size. Migrating to
  `better-sqlite3` (same SQL, real transactions) or Postgres is the path
  before meaningful traffic.
- **Partial pagination:** Student search (12/page), admin listings
  (15/page), and admin bookings (20/page) are paginated. Admin users, admin
  reports, the landlord dashboard, and per-house review lists still return
  all rows.
- **Local file storage:** Uploaded images live in `uploads/houses/` on the
  local filesystem. On an ephemeral host (Heroku, Render, Fly) they are
  **lost on every deploy**, so use S3/Cloudinary or a persistent volume.
- **Email is transactional only:** Password reset is wired up; email
  verification and booking notifications are not.
- **Inline event handlers:** ~29 `onclick`/`onsubmit` attributes remain in
  the views, so the CSP has to allow `script-src-attr 'unsafe-inline'`.
  Moving them to `addEventListener` would let that directive be dropped.
- **Persistence window:** The database is saved after every write, flushed
  on `SIGTERM`/`SIGINT`, and snapshotted every 5 seconds as a fallback.
  Saves are atomic (temp file + rename), so a crash cannot corrupt the
  database, but a `kill -9` between writes can still lose the last write.

## Screenshots

*(Add screenshots to `docs/screenshots/` and link them here)*
