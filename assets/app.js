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
		$("setupView").classList.add("hidden");
		$("scoreView").classList.add("hidden");
		const mainTabs = $("mainTabs");
		if (mainTabs) mainTabs.classList.remove("hidden");
		if (mainTab === "stats") {
			$("matchesView").classList.add("hidden");
			$("statsView").classList.remove("hidden");
		} else {
			$("matchesView").classList.remove("hidden");
			$("statsView").classList.add("hidden");
		}
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
			const wasComplete = prev && prev.status === "complete";
			state = r.state;
			if (!wasComplete && isComplete()) {
				activeScoreTab = "scorecard";
			} else if (wasComplete && !isComplete()) {
				activeScoreTab = "live";
			}
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
	const matchOpen = !$("scoreView").classList.contains("hidden");
	const setupOpen = !$("setupView").classList.contains("hidden");
	const mainTabs = $("mainTabs");
	if (mainTabs) {
		mainTabs.classList.toggle("hidden", matchOpen || setupOpen);
	}
}
function applyRole() {
	headerMode();
	$("logout").classList.toggle("hidden", !isAdmin);
	$("loginBtn").classList.toggle("hidden", isAdmin);
	$("recordPanel").classList.toggle("hidden", !isAdmin);
	const addPBtn = $("addPlayerBtn");
	if (addPBtn) addPBtn.classList.toggle("hidden", !isAdmin);
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
	await loadCommonPlayers();
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
let commonPlayers = [];
let selectedRosterA = [];
let selectedRosterB = [];
let poolSearchA = "";
let poolSearchB = "";
let mainTab = "matches";
let playerStatsData = null;
let playerStatsFilter = "";

async function loadCommonPlayers() {
	try {
		const r = await api("players");
		commonPlayers = (r.players || []).map((p) => p.name);
	} catch (e) {
		commonPlayers = [];
	}
}

function renderRosterChips() {
	const maxA = Math.max(2, Math.min(15, parseInt($("playersA").value, 10) || 7));
	const maxB = Math.max(2, Math.min(15, parseInt($("playersB").value, 10) || 7));

	if ($("countA")) $("countA").textContent = selectedRosterA.length;
	if ($("maxA")) $("maxA").textContent = maxA;
	if ($("countB")) $("countB").textContent = selectedRosterB.length;
	if ($("maxB")) $("maxB").textContent = maxB;

	// Render Selected A
	const selA = $("selectedChipsA");
	if (selA) {
		selA.innerHTML = "";
		if (!selectedRosterA.length) {
			selA.innerHTML = '<span class="hint" style="margin:2px 4px;font-size:11px">No players selected. Tap from pool below.</span>';
		} else {
			selectedRosterA.forEach((name, idx) => {
				const chip = document.createElement("span");
				chip.className = "sel-chip";
				const num = document.createElement("span");
				num.className = "sel-chip-num";
				num.textContent = idx + 1;
				const txt = document.createElement("span");
				txt.className = "sel-chip-name";
				txt.textContent = name;
				const btn = document.createElement("button");
				btn.type = "button";
				btn.className = "sel-chip-remove";
				btn.innerHTML = "&times;";
				btn.title = "Remove from Team A";
				btn.onclick = () => {
					selectedRosterA.splice(idx, 1);
					renderRosterChips();
				};
				chip.append(num, txt, btn);
				selA.append(chip);
			});
		}
	}

	// Render Pool A
	const poolA = $("poolChipsA");
	if (poolA) {
		poolA.innerHTML = "";
		const qA = poolSearchA.trim().toLowerCase();
		const listA = commonPlayers.filter((p) => {
			if (selectedRosterA.includes(p) || selectedRosterB.includes(p)) return false;
			return !qA || p.toLowerCase().includes(qA);
		});
		if (!listA.length) {
			const hint = document.createElement("span");
			hint.className = "hint";
			hint.style.fontSize = "11px";
			hint.textContent = qA
				? "No matching players in directory."
				: "All directory players selected.";
			poolA.append(hint);
		} else {
			listA.forEach((name) => {
				const chip = document.createElement("span");
				chip.className = "pool-chip";
				chip.textContent = name;
				chip.title = "Tap to add to Team A";
				chip.onclick = () => {
					if (selectedRosterA.length >= maxA) {
						showError(
							`Team A is full (${maxA} players). Increase player count to add more.`,
						);
						return;
					}
					selectedRosterA.push(name);
					renderRosterChips();
				};
				poolA.append(chip);
			});
		}
		if (isAdmin) {
			const addChip = document.createElement("span");
			addChip.className = "pool-chip add-new-pill";
			addChip.textContent = "＋ New Player";
			addChip.title = "Register a new player in directory";
			addChip.onclick = async () => {
				const newName = await showAddPlayerModal(poolSearchA.trim());
				if (
					newName &&
					selectedRosterA.length < maxA &&
					!selectedRosterA.includes(newName)
				) {
					selectedRosterA.push(newName);
					renderRosterChips();
				}
			};
			poolA.append(addChip);
		}
	}

	// Render Selected B
	const selB = $("selectedChipsB");
	if (selB) {
		selB.innerHTML = "";
		if (!selectedRosterB.length) {
			selB.innerHTML =
				'<span class="hint" style="margin:2px 4px;font-size:11px">No players selected. Tap from pool below.</span>';
		} else {
			selectedRosterB.forEach((name, idx) => {
				const chip = document.createElement("span");
				chip.className = "sel-chip";
				const num = document.createElement("span");
				num.className = "sel-chip-num";
				num.textContent = idx + 1;
				const txt = document.createElement("span");
				txt.className = "sel-chip-name";
				txt.textContent = name;
				const btn = document.createElement("button");
				btn.type = "button";
				btn.className = "sel-chip-remove";
				btn.innerHTML = "&times;";
				btn.title = "Remove from Team B";
				btn.onclick = () => {
					selectedRosterB.splice(idx, 1);
					renderRosterChips();
				};
				chip.append(num, txt, btn);
				selB.append(chip);
			});
		}
	}

	// Render Pool B
	const poolB = $("poolChipsB");
	if (poolB) {
		poolB.innerHTML = "";
		const qB = poolSearchB.trim().toLowerCase();
		const listB = commonPlayers.filter((p) => {
			if (selectedRosterA.includes(p) || selectedRosterB.includes(p)) return false;
			return !qB || p.toLowerCase().includes(qB);
		});
		if (!listB.length) {
			const hint = document.createElement("span");
			hint.className = "hint";
			hint.style.fontSize = "11px";
			hint.textContent = qB
				? "No matching players in directory."
				: "All directory players selected.";
			poolB.append(hint);
		} else {
			listB.forEach((name) => {
				const chip = document.createElement("span");
				chip.className = "pool-chip";
				chip.textContent = name;
				chip.title = "Tap to add to Team B";
				chip.onclick = () => {
					if (selectedRosterB.length >= maxB) {
						showError(
							`Team B is full (${maxB} players). Increase player count to add more.`,
						);
						return;
					}
					selectedRosterB.push(name);
					renderRosterChips();
				};
				poolB.append(chip);
			});
		}
		if (isAdmin) {
			const addChip = document.createElement("span");
			addChip.className = "pool-chip add-new-pill";
			addChip.textContent = "＋ New Player";
			addChip.title = "Register a new player in directory";
			addChip.onclick = async () => {
				const newName = await showAddPlayerModal(poolSearchB.trim());
				if (newName && selectedRosterB.length < maxB && !selectedRosterB.includes(newName)) {
					selectedRosterB.push(newName);
					renderRosterChips();
				}
			};
			poolB.append(addChip);
		}
	}
}

async function handleAddChipInput(side) {
	const inp = $(side === "A" ? "playerSearchA" : "playerSearchB");
	if (!inp) return;
	const name = inp.value.trim();
	if (!name) return;
	const max = Math.max(2, Math.min(15, parseInt($(side === "A" ? "playersA" : "playersB").value, 10) || 7));
	const current = side === "A" ? selectedRosterA : selectedRosterB;
	const other = side === "A" ? selectedRosterB : selectedRosterA;

	const existingMatch = commonPlayers.find((p) => p.toLowerCase() === name.toLowerCase());
	const finalName = existingMatch || name;

	if (current.some((p) => p.toLowerCase() === finalName.toLowerCase())) {
		showError(`${finalName} is already in Team ${side}.`);
		return;
	}
	if (other.some((p) => p.toLowerCase() === finalName.toLowerCase())) {
		showError(`${finalName} is already selected in the opposing team.`);
		return;
	}
	if (current.length >= max) {
		showError(`Team ${side} is full (${max} players). Increase count to add more.`);
		return;
	}

	current.push(finalName);
	inp.value = "";
	if (side === "A") poolSearchA = "";
	else poolSearchB = "";

	if (!existingMatch) {
		commonPlayers.push(finalName);
		commonPlayers.sort((a, b) => a.localeCompare(b));
		try {
			await api("player_create", "POST", { name: finalName });
		} catch (e) {}
	}

	renderRosterChips();
}

function autoFillRoster(side) {
	const max = Math.max(2, Math.min(15, parseInt($(side === "A" ? "playersA" : "playersB").value, 10) || 7));
	const current = side === "A" ? selectedRosterA : selectedRosterB;
	const other = side === "A" ? selectedRosterB : selectedRosterA;

	for (const p of commonPlayers) {
		if (current.length >= max) break;
		if (!current.includes(p) && !other.includes(p)) {
			current.push(p);
		}
	}

	let n = 1;
	while (current.length < max) {
		const candidate = "Player " + n;
		if (!current.includes(candidate) && !other.includes(candidate)) {
			current.push(candidate);
		}
		n++;
	}

	renderRosterChips();
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
		selectedRosterA = [];
		selectedRosterB = [];
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
		selectedRosterA = [...(state.roster_a || [])];
		selectedRosterB = [...(state.roster_b || [])];
	}
	const lock = editingMatch && matchStarted();
	document.querySelectorAll('input[name="batting"]').forEach((el) => {
		el.disabled = lock;
	});
	$("tossNote").classList.toggle("hidden", !lock);
	syncTossPills();
	poolSearchA = "";
	poolSearchB = "";
	if ($("playerSearchA")) $("playerSearchA").value = "";
	if ($("playerSearchB")) $("playerSearchB").value = "";
	renderRosterChips();
	$("matchesView").classList.add("hidden");
	$("statsView").classList.add("hidden");
	$("scoreView").classList.add("hidden");
	$("setupView").classList.remove("hidden");
	$("app").classList.remove("hidden");
	headerMode();
}
$("playersA").addEventListener("input", () => {
	renderRosterChips();
});
$("playersB").addEventListener("input", () => {
	renderRosterChips();
});
$("newMatch").onclick = async () => {
	if (!isAdmin) return;
	stopPoll();
	editingMatch = false;
	await loadCommonPlayers();
	fillSetup("create");
};
$("updateMatch").onclick = async () => {
	if (!isAdmin || !current || !state || state.status === "complete") return;
	stopPoll();
	await loadCommonPlayers();
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
		const maxA = Math.max(2, Math.min(15, parseInt($("playersA").value, 10) || 7));
		const maxB = Math.max(2, Math.min(15, parseInt($("playersB").value, 10) || 7));

		if (selectedRosterA.length < maxA) {
			showError(
				`Please select ${maxA} players for ${$("teamA").value.trim() || "Team A"} (currently ${selectedRosterA.length}/${maxA}) or use Auto-fill.`,
			);
			return;
		}
		if (selectedRosterB.length < maxB) {
			showError(
				`Please select ${maxB} players for ${$("teamB").value.trim() || "Team B"} (currently ${selectedRosterB.length}/${maxB}) or use Auto-fill.`,
			);
			return;
		}

		const finalRosterA = selectedRosterA.slice(0, maxA);
		const finalRosterB = selectedRosterB.slice(0, maxB);

		const body = {
			team_a: $("teamA").value.trim(),
			team_b: $("teamB").value.trim(),
			players_a: maxA,
			players_b: maxB,
			roster_a: finalRosterA,
			roster_b: finalRosterB,
			overs: $("overs").value,
			batting_first: batting,
		};
		if (editingMatch && current) {
			const r = await api("update", "POST", body, current);
			state = r.state;
			activeScoreTab = isComplete() ? "scorecard" : "live";
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
		await loadCommonPlayers();
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
		weekday: "short",
		day: "numeric",
		month: "short",
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
		activeScoreTab = "scorecard";
		render();
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
function setMainTab(tab) {
	mainTab = tab;
	const tabM = $("tabMatches");
	const tabS = $("tabStats");
	if (tabM && tabS) {
		tabM.classList.toggle("active", tab === "matches");
		tabS.classList.toggle("active", tab === "stats");
	}
	$("matchesView").classList.toggle("hidden", tab !== "matches");
	$("statsView").classList.toggle("hidden", tab !== "stats");
	if (tab === "stats") {
		loadPlayerStats();
	} else {
		loadMatches();
	}
}

async function loadPlayerStats() {
	try {
		const r = await api("player_stats");
		playerStatsData = r.stats || [];
		renderLeaderboards(r.leaderboards || {});
		renderPlayerDirectory(playerStatsData, playerStatsFilter);
	} catch (e) {
		showError("Failed to load player stats: " + e.message);
	}
}

function renderLeaderboards(lb) {
	const container = $("leaderboardGrid");
	if (!container) return;
	container.innerHTML = "";

	function makeCard(title, list, valFn) {
		const card = document.createElement("div");
		card.className = "lb-card";
		const head = document.createElement("div");
		head.className = "lb-card-head";
		const t = document.createElement("h4");
		t.className = "lb-card-title";
		t.textContent = title;
		head.append(t);
		card.append(head);

		const body = document.createElement("div");
		body.className = "lb-list";
		if (!list || !list.length) {
			body.innerHTML = '<span class="hint" style="font-size:11px">No data yet.</span>';
		} else {
			list.slice(0, 5).forEach((p, idx) => {
				const row = document.createElement("div");
				row.className = "lb-row";
				row.onclick = () => showPlayerCareerModal(p.name);
				const left = document.createElement("div");
				left.className = "lb-left";
				const rank = document.createElement("span");
				rank.className = "lb-rank rank-" + (idx + 1);
				rank.textContent = idx + 1;
				const name = document.createElement("span");
				name.className = "lb-name";
				name.textContent = p.name;
				left.append(rank, name);

				const val = document.createElement("span");
				val.className = "lb-val";
				val.innerHTML = valFn(p);

				row.append(left, val);
				body.append(row);
			});
		}
		card.append(body);
		return card;
	}

	container.append(
		makeCard("🏏 Top Run Scorers", lb.top_runs, (p) => `${p.batting.runs} <small class="lb-subval">(${p.batting.innings} inn · SR ${p.batting.strike_rate})</small>`),
		makeCard("🎯 Top Wicket Takers", lb.top_wickets, (p) => `${p.bowling.wickets} <small class="lb-subval">(${p.bowling.overs} ov · Econ ${p.bowling.economy})</small>`),
		makeCard("💥 Most Sixes", lb.top_sixes, (p) => `${p.batting.sixes} <small class="lb-subval">sixes</small>`),
		makeCard("⚡ Best Economy", lb.best_economy, (p) => `${p.bowling.economy} <small class="lb-subval">(${p.bowling.overs} ov)</small>`),
	);
}

let playerDirPage = 1;
const DIR_PER_PAGE = 5;

function renderPlayerDirectory(stats, filterQuery = "") {
	const tbody = $("playerStatsBody");
	if (!tbody) return;
	tbody.innerHTML = "";

	const pagEl = $("playerStatsPagination");
	if (pagEl) pagEl.innerHTML = "";

	const q = (filterQuery || "").trim().toLowerCase();
	const filtered = (stats || []).filter((p) => !q || p.name.toLowerCase().includes(q));

	if (!filtered.length) {
		tbody.innerHTML = '<tr><td colspan="9" class="hint" style="text-align:center;padding:16px">No players found.</td></tr>';
		return;
	}

	const totalPages = Math.ceil(filtered.length / DIR_PER_PAGE) || 1;
	if (playerDirPage > totalPages) playerDirPage = totalPages;
	if (playerDirPage < 1) playerDirPage = 1;

	const start = (playerDirPage - 1) * DIR_PER_PAGE;
	const end = start + DIR_PER_PAGE;
	const pageItems = filtered.slice(start, end);

	pageItems.forEach((p) => {
		const b = p.batting;
		const bw = p.bowling;
		const tr = document.createElement("tr");
		tr.onclick = () => showPlayerCareerModal(p.name);
		tr.innerHTML = `
			<td class="sc-col-player"><strong>${p.name}</strong></td>
			<td class="sc-num">${p.matches}</td>
			<td class="sc-num"><strong>${b.runs}</strong></td>
			<td class="sc-num">${b.hs_display}</td>
			<td class="sc-num">${b.average !== null ? b.average : "—"}</td>
			<td class="sc-num">${b.strike_rate}</td>
			<td class="sc-num"><strong>${bw.wickets}</strong></td>
			<td class="sc-num">${bw.best_bowling}</td>
			<td class="sc-num">${bw.economy}</td>
		`;
		tbody.append(tr);
	});

	if (pagEl) {
		const info = document.createElement("span");
		info.className = "pagination-info";
		info.textContent = `Page ${playerDirPage} of ${totalPages} (${filtered.length} players)`;

		const controls = document.createElement("div");
		controls.className = "pagination-nav";

		const prevBtn = document.createElement("button");
		prevBtn.type = "button";
		prevBtn.className = "pagination-btn";
		prevBtn.textContent = "‹ Prev";
		prevBtn.disabled = playerDirPage <= 1;
		prevBtn.onclick = () => {
			if (playerDirPage > 1) {
				playerDirPage--;
				renderPlayerDirectory(stats, filterQuery);
			}
		};
		controls.append(prevBtn);

		const maxButtons = 5;
		let startBtn = Math.max(1, playerDirPage - 2);
		let endBtn = Math.min(totalPages, startBtn + maxButtons - 1);
		if (endBtn - startBtn < maxButtons - 1) {
			startBtn = Math.max(1, endBtn - maxButtons + 1);
		}

		for (let i = startBtn; i <= endBtn; i++) {
			const pBtn = document.createElement("button");
			pBtn.type = "button";
			pBtn.className = "pagination-btn" + (i === playerDirPage ? " active" : "");
			pBtn.textContent = i;
			const targetPage = i;
			pBtn.onclick = () => {
				playerDirPage = targetPage;
				renderPlayerDirectory(stats, filterQuery);
			};
			controls.append(pBtn);
		}

		const nextBtn = document.createElement("button");
		nextBtn.type = "button";
		nextBtn.className = "pagination-btn";
		nextBtn.textContent = "Next ›";
		nextBtn.disabled = playerDirPage >= totalPages;
		nextBtn.onclick = () => {
			if (playerDirPage < totalPages) {
				playerDirPage++;
				renderPlayerDirectory(stats, filterQuery);
			}
		};
		controls.append(nextBtn);

		pagEl.append(info, controls);
	}
}

async function showPlayerCareerModal(playerName) {
	try {
		const pRes = await api("player_stats&name=" + encodeURIComponent(playerName));
		const p = pRes.player;
		if (!p) return;

		const b = p.batting;
		const bw = p.bowling;

		const customContent = (container) => {
			const heroSection = document.createElement("div");
			heroSection.className = "career-hero-section";
			heroSection.innerHTML = `
				<div class="career-modal-header">
					<h3 class="career-modal-title">Player Profile</h3>
				</div>
				<div class="career-hero">
					<h2>${esc(p.name)}</h2>
					<p>${p.matches} Matches played across completed matches</p>
				</div>
			`;

			const batSub = document.createElement("div");
			batSub.className = "career-subhead";
			batSub.textContent = "Batting Career";

			const batSummary = document.createElement("div");
			batSummary.className = "career-stats-summary";
			batSummary.innerHTML = `
				<div class="career-stat-box"><span class="career-stat-val">${b.innings}</span><span class="career-stat-lbl">Innings</span></div>
				<div class="career-stat-box"><span class="career-stat-val">${b.runs}</span><span class="career-stat-lbl">Runs</span></div>
				<div class="career-stat-box"><span class="career-stat-val">${b.hs_display}</span><span class="career-stat-lbl">Highest</span></div>
				<div class="career-stat-box"><span class="career-stat-val">${b.average !== null ? b.average : "—"}</span><span class="career-stat-lbl">Average</span></div>
				<div class="career-stat-box"><span class="career-stat-val">${b.strike_rate}</span><span class="career-stat-lbl">SR</span></div>
				<div class="career-stat-box"><span class="career-stat-val">${b.fours} / ${b.sixes}</span><span class="career-stat-lbl">4s / 6s</span></div>
				<div class="career-stat-box"><span class="career-stat-val">${b.fifties} / ${b.hundreds}</span><span class="career-stat-lbl">50s / 100s</span></div>
			`;

			const bowlSub = document.createElement("div");
			bowlSub.className = "career-subhead";
			bowlSub.textContent = "Bowling Career";

			const bowlSummary = document.createElement("div");
			bowlSummary.className = "career-stats-summary";
			bowlSummary.innerHTML = `
				<div class="career-stat-box"><span class="career-stat-val">${bw.innings}</span><span class="career-stat-lbl">Innings</span></div>
				<div class="career-stat-box"><span class="career-stat-val">${bw.overs}</span><span class="career-stat-lbl">Overs</span></div>
				<div class="career-stat-box"><span class="career-stat-val">${bw.maidens}</span><span class="career-stat-lbl">Maidens</span></div>
				<div class="career-stat-box"><span class="career-stat-val">${bw.wickets}</span><span class="career-stat-lbl">Wickets</span></div>
				<div class="career-stat-box"><span class="career-stat-val">${bw.best_bowling}</span><span class="career-stat-lbl">BBI</span></div>
				<div class="career-stat-box"><span class="career-stat-val">${bw.economy}</span><span class="career-stat-lbl">Economy</span></div>
				<div class="career-stat-box"><span class="career-stat-val">${bw.average !== null ? bw.average : "—"}</span><span class="career-stat-lbl">Avg</span></div>
			`;

			container.append(heroSection, batSub, batSummary, bowlSub, bowlSummary);

			if (p.match_log && p.match_log.length) {
				const logSection = document.createElement("div");
				logSection.className = "match-log-section";

				const allLogs = (p.match_log || []).slice().reverse();
				const perPage = 3;
				let currentPage = 1;
				const totalPages = Math.ceil(allLogs.length / perPage) || 1;

				const logSub = document.createElement("div");
				logSub.className = "career-subhead";
				logSub.textContent = `Match Log (${allLogs.length})`;

				const tableWrap = document.createElement("div");
				tableWrap.className = "table-wrap";
				tableWrap.style.margin = "6px 0 8px";

				const table = document.createElement("table");
				table.className = "career-log-table";
				table.innerHTML = `
					<thead>
						<tr>
							<th style="text-align:left">Match</th>
							<th>Type</th>
							<th>Performance</th>
						</tr>
					</thead>
				`;
				const tbody = document.createElement("tbody");
				table.append(tbody);
				tableWrap.append(table);

				const pagNav = document.createElement("div");
				pagNav.className = "log-pagination";

				function renderLogPage() {
					tbody.innerHTML = "";
					const start = (currentPage - 1) * perPage;
					const end = start + perPage;
					const pageItems = allLogs.slice(start, end);

					pageItems.forEach((entry) => {
						const tr = document.createElement("tr");
						tr.className = "log-row";
						tr.innerHTML = `
							<td style="text-align:left">
								<strong>${esc(entry.title)}</strong>
								<span style="display:block;font-size:9px;color:var(--muted)">${esc((entry.date || "").slice(0, 10))}</span>
							</td>
							<td>${entry.type === "batting" ? "🏏 Bat" : "⚾ Bowl"}</td>
							<td class="sc-num">
								${entry.type === "batting"
									? `<strong>${entry.runs}</strong> (${entry.balls}b) · ${esc(entry.dismissal)}`
									: `<strong>${entry.wickets}/${entry.runs_conceded}</strong> (${entry.overs} ov, Econ ${entry.econ})`}
							</td>
						`;
						if (entry.match_id) {
							tr.title = "View match scoreboard";
							tr.onclick = async () => {
								closeModal(false);
								await openMatch(entry.match_id);
							};
						}
						tbody.append(tr);
					});

					pagNav.innerHTML = "";
					const info = document.createElement("span");
					info.className = "log-pag-info";
					info.textContent = `Page ${currentPage} of ${totalPages} (${allLogs.length} total)`;

					const controls = document.createElement("div");
					controls.className = "log-pag-nav";

					const prevBtn = document.createElement("button");
					prevBtn.type = "button";
					prevBtn.className = "log-pag-btn";
					prevBtn.textContent = "‹ Prev";
					prevBtn.disabled = currentPage <= 1;
					prevBtn.onclick = () => {
						if (currentPage > 1) {
							currentPage--;
							renderLogPage();
						}
					};
					controls.append(prevBtn);

					const maxButtons = 5;
					let startBtn = Math.max(1, currentPage - 2);
					let endBtn = Math.min(totalPages, startBtn + maxButtons - 1);
					if (endBtn - startBtn < maxButtons - 1) {
						startBtn = Math.max(1, endBtn - maxButtons + 1);
					}

					for (let i = startBtn; i <= endBtn; i++) {
						const pBtn = document.createElement("button");
						pBtn.type = "button";
						pBtn.className = "log-pag-btn" + (i === currentPage ? " active" : "");
						pBtn.textContent = i;
						const targetPage = i;
						pBtn.onclick = () => {
							currentPage = targetPage;
							renderLogPage();
						};
						controls.append(pBtn);
					}

					const nextBtn = document.createElement("button");
					nextBtn.type = "button";
					nextBtn.className = "log-pag-btn";
					nextBtn.textContent = "Next ›";
					nextBtn.disabled = currentPage >= totalPages;
					nextBtn.onclick = () => {
						if (currentPage < totalPages) {
							currentPage++;
							renderLogPage();
						}
					};
					controls.append(nextBtn);

					pagNav.append(info, controls);
				}

				renderLogPage();
				logSection.append(logSub, tableWrap, pagNav);
				container.append(logSection);
			}

			if (isAdmin) {
				const adminActions = document.createElement("div");
				adminActions.className = "career-actions";
				const renameBtn = document.createElement("button");
				renameBtn.type = "button";
				renameBtn.className = "ghost";
				renameBtn.textContent = "Rename player";
				renameBtn.onclick = () => {
					closeModal(false);
					setTimeout(() => showRenamePlayerModal(p), 60);
				};

				const delBtn = document.createElement("button");
				delBtn.type = "button";
				delBtn.className = "ghost error";
				delBtn.textContent = "Delete player";
				delBtn.onclick = () => {
					closeModal(false);
					setTimeout(async () => {
						const ok = await showModal({
							title: "Delete Player",
							message: `Are you sure you want to delete "${p.name}" from the player directory? (Past match scorecards remain preserved.)`,
							confirmLabel: "Delete Player",
							showCancel: true,
							showClose: true,
						});
						if (ok) {
							try {
								await api("player_delete", "POST", { id: p.id });
								await loadCommonPlayers();
								if (mainTab === "stats") {
									await loadPlayerStats();
								} else {
									renderRosterChips();
								}
							} catch (err) {
								showError(err.message);
							}
						}
					}, 60);
				};

				adminActions.append(renameBtn, delBtn);
				container.append(adminActions);
			}
		};

		await showModal({
			title: "",
			message: "",
			confirmLabel: "Close",
			showCancel: false,
			showClose: true,
			modalClass: "player-profile-modal",
			customContent,
		});
	} catch (e) {
		showError(e.message);
	}
}

function parsePlayerNameAndTag(raw) {
	raw = (raw || "").trim();
	const m = raw.match(/^(.*?)\s*\((.*?)\)$/);
	if (m) {
		return { baseName: m[1].trim(), tag: m[2].trim() };
	}
	return { baseName: raw, tag: "" };
}

function formatPlayerDisplayName(baseName, tag) {
	baseName = (baseName || "").trim();
	tag = (tag || "").trim();
	if (!tag) return baseName;
	const m = baseName.match(/^(.*?)\s*\((.*?)\)$/);
	if (m) {
		return `${m[1].trim()} (${tag})`;
	}
	return `${baseName} (${tag})`;
}

async function showAddPlayerModal(prefill = "") {
	const parsed = parsePlayerNameAndTag(prefill);
	let enteredName = parsed.baseName;
	let enteredTag = parsed.tag;
	let validationError = "";

	while (true) {
		let nameInputRef = null;
		let tagInputRef = null;
		let previewValRef = null;

		function updatePreview() {
			const b = (nameInputRef ? nameInputRef.value : enteredName).trim();
			const t = (tagInputRef ? tagInputRef.value : enteredTag).trim();
			const disp = formatPlayerDisplayName(b, t);
			if (previewValRef) {
				previewValRef.textContent = disp || "—";
			}
		}

		const content = (container) => {
			if (validationError) {
				const errBox = document.createElement("div");
				errBox.className = "modal-alert-error";
				errBox.style.cssText =
					"color:#b31b1b;background:#fdf2f2;border:1px solid #f8caca;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:600;margin-bottom:8px;line-height:1.4;";
				errBox.textContent = validationError;
				container.append(errBox);
			}

			// Row 1: Player Name
			const rowName = document.createElement("div");
			rowName.className = "modal-custom-row";
			const lblName = document.createElement("label");
			lblName.textContent = "Player Name *";
			const inpName = document.createElement("input");
			inpName.type = "text";
			inpName.className = "modal-input";
			inpName.placeholder = "Enter player name (e.g. Rahul, Rohit)";
			inpName.value = enteredName;
			inpName.autocomplete = "off";
			nameInputRef = inpName;

			inpName.oninput = () => {
				enteredName = inpName.value;
				updatePreview();
			};
			inpName.onkeydown = (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					if (tagInputRef) tagInputRef.focus();
				}
			};

			rowName.append(lblName, inpName);

			// Row 2: Jersey # / Identifier
			const rowTag = document.createElement("div");
			rowTag.className = "modal-custom-row";
			rowTag.style.marginTop = "6px";
			const lblTag = document.createElement("label");
			lblTag.innerHTML = `Jersey # / Identifier <span class="hint" style="font-weight:400;font-size:11px; margin: 0px;">(Optional — differentiates players with same name)</span>`;
			const inpTag = document.createElement("input");
			inpTag.type = "text";
			inpTag.className = "modal-input";
			inpTag.placeholder = "e.g. 7, 18, K, Parel, Jr";
			inpTag.value = enteredTag;
			inpTag.autocomplete = "off";
			tagInputRef = inpTag;

			inpTag.oninput = () => {
				enteredTag = inpTag.value;
				updatePreview();
			};
			inpTag.onkeydown = (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					closeModal(true);
				}
			};

			rowTag.append(lblTag, inpTag);

			// Row 3: Preview Box
			const prevBox = document.createElement("div");
			prevBox.style.cssText =
				"font-size:12px;font-weight:600;color:var(--muted);background:#f4f9fd;border:1px dashed var(--sky);border-radius:8px;padding:8px 12px;margin-top:8px;display:flex;align-items:center;justify-content:space-between;";
			prevBox.innerHTML = `<span>Full Display Name:</span><strong style="color:var(--blue);font-size:13px" id="playerPreviewVal"></strong>`;
			container.append(rowName, rowTag, prevBox);

			previewValRef = prevBox.querySelector("#playerPreviewVal");
			updatePreview();

			setTimeout(() => {
				if (validationError && tagInputRef && enteredName) {
					tagInputRef.focus();
					if (enteredTag) tagInputRef.select();
				} else if (inpName) {
					inpName.focus();
					if (enteredName) inpName.select();
				}
			}, 80);
		};

		const ok = await showModal({
			title: "Add Player",
			message: "Register a new player to the directory:",
			confirmLabel: "Add Player",
			showCancel: true,
			showClose: true,
			customContent: content,
		});

		if (!ok) return null;

		const base = (nameInputRef ? nameInputRef.value : enteredName).trim();
		const tag = (tagInputRef ? tagInputRef.value : enteredTag).trim();

		if (!base) {
			validationError = "Player name cannot be empty.";
			continue;
		}

		const fullName = formatPlayerDisplayName(base, tag);

		// Check if exact full name already exists
		const exactMatch = commonPlayers.find(
			(p) => p.toLowerCase() === fullName.toLowerCase(),
		);
		if (exactMatch) {
			validationError = `"${exactMatch}" already exists. Please choose a different jersey # or identifier.`;
			continue;
		}

		// If no tag was provided, check if baseName already exists to prompt for tag
		if (!tag) {
			const baseMatch = commonPlayers.find(
				(p) => p.toLowerCase() === base.toLowerCase(),
			);
			if (baseMatch) {
				validationError = `A player named "${baseMatch}" already exists. Please enter a Jersey # or Identifier below to distinguish them.`;
				continue;
			}
		}

		try {
			await api("player_create", "POST", { name: fullName });
			await loadCommonPlayers();
			if (mainTab === "stats") {
				await loadPlayerStats();
			} else {
				renderRosterChips();
			}
			return fullName;
		} catch (err) {
			validationError = err.message;
			continue;
		}
	}
}

async function showRenamePlayerModal(p) {
	const parsed = parsePlayerNameAndTag(p.name);
	let enteredName = parsed.baseName;
	let enteredTag = parsed.tag;
	let validationError = "";

	while (true) {
		let nameInputRef = null;
		let tagInputRef = null;
		let previewValRef = null;

		function updatePreview() {
			const b = (nameInputRef ? nameInputRef.value : enteredName).trim();
			const t = (tagInputRef ? tagInputRef.value : enteredTag).trim();
			const disp = formatPlayerDisplayName(b, t);
			if (previewValRef) {
				previewValRef.textContent = disp || "—";
			}
		}

		const content = (container) => {
			if (validationError) {
				const errBox = document.createElement("div");
				errBox.className = "modal-alert-error";
				errBox.style.cssText =
					"color:#b31b1b;background:#fdf2f2;border:1px solid #f8caca;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:600;margin-bottom:8px;line-height:1.4;";
				errBox.textContent = validationError;
				container.append(errBox);
			}

			// Row 1: Player Name
			const rowName = document.createElement("div");
			rowName.className = "modal-custom-row";
			const lblName = document.createElement("label");
			lblName.textContent = "Player Name *";
			const inpName = document.createElement("input");
			inpName.type = "text";
			inpName.className = "modal-input";
			inpName.placeholder = "Enter new player name...";
			inpName.value = enteredName;
			inpName.autocomplete = "off";
			nameInputRef = inpName;

			inpName.oninput = () => {
				enteredName = inpName.value;
				updatePreview();
			};
			inpName.onkeydown = (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					if (tagInputRef) tagInputRef.focus();
				}
			};

			rowName.append(lblName, inpName);

			// Row 2: Jersey # / Identifier
			const rowTag = document.createElement("div");
			rowTag.className = "modal-custom-row";
			rowTag.style.marginTop = "6px";
			const lblTag = document.createElement("label");
			lblTag.innerHTML = `Jersey # / Identifier <span class="hint" style="font-weight:400;font-size:11px">(Optional)</span>`;
			const inpTag = document.createElement("input");
			inpTag.type = "text";
			inpTag.className = "modal-input";
			inpTag.placeholder = "e.g. 7, 18, K, Parel, Jr";
			inpTag.value = enteredTag;
			inpTag.autocomplete = "off";
			tagInputRef = inpTag;

			inpTag.oninput = () => {
				enteredTag = inpTag.value;
				updatePreview();
			};
			inpTag.onkeydown = (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					closeModal(true);
				}
			};

			rowTag.append(lblTag, inpTag);

			// Row 3: Preview Box
			const prevBox = document.createElement("div");
			prevBox.style.cssText =
				"font-size:12px;font-weight:600;color:var(--muted);background:#f4f9fd;border:1px dashed var(--sky);border-radius:8px;padding:8px 12px;margin-top:8px;display:flex;align-items:center;justify-content:space-between;";
			prevBox.innerHTML = `<span>Full Display Name:</span><strong style="color:var(--blue);font-size:13px" id="playerPreviewVal"></strong>`;
			container.append(rowName, rowTag, prevBox);

			previewValRef = prevBox.querySelector("#playerPreviewVal");
			updatePreview();

			setTimeout(() => {
				if (validationError && tagInputRef) {
					tagInputRef.focus();
				} else if (inpName) {
					inpName.focus();
					inpName.select();
				}
			}, 80);
		};

		const ok = await showModal({
			title: "Rename Player",
			message: `Update player name for "${p.name}":`,
			confirmLabel: "Save Name",
			showCancel: true,
			showClose: true,
			customContent: content,
		});

		if (!ok) return null;

		const base = (nameInputRef ? nameInputRef.value : enteredName).trim();
		const tag = (tagInputRef ? tagInputRef.value : enteredTag).trim();

		if (!base) {
			validationError = "Player name cannot be empty.";
			continue;
		}

		const newFullName = formatPlayerDisplayName(base, tag);
		if (newFullName === p.name) return p.name;

		const existing = commonPlayers.find(
			(cp) =>
				cp.toLowerCase() === newFullName.toLowerCase() &&
				cp.toLowerCase() !== p.name.toLowerCase(),
		);
		if (existing) {
			validationError = `A player named "${existing}" already exists. Please choose a different jersey # or identifier.`;
			continue;
		}

		try {
			await api("player_update", "POST", { id: p.id, name: newFullName });
			await loadCommonPlayers();
			if (mainTab === "stats") {
				await loadPlayerStats();
			} else {
				renderRosterChips();
			}
			return newFullName;
		} catch (err) {
			validationError = err.message;
			continue;
		}
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
function bowlingTeamName() {
	if (!state) return "Bowling Team";
	return battingSide() === "B" ? (state.team_a || "Team A") : (state.team_b || "Team B");
}

function hasValidInningsOpeners() {
	if (!state || !state.openers) return false;
	if (state.openers_innings && Number(state.openers_innings) !== Number(state.innings)) return false;
	const { striker, non_striker, bowler } = state.openers;
	if (!striker || !non_striker || !bowler || striker === non_striker) return false;
	const bRoster = battingRoster();
	const bowRoster = bowlingRoster();
	if (!bRoster.includes(striker) || !bRoster.includes(non_striker)) return false;
	if (!bowRoster.includes(bowler)) return false;
	return true;
}

function isCreaseValidForCurrentInnings(cr = null) {
	if (!state) return false;
	const c = cr || state.crease;
	if (!c || !c.striker || !c.non_striker || !c.bowler) return false;
	if (c.striker === c.non_striker) return false;
	const bRoster = battingRoster();
	const bowRoster = bowlingRoster();
	if (!bRoster.includes(c.striker) || !bRoster.includes(c.non_striker)) return false;
	if (!bowRoster.includes(c.bowler)) return false;
	return true;
}

async function openInningsOpenerModal() {
	if (!isAdmin || !current || !state || isComplete()) return;
	const bRoster = battingRoster();
	const bowRoster = bowlingRoster();
	const innTeam = battingTeamName();
	const oppTeam = bowlingTeamName();

	const hasCurrentOpeners = state.openers && Number(state.openers_innings) === Number(state.innings);
	let striker = (hasCurrentOpeners && bRoster.includes(state.openers.striker))
		? state.openers.striker
		: bRoster[0] || "Player 1";
	let nonStriker = (hasCurrentOpeners && bRoster.includes(state.openers.non_striker) && state.openers.non_striker !== striker)
		? state.openers.non_striker
		: bRoster[1] || bRoster[0] || "Player 2";
	let bowler = (hasCurrentOpeners && bowRoster.includes(state.openers.bowler))
		? state.openers.bowler
		: bowRoster[0] || "Player 1";

	const content = (container) => {
		const row1 = document.createElement("div");
		row1.className = "modal-custom-row";
		row1.innerHTML = `<label>Opening Striker (${innTeam} · Facing ball 1)</label>`;
		const selStriker = document.createElement("select");
		bRoster.forEach((p) => {
			const opt = document.createElement("option");
			opt.value = p;
			opt.textContent = p;
			if (p === striker) opt.selected = true;
			selStriker.append(opt);
		});

		const row2 = document.createElement("div");
		row2.className = "modal-custom-row";
		row2.innerHTML = `<label>Opening Non-Striker (${innTeam})</label>`;
		const selNon = document.createElement("select");
		bRoster.forEach((p) => {
			const opt = document.createElement("option");
			opt.value = p;
			opt.textContent = p;
			if (p === nonStriker) opt.selected = true;
			selNon.append(opt);
		});

		selStriker.onchange = () => {
			striker = selStriker.value;
			if (striker === nonStriker) {
				const alt = bRoster.find((p) => p !== striker) || striker;
				nonStriker = alt;
				selNon.value = alt;
			}
		};
		selNon.onchange = () => {
			nonStriker = selNon.value;
			if (nonStriker === striker) {
				const alt = bRoster.find((p) => p !== nonStriker) || nonStriker;
				striker = alt;
				selStriker.value = alt;
			}
		};

		row1.append(selStriker);
		row2.append(selNon);

		const row3 = document.createElement("div");
		row3.className = "modal-custom-row";
		row3.innerHTML = `<label>Opening Bowler (${oppTeam})</label>`;
		const selBow = document.createElement("select");
		bowRoster.forEach((p) => {
			const opt = document.createElement("option");
			opt.value = p;
			opt.textContent = p;
			if (p === bowler) opt.selected = true;
			selBow.append(opt);
		});
		selBow.onchange = () => {
			bowler = selBow.value;
		};
		row3.append(selBow);

		container.append(row1, row2, row3);
	};

	await showModal({
		title: `${innTeam} — Innings ${state.innings} Openers`,
		message: `Select opening batters for ${innTeam} and opening bowler for ${oppTeam}:`,
		confirmLabel: "Start Scoring",
		showCancel: false,
		showClose: false,
		customContent: content,
	});

	state.crease = { striker, non_striker: nonStriker, bowler };
	state.openers = { striker, non_striker: nonStriker, bowler };
	state.openers_innings = state.innings;

	try {
		const r = await api(
			"set_crease",
			"POST",
			{ ...state.crease, set_as_openers: true },
			current,
		);
		if (r && r.state) state = r.state;
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
	const deliveries = state.deliveries || [];
	if (deliveries.length === 0) {
		if (hasValidInningsOpeners()) {
			state.crease = state.openers;
			render();
			return;
		}
		await openInningsOpenerModal();
		return;
	}
	if (isCreaseValidForCurrentInnings()) {
		return;
	}
	const last = deliveries[deliveries.length - 1];
	if (last && last.crease_after && isCreaseValidForCurrentInnings(last.crease_after)) {
		state.crease = last.crease_after;
		render();
		return;
	}
	await openInningsOpenerModal();
}
async function openMatch(id) {
	const r = await api("get", "GET", null, id);
	current = id;
	state = r.state;
	activeScoreTab = isComplete() ? "scorecard" : "live";
	openScorecardInningsKey = null;
	editingMatch = false;
	setPendingExtra("");
	Object.keys(overSectionOpen).forEach((k) => delete overSectionOpen[k]);
	lastOverInnings = state ? state.innings : null;
	$("matchTitle").textContent = matchTitleText(state);
	show("app");
	$("matchesView").classList.add("hidden");
	$("statsView").classList.add("hidden");
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
	return Boolean(state && state.status === "complete");
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
			const bowlersInOver = [
				...new Set((ov.balls || []).map((d) => d && d.bowler).filter(Boolean)),
			];
			const bowlerName = bowlersInOver.length
				? bowlersInOver.join(" / ")
				: (markCurrent &&
						!ov.complete &&
						state &&
						state.crease &&
						state.crease.bowler) ||
					"";
			title.textContent = bowlerName
				? `${bowlerName} (Over ${i + 1})${markCurrent && !ov.complete ? " · current" : ""}`
				: `Over ${i + 1}${markCurrent && !ov.complete ? " · current" : ""}`;
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
let activeScoreTab = "live";
let openScorecardInningsKey = null;
function setScoreTab(tab) {
	activeScoreTab = tab;
	render();
}
function teamName(s, side) {
	return side === "B" ? s.team_b || "Team B" : s.team_a || "Team A";
}
function computeInningsScorecard(
	deliveries,
	batRoster,
	bowRoster,
	crease = null,
	isLive = false,
) {
	const batting = {};
	const bowling = {};
	const fow = [];
	let totalRuns = 0;
	let totalWickets = 0;
	let legalBalls = 0;
	const extras = {
		wide: 0,
		noBall: 0,
		bye: 0,
		legBye: 0,
		overthrow: 0,
		total: 0,
	};

	(batRoster || []).forEach((name) => {
		batting[name] = {
			name,
			runs: 0,
			balls: 0,
			fours: 0,
			sixes: 0,
			isOut: false,
			dismissal: "not out",
			hasBatted: false,
		};
	});

	(bowRoster || []).forEach((name) => {
		bowling[name] = {
			name,
			balls: 0,
			runs: 0,
			maidens: 0,
			wickets: 0,
			wides: 0,
			noBalls: 0,
			dots: 0,
		};
	});

	(deliveries || []).forEach((d) => {
		const bat = d.batter || d.striker;
		const ns = d.non_striker;
		const bow = d.bowler;
		const isLegal = !["wide", "no-ball"].includes(d.extra_type || "");
		const runs = d.runs || 0;
		const exr = d.extra_runs || 0;
		const exType = d.extra_type || "";
		const ballTotal = runs + exr;

		totalRuns += ballTotal;

		if (batting[bat]) {
			batting[bat].hasBatted = true;
			batting[bat].runs += runs + (exType === "overthrow" ? exr : 0);
			if (isLegal) batting[bat].balls++;
			if (runs === 4 && exType !== "overthrow") batting[bat].fours++;
			if (runs === 6 && exType !== "overthrow") batting[bat].sixes++;
		}
		if (ns && batting[ns]) {
			batting[ns].hasBatted = true;
		}

		if (exType === "wide") {
			extras.wide += exr;
			extras.total += exr;
			if (bowling[bow]) bowling[bow].wides++;
		} else if (exType === "no-ball") {
			extras.noBall += exr;
			extras.total += exr;
			if (bowling[bow]) bowling[bow].noBalls++;
		} else if (exType === "bye") {
			extras.bye += exr;
			extras.total += exr;
		} else if (exType === "leg-bye") {
			extras.legBye += exr;
			extras.total += exr;
		} else if (exType === "overthrow") {
			extras.overthrow += exr;
			extras.total += exr;
		}

		if (bowling[bow]) {
			const bowlerCharge = ["bye", "leg-bye"].includes(exType) ? 0 : ballTotal;
			bowling[bow].runs += bowlerCharge;
			if (isLegal) {
				bowling[bow].balls++;
				if (ballTotal === 0) bowling[bow].dots++;
			}
		}

		if (isLegal) legalBalls++;

		if (d.wicket) {
			totalWickets++;
			const outPerson = d.dismissed_player || bat;
			if (batting[outPerson]) {
				batting[outPerson].hasBatted = true;
				batting[outPerson].isOut = true;
				const dis = d.dismissal || "bowled";
				if (dis === "run out") {
					batting[outPerson].dismissal = "run out";
				} else if (dis === "bowled") {
					batting[outPerson].dismissal = `b ${bow}`;
				} else if (dis === "caught") {
					batting[outPerson].dismissal = `c & b ${bow}`;
				} else if (dis === "lbw") {
					batting[outPerson].dismissal = `lbw b ${bow}`;
				} else if (dis === "stumped") {
					batting[outPerson].dismissal = `st † b ${bow}`;
				} else if (dis === "hit wicket") {
					batting[outPerson].dismissal = `hit wicket b ${bow}`;
				} else {
					batting[outPerson].dismissal = `${dis} b ${bow}`;
				}
			}
			if (bowling[bow] && !["run out", "retired hurt"].includes(d.dismissal)) {
				bowling[bow].wickets++;
			}
			fow.push({
				score: totalRuns,
				wicketNum: totalWickets,
				player: outPerson,
				over: oversText(legalBalls),
			});
		}
	});

	if (isLive && crease) {
		if (crease.striker && batting[crease.striker]) {
			batting[crease.striker].hasBatted = true;
			if (!batting[crease.striker].isOut) {
				batting[crease.striker].dismissal = "batting *";
			}
		}
		if (crease.non_striker && batting[crease.non_striker]) {
			batting[crease.non_striker].hasBatted = true;
			if (!batting[crease.non_striker].isOut) {
				batting[crease.non_striker].dismissal = "not out *";
			}
		}
	}

	const oversGrouped = groupOvers(deliveries || []);
	oversGrouped.forEach((ov) => {
		if (ov.complete && ov.balls.length > 0) {
			const b = ov.balls[0].bowler;
			if (overRuns(ov.balls) === 0 && bowling[b]) {
				bowling[b].maidens++;
			}
		}
	});

	return {
		batting,
		bowling,
		extras,
		fow,
		totalRuns,
		totalWickets,
		legalBalls,
		batRoster,
	};
}
function renderScorecardHTML(title, data, isOpen, inningsKey) {
	const rr =
		data.legalBalls > 0
			? (data.totalRuns / (data.legalBalls / 6)).toFixed(2)
			: "0.00";
	let html = `
		<details class="over-team scorecard-innings" name="scorecard-accordion" data-innings="${inningsKey}" ${isOpen ? "open" : ""}>
			<summary class="over-team-summary scorecard-innings-head">
				<span class="over-team-name">${title}</span>
				<span class="over-team-score">${data.totalRuns}/${data.totalWickets} (${oversText(data.legalBalls)} Ov)</span>
			</summary>
			<div class="over-team-body scorecard-innings-body">
			<table class="sc-table">
				<thead>
					<tr>
						<th class="sc-col-player">Batting</th>
						<th>R</th>
						<th>B</th>
						<th>4s</th>
						<th>6s</th>
						<th>SR</th>
					</tr>
				</thead>
				<tbody>
	`;

	const didNotBat = [];
	(data.batRoster || Object.keys(data.batting)).forEach((name) => {
		const b = data.batting[name];
		if (b && b.hasBatted) {
			const sr = b.balls > 0 ? ((b.runs / b.balls) * 100).toFixed(1) : "0.0";
			html += `
				<tr>
					<td class="sc-col-player">
						<span class="sc-player-name">${b.name}</span>
						<span class="sc-dismissal">${b.dismissal}</span>
					</td>
					<td class="sc-num"><strong>${b.runs}</strong></td>
					<td class="sc-num">${b.balls}</td>
					<td class="sc-num">${b.fours}</td>
					<td class="sc-num">${b.sixes}</td>
					<td class="sc-num">${sr}</td>
				</tr>
			`;
		} else {
			didNotBat.push(name);
		}
	});

	const ex = data.extras;
	html += `
					<tr class="sc-sub-row">
						<td class="sc-col-player">Extras</td>
						<td colspan="5" class="sc-extras-detail">
							<strong>${ex.total}</strong> (w ${ex.wide}, nb ${ex.noBall}, b ${ex.bye}, lb ${ex.legBye})
						</td>
					</tr>
					<tr class="sc-total-row">
						<td class="sc-col-player">Total</td>
						<td colspan="5">
							<strong>${data.totalRuns}/${data.totalWickets}</strong> (${oversText(data.legalBalls)} Ov, RR ${rr})
						</td>
					</tr>
				</tbody>
			</table>
	`;

	if (didNotBat.length) {
		html += `
			<div class="sc-dnb">
				<span class="sc-dnb-label">Yet to bat:</span>
				<span class="sc-dnb-list">${didNotBat.join(", ")}</span>
			</div>
		`;
	}

	if (data.fow && data.fow.length) {
		html += `
			<div class="sc-fow-section">
				<span class="sc-fow-label">Fall of Wickets</span>
				<div class="sc-fow-chips">
		`;
		html += data.fow
			.map(
				(f) =>
					`<span class="sc-fow-item"><strong>${f.score}-${f.wicketNum}</strong> (${f.player}, ${f.over} ov)</span>`,
			)
			.join(" · ");
		html += `
				</div>
			</div>
		`;
	}

	html += `
			<table class="sc-table sc-bowling-table">
				<thead>
					<tr>
						<th class="sc-col-player">Bowling</th>
						<th>O</th>
						<th>M</th>
						<th>R</th>
						<th>W</th>
						<th>ECON</th>
						<th>WD</th>
						<th>NB</th>
					</tr>
				</thead>
				<tbody>
	`;

	const bowlersWhoBowled = Object.values(data.bowling).filter(
		(b) => b.balls > 0 || b.wides > 0 || b.noBalls > 0 || b.runs > 0,
	);

	if (!bowlersWhoBowled.length) {
		html += `<tr><td colspan="8" class="hint" style="text-align:center">No bowling figures recorded yet.</td></tr>`;
	} else {
		bowlersWhoBowled.forEach((b) => {
			const ov = oversText(b.balls);
			const econ = b.balls > 0 ? (b.runs / (b.balls / 6)).toFixed(2) : "0.00";
			html += `
				<tr>
					<td class="sc-col-player"><strong>${b.name}</strong></td>
					<td class="sc-num">${ov}</td>
					<td class="sc-num">${b.maidens}</td>
					<td class="sc-num">${b.runs}</td>
					<td class="sc-num"><strong>${b.wickets}</strong></td>
					<td class="sc-num">${econ}</td>
					<td class="sc-num">${b.wides}</td>
					<td class="sc-num">${b.noBalls}</td>
				</tr>
			`;
		});
	}

	html += `
				</tbody>
			</table>
			</div>
		</details>
	`;

	return html;
}
function renderDetailedScorecard() {
	const container = $("scorecardContent");
	if (!container || !state) return;

	if (openScorecardInningsKey === null) {
		openScorecardInningsKey =
			state.innings === 2 || state.innings_1 ? "innings-2" : "innings-1";
	}

	let fullHTML = "";

	if (state.innings_1) {
		const i1 = state.innings_1;
		const i1Side = i1.side || (state.batting_first === "B" ? "B" : "A");
		const i1BatRoster = teamRoster(i1Side);
		const i1BowRoster = teamRoster(i1Side === "B" ? "A" : "B");
		const i1Data = computeInningsScorecard(
			i1.deliveries || [],
			i1BatRoster,
			i1BowRoster,
			i1.crease,
			false,
		);
		const i1Title = `Innings 1: ${i1.team || teamName(state, i1Side)}`;
		const isI1Open = openScorecardInningsKey === "innings-1";
		fullHTML += renderScorecardHTML(i1Title, i1Data, isI1Open, "innings-1");
	}

	const curSide = battingSide();
	const curBatRoster = battingRoster();
	const curBowRoster = bowlingRoster();
	const curData = computeInningsScorecard(
		state.deliveries || [],
		curBatRoster,
		curBowRoster,
		state.crease,
		!isComplete(),
	);
	const curTitle = `Innings ${state.innings}: ${battingTeamName()}${!isComplete() ? " (Live)" : ""}`;
	const curKey =
		state.innings === 2 || state.innings_1 ? "innings-2" : "innings-1";
	const isCurOpen = openScorecardInningsKey === curKey;
	fullHTML += renderScorecardHTML(curTitle, curData, isCurOpen, curKey);

	container.innerHTML = fullHTML;

	container
		.querySelectorAll("details.scorecard-innings")
		.forEach((detailsEl) => {
			detailsEl.addEventListener("toggle", () => {
				if (detailsEl.open) {
					openScorecardInningsKey = detailsEl.dataset.innings;
					container
						.querySelectorAll("details.scorecard-innings")
						.forEach((other) => {
							if (other !== detailsEl && other.open) {
								other.open = false;
							}
						});
				} else {
					if (openScorecardInningsKey === detailsEl.dataset.innings) {
						const anyOpen = container.querySelector(
							"details.scorecard-innings[open]",
						);
						openScorecardInningsKey = anyOpen
							? anyOpen.dataset.innings
							: "none";
					}
				}
			});
		});
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
	const liveTabActive = activeScoreTab === "live";
	const liveTab = $("tabLive");
	const scTab = $("tabScorecard");
	if (liveTab && scTab) {
		liveTab.classList.toggle("active", liveTabActive);
		scTab.classList.toggle("active", !liveTabActive);
	}
	$("recordPanel").classList.toggle(
		"hidden",
		!isAdmin || (isComplete() && !!state.locked) || !liveTabActive,
	);
	$("recordPanel").classList.toggle("scoring-locked", isComplete());
	$("overCards").classList.toggle("hidden", !liveTabActive);
	const scView = $("scorecardView");
	if (scView) {
		scView.classList.toggle("hidden", liveTabActive);
		if (!liveTabActive) {
			renderDetailedScorecard();
		}
	}
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
	if (!state || isComplete() || state.status === "complete" || state.status === "ended") {
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
	const modalCard = $("modal") ? $("modal").querySelector(".modal-card") : null;
	if (modalCard) {
		modalCard.className = "modal-card";
	}
	if ($("modalTitle")) {
		$("modalTitle").classList.remove("hidden");
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
	modalClass = "",
}) {
	const modalCard = $("modal") ? $("modal").querySelector(".modal-card") : null;
	if (modalCard) {
		modalCard.className = "modal-card" + (modalClass ? " " + modalClass : "");
	}
	if ($("modalTitle")) {
		$("modalTitle").textContent = title || "";
		$("modalTitle").classList.toggle("hidden", !title);
	}
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
			const bowlersInOver = [
				...new Set((balls || []).map((d) => d && d.bowler).filter(Boolean)),
			];
			const bName = bowlersInOver.length ? bowlersInOver.join(" / ") : "";
			hTitle.textContent = bName && overNumber
				? `${bName} (Over ${overNumber})`
				: overNumber
					? "Over " + overNumber
					: "This over";
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
		const inn1 = state.innings_1 || {};
		const inn1Team = bowlingTeamName();
		const inn2Team = battingTeamName();
		await showModal({
			title: "1st Innings Complete",
			message: `${inn1Team} scored ${inn1.total || 0}/${inn1.wickets || 0} in ${oversText(inn1.legal || 0)} overs.\nTarget for ${inn2Team} is ${state.target} runs. Ready to start 2nd innings?`,
			confirmLabel: "Select Innings 2 Openers",
			showCancel: false,
			balls: overDetails ? overDetails.balls : null,
			overNumber: overDetails ? overDetails.overNumber : 0,
		});
		state.crease = null;
		await openInningsOpenerModal();
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
		if (state.innings === prevInnings) {
			state.crease = creaseAfter;
		} else {
			state.crease = null;
			state.openers = null;
			state.openers_innings = null;
		}
		pendingExtra = "";
		pendingWicket = false;
		syncPendingButtons();
		if (isComplete() && prevStatus !== "complete") {
			activeScoreTab = "scorecard";
		}
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
		if (!isComplete()) {
			activeScoreTab = "live";
		}
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
		state.crease = null;
		state.openers = null;
		state.openers_innings = null;
		render();
		$("actionMessage").textContent = "2nd innings — target " + state.target;
		await openInningsOpenerModal();
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
		if (isComplete()) {
			activeScoreTab = "scorecard";
		}
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
const tabLive = $("tabLive");
if (tabLive) tabLive.onclick = () => setScoreTab("live");
const tabScorecard = $("tabScorecard");
if (tabScorecard) tabScorecard.onclick = () => setScoreTab("scorecard");

const tabMatches = $("tabMatches");
if (tabMatches) tabMatches.onclick = () => setMainTab("matches");
const tabStats = $("tabStats");
if (tabStats) tabStats.onclick = () => setMainTab("stats");

const addPBtn = $("addPlayerBtn");
if (addPBtn) {
	addPBtn.onclick = () => showAddPlayerModal();
}

const dirSearch = $("playerDirSearch");
if (dirSearch) {
	dirSearch.oninput = (e) => {
		playerStatsFilter = e.target.value;
		playerDirPage = 1;
		renderPlayerDirectory(playerStatsData, playerStatsFilter);
	};
}

const pSearchA = $("playerSearchA");
if (pSearchA) {
	pSearchA.oninput = (e) => {
		poolSearchA = e.target.value;
		renderRosterChips();
	};
	pSearchA.onkeydown = (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			handleAddChipInput("A");
		}
	};
}
const pSearchB = $("playerSearchB");
if (pSearchB) {
	pSearchB.oninput = (e) => {
		poolSearchB = e.target.value;
		renderRosterChips();
	};
	pSearchB.onkeydown = (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			handleAddChipInput("B");
		}
	};
}

const addChipABtn = $("addChipA");
if (addChipABtn) addChipABtn.onclick = () => handleAddChipInput("A");
const addChipBBtn = $("addChipB");
if (addChipBBtn) addChipBBtn.onclick = () => handleAddChipInput("B");

const autoFillABtn = $("autoFillA");
if (autoFillABtn) autoFillABtn.onclick = () => autoFillRoster("A");
const autoFillBBtn = $("autoFillB");
if (autoFillBBtn) autoFillBBtn.onclick = () => autoFillRoster("B");

boot();
