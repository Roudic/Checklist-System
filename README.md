# Kitchen Audit — Checklist System

Modern kitchen audit & checklist system with a built-in **TV / digital board mode**. Zero dependencies to run locally.

```bash
npm start            # http://localhost:3000
npm test             # scoring engine + API/security tests
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
Default is `data/db.json`. To use Firebase (Firestore for data, Firebase Storage for photos/signatures):

1. Firebase console → **Firestore Database** → create database. **Storage** → get started.
2. Project settings → **Service accounts** → *Generate new private key* → save as `firebase-key.json` (git-ignored).
3. `cp .env.example .env` and set:
   ```
   STORAGE=firebase
   FIREBASE_SERVICE_ACCOUNT=./firebase-key.json
   FIREBASE_STORAGE_BUCKET=your-project.appspot.com
   ```
4. `npm install && npm start` — startup log shows `storage: firebase`.

Collections: `checklists`, `runs`, `actions`, `board`, `users`, `sessions` (optional `FIREBASE_COLLECTION_PREFIX`). The server is the only thing talking to Firebase (Admin SDK), so no client-side keys and no security rules needed for the app to work — keep the service-account key private.

## Roadmap ideas
Reminders/notifications for overdue checklists, multi-location filtering, CSV/PDF export, per-screen TV configs.
