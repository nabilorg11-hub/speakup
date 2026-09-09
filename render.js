// ---------------------------------------------------------------------------
// Rendering: the marked-up notebook page, the fix list and the streak grid.
// ---------------------------------------------------------------------------

import { CONFIG, remarkClass } from "./config.js";
import { todayKey } from "./store.js";

export function esc(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// --- red-pen markup --------------------------------------------------------
// For each sentence we keep the student's own words and lay the corrections
// on top: struck-through wrong words, the right words written above in red,
// and a caret for a missing word.
export function paperHTML(report) {
	let n = 0;
	const blocks = report.sentences.map((sent) => {
		let html = esc(sent.original);
		const pieces = [];

		for (const err of sent.errors) {
			const id = `e${n++}`;
			err._id = id;
			const token = `\u0000${id}\u0000`;

			if (err.wrong) {
				const idx = indexOfLoose(html, esc(err.wrong));
				if (idx < 0) {
					// could not locate the words in the sentence: show it as an added note
					pieces.push({ id, html: markHTML(id, err) });
					continue;
				}
				html = html.slice(0, idx) + token + html.slice(idx + esc(err.wrong).length);
				pieces.push({ id, html: markHTML(id, err) });
			} else {
				// missing word: drop a caret at the end of the sentence
				html += ` ${token}`;
				pieces.push({ id, html: caretHTML(id, err) });
			}
		}

		for (const p of pieces) html = html.replace(`\u0000${p.id}\u0000`, p.html);
		const orphans = pieces.filter((p) => html.includes(`\u0000${p.id}\u0000`));
		for (const o of orphans) html = html.replace(`\u0000${o.id}\u0000`, "");
		return `<p class="hand sent">${html}</p>`;
	});

	const note = report.levelNote ? `<p class="paper-note">${esc(report.levelNote)}</p>` : "";
	return blocks.join("\n") + note;
}

function markHTML(id, err) {
	const right = err.right
		? `<span class="above"><span class="up">${esc(err.right)}</span></span>`
		: `<span class="above"><span class="up">✘</span></span>`;
	return (
		`<span class="mark" data-err="${id}" role="button" tabindex="0" title="${esc(err.why)}">` +
		`<span class="circle"><s class="ink-strike">${esc(err.wrong)}</s></span>${right}</span>`
	);
}

function caretHTML(id, err) {
	return (
		`<span class="mark" data-err="${id}" role="button" tabindex="0" title="${esc(err.why)}">` +
		`<span class="ink-caret">‸${esc(err.right)}</span></span>`
	);
}

// case-insensitive search that still returns an index into the original string
function indexOfLoose(haystack, needle) {
	if (!needle) return -1;
	const i = haystack.indexOf(needle);
	if (i >= 0) return i;
	return haystack.toLowerCase().indexOf(needle.toLowerCase());
}

const SPEAKER_SVG =
	'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6.5 9H3v6h3.5L11 19z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg>';

// --- the "why it was wrong" list ------------------------------------------
export function fixesHTML(report) {
	const all = report.sentences.flatMap((s) => s.errors.map((e) => ({ ...e, _correct: s.corrected })));
	if (!all.length) {
		return `<p class="empty">No mistakes worth marking. Try a harder topic and longer sentences next time.</p>`;
	}
	return all
		.map(
			(e) => `<div class="fix" data-err="${e._id}" role="button" tabindex="0">
  <div class="fix-swap">
    ${e.wrong ? `<span class="fix-wrong">${esc(e.wrong)}</span>` : `<span class="fix-wrong">(missing)</span>`}
    <span class="fix-arrow">→</span>
    <span class="fix-right">${esc(e.right || "(remove it)")}</span>
    <button class="speak" data-speak="${esc(e._correct || e.right)}" title="Hear the correct sentence" aria-label="Hear the correct sentence">${SPEAKER_SVG}</button>
  </div>
  <p class="fix-why">${esc(e.why)}</p>
  ${e.kind ? `<span class="fix-kind">${esc(e.kind)}</span>` : ""}
</div>`,
		)
		.join("\n");
}

// --- score panel -----------------------------------------------------------
export function paintScore(report, els, facts) {
	els.scoreNum.textContent = report.score;
	els.scoreRing.style.setProperty("--pct", `${report.score * 10}%`);
	els.stampScore.innerHTML = `${report.score}<span class="stamp-of">/10</span>`;
	els.stampRemark.textContent = report.remark;
	els.remarkBadge.textContent = report.remark;
	els.remarkBadge.className = `remark-badge ${remarkClass(report.remark)}`;
	els.levelNote.textContent = report.levelNote || "";
	els.barAcc.style.width = `${report.accuracy * 10}%`;
	els.barCom.style.width = `${report.complexity * 10}%`;
	els.numAcc.textContent = report.accuracy;
	els.numCom.textContent = report.complexity;
	els.factWords.textContent = facts.words;
	els.factSecs.textContent = `${Math.round(facts.seconds)}s`;
	els.factErrs.textContent = report.errorCount;

	const good = report.didWell.length
		? report.didWell.map((g) => `<li>${esc(g)}</li>`).join("")
		: `<li>You showed up and spoke. That is the habit that matters.</li>`;
	els.goodList.innerHTML = good;
}

// --- GitHub-style streak grid ---------------------------------------------
export function heatmapHTML(days, weeks = CONFIG.rules.heatmapWeeks) {
	const today = new Date();
	const end = new Date(today);
	end.setDate(end.getDate() + (6 - end.getDay())); // pad to end of this week
	const start = new Date(end);
	start.setDate(start.getDate() - (weeks * 7 - 1));

	const tKey = todayKey(today);
	const cells = [];
	const cursor = new Date(start);
	while (cursor <= end) {
		const key = todayKey(cursor);
		const rec = days[key];
		const future = cursor > today;
		const lvl = rec ? level(rec) : 0;
		const cls = ["cell", future ? "is-empty" : `lv${lvl}`, key === tKey ? "is-today" : ""].filter(Boolean).join(" ");
		const label = future
			? ""
			: rec
				? `${key}: ${rec.sessions} session${rec.sessions > 1 ? "s" : ""}, best ${rec.best}/10`
				: `${key}: no practice`;
		cells.push(`<i class="${cls}" title="${label}"></i>`);
		cursor.setDate(cursor.getDate() + 1);
	}
	return cells.join("");
}

function level(rec) {
	const s = rec.sessions || 0;
	const best = rec.best || 0;
	if (s >= 3 || best >= 9) return 4;
	if (s === 2 || best >= 7) return 3;
	if (best >= 5) return 2;
	return 1;
}

// --- repeat-mistake trends -------------------------------------------------
// Every marked error carries a plain-English `kind`, so this needs no extra data.
export function trendsHTML(sessions) {
	const counts = new Map();
	let total = 0;
	for (const s of sessions) {
		const rep = s?.report;
		if (!rep?.sentences) continue;
		for (const sent of rep.sentences) {
			for (const e of sent.errors || []) {
				const key = (e.kind || "other").toLowerCase();
				counts.set(key, (counts.get(key) || 0) + 1);
				total++;
			}
		}
	}
	if (!total) return `<p class="empty">Once you have a few checked sessions, your repeat mistakes will be listed here.</p>`;
	const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
	const max = top[0][1];
	return top
		.map(
			([kind, n]) => `<div class="trend">
  <span class="trend-label">${esc(kind)}</span>
  <div class="bar"><i style="width:${Math.round((n / max) * 100)}%"></i></div>
  <b>${n}×</b>
</div>`,
		)
		.join("");
}

// --- history list ----------------------------------------------------------
export function historyHTML(rows) {
	if (!rows.length) return `<p class="empty">No sessions yet. Your first one will show up here.</p>`;
	return rows
		.map((r, i) => {
			const d = new Date(r.created_at);
			const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
			return `<button class="hist" data-session="${i}">
  <span class="hist-date">${esc(date)}</span>
  <span class="hist-topic">${esc(r.topic_text)}</span>
  <span class="hist-right"><span class="remark-badge ${remarkClass(r.remark)}">${esc(r.remark)}</span><span class="hist-score">${r.score}/10</span></span>
</button>`;
		})
		.join("");
}
