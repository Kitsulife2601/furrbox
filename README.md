# FurrBox

FurrBox is a private local desktop environment that mimics a modern Windows 11 shell. It runs in Electron fullscreen/kiosk mode, renders the desktop UI with Next.js, authenticates users with JWT and bcrypt password hashes, and syncs files plus live UI state through a central Socket.io backend.

## Stack

- Electron desktop wrapper in `/electron`
- Next.js App Router, TypeScript, Tailwind CSS, Lucide React in `/frontend`
- Express, Socket.io, JWT, bcryptjs, Prisma, SQLite, Multer, and node-pty terminal bridge in `/backend`
- Docker Compose backend storage volume for shared file sync

## Run Locally

```bash
npm install
npm run dev
```

The Electron app waits for:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:4000`

Electron starts frameless, fullscreen, and kiosk-enabled by default.

On first launch the app shows:

1. Windows-style lock screen with local time and date
2. Sign In / Create Account screen
3. Authenticated desktop after the backend issues a JWT

Local backend data is stored under `backend/storage` by default:

- `furrbox.db` for SQLite users and file metadata
- `users/<userId>` for private FurrFS homes
- `public` for the shared Public folder

## Run Backend With Docker

```bash
docker compose up --build
```

Then run the frontend and Electron locally:

```bash
npm install
npm --workspace frontend run dev
electron ./electron/main.js
```

## File Sync Flow

1. A user signs in and opens FurrFS.
2. Private uploads go to that user's isolated `My Files` home.
3. Public uploads go to `Shared Network`.
4. The frontend uploads to `POST /api/files` with a Bearer JWT.
5. The backend stores metadata in SQLite and the file in the matching storage folder.
6. Private changes emit only to that user's Socket.io room.
7. Public changes emit to all authenticated sessions in the public room.

## Environment

The backend supports these variables:

```bash
PORT=4000
STORAGE_DIR=./storage
DATABASE_URL=file:./storage/furrbox.db
JWT_SECRET=replace-this-for-real-use
CORS_ORIGIN=http://localhost:3000
```

## GitHub Push

```bash
git init
git add .
git commit -m "Initial FurrBox desktop environment"
git branch -M main
git remote add origin https://github.com/YOUR_USER/furrbox.git
git push -u origin main
```
