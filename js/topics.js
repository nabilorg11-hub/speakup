// ---------------------------------------------------------------------------
// Topics: a new one every time the app opens.
// ---------------------------------------------------------------------------
// Strategy:
//  1. Try Supabase table `topics` (seeded by supabase/schema.sql).
//  2. Otherwise use the built-in seed list below.
//  3. Optionally top up with AI-generated topics (puter.ai.chat), cached locally.
// A topic is never repeated until the whole pool for that level is used up.

import { CONFIG } from "./config.js";
import { chat } from "./ai.js";

export const SEED_TOPICS = [
	["easy", "Describe your morning today, from waking up until now."],
	["easy", "Talk about a meal you love and who usually cooks it."],
	["easy", "Describe the street where you live."],
	["easy", "Tell me about a friend and how you met."],
	["easy", "What do you usually do on a day off?"],
	["easy", "Describe the weather this week and how it changed your plans."],
	["easy", "Talk about a shop or market you go to often."],
	["easy", "Describe your phone and the three apps you open most."],
	["easy", "Tell me about a song you keep playing."],
	["easy", "What did you eat yesterday, and was it good?"],
	["easy", "Describe someone in your family in detail."],
	["easy", "Talk about how you travel to work or school."],
	["easy", "Describe a photo on your phone that you like."],
	["easy", "What is your favourite time of day, and why?"],
	["medium", "Tell me about a time you were completely lost."],
	["medium", "Describe a mistake that taught you something useful."],
	["medium", "Explain your work or studies to someone who knows nothing about it."],
	["medium", "Talk about a habit you are trying to build, and how it is going."],
	["medium", "Describe the best trip you have taken and what surprised you."],
	["medium", "Explain how to cook something, step by step."],
	["medium", "Talk about a film or show you would recommend, without spoiling it."],
	["medium", "Describe a person who changed how you think."],
	["medium", "Tell me about a time you had to say no to someone."],
	["medium", "What would you change about your city if you were the mayor?"],
	["medium", "Describe something you bought that was not worth the money."],
	["medium", "Talk about a skill you want to learn this year and your plan for it."],
	["medium", "Explain a piece of news you read recently and what you think about it."],
	["medium", "Describe a time you helped someone you did not know."],
	["hard", "Should social media have an age limit? Argue one side."],
	["hard", "Is it better to be respected or to be liked? Explain your reasoning."],
	["hard", "Describe a problem in your industry and how you would fix it."],
	["hard", "Will AI make people lazier or sharper? Defend your view."],
	["hard", "Explain a decision you regret, and what you would tell your past self."],
	["hard", "Should university be free for everyone? Give reasons and an example."],
	["hard", "Talk about a belief you held strongly and later dropped."],
	["hard", "Is remote work good for young people starting a career?"],
	["hard", "Describe how money changes friendships."],
	["hard", "If you had to lead a team tomorrow, how would you start?"],
	["hard", "What responsibility do rich countries have for climate change?"],
	["hard", "Explain something you believe most people around you get wrong."],
].map(([level, text], i) => ({ id: `seed-${i + 1}`, level, text }));

const SEEN_KEY = "speakup.seenTopics";
const AI_KEY = "speakup.aiTopics";

function readJSON(key, fallback) {
	try {
		const raw = localStorage.getItem(key);
		return raw ? JSON.parse(raw) : fallback;
	} catch {
		return fallback;
	}
}

function writeJSON(key, value) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		/* private mode: ignore */
	}
}

export class TopicPool {
	constructor(store) {
		this.store = store;
		this.pool = [];
	}

	async load() {
		const remote = await this.store.listTopics().catch(() => []);
		const ai = readJSON(AI_KEY, []);
		const merged = [...(remote || []), ...ai, ...SEED_TOPICS];
		const byText = new Map();
		for (const t of merged) {
			if (!t || !t.text) continue;
			const key = t.text.trim().toLowerCase();
			if (!byText.has(key)) byText.set(key, { id: t.id || key, level: t.level || "medium", text: t.text.trim() });
		}
		this.pool = [...byText.values()];
		return this.pool;
	}

	// level: "easy" | "medium" | "hard" | "auto"
	next(level = "auto", avgScore = null) {
		const want = level === "auto" ? levelFromScore(avgScore) : level;
		let seen = readJSON(SEEN_KEY, []);
		const candidates = this.pool.filter((t) => t.level === want);
		const list = candidates.length ? candidates : this.pool;
		let fresh = list.filter((t) => !seen.includes(t.id));
		if (!fresh.length) {
			// pool exhausted for this level: forget those and start over
			seen = seen.filter((id) => !list.some((t) => t.id === id));
			fresh = list;
		}
		const pick = fresh[Math.floor(Math.random() * fresh.length)];
		writeJSON(SEEN_KEY, [...seen, pick.id].slice(-400));
		return pick;
	}

	// Fire-and-forget: keeps the local pool growing so topics stay novel.
	async topUpWithAI() {
		const cached = readJSON(AI_KEY, []);
		if (cached.length >= CONFIG.ai.topicCacheSize) return;
		const prompt = `Give me 12 speaking-practice topics for English learners.
Rules: one sentence each, no numbering, natural spoken English, no niche cultural knowledge needed, must be answerable for 60 seconds by anyone.
Return ONLY JSON: {"topics":[{"level":"easy|medium|hard","text":"..."}]}`;
		try {
			const data = await chat(prompt, { json: true });
			const add = (data?.topics || [])
				.filter((t) => t && typeof t.text === "string")
				.map((t, i) => ({ id: `ai-${Date.now()}-${i}`, level: normalizeLevel(t.level), text: t.text.trim() }));
			if (add.length) {
				writeJSON(AI_KEY, [...cached, ...add].slice(-CONFIG.ai.topicCacheSize));
				this.pool = [...this.pool, ...add];
			}
		} catch {
			/* offline or not signed in: seed list is plenty */
		}
	}
}

function normalizeLevel(v) {
	const s = String(v || "").toLowerCase();
	return s === "easy" || s === "hard" ? s : "medium";
}

export function levelFromScore(avg) {
	if (avg == null || Number.isNaN(avg)) return "easy";
	if (avg >= 8) return "hard";
	if (avg >= 6) return "medium";
	return "easy";
}
