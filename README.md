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

## Build Windows EXE

The Windows build packages Electron with a static Next.js export and points the client to the hosted sync backend.

```bash
npm install
npm run dist:win
```

Output files are written to `release/`.

For a different backend URL:

```bash
set NEXT_PUBLIC_API_URL=https://your-domain.example
npm run dist:win
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
BOT_BRIDGE_TOKEN=replace-this-long-random-bridge-secret
```

## Javis Assistant

Javis ist der eingebaute FurrBox-Assistent und ersetzt einen separaten n8n-Server samt Jarvis-Workflow. Er läuft direkt im bestehenden Backend-Prozess, verbraucht im Leerlauf keine Ressourcen und wird über das Desktop-Icon "Javis" oder die Taskbar geöffnet.

Eingebaute Befehle (ohne Sprachmodell, komplett offline):

- Uhrzeit und Datum ("Wie spät ist es?", "Welches Datum haben wir?")
- Erinnerungen und Timer ("Erinnere mich in 10 Minuten an Kaffee", "Timer 5 min") - die Benachrichtigung erscheint als FurrBox-Toast
- Erinnerungen anzeigen ("Meine Erinnerungen") und löschen ("Erinnerungen löschen")
- FurrFS-Dateisuche ("Suche datei urlaub")
- Kopfrechnen ("Was ist 128*4?")
- "Status" zeigt die aktive Konfiguration

Optional kann Javis freie Fragen über ein OpenAI-kompatibles Sprachmodell beantworten, z. B. ein lokales Ollama:

```bash
# Beispiel: lokales Ollama (https://ollama.com), deutlich leichter als n8n + Cloud-Workflow
JAVIS_LLM_URL=http://localhost:11434/v1
JAVIS_LLM_MODEL=llama3.2
JAVIS_LLM_API_KEY=
JAVIS_LLM_TIMEOUT_MS=30000
JAVIS_SYSTEM_PROMPT=
```

Ohne `JAVIS_LLM_URL` bleibt Javis im regelbasierten Offline-Modus. Erinnerungen werden im Speicher gehalten und gehen bei einem Backend-Neustart verloren.

## Discord Bot

The backend includes a `discord.js` v14 bot in `backend/src/bot.ts`. It syncs Discord member roles into SQLite, receives remote moderation commands from FurrBox over the internal Socket.io bridge, writes audit entries to `Dokumente/Moderation_Beweise/Discord_Logs/audit_log.json`, and DMs the Fish Nagie Owner after every moderation action.

Never commit your Discord token. Put secrets in a local `.env` file or in your hoster's protected environment variables:

```bash
DISCORD_TOKEN=your_discord_bot_token
DISCORD_GUILD_ID=your_guild_id
BOT_BRIDGE_TOKEN=use-the-same-long-random-secret-as-the-backend
FURRBOX_BACKEND_URL=http://localhost:4000
DISCORD_MUTED_ROLE_ID=optional_existing_muted_role_id
DISCORD_MUTED_ROLE_NAME=Muted
```

Local development:

```bash
npm --workspace backend run dev
npm --workspace backend run dev:bot
```

Production:

```bash
npm --workspace backend run build
npm --workspace backend run start
npm --workspace backend run start:bot
```

Docker Compose reads `DISCORD_TOKEN` from a project `.env` file next to `docker-compose.yml` and starts both `furrbox-backend` and `furrbox-discord-bot`.

## GitHub Push

```bash
git init
git add .
git commit -m "Initial FurrBox desktop environment"
git branch -M main
git remote add origin https://github.com/YOUR_USER/furrbox.git
git push -u origin main
```
