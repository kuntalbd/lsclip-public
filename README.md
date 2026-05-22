# LS Clip

A minimal, professional clipboard/snippet sharing web app. Create a clip, get a short URL, share it. No account required.

## Quick Start (Local)

```bash
npm install
cp .env.example .env   # edit as needed
npm start
```

Open `http://localhost:3000`.

## Quick Start (Docker)

```bash
docker-compose up -d --build
```

Open `http://localhost:8743`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `DB_PATH` | ./data/lsclip.db | SQLite database path |
| `UPLOADS_PATH` | ./uploads | File upload directory |
| `TURNSTILE_SITE_KEY` | | Cloudflare Turnstile site key |
| `TURNSTILE_SECRET_KEY` | | Cloudflare Turnstile secret key |
| `BCRYPT_ROUNDS` | 12 | Bcrypt hashing rounds |
| `BASE_URL` | http://localhost:3000 | Public URL (for QR codes, link generation) |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/clips` | Create a new clip |
| `GET` | `/api/clips/:slug` | Get a clip |
| `PUT` | `/api/clips/:slug` | Update a clip |
| `DELETE` | `/api/clips/:slug` | Delete a clip |
| `GET` | `/api/check/:slug` | Check slug availability |
| `POST` | `/api/clips/:slug/file` | Upload file attachment |
| `GET` | `/api/clips/:slug/file` | Download attached file |
| `DELETE` | `/api/clips/:slug/file` | Delete attached file |

## Project Structure

```
├── index.js              # Express server entry point
├── db/
│   ├── connection.js     # SQLite connection (sql.js)
│   └── schema.js         # Database schema
├── routes/
│   ├── health.js          # Health endpoint
│   ├── clips.js           # Clip CRUD + slug check
│   └── files.js           # File upload/download/delete
├── public/               # Static frontend assets
├── views/                # EJS server templates
├── data/                 # SQLite database (gitignored)
├── uploads/              # Uploaded files (gitignored)
├── Dockerfile
├── docker-compose.yml
├── package.json
├── .env.example
└── .gitignore
```

## License

Private — Logic Shift