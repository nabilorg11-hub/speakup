// ---------------------------------------------------------------------------
// SpeakUp — app wiring
// ---------------------------------------------------------------------------

import { CONFIG } from "./config.js";
import * as AI from "./ai.js";
import { Store, streakStats, todayKey } from "./store.js";
import { TopicPool } from "./topics.js";
import { Recorder, formatTime } from "./recorder.js";
import { paperHTML, fixesHTML, paintScore, heatmapHTML, historyHTML, trendsHTML } from "./render.js";
import { DEMO_TOPIC, DEMO_TRANSCRIPT, demoReport, demoDays, demoSessions } from "./demo.js";

const $ = (id) => document.getElementById(id);
const el = {};
for (const id of [
	"topbar","streakPill","streakPillNum","userBtn","userInitial","signInBtn","demoBtn","authNote",
	"topicText","topicLevel","topicHint","newTopicBtn","micBtn","levels","timer","recHint","recActions",
	"playback","checkBtn","retakeBtn","recError","heatmapMini","heatmapFull","loadingTitle","steps",
	"reportTopic","reportDate","paperBody","stampScore","stampRemark","scoreRing","scoreNum","remarkBadge",
	"levelNote","barAcc","barCom","numAcc","numCom","factWords","factSecs","factErrs","fixes","goodList",
	"statStreak","statBest","statTotal","statAvg","history","toast","heatmapNote",
]) el[id] = $(id);

const state = {
	user: null,
	demo: false,
	topic: null,
	blob: null,
	seconds: 0,
	report: null,
	transcript: "",
	days: {},
	sessions: [],
	avgScore: null,
};

const store = new Store();
const topics = new TopicPool(store);
const BARS = 24;
el.levels.innerHTML = Array.from({ length: BARS }, () => "<i></i>").join("");
const barEls = [...el.levels.querySelectorAll("i")];

// ---------------------------------------------------------------------------
// navigation
// ---------------------------------------------------------------------------
function show(name) {
	for (const s of document.querySelectorAll(".screen")) s.classList.toggle("is-active", s.id === `screen-${name}`);
	el.topbar.hidden = name === "landing";
	for (const t of document.querySelectorAll(".tab")) {
		const on = t.dataset.goto === name || (name === "report" && t.dataset.goto === "home");
		t.classList.toggle("is-active", on);
		t.setAttribute("aria-selected", String(on));
	}
	window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}
document.addEventListener("click", (e) => {
	const btn = e.target.closest("[data-goto]");
	if (btn) show(btn.dataset.goto);
});

let toastTimer;
// Reads a corrected sentence aloud with Puter's text-to-speech.
async function playSentence(btn) {
	const text = btn.dataset.speak;
	if (!text) return;
	if (btn.classList.contains("is-busy")) return;
	btn.classList.add("is-busy");
	try {
		await AI.speak(text);
	} catch (err) {
		toast(err.message || "Could not play the audio.");
	} finally {
		btn.classList.remove("is-busy");
	}
}

function toast(msg) {
	el.toast.textContent = msg;
	el.toast.hidden = false;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => (el.toast.hidden = true), 3200);
}

function setSteps(current) {
	const order = ["transcribe", "analyze", "mark"];
	const i = order.indexOf(current);
	for (const li of el.steps.querySelectorAll("li")) {
		const j = order.indexOf(li.dataset.step);
		li.classList.toggle("is-done", j < i);
		li.classList.toggle("is-now", j === i);
	}
	el.loadingTitle.textContent =
		current === "transcribe" ? "Listening to your recording…"
		: current === "analyze" ? "Reading your English carefully…"
		: "Marking the page in red…";
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
async function boot() {
	const params = new URLSearchParams(location.search);
	if (params.get("demo") === "1") return startDemo();

	if (!AI.puterReady()) {
		el.authNote.textContent = "Puter.js could not load, so sign-in and AI checking are offline. You can still look at a marked example.";
		el.signInBtn.disabled = true;
		return show("landing");
	}

	if (await AI.isSignedIn()) {
		const user = await AI.getUser();
		if (user) return enter(user);
	}
	show("landing");
}

el.signInBtn.addEventListener("click", async () => {
	el.signInBtn.disabled = true;
	el.signInBtn.textContent = "Opening Puter…";
	try {
		const user = await AI.signIn();
		await enter(user);
	} catch {
		toast("Sign-in was cancelled.");
	} finally {
		el.signInBtn.disabled = false;
		el.signInBtn.textContent = "Sign in and start";
	}
});

el.demoBtn.addEventListener("click", startDemo);

el.userBtn.addEventListener("click", async () => {
	if (state.demo) return location.assign(location.pathname);
	if (!confirm("Sign out of SpeakUp?")) return;
	await AI.signOut();
	location.assign(location.pathname);
});

async function enter(user) {
	state.user = user;
	state.demo = false;
	el.userInitial.textContent = (user?.username || "?").slice(0, 1).toUpperCase();
	el.userBtn.title = `Signed in as ${user?.username || "you"}`;

	const mode = await store.init(user?.uuid || user?.id || user?.username || "local");
	if (mode === "local") toast("Saving progress on this device (Supabase not reachable yet).");

	await Promise.all([topics.load(), refreshProgress()]);
	nextTopic();
	show("home");
	topics.topUpWithAI();
}

async function startDemo() {
	state.demo = true;
	state.user = { username: "demo" };
	el.userInitial.textContent = "D";
	el.userBtn.title = "Demo mode — click to leave";
	state.days = demoDays();
	state.sessions = demoSessions();
	state.avgScore = 6.5;
	paintProgress();
	state.topic = DEMO_TOPIC;
	paintTopic();
	state.transcript = DEMO_TRANSCRIPT;
	state.seconds = 74;
	state.report = demoReport();
	paintReport();
	const wanted = new URLSearchParams(location.search).get("screen");
	show(["home", "progress", "loading", "report"].includes(wanted) ? wanted : "report");
	toast("Demo mode: this is a marked example.");
}

// ---------------------------------------------------------------------------
// topic
// ---------------------------------------------------------------------------
function nextTopic() {
	state.topic = topics.next("auto", state.avgScore);
	paintTopic();
}
function paintTopic() {
	el.topicText.textContent = state.topic.text;
	el.topicLevel.textContent = state.topic.level;
	el.topicLevel.className = `chip ${state.topic.level}`;
}
el.newTopicBtn.addEventListener("click", () => {
	if (state.demo) return toast("Sign in to get fresh topics.");
	nextTopic();
});

// ---------------------------------------------------------------------------
// recording
// ---------------------------------------------------------------------------
const recorder = new Recorder({
	bars: BARS,
	onTick: (s) => {
		el.timer.textContent = formatTime(s);
		const left = CONFIG.rules.minSecondsForCredit - s;
		el.recHint.textContent = left > 0
			? `Keep going — ${Math.ceil(left)}s more counts for your streak`
			: "Tap again to stop when you are done";
	},
	onLevel: (levels) => levels.forEach((v, i) => (barEls[i].style.height = `${6 + v * 30}px`)),
	onError: (msg) => {
		el.recError.textContent = msg;
		el.recError.hidden = false;
		resetMicUI();
	},
	onStop: (blob, seconds) => {
		state.blob = blob;
		state.seconds = seconds;
		resetMicUI();
		el.timer.textContent = formatTime(seconds);
		el.playback.src = URL.createObjectURL(blob);
		el.recActions.hidden = false;
		const short = seconds < CONFIG.rules.minSecondsForCredit;
		el.recHint.textContent = short
			? `That was ${Math.round(seconds)}s — under ${CONFIG.rules.minSecondsForCredit}s, so it will not count for your streak.`
			: "Sounds good. Send it to be checked.";
		el.checkBtn.disabled = seconds < CONFIG.rules.minSecondsToCheck;
	},
});

function resetMicUI() {
	el.micBtn.classList.remove("is-rec");
	el.micBtn.setAttribute("aria-label", "Start recording");
	el.levels.classList.remove("is-live");
	barEls.forEach((b) => (b.style.height = "6px"));
}

el.micBtn.addEventListener("click", async () => {
	if (state.demo) return toast("Sign in with Puter to record your own answer.");
	if (recorder.recording) return recorder.stop();
	el.recError.hidden = true;
	el.recActions.hidden = true;
	state.blob = null;
	await recorder.start();
	if (recorder.recording) {
		el.micBtn.classList.add("is-rec");
		el.micBtn.setAttribute("aria-label", "Stop recording");
		el.levels.classList.add("is-live");
		el.timer.textContent = "0:00";
	}
});

el.retakeBtn.addEventListener("click", () => {
	state.blob = null;
	el.recActions.hidden = true;
	el.timer.textContent = "0:00";
	el.recHint.textContent = "Tap the mic to start";
});

$("backHomeBtn").addEventListener("click", () => {
	if (!state.demo) nextTopic();
	el.recActions.hidden = true;
	el.timer.textContent = "0:00";
	el.recHint.textContent = "Tap the mic to start";
	show("home");
});

// ---------------------------------------------------------------------------
// check my English
// ---------------------------------------------------------------------------
el.checkBtn.addEventListener("click", async () => {
	if (!state.blob) return;
	show("loading");
	setSteps("transcribe");
	try {
		const transcript = await AI.transcribe(state.blob);
		state.transcript = transcript;
		if (transcript.split(/\s+/).filter(Boolean).length < 8) {
			throw new Error("We could only hear a few words. Try speaking a bit louder and longer.");
		}
		setSteps("analyze");
		const report = await AI.markEnglish({ topic: state.topic.text, transcript, seconds: state.seconds });
		setSteps("mark");
		state.report = report;
		paintReport();
		show("report");

		const counts = state.seconds >= CONFIG.rules.minSecondsForCredit;
		await store.saveSession({
			topic: state.topic,
			transcript,
			seconds: state.seconds,
			wordCount: wordCount(transcript),
			report,
			day: todayKey(),
			counts,
		});
		await refreshProgress();
		if (counts) toast(`Day marked present — ${state.days[todayKey()]?.sessions || 1} session today.`);
	} catch (e) {
		el.recError.textContent = e?.message || "Something went wrong. Please try again.";
		el.recError.hidden = false;
		show("home");
	}
});

function wordCount(t) {
	return String(t).trim().split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// report painting + linking marks to explanations
// ---------------------------------------------------------------------------
function paintReport() {
	el.reportTopic.textContent = state.topic.text;
	el.reportDate.textContent = state.demo ? "Example marking" : "Checked just now";
	el.paperBody.innerHTML = paperHTML(state.report);
	el.fixes.innerHTML = fixesHTML(state.report);
	paintScore(state.report, el, { words: wordCount(state.transcript), seconds: state.seconds });
}

function focusError(id) {
	for (const n of document.querySelectorAll("[data-err]")) n.classList.toggle("is-active", n.dataset.err === id);
	const fix = document.querySelector(`.fix[data-err="${id}"]`);
	fix?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
document.addEventListener("click", (e) => {
	const speakBtn = e.target.closest?.(".speak");
	if (speakBtn) {
		e.stopPropagation();
		playSentence(speakBtn);
		return;
	}
	const node = e.target.closest("[data-err]");
	if (node) focusError(node.dataset.err);
});
document.addEventListener("keydown", (e) => {
	if (e.key !== "Enter" && e.key !== " ") return;
	const node = e.target.closest?.("[data-err]");
	if (node) {
		e.preventDefault();
		focusError(node.dataset.err);
	}
});

// ---------------------------------------------------------------------------
// progress
// ---------------------------------------------------------------------------
async function refreshProgress() {
	const [days, sessions] = await Promise.all([store.listDays(), store.listSessions()]);
	state.days = days || {};
	state.sessions = sessions || [];
	const scored = state.sessions.filter((s) => typeof s.score === "number");
	state.avgScore = scored.length ? scored.reduce((n, s) => n + s.score, 0) / scored.length : null;
	paintProgress();
}

function paintProgress() {
	const st = streakStats(state.days, CONFIG.rules.streakGraceDays);
	el.streakPillNum.textContent = st.current;
	el.statStreak.textContent = st.current;
	el.statBest.textContent = st.best;
	el.statTotal.textContent = st.totalSessions;
	el.statAvg.textContent = state.avgScore == null ? "–" : `${state.avgScore.toFixed(1)}/10`;
	el.heatmapFull.innerHTML = heatmapHTML(state.days, CONFIG.rules.heatmapWeeks);
	el.heatmapMini.innerHTML = heatmapHTML(state.days, CONFIG.rules.heatmapWeeksCompact);
	el.history.innerHTML = historyHTML(state.sessions);
	const trends = document.getElementById("trends");
	if (trends) trends.innerHTML = trendsHTML(state.sessions);
	el.heatmapNote.textContent = `A day counts once you finish a recording of ${CONFIG.rules.minSecondsForCredit} seconds or longer. Days roll over at midnight in your own timezone.`;
}

el.history.addEventListener("click", (e) => {
	const btn = e.target.closest("[data-session]");
	if (!btn) return;
	const row = state.sessions[Number(btn.dataset.session)];
	if (!row?.report) return toast("That session was saved before reports were kept.");
	state.topic = { text: row.topic_text, level: row.topic_level || "medium" };
	state.transcript = row.transcript || "";
	state.seconds = row.duration_seconds || 0;
	state.report = row.report;
	paintReport();
	el.reportDate.textContent = new Date(row.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
	show("report");
});

boot();
