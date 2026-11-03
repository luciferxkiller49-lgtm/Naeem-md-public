# REPO B: Naeem-Bot (Extreme Edition Multi-Device WhatsApp Bot)

Single codebase deployable across 10 Heroku Apps, handling up to 50 active WhatsApp numbers per dyno (500 total).

## Architecture Highlights
- **Multi-Device Engine**: Built on `@whiskeysockets/baileys` with MultiFileAuthState translated to MongoDB.
- **Node Scoping**: Each Heroku app operates under its own `APP_ID` (1 through 10) and only resumes sessions scoped to that app.
- **Capacity Telemetry**: Real-time synchronization of active sessions count to the MongoDB `capacity` collection.
- **Security & Anti-Ban**:
  - `PANEL_KEY` validation on pairing routes.
  - Safe request cooldowns (`COMMAND_COOLDOWN_MS`) and anti-spam protection.
  - Quiet Pino logs to suppress terminal buffer overflows.
- **Complete Feature Suite**:
  - Full Naeem command base (General, AI, Downloader, Group, Moderation, Media, Fun, Islamic, Settings, Utility).
  - Queen-MD integrations (Antilink with delete/warn/kick modes, Antidelete with auto-repost, Antiedit detection, Sticker Maker with custom EXIF, Audio Editor with 10 effects, AI Chatbot auto-responder, Newsletter/Channel manager).

## Environment Variables
Set these in your Heroku App Config Vars:
| Variable | Description | Example |
| :--- | :--- | :--- |
| `APP_ID` | Node number (1 to 10, unique per Heroku dyno) | `1` |
| `MONGODB_URI` | MongoDB Atlas connection string | `mongodb+srv://...` |
| `PANEL_KEY` | Shared secret key matching Central Panel | `naeem_extreme_secret_2026` |
| `OWNER_NUMBER`| Bot Owner phone number (without +) | `923001234567` |
| `MODE` | Default operating mode | `public` |

## Deployment to Heroku
1. Push this folder to a private GitHub repository (`naeem-bot`).
2. Create 10 Heroku Apps (`naeem-bot-1` to `naeem-bot-10`).
3. Connect all 10 apps to the same GitHub repository.
4. Set Config Vars for each app:
   - Same `MONGODB_URI` and `PANEL_KEY` across all 10 apps.
   - Unique `APP_ID` (`1` on App 1, `2` on App 2, ..., `10` on App 10).
5. Enable automatic deployment or manually deploy the `main` branch on all 10 apps.
