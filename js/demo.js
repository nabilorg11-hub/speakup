// ---------------------------------------------------------------------------
// Demo data: powers the "See a marked example" button and ?demo=1.
// Nothing here is used in the real flow.
// ---------------------------------------------------------------------------

import { normalizeReport } from "./ai.js";
import { todayKey } from "./store.js";

export const DEMO_TOPIC = { id: "demo-1", level: "medium", text: "Tell me about a time you were completely lost." };

export const DEMO_TRANSCRIPT =
	"Last year I am going to Chittagong with my two friend for a wedding. We reached at the bus stand very late and my phone battery was die. I asked one man about the address but he don't understand me, so we walking around one hour in the rain. Finally a rickshaw driver he helped us and we arrived the hotel at midnight. Now when I travel somewhere new, I always save the map before I leave home.";

export const DEMO_RAW = {
	sentences: [
		{
			original: "Last year I am going to Chittagong with my two friend for a wedding.",
			corrected: "Last year I went to Chittagong with my two friends for a wedding.",
			errors: [
				{
					wrong: "am going",
					right: "went",
					why: "This happened last year, so it is finished and over. \"Am going\" sounds like you are on your way right now.",
					kind: "wrong time word",
				},
				{
					wrong: "two friend",
					right: "two friends",
					why: "You are talking about more than one person, so the word needs an s on the end.",
					kind: "one or many",
				},
			],
		},
		{
			original: "We reached at the bus stand very late and my phone battery was die.",
			corrected: "We reached the bus stand very late and my phone battery was dead.",
			errors: [
				{
					wrong: "reached at",
					right: "reached",
					why: "\"Reached\" already means you got there, so the extra \"at\" is not needed.",
					kind: "extra word",
				},
				{
					wrong: "was die",
					right: "was dead",
					why: "Here you are describing the state of the battery, not an action it did. A battery with no power is \"dead\".",
					kind: "word choice",
				},
			],
		},
		{
			original: "I asked one man about the address but he don't understand me, so we walking around one hour in the rain.",
			corrected: "I asked a man for the address but he didn't understand me, so we walked around for an hour in the rain.",
			errors: [
				{
					wrong: "don't understand",
					right: "didn't understand",
					why: "You are telling a story from the past, so use \"didn't\". \"Don't\" is for right now.",
					kind: "wrong time word",
				},
				{
					wrong: "we walking",
					right: "we walked",
					why: "\"Walking\" on its own is not finished. Since it already happened, say \"we walked\".",
					kind: "wrong time word",
				},
				{
					wrong: "one hour",
					right: "for an hour",
					why: "When you say how long something lasted, put \"for\" in front of the time.",
					kind: "missing small word",
				},
			],
		},
		{
			original: "Finally a rickshaw driver he helped us and we arrived the hotel at midnight.",
			corrected: "Finally a rickshaw driver helped us and we arrived at the hotel at midnight.",
			errors: [
				{
					wrong: "driver he helped",
					right: "driver helped",
					why: "You already said who helped you, so \"he\" says the same thing twice.",
					kind: "extra word",
				},
				{
					wrong: "arrived the hotel",
					right: "arrived at the hotel",
					why: "With \"arrived\" we add \"at\" before the place. It is the opposite of \"reached\", which needs nothing.",
					kind: "missing small word",
				},
			],
		},
		{
			original: "Now when I travel somewhere new, I always save the map before I leave home.",
			corrected: "Now when I travel somewhere new, I always save the map before I leave home.",
			errors: [],
		},
	],
	accuracy: 6,
	complexity: 8,
	score: 7,
	remark: "good",
	level_note:
		"You told a real story with several linked ideas, which is harder than simple sentences — that lifted your mark. Your main slip is mixing present words into a past story.",
	did_well: [
		"You kept one clear story from start to end.",
		"Good use of \"finally\" and \"so\" to join your ideas.",
		"Your last sentence was completely correct and natural.",
	],
};

export function demoReport() {
	return normalizeReport(structuredClone(DEMO_RAW), DEMO_TRANSCRIPT);
}

// ~5 months of believable attendance, so the grid and streak look real
export function demoDays() {
	const days = {};
	const today = new Date();
	for (let i = 150; i >= 0; i--) {
		const d = new Date(today);
		d.setDate(d.getDate() - i);
		const dow = d.getDay();
		const chance = i < 12 ? 0.95 : dow === 5 || dow === 6 ? 0.35 : 0.72;
		if (Math.random() > chance) continue;
		const sessions = Math.random() > 0.82 ? 2 : 1;
		const best = Math.min(10, 4 + Math.round((150 - i) / 30) + (Math.random() > 0.7 ? 1 : 0));
		days[todayKey(d)] = { sessions, best };
	}
	days[todayKey(today)] = { sessions: 1, best: 7 };
	return days;
}

export function demoSessions() {
	const topics = [
		["Tell me about a time you were completely lost.", 7, "good"],
		["Describe your morning today, from waking up until now.", 8, "very good"],
		["Should social media have an age limit? Argue one side.", 6, "good"],
		["Explain how to cook something, step by step.", 9, "excellent"],
		["Describe a person who changed how you think.", 5, "good"],
		["Talk about a habit you are trying to build.", 4, "bad"],
	];
	const today = new Date();
	return topics.map(([text, score, remark], i) => {
		const d = new Date(today);
		d.setDate(d.getDate() - i * 2);
		return {
			id: `demo-${i}`,
			topic_text: text,
			topic_level: i % 3 === 2 ? "hard" : i % 2 ? "easy" : "medium",
			score,
			remark,
			report: i === 0 ? demoReport() : null,
			transcript: i === 0 ? DEMO_TRANSCRIPT : "",
			duration_seconds: 60 + i * 7,
			word_count: 70 + i * 9,
			local_day: todayKey(d),
			created_at: d.toISOString(),
		};
	});
}
