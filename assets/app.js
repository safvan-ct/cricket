const $ = (id) => document.getElementById(id);
let current = null;
let state = null;
let pendingExtra = "";
let pendingWicket = false;
let isAdmin = false;
let pollTimer = null;
let editingMatch = false;
const overSectionOpen = {};
let lastOverInnings = null;
const EXTRA_LABELS = {
	wide: "Wide",
	"no-ball": "No-ball",
	bye: "Bye",
	overthrow: "Ovr 4",
	wicket: "Wicket",
};
async function api(action, method = "GET", data = null, id = null) {
	const url = "api/index.php?action=" + action + (id ? "&id=" + id : "");
	const r = await fetch(url, {
		method,
		headers: data ? { "Content-Type": "application/json" } : {},
		body: data ? JSON.stringify(data) : undefined,
	});
	const j = await r.json();
	if (!r.ok) throw new Error(j.error || "Request failed");
	return j;
}
function show(id) {
	["login", "app", "setupView", "scoreView"].forEach((x) =>
		$(x).classList.add("hidden"),
	);
	$(id).classList.remove("hidden");
	if (id === "app") {
		$("matchesView").classList.remove("hidden");
		$("setupView").classList.add("hidden");
		$("scoreView").classList.add("hidden");
	}
}
function readScoreId() {
	const m = String(location.hash || "").match(/^#m=(\d+)$/);
	return m ? m[1] : null;
}
function rememberMatch(id) {
	const next = "#m=" + id;
	if (location.hash !== next)
		history.replaceState(null, "", location.pathname + location.search + next);
}
function forgetMatch() {
	if (location.hash)
		history.replaceState(null, "", location.pathname + location.search);
}
function stopPoll() {
	if (pollTimer) {
		clearInterval(pollTimer);
		pollTimer = null;
	}
}
function startViewerPoll() {
	stopPoll();
	if (isAdmin || !current) return;
	pollTimer = setInterval(async () => {
		if (!current || isAdmin || !$("modal").classList.contains("hidden")) return;
		try {
			const prev = state;
			const r = await api("get", "GET", null, current);
			const closed = overJustClosed(prev, r.state);
			const inningsChanged =
				prev && prev.innings === 1 && r.state && r.state.innings === 2;
			state = r.state;
			render();
			if (inningsChanged) {
				const beforeLegal = legalCount(prev);
				const afterLegal = r.state.innings_1 ? r.state.innings_1.legal : 0;
				const endedOverNum =
					Math.floor(afterLegal / 6) > Math.floor(beforeLegal / 6)
						? Math.floor(afterLegal / 6)
						: 0;
				const overBalls = endedOverNum
					? endedOverBalls(endedOverNum, r.state)
					: null;
				await notifyPhaseChange(
					endedOverNum ? { balls: overBalls, overNumber: endedOverNum } : null,
				);
			} else if (closed) {
				await notifyOverComplete(closed, endedOverBalls(closed, r.state));
			}
		} catch (e) {}
	}, 4000);
}
function scoringOpen() {
	return !$("scoreView").classList.contains("hidden") || editingMatch;
}
function headerMode() {
	const inProgress =
		isAdmin && scoringOpen() && state && state.status !== "complete";
	$("newMatch").classList.toggle("hidden", !isAdmin || inProgress);
	$("updateMatch").classList.toggle("hidden", !inProgress);
}
function applyRole() {
	headerMode();
	$("logout").classList.toggle("hidden", !isAdmin);
	$("loginBtn").classList.toggle("hidden", isAdmin);
	$("recordPanel").classList.toggle("hidden", !isAdmin);
}
async function boot() {
	if ("serviceWorker" in navigator) {
		navigator.serviceWorker
			.register("sw.js", { updateViaCache: "none" })
			.catch(() => {});
	}
	try {
		const s = await api("status");
		isAdmin = !!s.authenticated;
		if (s && s.app_url && document.body) document.body.dataset.qrUrl = s.app_url;
	} catch (e) {
		isAdmin = false;
	}
	applyRole();
	const id = readScoreId();
	if (id) {
		try {
			await openMatch(id);
			return;
		} catch (e) {
			forgetMatch();
		}
	}
	show("app");
	loadMatches();
}
if ($("qrBtn")) {
	$("qrBtn").onclick = () => {
		const url = getAppQrUrl();
		showModal({
			title: "Scan to open app",
			message: "Scan with your phone camera to view the live scoreboard.",
			confirmLabel: "Close",
			showCancel: false,
			qr: url,
		});
	};
}
$("loginBtn").onclick = () => {
	$("loginError").textContent = "";
	show("login");
};
$("togglePassword").onclick = () => {
	const input = $("password");
	const show = input.type === "password";
	input.type = show ? "text" : "password";
	const btn = $("togglePassword");
	btn.setAttribute("aria-pressed", show ? "true" : "false");
	btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
	$("eyeOpen").classList.toggle("hidden", show);
	$("eyeOff").classList.toggle("hidden", !show);
};
$("backToMatches").onclick = () => {
	forgetMatch();
	show("app");
	loadMatches();
};
$("loginForm").onsubmit = async (e) => {
	e.preventDefault();
	try {
		await api("login", "POST", { password: $("password").value });
		$("password").value = "";
		isAdmin = true;
		applyRole();
		forgetMatch();
		show("app");
		loadMatches();
	} catch (err) {
		$("loginError").textContent = err.message;
	}
};
$("logout").onclick = async () => {
	stopPoll();
	await api("logout", "POST", {});
	isAdmin = false;
	current = null;
	applyRole();
	forgetMatch();
	show("app");
	loadMatches();
};
function matchStarted() {
	const balls =
		(state.deliveries || []).length +
		((state.innings_1 && state.innings_1.deliveries) || []).length +
		((state.innings_2 && state.innings_2.deliveries) || []).length;
	return balls > 0;
}
function renderRosterInputs(side, count, existing = []) {
	const container = $(side === "A" ? "rosterAGrid" : "rosterBGrid");
	if (!container) return;
	const currentInputs = Array.from(container.querySelectorAll("input")).map(
		(inp) => inp.value,
	);
	container.innerHTML = "";
	for (let i = 1; i <= count; i++) {
		const idx = i - 1;
		const input = document.createElement("input");
		input.type = "text";
		input.placeholder = "Player " + i;
		input.value =
			(currentInputs && currentInputs[idx]) ||
			(existing && existing[idx]) ||
			"Player " + i;
		container.append(input);
	}
}
function fillSetup(mode) {
	editingMatch = mode === "update";
	$("setupTitle").textContent = editingMatch
		? "Update match info"
		: "Create match";
	$("setupSubmit").textContent = editingMatch ? "Save" : "Create match";
	if (!editingMatch) {
		$("teamA").value = "PAREL";
		$("teamB").value = "BNA";
		$("playersA").value = 7;
		$("playersB").value = 7;
		$("overs").value = 6;
		$("battingA").checked = true;
	}
	if (editingMatch && state) {
		$("teamA").value = state.team_a || "";
		$("teamB").value = state.team_b || "";
		$("playersA").value = state.players_a || state.players || 7;
		$("playersB").value = state.players_b || state.players || 7;
		$("overs").value = state.overs_limit || 6;
		const first = state.batting_first === "B" ? "B" : "A";
		document.querySelector(
			'input[name="batting"][value="' + first + '"]',
		).checked = true;
	}
	const lock = editingMatch && matchStarted();
	document.querySelectorAll('input[name="batting"]').forEach((el) => {
		el.disabled = lock;
	});
	$("tossNote").classList.toggle("hidden", !lock);
	syncTossPills();
	const countA = Math.max(2, Math.min(15, parseInt($("playersA").value, 10) || 7));
	const countB = Math.max(2, Math.min(15, parseInt($("playersB").value, 10) || 7));
	renderRosterInputs(
		"A",
		countA,
		editingMatch && state ? state.roster_a : [],
	);
	renderRosterInputs(
		"B",
		countB,
		editingMatch && state ? state.roster_b : [],
	);
	$("matchesView").classList.add("hidden");
	$("scoreView").classList.add("hidden");
	$("setupView").classList.remove("hidden");
	$("app").classList.remove("hidden");
	headerMode();
}
$("playersA").addEventListener("input", () => {
	const count = Math.max(2, Math.min(15, parseInt($("playersA").value, 10) || 7));
	renderRosterInputs("A", count);
});
$("playersB").addEventListener("input", () => {
	const count = Math.max(2, Math.min(15, parseInt($("playersB").value, 10) || 7));
	renderRosterInputs("B", count);
});
$("newMatch").onclick = () => {
	if (!isAdmin) return;
	stopPoll();
	editingMatch = false;
	fillSetup("create");
};
$("updateMatch").onclick = () => {
	if (!isAdmin || !current || !state || state.status === "complete") return;
	stopPoll();
	fillSetup("update");
};
$("cancelSetup").onclick = () => {
	if (editingMatch && current) {
		editingMatch = false;
		$("setupView").classList.add("hidden");
		$("scoreView").classList.remove("hidden");
		headerMode();
		startViewerPoll();
		return;
	}
	editingMatch = false;
	forgetMatch();
	show("app");
	headerMode();
	loadMatches();
};
$("back").onclick = () => {
	stopPoll();
	current = null;
	editingMatch = false;
	setPendingExtra("");
	forgetMatch();
	show("app");
	headerMode();
	loadMatches();
};
function syncTossPills() {
	const a = ($("teamA").value.trim() || "Team A").toUpperCase();
	const b = ($("teamB").value.trim() || "Team B").toUpperCase();
	$("pillA").textContent = a;
	$("pillB").textContent = b;
}
$("teamA").addEventListener("input", syncTossPills);
$("teamB").addEventListener("input", syncTossPills);

$("setupForm").onsubmit = async (e) => {
	e.preventDefault();
	try {
		const batting = document.querySelector(
			'input[name="batting"]:checked',
		).value;
		const rosterA = Array.from(
			$("rosterAGrid").querySelectorAll("input"),
		).map((inp, idx) => inp.value.trim() || "Player " + (idx + 1));
		const rosterB = Array.from(
			$("rosterBGrid").querySelectorAll("input"),
		).map((inp, idx) => inp.value.trim() || "Player " + (idx + 1));
		const body = {
			team_a: $("teamA").value,
			team_b: $("teamB").value,
			players_a: $("playersA").value,
			players_b: $("playersB").value,
			roster_a: rosterA,
			roster_b: rosterB,
			overs: $("overs").value,
			batting_first: batting,
		};
		if (editingMatch && current) {
			const r = await api("update", "POST", body, current);
			state = r.state;
			$("matchTitle").textContent = matchTitleText(state);
			editingMatch = false;
			$("setupView").classList.add("hidden");
			$("scoreView").classList.remove("hidden");
			headerMode();
			render();
			startViewerPoll();
		} else {
			const r = await api("create", "POST", body);
			await openMatch(r.id);
		}
	} catch (err) {
		showError(err.message);
	}
};
function matchDayKey(m) {
	const raw = String(
		m.created_at || m.updated_at || (m.state && m.state.created) || "",
	);
	const hit = raw.match(/^(\d{4}-\d{2}-\d{2})/);
	return hit ? hit[1] : "unknown";
}
function matchDayLabel(key) {
	if (key === "unknown") return "Unknown date";
	const [y, mo, da] = key.split("-").map(Number);
	const d = new Date(y, mo - 1, da);
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const diff = Math.round((today - d) / 86400000);
	const nice = d.toLocaleDateString(undefined, {
		weekday: "long",
		day: "numeric",
		month: "long",
		year: "numeric",
	});
	if (diff === 0) return "Today · " + nice;
	if (diff === 1) return "Yesterday · " + nice;
	return nice;
}
function cardInnings(deliveries) {
	let total = 0,
		w = 0,
		legal = 0;
	(deliveries || []).forEach((d) => {
		total += (d.runs || 0) + (d.extra_runs || 0);
		if (d.wicket) w++;
		if (isLegalBall(d)) legal++;
	});
	return { total, w, legal };
}
function cardScore(s) {
	if ((s.deliveries || []).length) return cardInnings(s.deliveries);
	if ((s.status || "") !== "complete") return cardInnings([]);
	const inn2 = s.innings_2;
	const inn1 = s.innings_1;
	const snap =
		inn2 && (inn2.deliveries || []).length
			? inn2
			: inn1 && (inn1.deliveries || []).length
				? inn1
				: inn2 || inn1;
	if (!snap) return cardInnings([]);
	return {
		total: snap.total || 0,
		w: snap.wickets || 0,
		legal: snap.legal || 0,
	};
}
function makeMatchCard(m) {
	const d = document.createElement("div");
	d.className = "match-card";
	const info = document.createElement("div");
	const s = m.state;
	const name = document.createElement("strong");
	name.textContent =
		(s.team_a || "") + " vs " + (s.team_b || "") + " (" + (s.overs_limit || 0) + ")";
	const sub = document.createElement("small");
	const past = s.innings_1 && (s.innings_1.deliveries || []).length;
	const started = (s.deliveries || []).length || past;
	if (started) {
		const st = cardScore(s);
		const score = document.createElement("b");
		score.textContent = st.total + "/" + st.w + " (" + oversText(st.legal) + ")";
		const tag = document.createElement("span");
		const done = (s.status || "") === "complete";
		tag.className = "match-tag" + (done ? "" : " live");
		tag.textContent = done ? (s.result && s.result.text) || "Complete" : "Live";
		sub.className = "match-score";
		sub.append(score, tag);
		info.append(sub);
	}
	info.prepend(name);
	const actions = document.createElement("div");
	actions.className = "match-actions";
	const open = document.createElement("button");
	open.className = "primary";
	open.textContent = "Open";
	open.onclick = () => openMatch(m.id);
	actions.append(open);
	if (isAdmin && !s.locked && s.result && s.result.text) {
		const mark = document.createElement("button");
		mark.className = "ghost mark-complete";
		mark.textContent = "Mark completed";
		mark.onclick = () => markMatchFromCard(m);
		actions.append(mark);
	}
	if (isAdmin && !s.locked) {
		const del = document.createElement("button");
		del.className = "ghost";
		del.textContent = "Delete";
		del.onclick = async () => {
			const ok = await showModal({
				title: "Delete",
				message: "Delete this match?",
				confirmLabel: "Delete",
				showCancel: true,
			});
			if (!ok) return;
			try {
				await api("delete", "POST", {}, m.id);
				loadMatches();
			} catch (e) {
				showError(e.message);
			}
		};
		actions.append(del);
	}
	d.append(info, actions);
	return d;
}
async function markMatchFromCard(m) {
	const wasLive = (m.state.status || "") !== "complete";
	const ok = await showModal({
		title: "Mark completed",
		message: "Mark this match completed? It cannot be deleted or reopened.",
		confirmLabel: "Mark completed",
		showCancel: true,
	});
	if (!ok) return;
	try {
		const r = await api("mark_complete", "POST", {}, m.id);
		if (!wasLive) return loadMatches();
		state = r.state;
		await notifyPhaseChange();
	} catch (e) {
		showError(e.message);
	}
}
async function loadMatches() {
	try {
		const r = await api("list");
		$("matchList").innerHTML = "";
		if (!r.matches.length) {
			$("matchList").innerHTML =
				'<p class="hint">No matches yet. Create your first match.</p>';
			return;
		}
		const groups = {};
		r.matches.forEach((m) => {
			const k = matchDayKey(m);
			(groups[k] ?? (groups[k] = [])).push(m);
		});
		const keys = Object.keys(groups).sort((a, b) => b.localeCompare(a));
		keys.forEach((key, i) => {
			const details = document.createElement("details");
			details.className = "match-day";
			if (i === 0) details.open = true;
			const summary = document.createElement("summary");
			summary.className = "match-day-summary";
			const name = document.createElement("span");
			name.className = "match-day-name";
			name.textContent = matchDayLabel(key);
			const count = document.createElement("span");
			count.className = "match-day-count";
			count.textContent =
				groups[key].length + (groups[key].length === 1 ? " match" : " matches");
			summary.append(name, count);
			details.append(summary);
			const body = document.createElement("div");
			body.className = "match-day-body";
			groups[key].forEach((m) => body.append(makeMatchCard(m)));
			details.append(body);
			$("matchList").append(details);
		});
	} catch (e) {
		showError(e.message);
	}
}
function esc(s) {
	return String(s).replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			],
	);
}
function teamRoster(side) {
	if (!state) return [];
	const s = side || battingSide();
	const raw = s === "B" ? state.roster_b : state.roster_a;
	const count =
		s === "B"
			? state.players_b || state.players || 7
			: state.players_a || state.players || 7;
	const list = Array.isArray(raw) ? raw : [];
	const out = [];
	for (let i = 1; i <= count; i++) {
		const idx = i - 1;
		out.push(list[idx] || "Player " + i);
	}
	return out;
}
function battingRoster() {
	return teamRoster(battingSide());
}
function bowlingRoster() {
	const bowSide = battingSide() === "B" ? "A" : "B";
	return teamRoster(bowSide);
}
function getPreviousOverBowler() {
	if (!state || !state.deliveries) return null;
	const overs = groupOvers(state.deliveries);
	const completed = overs.filter((o) => o.complete);
	if (!completed.length) return null;
	const lastCompleted = completed[completed.length - 1];
	return (
		(lastCompleted.balls &&
			lastCompleted.balls[0] &&
			lastCompleted.balls[0].bowler) ||
		null
	);
}
async function openInningsOpenerModal() {
	if (!isAdmin || !current || !state || isComplete()) return;
	const bRoster = battingRoster();
	const bowRoster = bowlingRoster();
	let striker = bRoster[0] || "Player 1";
	let nonStriker = bRoster[1] || bRoster[0] || "Player 2";
	let bowler = bowRoster[0] || "Player 1";

	const content = (container) => {
		const row1 = document.createElement("div");
		row1.className = "modal-custom-row";
		row1.innerHTML = `<label>Opening Striker (Facing ball 1)</label>`;
		const selStriker = document.createElement("select");
		bRoster.forEach((p, idx) => {
			const opt = document.createElement("option");
			opt.value = p;
			opt.textContent = p;
			if (idx === 0) opt.selected = true;
			selStriker.append(opt);
		});
		selStriker.onchange = () => {
			striker = selStriker.value;
		};
		row1.append(selStriker);

		const row2 = document.createElement("div");
		row2.className = "modal-custom-row";
		row2.innerHTML = `<label>Opening Non-Striker</label>`;
		const selNon = document.createElement("select");
		bRoster.forEach((p, idx) => {
			const opt = document.createElement("option");
			opt.value = p;
			opt.textContent = p;
			if (idx === 1) opt.selected = true;
			selNon.append(opt);
		});
		selNon.onchange = () => {
			nonStriker = selNon.value;
		};
		row2.append(selNon);

		const row3 = document.createElement("div");
		row3.className = "modal-custom-row";
		row3.innerHTML = `<label>Opening Bowler</label>`;
		const selBow = document.createElement("select");
		bowRoster.forEach((p, idx) => {
			const opt = document.createElement("option");
			opt.value = p;
			opt.textContent = p;
			if (idx === 0) opt.selected = true;
			selBow.append(opt);
		});
		selBow.onchange = () => {
			bowler = selBow.value;
		};
		row3.append(selBow);

		container.append(row1, row2, row3);
	};

	await showModal({
		title: `${battingTeamName()} — Innings ${state.innings} Openers`,
		message: "Select opening batsmen and opening bowler to start the innings:",
		confirmLabel: "Start Scoring",
		showCancel: false,
		customContent: content,
	});

	state.crease = { striker, non_striker: nonStriker, bowler };
	try {
		await api(
			"set_crease",
			"POST",
			{ ...state.crease, set_as_openers: true },
			current,
		);
	} catch (e) {}
	render();
}
async function chooseNextBowlerModal(prevBowler) {
	if (!isAdmin || !current || isComplete()) return;
	const roster = bowlingRoster();
	const c = calc();
	let selected = null;
	for (const p of roster) {
		if (p !== prevBowler) {
			selected = p;
			break;
		}
	}
	const content = (container) => {
		const grid = document.createElement("div");
		grid.className = "modal-select-grid";
		roster.forEach((name) => {
			const btn = document.createElement("button");
			btn.type = "button";
			const isPrev = name === prevBowler;
			const bStat = c.bowl[name] || { r: 0, w: 0, b: 0, maidens: 0 };
			const fig = `${oversText(bStat.b)} - ${bStat.maidens || 0} - ${bStat.r} - ${bStat.w}`;
			btn.className =
				"modal-select-btn" +
				(name === selected ? " selected" : "") +
				(isPrev ? " disabled" : "");
			btn.innerHTML = `<span>${name} ${isPrev ? "<small>(Just bowled)</small>" : ""}</span><small>${fig}</small>`;
			if (isPrev) {
				btn.disabled = true;
			} else {
				btn.onclick = () => {
					selected = name;
					grid
						.querySelectorAll(".modal-select-btn")
						.forEach((b) => b.classList.remove("selected"));
					btn.classList.add("selected");
				};
			}
			grid.append(btn);
		});
		container.append(grid);
	};
	const ok = await showModal({
		title: "Select Bowler",
		message: prevBowler
			? `${prevBowler} just completed the over. Choose the next bowler (cannot bowl consecutive overs):`
			: "Choose the active bowler:",
		confirmLabel: "Confirm Bowler",
		showCancel: false,
		showClose: true,
		customContent: content,
	});
	if (ok && selected) {
		state.crease ??= {};
		state.crease.bowler = selected;
		try {
			await api("set_crease", "POST", state.crease, current);
		} catch (e) {}
		render();
	}
}
async function changeBattersModal() {
	if (!isAdmin || !current || !state || isComplete()) return;
	await ensureCreaseInitialized();
	const cr = state.crease || {};
	const bRoster = battingRoster();
	const deliveries = state.deliveries || [];
	const isStartOfInnings = deliveries.length === 0;

	const outSet = new Set(
		deliveries
			.filter((d) => d.wicket)
			.map((d) => String(d.dismissed_player || d.batter || d.striker)),
	);

	const availableBatters = isStartOfInnings
		? bRoster
		: bRoster.filter((p) => !outSet.has(p));

	let currentStriker = cr.striker || bRoster[0] || "Player 1";
	let currentNonStriker = cr.non_striker || bRoster[1] || "Player 2";

	const content = (container) => {
		const row1 = document.createElement("div");
		row1.className = "modal-custom-row";
		row1.innerHTML = `<label>Striker (Facing ball)</label>`;
		const selStriker = document.createElement("select");
		availableBatters.forEach((p) => {
			const opt = document.createElement("option");
			opt.value = p;
			opt.textContent = p;
			if (p === currentStriker) opt.selected = true;
			selStriker.append(opt);
		});
		selStriker.onchange = () => {
			currentStriker = selStriker.value;
		};
		row1.append(selStriker);

		const row2 = document.createElement("div");
		row2.className = "modal-custom-row";
		row2.innerHTML = `<label>Non-Striker</label>`;
		const selNon = document.createElement("select");
		availableBatters.forEach((p) => {
			const opt = document.createElement("option");
			opt.value = p;
			opt.textContent = p;
			if (p === currentNonStriker) opt.selected = true;
			selNon.append(opt);
		});
		selNon.onchange = () => {
			currentNonStriker = selNon.value;
		};
		row2.append(selNon);

		container.append(row1, row2);
	};

	const ok = await showModal({
		title: isStartOfInnings ? "Change Opening Batters" : "Change Active Batters",
		message: "Select the striker and non-striker for the batting crease:",
		confirmLabel: "Update Batters",
		showCancel: false,
		showClose: true,
		customContent: content,
	});

	if (ok) {
		state.crease ??= {};
		state.crease.striker = currentStriker;
		state.crease.non_striker = currentNonStriker;
		try {
			await api(
				"set_crease",
				"POST",
				{
					...state.crease,
					set_as_openers: isStartOfInnings,
				},
				current,
			);
			$("actionMessage").textContent =
				`Batters updated: ${currentStriker} & ${currentNonStriker}.`;
		} catch (e) {
			showError(e.message);
		}
		render();
	}
}
async function ensureCreaseInitialized() {
	if (!isAdmin || !current || !state || isComplete()) return;
	if (
		state.crease &&
		state.crease.striker &&
		state.crease.non_striker &&
		state.crease.bowler
	) {
		return;
	}
	if ((state.deliveries || []).length > 0) {
		const last = state.deliveries[state.deliveries.length - 1];
		if (last.crease_after) {
			state.crease = last.crease_after;
			render();
			return;
		}
	}
	await openInningsOpenerModal();
}
async function openMatch(id) {
	const r = await api("get", "GET", null, id);
	current = id;
	state = r.state;
	editingMatch = false;
	setPendingExtra("");
	Object.keys(overSectionOpen).forEach((k) => delete overSectionOpen[k]);
	lastOverInnings = state ? state.innings : null;
	$("matchTitle").textContent = matchTitleText(state);
	show("app");
	$("matchesView").classList.add("hidden");
	$("setupView").classList.add("hidden");
	$("scoreView").classList.remove("hidden");
	headerMode();
	fillPlayers();
	render();
	startViewerPoll();
	rememberMatch(id);
	if (isAdmin && !isComplete()) {
		await ensureCreaseInitialized();
	}
}
function fillPlayers() {
	const countA = state.players_a || state.players;
	const countB = state.players_b || state.players;
	["batter", "bowler"].forEach((id) => {
		const el = $(id);
		if (!el || el.tagName !== "SELECT") return;
		el.innerHTML = "";
		const count =
			id === "bowler"
				? state.batting_first === "A"
					? countB
					: countA
				: state.batting_first === "A"
					? countA
					: countB;
		for (let i = 1; i <= count; i++) {
			const o = document.createElement("option");
			o.value = i;
			o.textContent = "Player " + i;
			el.append(o);
		}
	});
}
function battingSide() {
	const first = state.batting_first === "B" ? "B" : "A";
	return state.innings === 2 ? (first === "A" ? "B" : "A") : first;
}
function battingTeamName() {
	return battingSide() === "B" ? state.team_b : state.team_a;
}
function matchTitleText(s) {
	const a = s.players_a || s.players || 7;
	const b = s.players_b || s.players || 7;
	return (
		(s.team_a || "") +
		" (" +
		a +
		") vs " +
		(s.team_b || "") +
		" (" +
		b +
		") · OV (" +
		(s.overs_limit || 0) +
		")"
	);
}
function isComplete() {
	return state.status === "complete";
}
function isLegalBall(d) {
	return !["wide", "no-ball"].includes(d.extra_type || "");
}
function legalCount(s) {
	return ((s && s.deliveries) || []).filter(isLegalBall).length;
}
function overWord(n) {
	const words = [
		"",
		"First",
		"Second",
		"Third",
		"Fourth",
		"Fifth",
		"Sixth",
		"Seventh",
		"Eighth",
		"Ninth",
		"Tenth",
	];
	if (n > 0 && n < words.length) return words[n];
	const mod10 = n % 10,
		mod100 = n % 100;
	const suf =
		mod10 === 1 && mod100 !== 11
			? "st"
			: mod10 === 2 && mod100 !== 12
				? "nd"
				: mod10 === 3 && mod100 !== 13
					? "rd"
					: "th";
	return n + suf;
}
function overJustClosed(prev, next) {
	if (
		!prev ||
		!next ||
		prev.innings !== next.innings ||
		next.status === "complete"
	)
		return 0;
	const before = legalCount(prev),
		after = legalCount(next),
		closed = Math.floor(after / 6);
	return closed > Math.floor(before / 6) ? closed : 0;
}
function calc() {
	let batRuns = 0,
		extraRuns = 0,
		w = 0,
		legal = 0,
		batBalls = {},
		bowl = {},
		recent = [];
	(state.deliveries || []).forEach((d) => {
		const bat = String(d.batter || d.striker || 1),
			bow = String(d.bowler || 1);
		batBalls[bat] ??= { r: 0, b: 0, f: 0, s: 0, out: false, dismissal: "" };
		bowl[bow] ??= { r: 0, w: 0, b: 0, maidens: 0 };
		const isLegal = isLegalBall(d);
		const ex = d.extra_type || "";
		const ovr = ex === "overthrow" ? d.extra_runs || 0 : 0;
		const extraOnly = ex === "overthrow" ? 0 : d.extra_runs || 0;
		const total = (d.runs || 0) + (d.extra_runs || 0);
		batRuns += (d.runs || 0) + ovr;
		extraRuns += extraOnly;
		if (d.wicket) {
			w++;
			const outPlayer = String(
				d.dismissed_player || d.batter || d.striker || 1,
			);
			batBalls[outPlayer] ??= {
				r: 0,
				b: 0,
				f: 0,
				s: 0,
				out: false,
				dismissal: "",
			};
			batBalls[outPlayer].out = true;
			batBalls[outPlayer].dismissal = d.dismissal || "out";
		}
		if (isLegal) {
			legal++;
			batBalls[bat].b++;
			bowl[bow].b++;
		}
		batBalls[bat].r += (d.runs || 0) + ovr;
		if (d.runs === 4 && ex !== "overthrow") batBalls[bat].f++;
		if (d.runs === 6 && ex !== "overthrow") batBalls[bat].s++;
		bowl[bow].r += total;
		if (d.wicket && !["run out", "retired hurt"].includes(d.dismissal))
			bowl[bow].w++;
		recent.push({ d, total, legal: isLegal });
	});
	const overs = groupOvers(state.deliveries || []);
	overs.forEach((ov) => {
		if (ov.complete && ov.balls.length > 0) {
			const b = String(ov.balls[0].bowler || 1);
			const r = overRuns(ov.balls);
			if (r === 0) {
				bowl[b] ??= { r: 0, w: 0, b: 0, maidens: 0 };
				bowl[b].maidens = (bowl[b].maidens || 0) + 1;
			}
		}
	});
	return {
		total: batRuns + extraRuns,
		extraRuns,
		w,
		legal,
		batBalls,
		bowl,
		recent,
	};
}
function oversText(n) {
	return Math.floor(n / 6) + "." + (n % 6);
}
function ballNote(d) {
	const extra = d.extra_type || "";
	const bat = d.runs || 0;
	const exr = d.extra_runs || 0;
	const w = !!d.wicket;
	let note = "";
	if (extra === "wide") {
		const extraBeyond = Math.max(0, exr - 1);
		note = extraBeyond ? "Wd+" + extraBeyond : "Wd";
	} else if (extra === "no-ball") {
		note = bat ? "Nb+" + bat : "Nb";
	} else if (extra === "bye") {
		const n = exr || bat;
		note = n > 1 ? "B+" + n : "B";
	} else if (extra === "leg-bye") {
		const n = exr || bat;
		note = n > 1 ? "Lb+" + n : "Lb";
	} else if (extra === "penalty") {
		note = "Pen";
	} else if (extra === "overthrow") {
		note = (bat || 0) + "+4";
	} else {
		if (w && bat) return "W+" + bat;
		if (w) return "W";
		return String(bat);
	}
	if (w) note += "+W";
	return note;
}
function chipClass(d) {
	const extra = d.extra_type || "";
	let cls = "ball-chip";
	if (d.wicket) cls += " wicket";
	else if (
		extra === "overthrow" ||
		([4, 6].includes(d.runs) && extra !== "wide")
	)
		cls += " boundary";
	else if (extra) cls += " extra";
	return cls;
}
function makeChip(d) {
	const chip = document.createElement("span");
	chip.className = chipClass(d);
	chip.textContent = ballNote(d);
	return chip;
}
function groupOvers(deliveries) {
	const overs = [];
	let balls = [];
	let legal = 0;
	(deliveries || []).forEach((d) => {
		balls.push(d);
		if (isLegalBall(d)) {
			legal++;
			if (legal === 6) {
				overs.push({ balls, complete: true });
				balls = [];
				legal = 0;
			}
		}
	});
	if (balls.length) overs.push({ balls, complete: false });
	return overs;
}
function overRuns(balls) {
	return balls.reduce((s, d) => s + (d.runs || 0) + (d.extra_runs || 0), 0);
}
function renderOverChips(container, balls) {
	container.innerHTML = "";
	balls.forEach((d) => container.append(makeChip(d)));
}
function sectionIsOpen(key, defaultOpen) {
	return Object.prototype.hasOwnProperty.call(overSectionOpen, key)
		? overSectionOpen[key]
		: defaultOpen;
}
function appendOverSection(
	el,
	key,
	team,
	score,
	deliveries,
	markCurrent,
	defaultOpen,
) {
	const details = document.createElement("details");
	details.className = "over-team";
	details.open = sectionIsOpen(key, defaultOpen);
	details.addEventListener("toggle", () => {
		overSectionOpen[key] = details.open;
	});
	const summary = document.createElement("summary");
	summary.className = "over-team-summary";
	const name = document.createElement("span");
	name.className = "over-team-name";
	name.textContent = team;
	const sc = document.createElement("span");
	sc.className = "over-team-score";
	sc.textContent = score;
	summary.append(name, sc);
	details.append(summary);
	const body = document.createElement("div");
	body.className = "over-team-body";
	const overs = groupOvers(deliveries);
	if (!overs.length) {
		const p = document.createElement("p");
		p.className = "hint";
		p.textContent = "No deliveries yet.";
		body.append(p);
	} else {
		for (let i = overs.length - 1; i >= 0; i--) {
			const ov = overs[i];
			const card = document.createElement("div");
			card.className =
				"over-card" + (markCurrent && !ov.complete ? " current" : "");
			const h = document.createElement("div");
			h.className = "over-card-head";
			const title = document.createElement("h3");
			title.textContent =
				"Over " + (i + 1) + (markCurrent && !ov.complete ? " · current" : "");
			const runs = document.createElement("span");
			runs.textContent = overRuns(ov.balls) + " runs";
			h.append(title, runs);
			const chips = document.createElement("div");
			chips.className = "over-card-balls";
			ov.balls.forEach((d) => chips.append(makeChip(d)));
			card.append(h, chips);
			body.append(card);
		}
	}
	details.append(body);
	el.append(details);
}
function renderOverCards() {
	const el = $("overCards");
	if (!el) return;
	el.innerHTML = "";
	const current = state.deliveries || [];
	if (!state.innings_1 && !current.length) {
		el.innerHTML = "";
		return;
	}
	if (lastOverInnings !== state.innings) {
		Object.keys(overSectionOpen).forEach((k) => delete overSectionOpen[k]);
		lastOverInnings = state.innings;
	}
	const c = calc();
	const batting = battingTeamName();
	const currentScore = c.total + "/" + c.w + " (" + oversText(c.legal) + ")";
	const liveKey = state.innings === 2 ? "innings-2" : "innings-1";
	appendOverSection(
		el,
		liveKey,
		batting,
		currentScore,
		current,
		!isComplete(),
		true,
	);
	if (state.innings === 2 && state.innings_1) {
		const i1 = state.innings_1;
		appendOverSection(
			el,
			"innings-1",
			i1.team,
			i1.total + "/" + i1.wickets + " (" + oversText(i1.legal) + ")",
			i1.deliveries || [],
			false,
			false,
		);
	}
}
function defaultHint() {
	return "Tap a run, or an extra / wicket to add on runs.";
}
function pendingHint() {
	if (pendingExtra && pendingWicket)
		return EXTRA_LABELS[pendingExtra] + " + wicket selected — tap 0–6.";
	if (pendingWicket) return "Wicket selected — tap 0–6.";
	if (pendingExtra)
		return EXTRA_LABELS[pendingExtra] + " selected — tap 0–6 for extra runs.";
	return "";
}
function syncPendingButtons() {
	document.querySelectorAll("[data-extra]").forEach((b) => {
		const on =
			b.dataset.extra === "wicket"
				? pendingWicket
				: b.dataset.extra === pendingExtra;
		b.classList.toggle("selected", on);
	});
	const msg = $("actionMessage");
	if (!msg) return;
	const hint = pendingHint();
	if (hint) msg.textContent = hint;
	else if (!msg.textContent || msg.textContent.includes("selected"))
		msg.textContent = defaultHint();
}
function setPendingExtra(type) {
	if (type === "wicket") {
		pendingWicket = !pendingWicket;
		syncPendingButtons();
		return;
	}
	pendingExtra = type || "";
	if (!type) pendingWicket = false;
	syncPendingButtons();
}
function render() {
	headerMode();
	$("matchTitle").textContent = matchTitleText(state);
	const c = calc();
	const team = battingTeamName();
	$("sbTeam").textContent = team;
	$("sbTotal").textContent = c.total;
	$("sbWickets").textContent = c.w;
	$("sbOvers").textContent = oversText(c.legal);
	const rr = c.legal ? (c.total / (c.legal / 6)).toFixed(2) : "0.00";
	$("sbRR").textContent = rr;
	const needBlock = $("sbNeedBlock");
	const resultEl = $("sbResult");
	if (isComplete() && state.result && state.result.text) {
		needBlock.classList.add("hidden");
		resultEl.textContent = state.result.text;
		resultEl.classList.remove("hidden");
	} else if (state.innings === 2 && state.target) {
		resultEl.classList.add("hidden");
		const need = state.target - c.total;
		const totalBalls = state.overs_limit * 6;
		const ballsLeft = totalBalls - c.legal;
		const rrr = ballsLeft > 0 ? (need / (ballsLeft / 6)).toFixed(2) : "—";
		$("sbNeed").textContent = need > 0 ? need : 0;
		$("sbNeedBalls").textContent = ballsLeft > 0 ? ballsLeft : 0;
		$("sbRRR").textContent = rrr;
		needBlock.classList.remove("hidden");
	} else {
		needBlock.classList.add("hidden");
		resultEl.classList.add("hidden");
	}
	const live = state.status !== "complete";
	$("endInnings").classList.toggle(
		"hidden",
		!(isAdmin && live && state.innings === 1),
	);
	$("endMatch").classList.toggle(
		"hidden",
		!(isAdmin && live && state.innings === 2),
	);
	$("undo").classList.toggle("hidden", !!state.locked);
	$("undo").textContent = isComplete()
		? "Reopen match"
		: state.innings === 2 && !(state.deliveries || []).length
			? "Reopen innings"
			: "↶ Undo";
	$("recordPanel").classList.toggle(
		"hidden",
		!isAdmin || (isComplete() && !!state.locked),
	);
	$("recordPanel").classList.toggle("scoring-locked", isComplete());
	if (isComplete()) {
		$("actionMessage").textContent =
			state.result && state.result.text ? state.result.text : "Match complete.";
	}
	const overs = groupOvers(state.deliveries || []);
	const lastOver = overs.length ? overs[overs.length - 1] : null;
	const stickyOver = lastOver && !lastOver.complete ? lastOver.balls : [];
	const overRunCount = overRuns(stickyOver);
	$("thisOverRuns").textContent =
		overRunCount === 1 ? "1 run" : overRunCount + " runs";
	renderOverChips($("recent"), stickyOver);
	renderOverCards();
	renderCrease();
}
function renderCrease() {
	const hud = $("creaseHud");
	if (!hud) return;
	if (!state) {
		hud.classList.add("hidden");
		return;
	}
	hud.classList.remove("hidden");
	const c = calc();
	const cr = state.crease || {};
	const bRoster = battingRoster();
	const bowRoster = bowlingRoster();
	const sName = cr.striker || bRoster[0] || "Striker";
	const nsName = cr.non_striker || bRoster[1] || "Non-Striker";
	const bName = cr.bowler || bowRoster[0] || "Bowler";

	const sStat = c.batBalls[sName] || { r: 0, b: 0, f: 0, s: 0 };
	const nsStat = c.batBalls[nsName] || { r: 0, b: 0, f: 0, s: 0 };
	const bStat = c.bowl[bName] || { r: 0, w: 0, b: 0, maidens: 0 };

	$("strikerName").textContent = sName;
	$("strikerStat").textContent = `${sStat.r} (${sStat.b}) · 4s: ${sStat.f} · 6s: ${sStat.s}`;

	$("nonStrikerName").textContent = nsName;
	$("nonStrikerStat").textContent = `${nsStat.r} (${nsStat.b}) · 4s: ${nsStat.f} · 6s: ${nsStat.s}`;

	const bOvers = oversText(bStat.b);
	const econ = bStat.b > 0 ? ((bStat.r / bStat.b) * 6).toFixed(2) : "0.00";
	$("bowlerName").textContent = bName;
	$("bowlerStat").textContent = `${bOvers} - ${bStat.maidens || 0} - ${bStat.r} - ${bStat.w} · Econ: ${econ}`;

	$("swapStrikeBtn").classList.toggle("hidden", !isAdmin || isComplete());
	$("changeBowlerBtn").classList.toggle("hidden", !isAdmin || isComplete());
	const changeBatBtn = $("changeBattersBtn");
	if (changeBatBtn)
		changeBatBtn.classList.toggle("hidden", !isAdmin || isComplete());
}
let modalResolve = null;
function modalKey(e) {
	if (e.key === "Escape" && $("modal").dataset.allowDismiss === "1")
		closeModal(false);
}
function getAppQrUrl() {
	return (
		(document.body && document.body.dataset && document.body.dataset.qrUrl) ||
		(state && state.app_url) ||
		""
	);
}
function renderQrCode(container, url) {
	if (!container) return;
	container.innerHTML = "";
	if (typeof qrcode === "function") {
		try {
			const qr = qrcode(0, "M");
			qr.addData(url);
			qr.make();
			container.innerHTML = qr.createSvgTag({
				cellSize: 6,
				margin: 2,
				scalable: true,
			});
			return;
		} catch (e) {}
	}
	const img = document.createElement("img");
	img.src =
		"https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" +
		encodeURIComponent(url);
	img.alt = "QR code";
	img.width = 180;
	img.height = 180;
	container.append(img);
}
function closeModal(ok) {
	$("modal").classList.add("hidden");
	$("modal").setAttribute("aria-hidden", "true");
	document.removeEventListener("keydown", modalKey);
	const ballsEl = $("modalBalls");
	if (ballsEl) {
		ballsEl.innerHTML = "";
		ballsEl.classList.add("hidden");
	}
	const qrEl = $("modalQr");
	if (qrEl) {
		qrEl.classList.add("hidden");
		const codeEl = $("modalQrCode");
		if (codeEl) codeEl.innerHTML = "";
	}
	const customEl = $("modalCustom");
	if (customEl) {
		customEl.innerHTML = "";
		customEl.classList.add("hidden");
	}
	if (modalResolve) {
		const r = modalResolve;
		modalResolve = null;
		r(!!ok);
	}
}
function showModal({
	title,
	message,
	confirmLabel = "OK",
	showCancel = false,
	showClose = null,
	fields = false,
	balls = null,
	overNumber = 0,
	qr = null,
	customContent = null,
}) {
	$("modalTitle").textContent = title;
	$("modalMessage").textContent = message;
	$("modalOk").textContent = confirmLabel;
	const isClose = showClose !== null ? !!showClose : showCancel || !!qr;
	$("modalClose").classList.toggle("hidden", !isClose);
	const cancelBtn = $("modalCancel");
	if (cancelBtn) cancelBtn.classList.toggle("hidden", !showCancel);
	$("modalFields").classList.toggle("hidden", !fields);
	const customEl = $("modalCustom");
	if (customEl) {
		customEl.innerHTML = "";
		if (customContent) {
			customEl.classList.remove("hidden");
			if (typeof customContent === "function") customContent(customEl);
			else if (customContent instanceof HTMLElement)
				customEl.append(customContent);
		} else {
			customEl.classList.add("hidden");
		}
	}
	const qrEl = $("modalQr");
	if (qrEl) {
		if (qr) {
			qrEl.classList.remove("hidden");
			renderQrCode($("modalQrCode"), qr);
			// const linkEl = $("modalQrUrl");
			// if (linkEl) {
			// 	linkEl.textContent = qr;
			// 	linkEl.href = qr;
			// }
		} else {
			qrEl.classList.add("hidden");
			const codeEl = $("modalQrCode");
			if (codeEl) codeEl.innerHTML = "";
		}
	}
	const ballsEl = $("modalBalls");
	if (ballsEl) {
		ballsEl.innerHTML = "";
		if (balls && balls.length) {
			ballsEl.classList.remove("hidden");
			const card = document.createElement("div");
			card.className = "over-card";
			const head = document.createElement("div");
			head.className = "over-card-head";
			const hTitle = document.createElement("h3");
			hTitle.textContent = overNumber ? "Over " + overNumber : "This over";
			const runs = document.createElement("span");
			const r = overRuns(balls);
			const w = balls.filter((d) => d.wicket).length;
			runs.textContent =
				r + " runs" + (w ? " · " + w + (w === 1 ? " wkt" : " wkts") : "");
			head.append(hTitle, runs);
			const chips = document.createElement("div");
			chips.className = "over-card-balls";
			balls.forEach((d) => chips.append(makeChip(d)));
			card.append(head, chips);
			ballsEl.append(card);
		} else {
			ballsEl.classList.add("hidden");
		}
	}
	if (fields) {
		const ovr = $("modalFields").classList.contains("overthrow-mode");
		const val = ovr ? "1" : "0";
		const r = document.querySelector(
			'input[name="modalAddon"][value="' + val + '"]',
		);
		if (r) r.checked = true;
		$("modalAddonLabel").textContent = ovr ? "Runs completed" : "Add-on runs";
	}
	$("modal").dataset.allowDismiss =
		showCancel || qr || isClose ? "1" : "0";
	$("modal").classList.remove("hidden");
	$("modal").setAttribute("aria-hidden", "false");
	document.addEventListener("keydown", modalKey);
	return new Promise((res) => {
		modalResolve = res;
	});
}
function showError(message) {
	return showModal({
		title: "Error",
		message: message || "Request failed",
		confirmLabel: "OK",
		showCancel: false,
	});
}
function endedOverBalls(n, customState = null) {
	const s = customState || state;
	const deliveries =
		s && s.deliveries && s.deliveries.length
			? s.deliveries
			: (s && s.innings_1 && s.innings_1.deliveries) || [];
	const overs = groupOvers(deliveries);
	return (overs[n - 1] && overs[n - 1].balls) || [];
}
async function notifyOverComplete(n, balls = null) {
	if (!n) return;
	const overBalls = balls && balls.length ? balls : endedOverBalls(n);
	await showModal({
		title: "Over complete",
		message:
			overWord(n) + " over completed. " + overWord(n + 1) + " over start.",
		confirmLabel: "OK",
		showCancel: false,
		balls: overBalls,
		overNumber: n,
	});
}
async function notifyPhaseChange(overDetails = null) {
	if (isComplete() && state.result && state.result.text) {
		await showModal({
			title: "Match complete",
			message: state.result.text,
			confirmLabel: "OK",
			showCancel: false,
		});
		stopPoll();
		current = null;
		editingMatch = false;
		setPendingExtra("");
		forgetMatch();
		show("app");
		headerMode();
		loadMatches();
		return;
	}
	if (state.innings === 2 && !(state.deliveries || []).length) {
		await showModal({
			title: "End innings",
			message: "2nd innings. Target " + state.target + ".",
			confirmLabel: "Start 2nd innings",
			showCancel: false,
			balls: overDetails ? overDetails.balls : null,
			overNumber: overDetails ? overDetails.overNumber : 0,
		});
		await ensureCreaseInitialized();
		return;
	}
}
async function openWicketDeliveryModal(extraType = "") {
	if (!isAdmin || !current || isComplete()) return;
	await ensureCreaseInitialized();
	const cr = state.crease || {};
	const striker = cr.striker || "Striker";
	const nonStriker = cr.non_striker || "Non-Striker";

	const bRoster = battingRoster();
	const outSet = new Set(
		(state.deliveries || [])
			.filter((d) => d.wicket)
			.map((d) => String(d.dismissed_player || d.batter || d.striker)),
	);
	const unbatted = bRoster.filter(
		(p) => p !== striker && p !== nonStriker && !outSet.has(p),
	);

	let dismissal = "bowled";
	let dismissedPlayer = striker;
	let nextBatter =
		unbatted[0] ||
		bRoster.find((p) => p !== striker && p !== nonStriker) ||
		"Next Batter";
	let runs = 0;

	const content = (container) => {
		const rowDismissal = document.createElement("div");
		rowDismissal.className = "modal-custom-row";
		rowDismissal.innerHTML = `<label>Dismissal Type</label>`;
		const selDismissal = document.createElement("select");
		["bowled", "caught", "lbw", "run out", "stumped", "hit wicket"].forEach(
			(d) => {
				const opt = document.createElement("option");
				opt.value = d;
				opt.textContent = d.toUpperCase();
				selDismissal.append(opt);
			},
		);
		rowDismissal.append(selDismissal);

		const rowPlayer = document.createElement("div");
		rowPlayer.className = "modal-custom-row";
		rowPlayer.innerHTML = `<label>Dismissed Batter</label>`;
		const selPlayer = document.createElement("select");
		const optStriker = document.createElement("option");
		optStriker.value = striker;
		optStriker.textContent = `${striker} (Striker)`;
		const optNon = document.createElement("option");
		optNon.value = nonStriker;
		optNon.textContent = `${nonStriker} (Non-Striker)`;
		selPlayer.append(optStriker, optNon);
		rowPlayer.append(selPlayer);

		const rowRuns = document.createElement("div");
		rowRuns.className = "modal-custom-row";
		rowRuns.innerHTML = `<label>Runs completed before dismissal</label>`;
		const selRuns = document.createElement("select");
		[0, 1, 2, 3].forEach((r) => {
			const opt = document.createElement("option");
			opt.value = r;
			opt.textContent = r + " runs";
			selRuns.append(opt);
		});
		rowRuns.append(selRuns);

		const rowNext = document.createElement("div");
		rowNext.className = "modal-custom-row";
		rowNext.innerHTML = `<label>Next Incoming Batter</label>`;
		const selNext = document.createElement("select");
		if (unbatted.length) {
			unbatted.forEach((p) => {
				const opt = document.createElement("option");
				opt.value = p;
				opt.textContent = p;
				selNext.append(opt);
			});
		} else {
			const opt = document.createElement("option");
			opt.value = "";
			opt.textContent = "No more unbatted players (All Out / Manual End)";
			selNext.append(opt);
		}
		rowNext.append(selNext);

		function updateVisibility() {
			const isRunOut = selDismissal.value === "run out";
			selPlayer.disabled = !isRunOut;
			if (!isRunOut) {
				selPlayer.value = striker;
				dismissedPlayer = striker;
			}
			rowRuns.classList.toggle("hidden", !isRunOut);
		}

		selDismissal.onchange = () => {
			dismissal = selDismissal.value;
			updateVisibility();
		};
		selPlayer.onchange = () => {
			dismissedPlayer = selPlayer.value;
		};
		selRuns.onchange = () => {
			runs = parseInt(selRuns.value, 10) || 0;
		};
		selNext.onchange = () => {
			nextBatter = selNext.value;
		};

		updateVisibility();
		container.append(rowDismissal, rowPlayer, rowRuns, rowNext);
	};

	const ok = await showModal({
		title: "Fall of Wicket",
		message: "Record wicket details and next incoming batter:",
		confirmLabel: "Record Wicket",
		showCancel: true,
		customContent: content,
	});

	if (!ok) return;

	let extraRuns = 0;
	if (extraType === "wide") {
		extraRuns = 1 + runs;
		runs = 0;
	} else if (extraType === "no-ball") {
		extraRuns = 1;
	} else if (extraType === "bye") {
		extraRuns = runs === 0 ? 1 : runs;
		runs = 0;
	}

	await recordBallWithRotation({
		runs,
		extraType,
		extraRuns,
		wicket: true,
		dismissal,
		dismissedPlayer,
		nextBatter,
	});
}

async function recordBallWithRotation({
	runs = 0,
	extraType = "",
	extraRuns = 0,
	wicket = false,
	dismissal = "",
	dismissedPlayer = null,
	nextBatter = null,
}) {
	if (!isAdmin || !current || isComplete()) return;
	await ensureCreaseInitialized();

	try {
		const prev = state;
		const prevInnings = state.innings;
		const prevStatus = state.status;

		const cr = state.crease || {};
		const bRoster = battingRoster();
		const bowRoster = bowlingRoster();
		let curStriker = cr.striker || bRoster[0] || "Player 1";
		let curNonStriker = cr.non_striker || bRoster[1] || "Player 2";
		let curBowler = cr.bowler || bowRoster[0] || "Player 1";

		const creaseBefore = {
			striker: curStriker,
			non_striker: curNonStriker,
			bowler: curBowler,
		};

		let nextStriker = curStriker;
		let nextNonStriker = curNonStriker;

		let physicalRuns = runs;
		if (extraType === "wide") {
			physicalRuns = Math.max(0, extraRuns - 1);
		} else if (extraType === "no-ball") {
			physicalRuns = runs;
		} else if (extraType === "bye" || extraType === "leg-bye") {
			physicalRuns = extraRuns || runs;
		}

		if (wicket) {
			const outPerson = dismissedPlayer || curStriker;
			const incoming =
				nextBatter ||
				(outPerson === curStriker ? "Next Batter" : curNonStriker);

			if (outPerson === curStriker) {
				nextStriker = incoming;
				nextNonStriker = curNonStriker;
			} else {
				if (physicalRuns % 2 === 1) {
					nextStriker = incoming;
					nextNonStriker = curStriker;
				} else {
					nextStriker = curStriker;
					nextNonStriker = incoming;
				}
			}
		} else {
			if (physicalRuns % 2 === 1) {
				nextStriker = curNonStriker;
				nextNonStriker = curStriker;
			}
		}

		const isLegal = !["wide", "no-ball"].includes(extraType);
		const currentLegal = (legalCount(prev) % 6) + (isLegal ? 1 : 0);
		const overEnded = isLegal && currentLegal === 6;

		if (overEnded) {
			const t = nextStriker;
			nextStriker = nextNonStriker;
			nextNonStriker = t;
		}

		const creaseAfter = {
			striker: nextStriker,
			non_striker: nextNonStriker,
			bowler: curBowler,
		};

		const d = {
			runs,
			extra_type: extraType,
			extra_runs: extraRuns,
			wicket,
			dismissal: wicket ? dismissal || "bowled" : "",
			dismissed_player: wicket ? dismissedPlayer || curStriker : null,
			next_batter: wicket ? nextBatter : null,
			batter: curStriker,
			bowler: curBowler,
			striker: curStriker,
			non_striker: curNonStriker,
			crease_before: creaseBefore,
			crease_after: creaseAfter,
		};

		const r = await api(
			"delivery",
			"POST",
			{ delivery: d, crease: creaseAfter },
			current,
		);
		const closed = overJustClosed(prev, r.state);
		state = r.state;
		state.crease = creaseAfter;
		pendingExtra = "";
		pendingWicket = false;
		syncPendingButtons();
		render();

		if (isComplete() && prevStatus !== "complete") {
			await notifyPhaseChange();
		} else if (state.innings === 2 && prevInnings === 1) {
			const beforeLegal = legalCount(prev);
			const afterLegal = r.state.innings_1 ? r.state.innings_1.legal : 0;
			const endedOverNum =
				Math.floor(afterLegal / 6) > Math.floor(beforeLegal / 6)
					? Math.floor(afterLegal / 6)
					: 0;
			const overBalls = endedOverNum
				? endedOverBalls(endedOverNum, r.state)
				: null;
			await notifyPhaseChange(
				endedOverNum ? { balls: overBalls, overNumber: endedOverNum } : null,
			);
		} else if (closed) {
			await notifyOverComplete(closed, endedOverBalls(closed, r.state));
			await chooseNextBowlerModal(curBowler);
		} else {
			$("actionMessage").textContent = "Delivery recorded.";
		}
	} catch (e) {
		showError(e.message);
	}
}

async function addDelivery(
	runs = 0,
	extra = "",
	extraRuns = 0,
	wicket = false,
) {
	await recordBallWithRotation({
		runs,
		extraType: extra,
		extraRuns,
		wicket,
	});
}
function commitExtra(type, additional, wicket) {
	let runs = 0,
		extraRuns = 0;
	if (type === "wide") {
		extraRuns = 1 + additional;
		runs = 0;
	} else if (type === "no-ball") {
		extraRuns = 1;
		runs = additional;
	} else if (type === "bye") {
		extraRuns = additional === 0 ? 1 : additional;
		runs = 0;
	} else if (type === "overthrow") {
		runs = Math.min(3, Math.max(1, additional));
		extraRuns = 4;
	} else return;
	recordBallWithRotation({
		runs,
		extraType: type,
		extraRuns,
		wicket,
	});
}
function addonValue() {
	const el = document.querySelector('input[name="modalAddon"]:checked');
	const n = el ? parseInt(el.value, 10) : 0;
	return Number.isNaN(n) ? 0 : Math.min(6, Math.max(0, n));
}
async function openDeliveryPopup(type) {
	if (!isAdmin || !current || isComplete()) return;
	const isWicket = type === "wicket";
	if (isWicket) {
		await openWicketDeliveryModal("");
		return;
	}
	const isOvr = type === "overthrow";
	$("modalWicket").checked = false;
	$("modalWicketRow").classList.remove("hidden");
	$("modalFields").classList.toggle("overthrow-mode", isOvr);
	const msg = isOvr
		? "Runs completed, then 4 overthrows."
		: "Choose add-on runs, then mark the delivery.";
	const ok = await showModal({
		title: EXTRA_LABELS[type] || type,
		message: msg,
		confirmLabel: "Mark delivery",
		showCancel: true,
		fields: true,
	});
	if (!ok) return;
	const additional = addonValue();
	const wicket = $("modalWicket").checked;
	if (wicket) {
		await openWicketDeliveryModal(type);
	} else {
		commitExtra(type, additional, false);
	}
}
document.querySelectorAll("[data-run]").forEach(
	(b) =>
		(b.onclick = () => {
			recordBallWithRotation({ runs: +b.dataset.run });
		}),
);
document
	.querySelectorAll("[data-extra]")
	.forEach((b) => (b.onclick = () => openDeliveryPopup(b.dataset.extra)));

$("swapStrikeBtn").onclick = async () => {
	if (!isAdmin || !current || !state || isComplete()) return;
	await ensureCreaseInitialized();
	if (!state.crease) return;
	const s = state.crease.striker;
	const ns = state.crease.non_striker;
	state.crease.striker = ns;
	state.crease.non_striker = s;
	render();
	try {
		await api("set_crease", "POST", state.crease, current);
		$("actionMessage").textContent = `Strike swapped: ${ns} is on strike.`;
	} catch (e) {
		showError(e.message);
	}
};
const changeBatBtn = $("changeBattersBtn");
if (changeBatBtn) changeBatBtn.onclick = changeBattersModal;
$("changeBowlerBtn").onclick = async () => {
	if (!isAdmin || !current || !state || isComplete()) return;
	await ensureCreaseInitialized();
	const prevBowler = getPreviousOverBowler();
	await chooseNextBowlerModal(prevBowler);
};
$("undo").onclick = async () => {
	if (!state) return;
	let title = "Undo";
	let msg = "Undo the last delivery?";
	let confirmLabel = "Undo";
	if (isComplete()) {
		title = "Reopen match";
		msg = "Reopen the completed match?";
		confirmLabel = "Reopen match";
	} else if (state.innings === 2 && !(state.deliveries || []).length) {
		title = "Reopen innings";
		msg = "Reopen the innings?";
		confirmLabel = "Reopen innings";
	}
	else if (!(state.deliveries || []).length) return;
	const ok = await showModal({
		title,
		message: msg,
		confirmLabel,
		showCancel: true,
	});
	if (!ok) return;
	try {
		const r = await api("undo", "POST", {}, current);
		state = r.state;
		setPendingExtra("");
		render();
	} catch (e) {
		showError(e.message);
	}
};
$("endInnings").onclick = async () => {
	if (!current || isComplete()) return;
	const ok = await showModal({
		title: "End innings",
		message: "End the first innings and start the chase?",
		confirmLabel: "End innings",
		showCancel: true,
	});
	if (!ok) return;
	try {
		const r = await api("end_innings", "POST", {}, current);
		state = r.state;
		setPendingExtra("");
		render();
		$("actionMessage").textContent = "2nd innings — target " + state.target;
		await notifyPhaseChange();
	} catch (e) {
		showError(e.message);
	}
};
$("endMatch").onclick = async () => {
	if (!current || isComplete()) return;
	const ok = await showModal({
		title: "End match",
		message: "End the match now?",
		confirmLabel: "End match",
		showCancel: true,
	});
	if (!ok) return;
	try {
		const r = await api("end_match", "POST", {}, current);
		state = r.state;
		setPendingExtra("");
		render();
		await notifyPhaseChange();
	} catch (e) {
		showError(e.message);
	}
};
$("modalOk").onclick = () => closeModal(true);
$("modalClose").onclick = () => closeModal(false);
if ($("modalCancel")) $("modalCancel").onclick = () => closeModal(false);
$("modal").onclick = (e) => {
	if (e.target === $("modal") && $("modal").dataset.allowDismiss === "1")
		closeModal(false);
};
boot();
