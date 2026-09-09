// ---------------------------------------------------------------------------
// All AI runs through Puter.js (user-pays model: $0 for the developer).
//   puter.ai.speech2txt()  -> whisper-1 / gpt-4o-*-transcribe
//   puter.ai.chat()        -> the English marking
// ---------------------------------------------------------------------------

import { CONFIG, remarkForScore } from "./config.js";

export function puterReady() {
	return typeof window !== "undefined" && !!window.puter;
}

export async function isSignedIn() {
	if (!puterReady()) return false;
	try {
		return await puter.auth.isSignedIn();
	} catch {
		return false;
	}
}

export async function signIn() {
	await puter.auth.signIn();
	return puter.auth.getUser();
}

export async function getUser() {
	try {
		return await puter.auth.getUser();
	} catch {
		return null;
	}
}

export async function signOut() {
	try {
		await puter.auth.signOut();
	} catch {
		/* ignore */
	}
}

// ---------------------------------------------------------------------------
// Speech to text
// ---------------------------------------------------------------------------
export async function transcribe(blob) {
	if (!puterReady()) throw new Error("Puter.js did not load. Check your internet connection.");
	let lastErr;
	for (const model of CONFIG.ai.transcribeModels) {
		try {
			const res = await puter.ai.speech2txt(blob, { model, language: "en" });
			const text = typeof res === "string" ? res : res?.text;
			if (text && text.trim()) return text.trim();
			lastErr = new Error("empty transcript");
		} catch (e) {
			lastErr = e;
		}
	}
	throw new Error(friendly(lastErr, "We could not turn that recording into text. Try again in a quiet place."));
}

// ---------------------------------------------------------------------------
// Text to speech: hear the corrected sentence read back
// ---------------------------------------------------------------------------
let currentAudio = null;

export async function speak(text) {
	if (!puterReady()) throw new Error("Puter.js did not load, so audio is unavailable.");
	if (currentAudio) {
		try {
			currentAudio.pause();
		} catch {}
		currentAudio = null;
	}
	try {
		const audio = await puter.ai.txt2speech(String(text).slice(0, 600), { language: "en" });
		currentAudio = audio;
		await audio.play();
		return audio;
	} catch (e) {
		throw new Error(friendly(e, "Could not play the audio. Please try again."));
	}
}

// ---------------------------------------------------------------------------
// Chat helper: tries several models, understands JSON replies
// ---------------------------------------------------------------------------
export async function chat(prompt, { json = false, models = CONFIG.ai.chatModels } = {}) {
	if (!puterReady()) throw new Error("Puter.js did not load. Check your internet connection.");
	let lastErr;
	for (const model of [...models, undefined]) {
		try {
			const res = await puter.ai.chat(prompt, model ? { model } : {});
			const text = readChat(res);
			if (!text) throw new Error("empty reply");
			return json ? parseJSON(text) : text;
		} catch (e) {
			lastErr = e;
		}
	}
	throw new Error(friendly(lastErr, "The AI check failed. Please try again."));
}

function readChat(res) {
	if (!res) return "";
	if (typeof res === "string") return res;
	if (typeof res.text === "string") return res.text;
	const c = res.message?.content;
	if (typeof c === "string") return c;
	if (Array.isArray(c)) return c.map((p) => p?.text || "").join("");
	return String(res);
}

function parseJSON(text) {
	let s = String(text).trim();
	s = s.replace(/^```(?:json)?/i, "").replace(/```$/,"").trim();
	const start = s.indexOf("{");
	const end = s.lastIndexOf("}");
	if (start > 0 || end < s.length - 1) s = s.slice(start, end + 1);
	return JSON.parse(s);
}

function friendly(err, fallback) {
	const msg = String(err?.message || err?.error?.message || err || "");
	if (/insufficient|credit|usage|quota/i.test(msg)) return "Your Puter AI allowance ran out. Top it up in your Puter account and try again.";
	if (/auth|sign|token|401|403/i.test(msg)) return "Please sign in with Puter again.";
	if (/network|fetch|timeout|502|503/i.test(msg)) return "Network problem while reaching the AI. Please try again.";
	return fallback;
}

// ---------------------------------------------------------------------------
// The teacher: marks the transcript
// ---------------------------------------------------------------------------
const MARKING_PROMPT = (topic, transcript, seconds) => `You are a kind, plain-spoken English teacher marking a student's spoken answer.

TOPIC GIVEN TO THE STUDENT: "${topic}"
SPOKEN LENGTH: ${seconds} seconds
TRANSCRIPT (from speech-to-text, so ignore missing punctuation and capital letters):
"""
${transcript}
"""

YOUR JOB
1. Split the transcript into short sentences, keeping the student's own words exactly as spoken.
2. For each sentence, write the corrected version.
3. List every real mistake: grammar, wrong word, word order, missing word, extra word, singular/plural, tense, preposition, or an unnatural phrase.
4. Explain each mistake in VERY SIMPLE words. This is the most important part.

EXPLANATION RULES (strict)
- Never use grammar terms. Banned words include: tense, past perfect, gerund, article, preposition, subject, verb, plural, auxiliary, clause, conjugation, modal.
- Explain WHY it sounds wrong, using everyday meaning. Example: instead of "wrong past tense", say "This already happened yesterday, so we say 'went', not 'am going'."
- One or two short sentences. Speak directly to the student as "you".
- Never scold. Be warm and clear.

MARKING RULES
- "accuracy" 0-10: how correct the English was, judged against how much they said.
- "complexity" 0-10: how ambitious the English was (long sentences, linking ideas, richer words score higher; very short simple sentences score low).
- "score" 0-10: overall mark. Weigh accuracy most, but a student who attempts harder English and slips a little should beat a student who only says very easy safe sentences perfectly. Do not give 9 or 10 unless the English was genuinely strong.
- "remark": exactly one of "very bad", "bad", "good", "very good", "excellent", matching the score.
- "level_note": one friendly sentence about how hard their English was and what to try next.
- "did_well": 1-3 short specific things they did right.
- If the transcript is too short or is not really an answer, give a low score and say so kindly in level_note.

For each mistake use:
  "wrong": the exact words from the sentence that are wrong ("" if a word is simply missing)
  "right": the words that should be used instead ("" if words should be deleted)
  "why": the simple explanation
  "kind": one short everyday label like "wrong time word", "missing small word", "word order", "one or many", "word choice"

Return ONLY this JSON, nothing else:
{"sentences":[{"original":"...","corrected":"...","errors":[{"wrong":"...","right":"...","why":"...","kind":"..."}]}],"accuracy":0,"complexity":0,"score":0,"remark":"good","level_note":"...","did_well":["..."]}`;

export async function markEnglish({ topic, transcript, seconds }) {
	const raw = await chat(MARKING_PROMPT(topic, transcript, Math.round(seconds)), { json: true });
	return normalizeReport(raw, transcript);
}

export function normalizeReport(raw, transcript) {
	const clamp = (n, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));
	const sentences = (Array.isArray(raw?.sentences) ? raw.sentences : [])
		.filter((s) => s && typeof s.original === "string" && s.original.trim())
		.map((s) => ({
			original: s.original.trim(),
			corrected: (s.corrected || s.original).trim(),
			errors: (Array.isArray(s.errors) ? s.errors : [])
				.filter((e) => e && (e.wrong || e.right) && e.why)
				.map((e) => ({
					wrong: String(e.wrong ?? "").trim(),
					right: String(e.right ?? "").trim(),
					why: String(e.why).trim(),
					kind: String(e.kind || "").trim(),
				})),
		}));

	if (!sentences.length && transcript) {
		sentences.push({ original: transcript.trim(), corrected: transcript.trim(), errors: [] });
	}

	const accuracy = clamp(raw?.accuracy);
	const complexity = clamp(raw?.complexity);
	let score = clamp(raw?.score);
	if (!score) score = clamp(0.75 * accuracy + 0.25 * complexity);

	const allowed = ["very bad", "bad", "good", "very good", "excellent"];
	const given = String(raw?.remark || "").toLowerCase().trim();
	const remark = allowed.includes(given) ? given : remarkForScore(score).key;

	return {
		sentences,
		accuracy,
		complexity,
		score,
		remark,
		levelNote: String(raw?.level_note || "").trim(),
		didWell: (Array.isArray(raw?.did_well) ? raw.did_well : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 3),
		errorCount: sentences.reduce((n, s) => n + s.errors.length, 0),
	};
}
