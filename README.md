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
| File Uploads | Multer |
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

# Start the server
npm start
```

The app runs at `http://localhost:3000` (configurable via `PORT` in `.env`).

> **First run:** The database is created automatically. Seed data (sample
> users, houses, bookings, reviews) is inserted once on fresh startup.

## Environment Variables

Create a `.env` file in the project root. All three variables are required —
the server will throw on startup if any is missing.

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No | HTTP port (default: `3000`) |
| `SESSION_SECRET` | Yes | Secret key for express-session cookie signing |
| `ADMIN_PASSWORD` | Yes | Password for the default admin account |

Example `.env`:

```plaintext
PORT=3000
SESSION_SECRET=kejahub_secret_2024
ADMIN_PASSWORD=admin123
```

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
│   ├── controllers/        # Route handler logic (auth, student, landlord, admin)
│   ├── middleware/         # auth.js (requireLogin, requireRole), upload.js
│   ├── routes/             # Express router files
│   ├── database.js         # sql.js setup, schema creation, seed data
│   └── index.js            # Express app entry point
├── frontend/
│   ├── public/
│   │   ├── css/style.css   # Global stylesheet
│   │   ├── js/             # toast.js, validation.js, skeleton.js
│   │   └── images/         # Static images
│   └── views/
│       ├── auth/           # login.ejs, register.ejs
│       ├── student/        # dashboard, search, house-detail, bookings
│       ├── landlord/       # dashboard, add-house, house-detail
│       ├── admin/          # dashboard, users, reports
│       └── partials/       # nav-student, nav-landlord, nav-admin
├── uploads/
│   └── houses/             # Landlord-uploaded house photos (runtime)
├── .env                    # Environment variables (not committed)
└── package.json
```

## Known Limitations

- **No migrations:** Schema changes require deleting `backend/kejahub.db`
  to force re-initialisation. Additive columns can use
  `ALTER TABLE … ADD COLUMN` with a try/catch.
- **SQL injection risk in search:** The `searchHouses` controller builds
  WHERE clauses with string interpolation for dynamic conditions.
  Parameterised values are used for user input but the condition list
  itself is not sanitised.
- **No email sending:** Password reset, email verification, and booking
  notifications are not implemented — there is no SMTP integration.
- **No pagination:** Search results and admin tables return all rows.
  Large datasets will affect performance.
- **Local file storage:** Uploaded images are stored in `/uploads/houses/`
  on the local filesystem, not in cloud storage.
- **5-second persistence window:** The sql.js database auto-saves every
  5 seconds. An abrupt process kill could lose recent writes.

## Screenshots

*(Add screenshots to `docs/screenshots/` and link them here)*
