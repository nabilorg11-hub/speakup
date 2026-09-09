// ---------------------------------------------------------------------------
// Microphone recording with a live level meter.
// Record -> stop -> transcribe (more accurate and much simpler than streaming).
// ---------------------------------------------------------------------------

import { CONFIG } from "./config.js";

function pickMime() {
	const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
	if (typeof MediaRecorder === "undefined") return "";
	return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

export class Recorder {
	constructor({ onTick, onLevel, onStop, onError, bars = 24 } = {}) {
		this.onTick = onTick || (() => {});
		this.onLevel = onLevel || (() => {});
		this.onStop = onStop || (() => {});
		this.onError = onError || (() => {});
		this.bars = bars;
		this.recording = false;
		this.seconds = 0;
	}

	get supported() {
		return !!(navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined");
	}

	async start() {
		if (this.recording) return;
		if (!this.supported) {
			this.onError("This browser cannot record audio. Try Chrome, Edge or Safari.");
			return;
		}
		try {
			this.stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
			});
		} catch (e) {
			const denied = /NotAllowed|Permission/i.test(String(e?.name || e));
			this.onError(
				denied
					? "We need microphone permission to hear you. Allow it in your browser and tap the mic again."
					: "No microphone found. Plug one in or check your system settings.",
			);
			return;
		}

		const mimeType = pickMime();
		this.chunks = [];
		this.rec = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
		this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
		this.rec.onstop = () => {
			const blob = new Blob(this.chunks, { type: this.rec.mimeType || "audio/webm" });
			this.cleanup();
			this.onStop(blob, this.seconds);
		};
		this.rec.start(250);
		this.recording = true;
		this.seconds = 0;
		this.startedAt = Date.now();

		this.timer = setInterval(() => {
			this.seconds = (Date.now() - this.startedAt) / 1000;
			this.onTick(this.seconds);
			if (this.seconds >= CONFIG.rules.maxSeconds) this.stop();
		}, 200);

		this.meter();
	}

	meter() {
		try {
			const Ctx = window.AudioContext || window.webkitAudioContext;
			this.audioCtx = new Ctx();
			const src = this.audioCtx.createMediaStreamSource(this.stream);
			const analyser = this.audioCtx.createAnalyser();
			analyser.fftSize = 512;
			src.connect(analyser);
			const data = new Uint8Array(analyser.frequencyBinCount);
			const loop = () => {
				if (!this.recording) return;
				analyser.getByteFrequencyData(data);
				const per = Math.floor(data.length / this.bars);
				const out = [];
				for (let i = 0; i < this.bars; i++) {
					let sum = 0;
					for (let j = 0; j < per; j++) sum += data[i * per + j];
					out.push(Math.min(1, sum / per / 140));
				}
				this.onLevel(out);
				this.raf = requestAnimationFrame(loop);
			};
			loop();
		} catch {
			/* meter is decoration only */
		}
	}

	stop() {
		if (!this.recording || !this.rec) return;
		this.recording = false;
		try {
			this.rec.stop();
		} catch {
			this.cleanup();
		}
	}

	cleanup() {
		clearInterval(this.timer);
		cancelAnimationFrame(this.raf);
		this.recording = false;
		this.stream?.getTracks().forEach((t) => t.stop());
		this.audioCtx?.close?.().catch?.(() => {});
		this.audioCtx = null;
	}
}

export function formatTime(s) {
	const m = Math.floor(s / 60);
	const sec = Math.floor(s % 60);
	return `${m}:${String(sec).padStart(2, "0")}`;
}
