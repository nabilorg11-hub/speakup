# SpeakUp — daily English speaking practice

Speak about a fresh topic, and get your English handed back like a teacher checked your notebook: mistakes circled in red, corrections written above the line, every reason explained in plain words, a mark out of 10, a remark from *very bad* to *excellent*, and a GitHub-style streak grid.

- **AI:** 100% [Puter.js](https://docs.puter.com) — speech-to-text and marking. User-pays model, so **you pay $0** and hold **no API keys**.
- **Database:** Supabase (publishable key only, in the browser).
- **Frontend:** plain HTML + CSS + ES modules. No build step, no framework, no bundler.

---

## 1. Run it

ES modules need a real HTTP server (opening `index.html` from disk will not work):

```bash
cd speakup
python3 -m http.server 8080
# open http://localhost:8080
```

Want to see the marked-up notebook without a microphone or an account?

```
http://localhost:8080/?demo=1
```

## 2. Create the database (2 minutes)

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste all of `supabase/schema.sql` and press **Run**.

That creates `topics`, `sessions`, `daily_activity`, the `speakup_mark_day()` function, the row-level-security policies, and seeds 40 topics.

Your project URL and publishable key are already filled in at `js/config.js`. **If that key has ever been posted in a chat or a repo, rotate it** in Supabase → Settings → API.

If Supabase is unreachable or the tables do not exist yet, the app does not break — it saves sessions and streaks in `localStorage` and shows a small notice. Set `CONFIG.supabase.fallbackToLocal = false` if you would rather it fail loudly.

## 3. Deploy

Any static host works, because there is no server code:

```bash
# Puter Hosting (free, no account juggling)
npx puter deploy      # or drag the folder into puter.com

# or Netlify / Vercel / GitHub Pages
netlify deploy --dir=. --prod
```

Nothing needs environment variables. The publishable key is safe in the client; the RLS policies are what protect the data.

---

## How it works

```
mic  ─► MediaRecorder (webm/opus)
     ─► puter.ai.speech2txt()      → transcript      (gpt-4o-mini-transcribe, falls back to whisper-1)
     ─► puter.ai.chat()            → marking JSON    (gpt-5-nano → gpt-4o-mini → claude, then default)
     ─► render red-pen notebook + score stamp
     ─► Supabase: insert session, speakup_mark_day() for the streak grid
```

**Why record-then-transcribe instead of live streaming:** accuracy is much higher on a complete utterance, it works on every browser, and it is one API call. Live captions would look nice but would make the marking worse.

### The teacher prompt

`js/ai.js` holds the whole marking prompt. It is the heart of the product, so it is worth reading. Key rules baked in:

- Grammar jargon is **banned** — the words *tense, article, preposition, clause, modal, gerund…* are explicitly forbidden. Explanations must say *why it sounds wrong* using everyday meaning.
- Every mistake returns `wrong` → `right` → `why` → `kind`, so the UI can circle the exact words and write the fix above them.
- Two sub-scores: **accuracy** (how correct) and **complexity** (how ambitious). The final mark weighs accuracy most, but someone attempting hard sentences with a few slips beats someone playing it safe with baby sentences — which is what you asked for.
- `remark` is one of `very bad | bad | good | very good | excellent`, and it is re-derived locally if the model returns something odd.

### The red-pen rendering

`js/render.js` takes each sentence, finds the exact wrong words inside the student's own text, and wraps them in:

- a hand-drawn-looking **circle** (CSS `border-radius` on an irregular blob),
- a **red strike-through** at a slight angle,
- the **correction written above the line** in a handwriting font,
- a **caret (‸)** where a word was missing.

The page itself is cream ruled paper with a red margin line, and the score lands as a rotated red **stamp** in the corner. Tapping any red mark highlights its plain-English explanation in the sidebar, and vice versa.

### Streaks

- A day counts when you finish a recording of **20 seconds or more** (`CONFIG.rules.minSecondsForCredit`).
- Days use the **user's own local calendar day**, so they roll over at their midnight, not UTC.
- Grid shade = how much you did that day (sessions and best score). Hover any square for the detail.
- `CONFIG.rules.streakGraceDays = 1` turns on a one-day grace period if you want streaks to be kinder.

---

## Files

```
index.html            all five screens (landing, practice, checking, report, progress)
css/styles.css        design system, notebook styling, dark mode, responsive
js/config.js          keys, models, practice rules, remark bands   ← tweak here first
js/ai.js              Puter auth, speech2txt, chat, THE MARKING PROMPT
js/recorder.js        microphone, live level meter, timer, auto-stop
js/topics.js          topic pool: Supabase → AI top-up → built-in seeds, no repeats
js/store.js           Supabase adapter + localStorage fallback + streak maths
js/render.js          red-pen markup, fix list, score panel, heatmap, history
js/app.js             wiring and screen flow
js/demo.js            the worked example used by ?demo=1
supabase/schema.sql   tables, RPC, RLS, 40 seeded topics
```

## Locking it down (when you have real users)

All AI runs in the browser under the user's own Puter account, and sign-in is Puter, not Supabase Auth — so there is no `auth.uid()` to write policies against. The shipped policies therefore let the publishable key read and insert rows scoped by `puter_user_id`. Good enough for a practice app; not tamper-proof.

When it matters:

1. Add a Supabase **Edge Function** `submit-session` that receives the Puter token, verifies it, and does the insert plus `speakup_mark_day` server-side.
2. Change the `sessions_insert` and `sessions_read` policies to `using (false)` for `anon`.
3. Point `store.saveSession()` at the Edge Function instead of `.from("sessions").insert()`.

That is a contained change — `js/store.js` is the only file that touches the database.

## Ideas worth building next

- **Speak the correction back** with `puter.ai.txt2speech()` so learners hear the right version.
- **Mistake trends** — you already store `kind` on every error, so "your top 3 repeat mistakes this month" is one query away.
- **Weekly report card** and shareable streak image.
- **Level ladder**: `topics.next("auto")` already picks harder topics as the average mark rises; surface that as a visible level.

---

## Extras that are already wired up

- **Hear the correction** — every card in *Why it was wrong* has a speaker button. It reads the corrected sentence aloud with Puter's `puter.ai.txt2speech` (same free user-pays model as the rest of the AI, no keys).
- **Mistakes you repeat most** — the Progress screen counts the `kind` of every marked error across your saved sessions and ranks the top six, so you can see the one habit worth fixing next.

---

## One-click start

Nothing to configure — your Supabase URL and publishable key are already baked into `js/config.js`.

- **Windows:** double-click **`run.bat`**
- **Mac / Linux:** double-click **`run.sh`** (or run `./run.sh` in Terminal; if it will not run, do `chmod +x run.sh` once)

Either script starts a local server on port **8080** and opens `http://localhost:8080` in your default browser. Keep the black terminal window open while you use the app; closing it (or pressing Ctrl+C) stops the server.

The scripts use Python if it is installed, and fall back to `npx http-server` if only Node is present. If neither is found, they tell you to install Python and stop cleanly.
