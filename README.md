# Total Victory

Total Victory is a campaign calling platform for managing outreach projects, assigning callers, tracking call outcomes, and showing live activity on a TV display.

The project is split into one backend service, three React frontends, and a PostgreSQL database.

## Apps

| App | Path | Default URL | Purpose |
| --- | --- | --- | --- |
| Backend API | `backend` | `http://localhost:5001` | Express API, Socket.IO updates, Prisma data access |
| Caller app | `frontend-caller` | `http://localhost:5173` | Mobile-friendly caller workflow |
| Admin dashboard | `frontend-admin` | `http://localhost:5174` | Project uploads, caller assignment, settings, reporting |
| TV display | `frontend-tv` | `http://localhost:5175` | Live campaign metrics and leaderboard |
| PostgreSQL | Docker service | `localhost:5432` | Campaign data storage |

## Features

- Admin registration and passcode-based login
- Manual admin subscription requests with WhatsApp and bank-transfer approval
- Caller login by name and phone number
- Project creation from CSV or XLSX contact files
- Automatic mapping for Hebrew and English contact columns
- Assignment of callers to projects
- Call status tracking: success, not interested, no answer, invalid number
- Export of project results as CSV for Google Sheets import
- Live TV display with Socket.IO stat updates
- Configurable WhatsApp follow-up message and TV dashboard settings

## Requirements

- Docker and Docker Compose
- Node.js 20+ if running services locally without Docker
- npm

## Quick Start With Docker

Start the database and backend:

```sh
docker compose up --build
```

Start one or more frontend profiles:

```sh
docker compose --profile caller up --build
docker compose --profile admin up --build
docker compose --profile tv up --build
```

Start the full stack:

```sh
docker compose --profile caller --profile admin --profile tv up --build
```

Then open:

- Caller app: `http://localhost:5173`
- Admin dashboard: `http://localhost:5174`
- TV display: `http://localhost:5175`
- Backend API: `http://localhost:5001`

Stop everything:

```sh
docker compose down
```

Remove the database volume too:

```sh
docker compose down -v
```

## Local Development

### Backend

```sh
cd backend
npm install
cp .env.example .env
npm run dev
```

By default, `.env.example` sets `USE_MEMORY_DB=true`, which uses the local JSON store at `backend/data/local-db.json`.

To use PostgreSQL locally, set `USE_MEMORY_DB=false`, make sure `DATABASE_URL` points at a running database, then run:

```sh
npm run prisma:generate
npx prisma db push
npm run dev
```

### Frontends

Run each frontend in a separate terminal:

```sh
cd frontend-caller
npm install
npm run dev
```

```sh
cd frontend-admin
npm install
npm run dev
```

```sh
cd frontend-tv
npm install
npm run dev
```

Vite will print the local URL for each app. Set `VITE_API_URL` in each frontend environment to the public backend URL, for example `https://total-victory.onrender.com`. Without it, local development falls back to the current hostname on port `5001`.

## Environment Variables

Backend configuration lives in `backend/.env`.

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | Yes when using Postgres | Prisma PostgreSQL connection string |
| `PORT` | No | Backend port, defaults to `5001` in this repo |
| `USE_MEMORY_DB` | No | Set to `true` to use `backend/data/local-db.json` instead of Prisma/Postgres |
| `PAYMENT_WHATSAPP_PHONE` | No | WhatsApp number that receives new admin subscription requests |

## Data Imports

The admin dashboard accepts `.csv` and `.xlsx` files. Required fields are a name and phone number, either as a full-name column or first-name plus last-name columns.

Recognized optional columns include city, sector/group, family size, and notes. The importer supports common Hebrew and English header names.

## Useful API Routes

- `POST /api/login` - caller login or creation
- `POST /api/admins/validate` - validate admin passcode
- `POST /api/admins/register` - create a pending manual-payment admin subscription request
- `POST /api/admins/:adminId/approve` - approve a paid admin request and generate the WhatsApp passcode message
- `GET /api/subscriptions/plans` - list subscription plans
- `GET /api/projects` - list projects
- `POST /api/projects/upload` - upload CSV/XLSX project contacts
- `DELETE /api/projects/:projectId` - delete a project
- `POST /api/projects/:projectId/callers` - assign a caller to a project
- `DELETE /api/projects/:projectId/callers/:callerId` - remove caller assignment
- `GET /api/projects/:projectId/export.csv` - export project results
- `GET /api/contacts/next` - get the next assigned contact for a caller
- `POST /api/contacts/skip` - skip a contact
- `POST /api/calls` - record a call result
- `GET /api/stats/admin` - admin stats
- `GET /api/stats/tv` - TV display stats
- `GET /api/settings` - read settings
- `POST /api/settings` - update settings


## Project Structure

```text
.
├── backend/          # Express, Socket.IO, Prisma, import/export logic
├── frontend-admin/   # Admin React/Vite app
├── frontend-caller/  # Caller React/Vite app
├── frontend-tv/      # Live TV display React/Vite app
└── docker-compose.yml
```

## Build Checks

Run TypeScript builds from each package:

```sh
cd backend && npm run build
cd frontend-caller && npm run build
cd frontend-admin && npm run build
cd frontend-tv && npm run build
```
