// ---------------------------------------------------------------------------
// Storage: Supabase first, localStorage as a safety net.
// ---------------------------------------------------------------------------
// The app identifies users by their Puter user id, so every row carries
// `puter_user_id`. See supabase/schema.sql for the tables and policies.

import { CONFIG } from "./config.js";

const LS = {
	sessions: "speakup.sessions",
	days: "speakup.days",
};

function lsRead(key, fallback) {
	try {
		const raw = localStorage.getItem(key);
		return raw ? JSON.parse(raw) : fallback;
	} catch {
		return fallback;
	}
}
function lsWrite(key, value) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {}
}

export function todayKey(d = new Date()) {
	// local calendar day, so streaks roll over at the user's own midnight
	const p = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export class Store {
	constructor() {
		this.sb = null;
		this.userId = "local";
		this.mode = "local"; // "supabase" | "local"
	}

	async init(userId) {
		this.userId = userId || "local";
		const { url, anonKey } = CONFIG.supabase;
		if (!url || !anonKey || anonKey.includes("YOUR_")) return this.mode;
		try {
			const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
			this.sb = createClient(url, anonKey, { auth: { persistSession: false } });
			const { error } = await this.sb.from("topics").select("id", { head: true, count: "exact" }).limit(1);
			if (error) throw error;
			this.mode = "supabase";
		} catch (e) {
			this.sb = null;
			this.mode = "local";
			if (!CONFIG.supabase.fallbackToLocal) throw e;
			console.warn("[SpeakUp] Supabase unavailable, using local storage.", e?.message || e);
		}
		return this.mode;
	}

	// ---- topics -------------------------------------------------------------
	async listTopics() {
		if (this.mode !== "supabase") return [];
		const { data, error } = await this.sb.from("topics").select("id,level,text").eq("active", true).limit(500);
		if (error) return [];
		return data || [];
	}

	// ---- sessions -----------------------------------------------------------
	async saveSession(session) {
		const row = {
			puter_user_id: this.userId,
			topic_text: session.topic.text,
			topic_level: session.topic.level,
			transcript: session.transcript,
			duration_seconds: Math.round(session.seconds),
			word_count: session.wordCount,
			score: session.report.score,
			accuracy: session.report.accuracy,
			complexity: session.report.complexity,
			remark: session.report.remark,
			level_note: session.report.levelNote,
			report: session.report,
			local_day: session.day,
			created_at: new Date().toISOString(),
		};

		if (this.mode === "supabase") {
			try {
				const { data, error } = await this.sb.from("sessions").insert(row).select("id").single();
				if (error) throw error;
				if (session.counts) await this.markDay(session.day, session.report.score);
				return { id: data?.id, ...row };
			} catch (e) {
				console.warn("[SpeakUp] Could not save to Supabase, keeping it locally.", e?.message || e);
			}
		}

		const all = lsRead(LS.sessions, []);
		const saved = { id: `local-${Date.now()}`, ...row };
		all.unshift(saved);
		lsWrite(LS.sessions, all.slice(0, 500));
		if (session.counts) await this.markDay(session.day, session.report.score);
		return saved;
	}

	async listSessions(limit = 60) {
		if (this.mode === "supabase") {
			const { data, error } = await this.sb
				.from("sessions")
				.select("id,topic_text,topic_level,score,remark,report,transcript,duration_seconds,word_count,local_day,created_at")
				.eq("puter_user_id", this.userId)
				.order("created_at", { ascending: false })
				.limit(limit);
			if (!error) return data || [];
		}
		return lsRead(LS.sessions, []).slice(0, limit);
	}

	// ---- attendance ---------------------------------------------------------
	async markDay(day, score) {
		if (this.mode === "supabase") {
			try {
				const { error } = await this.sb.rpc("speakup_mark_day", {
					p_user: this.userId,
					p_day: day,
					p_score: score,
				});
				if (error) throw error;
				return;
			} catch (e) {
				console.warn("[SpeakUp] mark_day fell back to local.", e?.message || e);
			}
		}
		const days = lsRead(LS.days, {});
		const prev = days[day] || { sessions: 0, best: 0 };
		days[day] = { sessions: prev.sessions + 1, best: Math.max(prev.best, score || 0) };
		lsWrite(LS.days, days);
	}

	// returns { "YYYY-MM-DD": { sessions, best } }
	async listDays() {
		if (this.mode === "supabase") {
			const { data, error } = await this.sb
				.from("daily_activity")
				.select("local_day,sessions,best_score")
				.eq("puter_user_id", this.userId)
				.order("local_day", { ascending: false })
				.limit(800);
			if (!error) {
				const out = {};
				for (const r of data || []) out[r.local_day] = { sessions: r.sessions, best: r.best_score };
				return out;
			}
		}
		return lsRead(LS.days, {});
	}

	seedLocal(days, sessions) {
		lsWrite(LS.days, days);
		lsWrite(LS.sessions, sessions);
	}
}

// ---------------------------------------------------------------------------
// Streak maths (pure, so it is easy to reason about and test)
// ---------------------------------------------------------------------------
export function streakStats(days, grace = 0, today = new Date()) {
	const has = (d) => !!days[todayKey(d)];
	const step = (d, n) => {
		const x = new Date(d);
		x.setDate(x.getDate() + n);
		return x;
	};

	// current streak: walk backwards from today (or yesterday if today is blank)
	let cursor = new Date(today);
	if (!has(cursor)) cursor = step(cursor, -1);
	let current = 0;
	let misses = 0;
	while (true) {
		if (has(cursor)) {
			current++;
			misses = 0;
		} else {
			misses++;
			if (misses > grace) break;
		}
		cursor = step(cursor, -1);
		if (current > 3650) break;
	}

	// longest streak over all recorded days
	const keys = Object.keys(days).sort();
	let best = 0;
	let run = 0;
	let prev = null;
	for (const k of keys) {
		const d = new Date(`${k}T00:00:00`);
		if (prev) {
			const gap = Math.round((d - prev) / 86400000);
			run = gap <= 1 + grace ? run + 1 : 1;
		} else run = 1;
		best = Math.max(best, run);
		prev = d;
	}

	const totalSessions = Object.values(days).reduce((n, v) => n + (v.sessions || 0), 0);
	return { current, best: Math.max(best, current), activeDays: keys.length, totalSessions };
}
