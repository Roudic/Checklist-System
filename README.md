# Kitchen Audit — Checklist System

Modern kitchen audit & checklist system with a built-in **TV / digital board mode**. Zero dependencies to run locally.

```bash
npm start            # http://localhost:3000
npm test             # scoring, Firebase adapter, and API/security tests (file + Firebase)
```

First visit asks you to create the **owner (admin) account**. After that everyone logs in by tapping their name and entering a PIN.

## What's in it
- **Logins & roles**: name + PIN login with a touch keypad (5 wrong tries locks that person out for 5 min). Sessions last 14 days.
  | Role | Can do |
  |---|---|
  | Staff | Run audits, view reports, mark actions fixed, discard their own drafts |
  | Manager | + build checklists, TV settings, add/reset staff, delete audits |
  | Admin | + add managers/admins, change roles. The last active admin can't be removed. |
- **Team page**: add people, reset PINs, deactivate (logs them out everywhere).
- **Schedules**: every day, specific days of the week, or on demand. Dashboard and TV show only what's due today.
- **Checklist builder** — 17 question types: Yes/No, Pass/Fail/N/A, Tick list, Multiple choice, Dropdown, Multi-select, Number, Temperature (safe range), Slider, Star rating, Short/Long text, Photo, Signature, Date, Time, Date & time, Section headers.
- **Requirements per question** — required, points, 🚨 critical (fail = audit fails), photo/note required *always* or *on fail*, N/A allowed, and **conditional logic** ("show only when Q3 fails / equals …").
- **Audit runner** — phone-friendly, auto-saves drafts, blocks submit until requirements are met, scores automatically.
- **Reports** — score ring, pass/fail, per-item results, photos, signature, print.
- **Corrective actions** — every failed item becomes an action until someone marks it fixed.
- **TV mode** — the TV doesn't log in. A manager copies the private **TV link** (`/tv?key=…`) from *TV Display* and opens it on the screen once. *New link* revokes the old one. Auto-rotating full-screen board: today's checklist status (done / in progress / due / **overdue**), scores + 7-day trend, open actions, live item-by-item checklist view, announcements + alert ticker. Live-updates every 15s. Configure under **TV Display**. Keys: ←/→ skip, Space pause, F fullscreen. Add `&slides=today,actions` to pin a screen to specific slides.

## Storage: local file or Firebase
Default is `data/db.json`, fine on your own computer. For hosting, use **Firebase**. Everything fits on the **free Spark plan**:

1. [console.firebase.google.com](https://console.firebase.google.com) → **Create project** (Analytics not needed).
2. **Build → Firestore Database → Create database** → *Production mode* → pick a region near you.
3. ⚙️ **Project settings → Service accounts → Generate new private key**. That downloads a JSON file. Treat it like a password.
4. Local: save it as `firebase-key.json` (git-ignored), `cp .env.example .env`, set `STORAGE=firebase`. On Render: paste the file's whole contents as `FIREBASE_SERVICE_ACCOUNT`.

How it stays free:
- **Photos & signatures** are saved as Firestore documents (shrunk in the browser first). Set `FIREBASE_STORAGE_BUCKET` only if you upgrade to Blaze and want them in Firebase Storage instead.
- **Reads are cached in memory.** Each collection is read once, then kept current on every write. A whole day of the TV polling every 15s costs ~1 read (free limit is 50,000/day). The cache assumes one server instance (Render). It's off automatically on Vercel.

Only the server talks to Firebase (Admin SDK), so no keys reach the browser and Firestore security rules can stay locked ("Production mode" denies all client access, which is what you want).

Collections: `checklists`, `runs`, `actions`, `board`, `users`, `sessions`, `lockouts`, `media` (optional `FIREBASE_COLLECTION_PREFIX`).

## Deploying (live on the internet)
GitHub Pages can't run this, since it only hosts static files and this app has a server. Instead, connect the GitHub repo to a host and it **redeploys on every push**. Either host needs **Firebase** (above), because their disks don't keep files.

**Render** (recommended: free tier allows business use, and a TV left on keeps it awake. With nobody using it for 15+ min, the first visit takes ~30s to wake up.)
1. render.com → New → **Blueprint** → pick this repo (it reads `render.yaml`).
2. When asked for `FIREBASE_SERVICE_ACCOUNT`, paste the whole key JSON file. Click **Apply**.
3. First deploy takes a few minutes. Your app lives at `https://kitchen-audit-xxxx.onrender.com`.

**Vercel** (Hobby plan is non-commercial only, so a business needs Pro)
1. vercel.com → Add New → Project → import this repo. `vercel.json` handles the setup, so leave build settings blank.
2. Settings → Environment Variables: `STORAGE=firebase`, `FIREBASE_SERVICE_ACCOUNT`. Redeploy. (No memory cache on Vercel, so heavy TV use can approach the free Firestore read limit.)

Either way: open the site, create the owner account, then copy the TV link from **TV Display**.

GitHub Actions (`.github/workflows/ci.yml`) runs the test suite on every push and PR.

## Design
Self-hosted, no CDN needed (works on a TV with a flaky connection): [Inter](https://rsms.me/inter/) font (`public/fonts`, SIL OFL) and [Lucide](https://lucide.dev) icons (`public/icons.svg`, ISC). Licenses are in `public/licenses/`. Colors and spacing are CSS variables at the top of `public/styles.css`, so changing `--brand` re-themes the app. Light and dark mode follow the device setting.

## Roadmap ideas
Reminders/notifications for overdue checklists, multi-location filtering, CSV/PDF export, per-screen TV configs.
