const $ = (id) => document.getElementById(id);
let current = null;
let state = null;
let matchSeriesScore = null;
let pendingExtra = "";
let pendingWicket = false;
let isAdmin = false;
let pollTimer = null;
let editingMatch = false;
const overSectionOpen = {};
let lastOverInnings = null;
let lastOverComplete = null;
const EXTRA_LABELS = {
	wide: "Wide",
	"no-ball": "No-ball",
	bye: "Bye",
	overthrow: "Overthrow 4",
	wicket: "Wicket",
};
function formatPlayerName(name) {
	if (!name || typeof name !== "string") return "";
	const trimmed = name.trim();
	if (!trimmed) return "";
	if (/^\d+$/.test(trimmed)) return "Player " + trimmed;
	const tagMatch = trimmed.match(/^(.*?)\s*\((.*?)\)$/);
	if (tagMatch) {
		const base = formatPlayerName(tagMatch[1]);
		const tag = tagMatch[2].trim();
		return `${base} (${tag})`;
	}
	return trimmed
		.toLowerCase()
		.replace(/(^|[\s\-\.\/'])([a-z])/g, (_, p1, p2) => p1 + p2.toUpperCase());
}
async function api(action, method = "GET", data = null, id = null) {
	const url = new URL("api/index.php", document.baseURI);
	url.searchParams.set("action", action);
	if (id) url.searchParams.set("id", id);
	const r = await fetch(url, {
		method,
		cache: "no-store",
		headers: data ? { "Content-Type": "application/json" } : {},
		body: data ? JSON.stringify(data) : undefined,
		credentials: "same-origin",
	});
	const j = await r.json();
	if (!r.ok || j.success === false) {
		const message =
			typeof j.error === "string"
				? j.error
				: j.error && j.error.message
					? j.error.message
					: "Request failed";
		const error = new Error(message);
		if (j.error && typeof j.error === "object" && j.error.code) {
			error.code = j.error.code;
		}
		throw error;
	}
	return j.success === true && Object.prototype.hasOwnProperty.call(j, "data")
		? j.data
		: j;
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
		$("matchesView").classList.toggle("hidden", mainTab !== "matches");
		$("statsView").classList.toggle("hidden", mainTab !== "stats");
		$("tossView").classList.toggle("hidden", mainTab !== "toss");
	}
	syncMainTabButtons();
	headerMode();
}
const mainTabNames = ["matches", "stats", "toss"];
const mainTabIds = {
	matches: "matchesMainTab",
	stats: "statsMainTab",
	toss: "tossMainTab",
};
function syncMainTabButtons() {
	mainTabNames.forEach((name) => {
		const tab = $(mainTabIds[name]);
		const active = mainTab === name;
		tab.setAttribute("aria-selected", String(active));
		tab.tabIndex = active ? 0 : -1;
	});
}
function setMainTab(tabName, historyMode = "push") {
	if (!mainTabNames.includes(tabName)) return;
	const changed = mainTab !== tabName;
	mainTab = tabName;
	if (changed || historyMode === "replace") setRoute(tabName, null, historyMode);
	show("app");
	syncMainTabButtons();
	if (tabName === "stats") loadPlayerStats();
	else if (tabName === "matches") loadMatches();
}
mainTabNames.forEach((name) => {
	const tab = $(mainTabIds[name]);
	tab.addEventListener("click", () => setMainTab(name));
	tab.addEventListener("keydown", (event) => {
		if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
		event.preventDefault();
		const currentIndex = mainTabNames.indexOf(name);
		const nextIndex =
			event.key === "Home"
				? 0
				: event.key === "End"
					? mainTabNames.length - 1
					: (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + mainTabNames.length) % mainTabNames.length;
		const nextName = mainTabNames[nextIndex];
		$(mainTabIds[nextName]).focus();
		setMainTab(nextName);
	});
});
function setRoute(screen, matchId = null, mode = "push") {
	window.CricketRouter.navigate(screen, matchId, mode);
}
function rememberMatch(id, mode = "push") {
	setRoute("score", id, mode);
}
function forgetMatch() {
	mainTab = "matches";
	setRoute("matches", null, "replace");
}
function pushNavState(stateUpdate = {}, hash = "", replace = false) {
	const url = new URL(location.href);
	url.hash = hash ? hash.replace(/^#/, "") : "";
	const nextState = { ...(history.state || {}), ...stateUpdate };
	if (replace) history.replaceState(nextState, "", url);
	else history.pushState(nextState, "", url);
}
function goBackToMatches() {
	stopPoll();
	current = null;
	state = null;
	matchSeriesScore = null;
	editingMatch = false;
	setPendingExtra("");
	forgetMatch();
	mainTab = "matches";
	show("app");
	headerMode();
	loadMatches();
}
function exitToMatches() {
	goBackToMatches();
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
			const matchCompleted =
				prev &&
				prev.status !== "complete" &&
				r.state &&
				r.state.status === "complete";
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
			if (matchCompleted) refreshMatchSeriesScore(current);
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
	const appOpen = !$("app").classList.contains("hidden");
	const mainTabs = $("mainTabs");
	if (mainTabs) {
		mainTabs.classList.toggle("hidden", !appOpen || matchOpen || setupOpen);
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
			.register(
				"sw.js?v=" + encodeURIComponent(document.body.dataset.appVersion),
				{ updateViaCache: "none" },
			)
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
	const route = window.CricketRouter.resolve();
	switch (route.name) {
		case "login":
			setRoute("login", null, "replace");
			show("login");
			return;
		case "setup-create":
			if (!isAdmin) {
				setRoute("login", null, "replace");
				show("login");
				return;
			}
			setRoute("setup-create", null, "replace");
			show("app");
			fillSetup("create");
			return;
		case "setup-edit":
			if (!isAdmin) {
				setRoute("login", null, "replace");
				show("login");
				return;
			}
			if (route.matchId) {
				try {
					await openMatch(route.matchId, null);
					setRoute("setup-edit", route.matchId, "replace");
					fillSetup("update");
					return;
				} catch (error) {
					showError(error.message);
				}
			}
			break;
		case "score":
			if (route.matchId) {
				try {
					await openMatch(route.matchId, "replace");
					return;
				} catch (error) {
					showError(error.message);
				}
			}
			break;
		case "stats":
			mainTab = "stats";
			setRoute("stats", null, "replace");
			show("app");
			loadPlayerStats();
			return;
		case "toss":
			mainTab = "toss";
			setRoute("toss", null, "replace");
			show("app");
			return;
	}
	mainTab = "matches";
	setRoute("matches", null, "replace");
	show("app");
	loadMatches();
}
if ($("qrBtn")) {
	$("qrBtn").onclick = () => {
		const url = getAppQrUrl();
		showModal({
			title: "Scan to open app",
			message: "Scan with your phone camera to view the live score.",
			confirmLabel: "Close",
			showCancel: false,
			qr: url,
		});
	};
}
$("loginBtn").onclick = () => {
	$("loginError").textContent = "";
	setRoute("login", current);
	show("login");
};
async function tossCoin() {
	const button = $("flipCoin");
	const section = button.closest(".coin-toss");
	const coin = $("coin");
	const resultMessage = $("coinTossResult");
	const buttonLabel = $("flipCoinLabel");
	const heads = Math.random() < 0.5;
	const result = heads ? "Heads" : "Tails";
	const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	button.disabled = true;
	buttonLabel.textContent = "Flipping…";
	section.setAttribute("aria-busy", "true");
	resultMessage.textContent = "Flipping coin…";

	if (!reducedMotion && coin.animate) {
		const rect = coin.getBoundingClientRect();
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const coinSize = Math.min(
			rect.width,
			rect.height,
			Math.max(0, Math.min(viewportWidth, viewportHeight) - 24) / 1.12,
		);
		const startVisibility = coin.style.visibility;
		const flyingCoin = coin.cloneNode(true);
		flyingCoin.removeAttribute("id");
		flyingCoin.classList.remove("is-settled");
		flyingCoin.textContent = "?";
		flyingCoin.setAttribute("aria-hidden", "true");
		Object.assign(flyingCoin.style, {
			position: "fixed",
			left: (viewportWidth - coinSize) / 2 + "px",
			top: (viewportHeight - coinSize) / 2 + "px",
			width: coinSize + "px",
			height: coinSize + "px",
			margin: "0",
			zIndex: "2147483647",
			pointerEvents: "none",
		});
		document.body.appendChild(flyingCoin);
		coin.style.visibility = "hidden";

		const travel = Math.min(
			viewportHeight * 0.2,
			Math.max(0, (viewportHeight - coinSize * 1.12) / 2 - 12),
		);
		const lift = -travel;
		try {
			const animation = flyingCoin.animate(
				[
					{ transform: "perspective(700px) translate3d(0, 0, 0) rotateX(0) rotateY(0) scale(1)", offset: 0 },
					{ transform: `perspective(700px) translate3d(0, ${lift}px, 0) rotateX(540deg) rotateY(720deg) scale(1.12)`, offset: 0.44 },
					{ transform: `perspective(700px) translate3d(0, ${lift * 0.82}px, 0) rotateX(1260deg) rotateY(1620deg) scale(.96)`, offset: 0.76 },
					{ transform: "perspective(700px) translate3d(0, 0, 0) rotateX(1800deg) rotateY(2160deg) scale(1)", offset: 1 },
				],
				{ duration: 1450, easing: "ease-in-out" },
			);
			await animation.finished;
		} catch (e) {
		} finally {
			flyingCoin.remove();
			coin.style.visibility = startVisibility;
		}
	}

	coin.textContent = heads ? "H" : "T";
	coin.classList.remove("is-settled");
	void coin.offsetWidth;
	coin.classList.add("is-settled");
	section.classList.add("has-result");
	resultMessage.textContent = result + " (" + (heads ? "H" : "T") + ").";
	buttonLabel.textContent = "Flip again";
	button.disabled = false;
	section.setAttribute("aria-busy", "false");
}
$("flipCoin").onclick = tossCoin;
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
	current = null;
	editingMatch = false;
	stopPoll();
	show("app");
	headerMode();
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
		current = null;
		editingMatch = false;
		stopPoll();
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
	pushNavState({ page: "matches" }, "", true);
	exitToMatches();
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
		commonPlayers = (r.players || [])
			.filter((p) => p.is_active === undefined || Number(p.is_active) === 1)
			.map((p) => formatPlayerName(typeof p === "string" ? p : p.name));
	} catch (e) {
		commonPlayers = [];
	}
}

function renderRosterChips() {
	const maxA = Math.max(2, Math.min(15, parseInt($("playersA").value, 10) || 7));
	const maxB = Math.max(2, Math.min(15, parseInt($("playersB").value, 10) || 7));

	$("rosterTitleA").textContent = `${$("teamA").value.trim() || "Team A"} players`;
	$("rosterTitleB").textContent = `${$("teamB").value.trim() || "Team B"} players`;
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
				btn.setAttribute("aria-label", `Remove ${name} from Team A`);
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
				: commonPlayers.length
					? "No available directory players."
					: "Player directory is empty.";
			poolA.append(hint);
		} else {
			listA.forEach((name) => {
				const chip = document.createElement("button");
				chip.type = "button";
				chip.className = "pool-chip";
				chip.textContent = name;
				chip.title = "Tap to add to Team A";
				chip.setAttribute("aria-label", `Add ${name} to Team A`);
				chip.addEventListener("click", () => {
					if (selectedRosterA.length >= maxA) {
						showError(
							`Team A is full (${maxA} players). Increase player count to add more.`,
						);
						return;
					}
					selectedRosterA.push(name);
					renderRosterChips();
				});
				poolA.append(chip);
			});
		}
		if (isAdmin) {
			const addChip = document.createElement("button");
			addChip.type = "button";
			addChip.className = "pool-chip add-new-pill";
			addChip.textContent = "＋ New Player";
			addChip.title = "Register a new player in directory";
			addChip.addEventListener("click", async () => {
				const newName = await showAddPlayerModal(poolSearchA.trim());
				if (
					newName &&
					selectedRosterA.length < maxA &&
					!selectedRosterA.includes(newName)
				) {
					selectedRosterA.push(newName);
					renderRosterChips();
				}
			});
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
				btn.setAttribute("aria-label", `Remove ${name} from Team B`);
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
				: commonPlayers.length
					? "No available directory players."
					: "Player directory is empty.";
			poolB.append(hint);
		} else {
			listB.forEach((name) => {
				const chip = document.createElement("button");
				chip.type = "button";
				chip.className = "pool-chip";
				chip.textContent = name;
				chip.title = "Tap to add to Team B";
				chip.setAttribute("aria-label", `Add ${name} to Team B`);
				chip.addEventListener("click", () => {
					if (selectedRosterB.length >= maxB) {
						showError(
							`Team B is full (${maxB} players). Increase player count to add more.`,
						);
						return;
					}
					selectedRosterB.push(name);
					renderRosterChips();
				});
				poolB.append(chip);
			});
		}
		if (isAdmin) {
			const addChip = document.createElement("button");
			addChip.type = "button";
			addChip.className = "pool-chip add-new-pill";
			addChip.textContent = "＋ New Player";
			addChip.title = "Register a new player in directory";
			addChip.addEventListener("click", async () => {
				const newName = await showAddPlayerModal(poolSearchB.trim());
				if (newName && selectedRosterB.length < maxB && !selectedRosterB.includes(newName)) {
					selectedRosterB.push(newName);
					renderRosterChips();
				}
			});
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
	let finalName = formatPlayerName(existingMatch || name);

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

	if (!existingMatch) {
		finalName = await showAddPlayerModal(name);
		if (!finalName) return;
	}
	current.push(finalName);
	inp.value = "";
	if (side === "A") poolSearchA = "";
	else poolSearchB = "";

	renderRosterChips();
}

async function showAddPlayerModal(initialName = "") {
	let input;
	const warning = document.createElement("p");
	warning.className = "hint hidden";
	warning.setAttribute("role", "alert");
	const customContent = (container) => {
		const row = document.createElement("div");
		row.className = "modal-custom-row";
		const label = document.createElement("label");
		label.textContent = "Player name *";
		input = document.createElement("input");
		input.type = "text";
		input.required = true;
		input.maxLength = 100;
		input.autocomplete = "off";
		input.value = initialName;
		row.append(label, input);
		container.append(warning, row);
	};
	const ok = await showModal({
		title: "Add player",
		message: "Register a player in the directory.",
		confirmLabel: "Add player",
		showCancel: true,
		customContent,
		validate: () => {
			const name = formatPlayerName(input.value);
			if (!name) {
				warning.textContent = "Enter a player name.";
				warning.classList.remove("hidden");
				return false;
			}
			if (commonPlayers.some((player) => player.toLowerCase() === name.toLowerCase())) {
				warning.textContent = "That player is already in the directory.";
				warning.classList.remove("hidden");
				return false;
			}
			return true;
		},
	});
	if (!ok) return null;
	const name = formatPlayerName(input.value);
	try {
		const result = await api("player_create", "POST", { name });
		const savedName = formatPlayerName(
			(result.player && result.player.name) || name,
		);
		commonPlayers.push(savedName);
		commonPlayers.sort((a, b) => a.localeCompare(b));
		return savedName;
	} catch (error) {
		await showError(error.message);
		return null;
	}
}

const playerStatsPageSize = 20;
let playerStatsPage = 1;
function statNumber(value, digits = 2) {
	if (value === null || value === undefined || value === "") return "—";
	const number = Number(value);
	return Number.isFinite(number) ? number.toFixed(digits).replace(/\.?0+$/, "") : "—";
}
function statText(value, fallback = "—") {
	return value === null || value === undefined || value === "" ? fallback : String(value);
}
function renderLeaderboards(leaderboards = {}) {
	const root = $("leaderboardGrid");
	root.replaceChildren();
	const boards = [
		{ key: "top_runs", title: "Most runs", metric: (p) => `${p.batting.runs} runs` },
		{ key: "top_wickets", title: "Most wickets", metric: (p) => `${p.bowling.wickets} wickets` },
		{ key: "top_sixes", title: "Most sixes", metric: (p) => `${p.batting.sixes} sixes` },
		{ key: "best_economy", title: "Best economy", metric: (p) => `${statNumber(p.bowling.economy)} econ` },
	];
	boards.forEach((board) => {
		const card = document.createElement("section");
		card.className = "leaderboard-card";
		const heading = document.createElement("h3");
		heading.textContent = board.title;
		card.append(heading);
		const entries = Array.isArray(leaderboards[board.key])
			? leaderboards[board.key].slice(0, 5)
			: [];
		if (!entries.length) {
			const empty = document.createElement("p");
			empty.className = "leaderboard-empty";
			empty.textContent = "No results yet";
			card.append(empty);
		} else {
			const list = document.createElement("ol");
			list.className = "leaderboard-list";
			entries.forEach((player) => {
				const item = document.createElement("li");
				const name = document.createElement("button");
				name.type = "button";
				name.className = "leaderboard-player";
				name.textContent = statText(player.name);
				name.addEventListener("click", () => showPlayerProfile(player));
				const metric = document.createElement("span");
				metric.className = "leaderboard-metric";
				metric.textContent = board.metric(player);
				item.append(name, metric);
				list.append(item);
			});
			card.append(list);
		}
		root.append(card);
	});
}
function renderPlayerStatsTable() {
	const body = $("playerStatsBody");
	const pagination = $("playerStatsPagination");
	const allPlayers = playerStatsData && Array.isArray(playerStatsData.stats)
		? playerStatsData.stats
		: [];
	const query = playerStatsFilter.trim().toLowerCase();
	const players = allPlayers
		.filter((player) => !query || player.name.toLowerCase().includes(query))
		.sort((a, b) => a.name.localeCompare(b.name));
	const totalPages = Math.max(1, Math.ceil(players.length / playerStatsPageSize));
	playerStatsPage = Math.min(playerStatsPage, totalPages);
	const start = (playerStatsPage - 1) * playerStatsPageSize;
	const page = players.slice(start, start + playerStatsPageSize);
	body.replaceChildren();
	$("playerStatsActionsHeader").classList.toggle("hidden", !isAdmin);
	if (!page.length) {
		const row = document.createElement("tr");
		const cell = document.createElement("td");
		cell.colSpan = isAdmin ? 10 : 9;
		cell.className = "player-stats-empty";
		cell.textContent = query ? "No players match your search." : "No players in the directory yet.";
		row.append(cell);
		body.append(row);
	} else {
		page.forEach((player) => {
			const row = document.createElement("tr");
			const nameCell = document.createElement("td");
			nameCell.className = "player-name-cell";
			const profileButton = document.createElement("button");
			profileButton.type = "button";
			profileButton.className = "player-profile-link";
			profileButton.textContent = player.name;
			profileButton.addEventListener("click", () => showPlayerProfile(player));
			nameCell.append(profileButton);
			if (Number(player.is_active) === 0) {
				const inactive = document.createElement("span");
				inactive.className = "player-status inactive";
				inactive.textContent = "Inactive";
				nameCell.append(inactive);
			}
			row.append(nameCell);
			[
				player.matches,
				player.batting.runs,
				player.batting.hs_display,
				statNumber(player.batting.average),
				statNumber(player.batting.strike_rate),
				player.bowling.wickets,
				player.bowling.best_bowling,
				statNumber(player.bowling.economy),
			].forEach((value) => {
				const cell = document.createElement("td");
				cell.textContent = statText(value);
				row.append(cell);
			});
			if (isAdmin) {
				const actions = document.createElement("td");
				actions.className = "player-actions-cell";
				if (Number(player.id) > 0) {
					actions.append(
						playerActionButton("Edit", "ghost", () => editDirectoryPlayer(player)),
						playerActionButton(
							Number(player.is_active) === 0 ? "Activate" : "Deactivate",
							"ghost",
							() => toggleDirectoryPlayer(player),
						),
						playerActionButton("Delete", "danger", () => deleteDirectoryPlayer(player)),
					);
				} else {
					actions.append(
						playerActionButton("Add to directory", "ghost", () => addStatsPlayer(player)),
					);
				}
				row.append(actions);
			}
			body.append(row);
		});
	}
	pagination.replaceChildren();
	if (players.length > playerStatsPageSize) {
		const previous = playerActionButton("Previous", "ghost", () => {
			playerStatsPage--;
			renderPlayerStatsTable();
		});
		previous.disabled = playerStatsPage <= 1;
		const next = playerActionButton("Next", "ghost", () => {
			playerStatsPage++;
			renderPlayerStatsTable();
		});
		next.disabled = playerStatsPage >= totalPages;
		const pageLabel = document.createElement("span");
		pageLabel.textContent = `Showing ${start + 1}-${Math.min(start + page.length, players.length)} of ${players.length} players`;
		pagination.append(previous, pageLabel, next);
	} else if (players.length) {
		const pageLabel = document.createElement("span");
		pageLabel.textContent = `Showing ${players.length} player${players.length === 1 ? "" : "s"}`;
		pagination.append(pageLabel);
	}
}
function playerActionButton(label, className, action) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = `player-action ${className}`;
	button.textContent = label;
	button.addEventListener("click", action);
	return button;
}
async function loadPlayerStats() {
	const status = $("playerStatsStatus");
	status.textContent = "Loading player statistics...";
	try {
		const result = await api("player_stats");
		if (!result || !Array.isArray(result.stats)) {
			throw new Error("The player statistics response is invalid.");
		}
		playerStatsData = result;
		playerStatsPage = 1;
		renderLeaderboards(result.leaderboards || {});
		renderPlayerStatsTable();
		status.textContent = result.stats.length
			? "Career statistics include completed matches only."
			: "No player statistics are available yet.";
	} catch (error) {
		playerStatsData = null;
		status.textContent = "Player statistics could not be loaded.";
		$("leaderboardGrid").replaceChildren();
		$("playerStatsBody").replaceChildren();
		$("playerStatsPagination").replaceChildren();
		const row = document.createElement("tr");
		const cell = document.createElement("td");
		cell.colSpan = isAdmin ? 10 : 9;
		cell.className = "player-stats-empty";
		cell.textContent = "Unable to display player statistics.";
		row.append(cell);
		$("playerStatsBody").append(row);
		showError(error.message);
	}
}
function showPlayerProfile(player) {
	const customContent = (container) => {
		const summary = document.createElement("div");
		summary.className = "player-profile-summary";
		const metrics = [
			["Matches", player.matches],
			["Runs", player.batting.runs],
			["High score", player.batting.hs_display],
			["Batting average", statNumber(player.batting.average)],
			["Strike rate", statNumber(player.batting.strike_rate)],
			["50s / 100s", `${player.batting.fifties} / ${player.batting.hundreds}`],
			["Wickets", player.bowling.wickets],
			["Best bowling", player.bowling.best_bowling],
			["Economy", statNumber(player.bowling.economy)],
		];
		metrics.forEach(([label, value]) => {
			const item = document.createElement("div");
			const heading = document.createElement("span");
			heading.textContent = label;
			const number = document.createElement("strong");
			number.textContent = statText(value);
			item.append(heading, number);
			summary.append(item);
		});
		container.append(summary);
		const log = [...(player.match_log || [])]
			.sort((a, b) => String(b.date).localeCompare(String(a.date)))
			.slice(0, 10);
		const logHeading = document.createElement("h3");
		logHeading.className = "player-profile-log-title";
		logHeading.textContent = "Recent match performances";
		container.append(logHeading);
		if (!log.length) {
			const empty = document.createElement("p");
			empty.className = "hint";
			empty.textContent = "No completed-match performances yet.";
			container.append(empty);
			return;
		}
		const list = document.createElement("ul");
		list.className = "player-match-log";
		log.forEach((entry) => {
			const item = document.createElement("li");
			const title = document.createElement("strong");
			title.textContent = statText(entry.title, "Match");
			const details = document.createElement("span");
			details.textContent = entry.type === "batting"
				? `Batting · ${entry.runs} runs from ${entry.balls} balls${entry.is_out ? "" : " not out"}`
				: `Bowling · ${entry.wickets} wickets, ${entry.runs_conceded} runs in ${entry.overs} overs (econ ${statNumber(entry.econ)})`;
			item.append(title, details);
			list.append(item);
		});
		container.append(list);
	};
	showModal({
		title: player.name,
		message: "Career totals and performances from completed matches.",
		confirmLabel: "Close",
		showCancel: false,
		customContent,
	});
}
async function addStatsPlayer(player) {
	const name = await showAddPlayerModal(player.name);
	if (name) {
		await loadCommonPlayers();
		await loadPlayerStats();
	}
}
async function editDirectoryPlayer(player) {
	let input;
	const warning = document.createElement("p");
	warning.className = "hint hidden";
	warning.setAttribute("role", "alert");
	const customContent = (container) => {
		const label = document.createElement("label");
		label.textContent = "Player name";
		input = document.createElement("input");
		input.type = "text";
		input.maxLength = 100;
		input.value = player.name;
		label.append(input);
		container.append(warning, label);
	};
	const ok = await showModal({
		title: "Edit player",
		message: "Update the player's directory name.",
		confirmLabel: "Save changes",
		showCancel: true,
		customContent,
		validate: () => {
			const name = formatPlayerName(input.value);
			if (!name) {
				warning.textContent = "Enter a player name.";
				warning.classList.remove("hidden");
				return false;
			}
			const duplicate = (playerStatsData.stats || []).some(
				(existing) =>
					Number(existing.id) !== Number(player.id) &&
					existing.name.toLowerCase() === name.toLowerCase(),
			);
			if (duplicate) {
				warning.textContent = "That player name is already in the directory.";
				warning.classList.remove("hidden");
				return false;
			}
			return true;
		},
	});
	if (!ok) return;
	try {
		await api("player_update", "POST", {
			id: player.id,
			name: formatPlayerName(input.value),
		});
		await loadCommonPlayers();
		await loadPlayerStats();
	} catch (error) {
		showError(error.message);
	}
}
async function toggleDirectoryPlayer(player) {
	try {
		await api("player_toggle_active", "POST", {
			id: player.id,
			is_active: Number(player.is_active) === 0,
		});
		await loadCommonPlayers();
		await loadPlayerStats();
	} catch (error) {
		showError(error.message);
	}
}
async function deleteDirectoryPlayer(player) {
	const ok = await showModal({
		title: "Delete player",
		message: `Delete ${player.name} from the player directory?`,
		confirmLabel: "Delete player",
		showCancel: true,
	});
	if (!ok) return;
	try {
		await api("player_delete", "POST", { id: player.id });
		await loadCommonPlayers();
		await loadPlayerStats();
	} catch (error) {
		showError(error.message);
	}
}
$("playerDirSearch").addEventListener("input", (event) => {
	playerStatsFilter = event.target.value;
	playerStatsPage = 1;
	if (playerStatsData) renderPlayerStatsTable();
});
$("addPlayerBtn").addEventListener("click", async () => {
	const name = await showAddPlayerModal();
	if (name) {
		await loadCommonPlayers();
		await loadPlayerStats();
	}
});

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
	const importBtn = $("importPrevMatch");
	if (importBtn) importBtn.classList.toggle("hidden", editingMatch);
	const notice = $("importMatchNotice");
	if (notice) notice.classList.add("hidden");
	if (!editingMatch) {
		$("teamA").value = "PAREL";
		$("teamB").value = "BNI";
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
		selectedRosterA = (state.roster_a || []).map(formatPlayerName);
		selectedRosterB = (state.roster_b || []).map(formatPlayerName);
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

function applyImportedMatch(prev) {
	if (!prev) return;
	// 1. Team names
	$("teamA").value = prev.team_a || "";
	$("teamB").value = prev.team_b || "";

	// 2. Number of players
	const pA = Math.max(2, Math.min(15, parseInt(prev.players_a || prev.players || 7, 10)));
	const pB = Math.max(2, Math.min(15, parseInt(prev.players_b || prev.players || 7, 10)));
	$("playersA").value = pA;
	$("playersB").value = pB;

	// 3. Selected players
	selectedRosterA = (prev.roster_a || []).map(formatPlayerName).slice(0, pA);
	selectedRosterB = (prev.roster_b || []).map(formatPlayerName).slice(0, pB);

	// 4. Over count
	$("overs").value = prev.overs_limit || 6;

	// 5. Toss (who bats first)
	const first = prev.batting_first === "B" ? "B" : "A";
	const tossRadio = document.querySelector('input[name="batting"][value="' + first + '"]');
	if (tossRadio) tossRadio.checked = true;

	syncTossPills();
	poolSearchA = "";
	poolSearchB = "";
	if ($("playerSearchA")) $("playerSearchA").value = "";
	if ($("playerSearchB")) $("playerSearchB").value = "";
	renderRosterChips();
}

async function importPreviousMatch() {
	if (!isAdmin) return;
	try {
		const r = await api("list");
		const matches = (r && r.matches) || [];
		if (!matches.length) {
			showError("No previous match found to import.");
			return;
		}

		const latest = matches[0];
		const s = latest.state || {};
		applyImportedMatch(s);

		const notice = $("importMatchNotice");
		if (notice) {
			const teamText = `${s.team_a || "Team A"} vs ${s.team_b || "Team B"}`;
			const tossTeam = s.batting_first === "B" ? (s.team_b || "Team B") : (s.team_a || "Team A");
			const pCountA = s.players_a || s.players || 7;
			const pCountB = s.players_b || s.players || 7;
			const detailsText = `${pCountA}v${pCountB} · ${s.overs_limit || 6} Ov · Toss: ${tossTeam}`;
			notice.innerHTML = `
				<span>✓ Imported previous match: <strong>${teamText}</strong> (${detailsText})</span>
				${matches.length > 1 ? '<button type="button" class="link-btn" id="chooseDiffMatchBtn">Choose different</button>' : ""}
			`;
			notice.classList.remove("hidden");
			const chooseBtn = $("chooseDiffMatchBtn");
			if (chooseBtn) {
				chooseBtn.onclick = () => showMatchPickerModal(matches);
			}
		}
	} catch (e) {
		showError(e.message || "Failed to import previous match.");
	}
}

function setSelectValue(el, val) {
	if (!el) return;
	el.value = val || "";
	if (el._choices) {
		try {
			const wasDisabled = el._choices.containerOuter && el._choices.containerOuter.isDisabled;
			if (wasDisabled) el._choices.enable();
			if (!val) {
				el._choices.removeActiveItems();
			} else {
				el._choices.setChoiceByValue(String(val));
			}
			if (wasDisabled) el._choices.disable();
		} catch (e) {
			console.warn("setSelectValue error:", e);
		}
	}
}

function setSelectDisabled(el, disabled) {
	if (!el) return;
	el.disabled = !!disabled;
	if (el._choices) {
		try {
			if (disabled) {
				el._choices.disable();
			} else {
				el._choices.enable();
			}
		} catch (e) {
			console.warn("setSelectDisabled error:", e);
		}
	}
}

function enhanceSelect(el, opts = {}) {
	if (!el || typeof Choices === "undefined") return el;
	if (el._choices) {
		try {
			el._choices.destroy();
		} catch (e) {}
		el._choices = null;
	}

	const searchEnabled = opts.searchEnabled !== undefined ? opts.searchEnabled : false;

	const instance = new Choices(el, {
		searchEnabled,
		searchResultLimit: -1,
		renderChoiceLimit: -1,
		itemSelectText: "",
		shouldSort: false,
		placeholder: true,
		placeholderValue: null,
		allowHTML: false,
		position: "auto",
		closeDropdownOnSelect: true,
		...opts,
	});

	el._choices = instance;

	// Override focus to open dropdown
	el.focus = () => {
		if (el._choices) {
			try {
				el._choices.showDropdown();
			} catch (e) {}
		}
	};

	// Smart flip & z-index elevation when dropdown opens
	el.addEventListener("showDropdown", () => {
		const row = el.closest(".modal-custom-row") || el.closest("div");
		if (row) row.style.zIndex = "50";

		const container = el._choices && el._choices.containerOuter && el._choices.containerOuter.element;
		if (container) {
			const rect = container.getBoundingClientRect();
			const dropdownNeededHeight = 270; // 7 items max height
			const spaceBelow = window.innerHeight - rect.bottom;
			const spaceAbove = rect.top;

			if (spaceBelow < dropdownNeededHeight && spaceAbove > spaceBelow) {
				container.classList.add("is-flipped");
			} else {
				container.classList.remove("is-flipped");
			}
		}

		if (el._choices) {
			const dropdown = el._choices.dropdown && el._choices.dropdown.element;
			if (dropdown) {
				const selectedEl = dropdown.querySelector(".choices__item--selectable.is-selected");
				if (selectedEl) {
					try {
						el._choices._highlightChoice(selectedEl);
					} catch (e) {}
				}
			}
		}
	});

	el.addEventListener("hideDropdown", () => {
		const row = el.closest(".modal-custom-row") || el.closest("div");
		if (row) row.style.zIndex = "";
		const container = el._choices && el._choices.containerOuter && el._choices.containerOuter.element;
		if (container) {
			container.classList.remove("is-flipped");
		}
	});

	return el;
}

async function showMatchPickerModal(matches) {
	let selectedIndex = -1;
	const customContent = (container) => {
		const wrap = document.createElement("div");
		wrap.style.cssText = "display:flex;flex-direction:column;gap:12px;text-align:left;";

		const lbl = document.createElement("label");
		lbl.style.cssText = "font-size:12px;font-weight:700;color:#3a5a7a;";
		lbl.textContent = "Select previous match to import *";

		const sel = document.createElement("select");
		sel.className = "app-select";
		sel.required = true;

		const defOpt = document.createElement("option");
		defOpt.value = "";
		defOpt.textContent = "Select any option";
		defOpt.disabled = true;
		defOpt.selected = true;
		sel.append(defOpt);

		matches.forEach((m, idx) => {
			const st = m.state || {};
			const opt = document.createElement("option");
			opt.value = idx;
			const tA = st.team_a || "Team A";
			const tB = st.team_b || "Team B";
			const ov = st.overs_limit || 6;
			const pA = st.players_a || st.players || 7;
			const pB = st.players_b || st.players || 7;
			const date = matchDayLabel(matchDayKey(m));
			opt.textContent = `${tA} vs ${tB} (${pA}v${pB}, ${ov} Ov) · ${date}${idx === 0 ? " (Latest)" : ""}`;
			sel.append(opt);
		});

		const previewBox = document.createElement("div");
		previewBox.style.cssText = "background:#f0f7ff;border:1px solid var(--line);border-radius:10px;padding:12px;font-size:12px;display:flex;flex-direction:column;gap:6px;";

		function updatePreview() {
			if (selectedIndex < 0 || !matches[selectedIndex]) {
				previewBox.innerHTML = '<span class="hint" style="margin:0;font-size:12px;color:var(--muted)">Please select a match from the dropdown above to preview details.</span>';
				return;
			}
			const m = matches[selectedIndex];
			const st = (m && m.state) || {};
			const tA = st.team_a || "Team A";
			const tB = st.team_b || "Team B";
			const pA = st.players_a || st.players || 7;
			const pB = st.players_b || st.players || 7;
			const rA = (st.roster_a || []).join(", ") || "None";
			const rB = (st.roster_b || []).join(", ") || "None";
			const tossTeam = st.batting_first === "B" ? tB : tA;
			previewBox.innerHTML = `
				<div><strong>Teams:</strong> ${tA} vs ${tB}</div>
				<div><strong>Players:</strong> ${pA} (${tA}) · ${pB} (${tB})</div>
				<div><strong>Overs:</strong> ${st.overs_limit || 6} overs per innings</div>
				<div><strong>Toss:</strong> ${tossTeam} bats first</div>
				<div style="color:var(--muted);margin-top:4px;"><strong>${tA} Roster:</strong> ${rA}</div>
				<div style="color:var(--muted);"><strong>${tB} Roster:</strong> ${rB}</div>
			`;
		}

		sel.onchange = () => {
			selectedIndex = sel.value === "" ? -1 : parseInt(sel.value, 10);
			updatePreview();
		};

		updatePreview();
		wrap.append(lbl, sel, previewBox);
		container.append(wrap);
		enhanceSelect(sel);
	};

	const ok = await showModal({
		title: "Import Match Info",
		message: "Choose which previous match to copy into this new match:",
		confirmLabel: "Import Selected",
		showCancel: true,
		showClose: true,
		customContent,
		validate: () => {
			if (selectedIndex < 0 || !matches[selectedIndex]) {
				showError("Please select a match to import.");
				return false;
			}
			return true;
		},
	});

	if (ok && selectedIndex >= 0 && matches[selectedIndex]) {
		const m = matches[selectedIndex];
		if (m && m.state) {
			applyImportedMatch(m.state);
			const notice = $("importMatchNotice");
			if (notice) {
				const s = m.state;
				const teamText = `${s.team_a || "Team A"} vs ${s.team_b || "Team B"}`;
				const tossTeam = s.batting_first === "B" ? (s.team_b || "Team B") : (s.team_a || "Team A");
				const pCountA = s.players_a || s.players || 7;
				const pCountB = s.players_b || s.players || 7;
				const detailsText = `${pCountA}v${pCountB} · ${s.overs_limit || 6} Ov · Toss: ${tossTeam}`;
				notice.innerHTML = `
					<span>✓ Imported match: <strong>${teamText}</strong> (${detailsText})</span>
					${matches.length > 1 ? '<button type="button" class="link-btn" id="chooseDiffMatchBtn">Change</button>' : ""}
				`;
				notice.classList.remove("hidden");
				const chooseBtn = $("chooseDiffMatchBtn");
				if (chooseBtn) {
					chooseBtn.onclick = () => showMatchPickerModal(matches);
				}
			}
		}
	}
}
$("playersA").addEventListener("input", () => {
	renderRosterChips();
});
$("playersB").addEventListener("input", () => {
	renderRosterChips();
});
[
	{ side: "A", searchId: "playerSearchA", addId: "addPlayerToRosterA", autoId: "autoFillA" },
	{ side: "B", searchId: "playerSearchB", addId: "addPlayerToRosterB", autoId: "autoFillB" },
].forEach(({ side, searchId, addId, autoId }) => {
	$(searchId).addEventListener("input", (event) => {
		if (side === "A") poolSearchA = event.target.value;
		else poolSearchB = event.target.value;
		renderRosterChips();
	});
	$(searchId).addEventListener("keydown", (event) => {
		if (event.key !== "Enter") return;
		event.preventDefault();
		handleAddChipInput(side);
	});
	$(addId).addEventListener("click", () => handleAddChipInput(side));
	$(autoId).addEventListener("click", () => autoFillRoster(side));
});
$("newMatch").onclick = async () => {
	if (!isAdmin) return;
	stopPoll();
	editingMatch = false;
	setRoute("setup-create");
	fillSetup("create");
};
$("updateMatch").onclick = async () => {
	if (!isAdmin || !current || !state || state.status === "complete") return;
	stopPoll();
	setRoute("setup-edit", current);
	fillSetup("update");
};
const importPrevBtn = $("importPrevMatch");
if (importPrevBtn) {
	importPrevBtn.onclick = importPreviousMatch;
}
$("cancelSetup").onclick = () => {
	history.back();
};
$("back").onclick = () => {
	goBackToMatches();
};
function syncTossPills() {
	const a = ($("teamA").value.trim() || "Team A").toUpperCase();
	const b = ($("teamB").value.trim() || "Team B").toUpperCase();
	$("pillA").textContent = a;
	$("pillB").textContent = b;
	renderRosterChips();
}
$("teamA").addEventListener("input", syncTossPills);
$("teamB").addEventListener("input", syncTossPills);

$("setupForm").onsubmit = async (e) => {
	e.preventDefault();
	const notice = $("importMatchNotice");
	if (notice) notice.classList.add("hidden");
	try {
		const tossChecked = document.querySelector('input[name="batting"]:checked');
		const batting = tossChecked ? tossChecked.value : (state && state.batting_first) || "A";
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
			overs: parseInt($("overs").value, 10) || 6,
			batting_first: batting,
		};
		if (editingMatch && current) {
			const matchId = current;
			const r = await api("update", "POST", body, matchId);
			state = r.state;
			matchSeriesScore = null;
			editingMatch = false;
			setRoute("score", current, "replace");
			$("setupView").classList.add("hidden");
			$("scoreView").classList.remove("hidden");
			headerMode();
			render();
			refreshMatchSeriesScore(current);
			startViewerPoll();
		} else {
			const r = await api("create", "POST", body);
			await openMatch(r.id, "replace");
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
function seriesTeamKey(name) {
	return String(name || "").trim().toLocaleLowerCase();
}
function matchSeriesKey(match) {
	const state = match.state || {};
	return JSON.stringify(
		[state.team_a, state.team_b].map(seriesTeamKey).sort(),
	);
}
function seriesSummary(matches) {
	const firstState = matches[0].state || {};
	const teams = [
		{ name: String(firstState.team_a || "Team A"), key: seriesTeamKey(firstState.team_a) },
		{ name: String(firstState.team_b || "Team B"), key: seriesTeamKey(firstState.team_b) },
	];
	const wins = [0, 0];
	let allComplete = true;

	matches.forEach((match) => {
		const state = match.state || {};
		if (state.status !== "complete") {
			allComplete = false;
			return;
		}
		const winner = seriesTeamKey(state.result && state.result.winner);
		const winnerIndex = teams.findIndex((team) => team.key === winner);
		if (winner && winnerIndex !== -1) wins[winnerIndex]++;
	});

	const score = wins[0] + " - " + wins[1];
	if (!allComplete) {
		return {
			teams,
			result: (wins[0] === wins[1] ? "Series in progress · " : "Series lead · ") + score,
			complete: false,
		};
	}
	if (wins[0] === wins[1]) {
		return { teams, result: "Series tied · " + score, complete: true };
	}
	const winnerIndex = wins[0] > wins[1] ? 0 : 1;
	return {
		teams,
		result: teams[winnerIndex].name + " won series · " + score,
		complete: true,
	};
}
function seriesScoreForMatch(matches, matchId, currentState) {
	const savedMatch = matches.find((match) => String(match.id) === String(matchId));
	const matchDay = matchDayKey(savedMatch || { state: currentState });
	const currentSeriesKey = matchSeriesKey({ state: currentState });
	const teamA = seriesTeamKey(currentState.team_a);
	const teamB = seriesTeamKey(currentState.team_b);
	const wins = [0, 0];

	matches.forEach((match) => {
		const matchState = match.state || {};
		if (
			matchDayKey(match) !== matchDay ||
			matchSeriesKey(match) !== currentSeriesKey ||
			matchState.status !== "complete"
		)
			return;
		const winner = seriesTeamKey(matchState.result && matchState.result.winner);
		if (winner && winner === teamA) wins[0]++;
		else if (winner && winner === teamB) wins[1]++;
	});

	return wins.join("-");
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

		if (s.innings === 2 && !done) {
			const target = s.target || (s.innings_1 && s.innings_1.total !== undefined ? s.innings_1.total + 1 : null);
			if (target) {
				const need = Math.max(0, target - st.total);
				const totalBalls = (s.overs_limit || 0) * 6;
				const ballsLeft = totalBalls > 0 ? Math.max(0, totalBalls - st.legal) : 0;
				const needTag = document.createElement("span");
				needTag.className = "match-need-pill";
				needTag.title = `Target: ${target} runs`;
				needTag.innerHTML = ballsLeft > 0
					? `Need <strong>${need}</strong> from <strong>${ballsLeft}</strong>b`
					: `Need <strong>${need}</strong> runs`;
				sub.append(needTag);
			}
		}

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
function makeSeriesGroup(matches) {
	const summary = seriesSummary(matches);
	const series = document.createElement("section");
	series.className = "match-series";

	const heading = document.createElement("div");
	heading.className = "match-series-heading";
	const teams = document.createElement("strong");
	teams.className = "match-series-teams";
	teams.textContent = summary.teams[0].name + " vs " + summary.teams[1].name;
	const result = document.createElement("span");
	result.className =
		"match-series-result" + (summary.complete ? "" : " in-progress");
	result.textContent = summary.result;
	heading.append(teams, result);
	series.append(heading);
	matches.forEach((match) => series.append(makeMatchCard(match)));
	return series;
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
			const seriesGroups = new Map();
			groups[key].forEach((match) => {
				const seriesKey = matchSeriesKey(match);
				if (!seriesGroups.has(seriesKey)) seriesGroups.set(seriesKey, []);
				seriesGroups.get(seriesKey).push(match);
			});
			seriesGroups.forEach((matches) => body.append(makeSeriesGroup(matches)));
			details.append(body);
			$("matchList").append(details);
		});
	} catch (e) {
		showError(e.message);
	}
}
async function refreshMatchSeriesScore(matchId = current) {
	if (!matchId || !state) return;
	try {
		const r = await api("list");
		if (String(current) !== String(matchId) || !state) return;
		matchSeriesScore = seriesScoreForMatch(r.matches, matchId, state);
		$("matchTitle").textContent = matchTitleText(state);
	} catch (error) {
		if (String(current) !== String(matchId) || !state) return;
		matchSeriesScore = null;
		$("matchTitle").textContent = matchTitleText(state);
		await showError(error.message);
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
async function openMatch(id, historyMode = "push") {
	const r = await api("get", "GET", null, id);
	current = id;
	state = r.state;
	matchSeriesScore = null;
	editingMatch = false;
	setPendingExtra("");
	Object.keys(overSectionOpen).forEach((k) => delete overSectionOpen[k]);
	lastOverInnings = state ? state.innings : null;
	lastOverComplete = state ? isComplete() : null;
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
	refreshMatchSeriesScore(id);
	if (historyMode) rememberMatch(id, historyMode);
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
function battingSide(matchState = state) {
	if (!matchState) return "A";
	const first = matchState.batting_first === "B" ? "B" : "A";
	return Number(matchState.innings) === 2 ? (first === "A" ? "B" : "A") : first;
}
function battingTeamName() {
	return battingSide() === "B" ? state.team_b : state.team_a;
}
function bowlingSide(matchState = state) {
	return battingSide(matchState) === "B" ? "A" : "B";
}
function bowlingTeamName() {
	return bowlingSide() === "B" ? state.team_b : state.team_a;
}
function teamRoster(side, matchState = state) {
	if (!matchState) return [];
	const normalizedSide = side === "B" ? "B" : "A";
	const count = Math.max(
		1,
		Number(
			normalizedSide === "B"
				? matchState.players_b || matchState.players || 7
				: matchState.players_a || matchState.players || 7,
		),
	);
	const roster = Array.isArray(matchState[`roster_${normalizedSide.toLowerCase()}`])
		? matchState[`roster_${normalizedSide.toLowerCase()}`]
		: [];
	return Array.from({ length: count }, (_, index) =>
		formatPlayerName(roster[index] || `Player ${index + 1}`),
	);
}
function battingRoster(matchState = state) {
	return teamRoster(battingSide(matchState), matchState);
}
function bowlingRoster(matchState = state) {
	return teamRoster(bowlingSide(matchState), matchState);
}
function maxWicketsForSide(side, matchState = state) {
	return teamRoster(side, matchState).length;
}
function maxWickets(matchState = state) {
	return maxWicketsForSide(battingSide(matchState), matchState);
}
function dismissedPlayers(deliveries = state && state.deliveries) {
	return new Set(
		(deliveries || [])
			.filter((delivery) => delivery && delivery.wicket)
			.map((delivery) =>
				formatPlayerName(
					String(
						delivery.dismissed_player ||
							delivery.batter ||
							delivery.striker ||
							"",
					),
				),
			)
			.filter(Boolean),
	);
}
function hasValidInningsOpeners(matchState = state) {
	if (!matchState || !matchState.openers) return false;
	if (Number(matchState.openers_innings) !== Number(matchState.innings)) return false;
	const roster = new Set(battingRoster(matchState));
	const out = dismissedPlayers(matchState.deliveries);
	const striker = formatPlayerName(matchState.openers.striker || "");
	const nonStriker = formatPlayerName(matchState.openers.non_striker || "");
	return (
		!!striker &&
		!!nonStriker &&
		striker !== nonStriker &&
		roster.has(striker) &&
		roster.has(nonStriker) &&
		!out.has(striker) &&
		!out.has(nonStriker)
	);
}
function isCreaseValidForCurrentInnings(matchState = state) {
	if (!matchState || !matchState.crease || isComplete()) return false;
	const crease = matchState.crease;
	const batting = new Set(battingRoster(matchState));
	const bowling = new Set(bowlingRoster(matchState));
	const out = dismissedPlayers(matchState.deliveries);
	const striker = formatPlayerName(crease.striker || "");
	const nonStriker = formatPlayerName(crease.non_striker || "");
	const bowler = formatPlayerName(crease.bowler || "");
	if (!striker || !bowler || !batting.has(striker) || !bowling.has(bowler)) return false;
	if (out.has(striker) || (nonStriker && out.has(nonStriker))) return false;
	if (nonStriker && (nonStriker === striker || !batting.has(nonStriker))) return false;
	return !!nonStriker || battingRoster(matchState).filter((player) => !out.has(player)).length <= 1;
}
async function ensureCreaseInitialized() {
	if (!state || isComplete()) return false;
	if (isCreaseValidForCurrentInnings()) return true;
	return openInningsOpenerModal();
}
function matchTitleText(s) {
	const a = s.players_a || s.players || 7;
	const b = s.players_b || s.players || 7;
	const title = (
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
	return title + (matchSeriesScore === null ? "" : " (" + matchSeriesScore + ")");
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
		const bat = formatPlayerName(String(d.batter || d.striker || 1)),
			bow = formatPlayerName(String(d.bowler || 1));
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
			const outPlayer = formatPlayerName(String(
				d.dismissed_player || d.batter || d.striker || 1,
			));
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
			const b = formatPlayerName(String(ov.balls[0].bowler || 1));
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
function makeChip(d, onEdit = null) {
	const chip = document.createElement(onEdit ? "button" : "span");
	chip.className = chipClass(d) + (onEdit ? " editable" : "");
	if (onEdit) {
		chip.type = "button";
		chip.title = "Edit delivery";
		chip.setAttribute("aria-label", "Edit delivery: " + ballNote(d));
		chip.onclick = onEdit;
	}
	chip.textContent = ballNote(d);
	return chip;
}
function groupOvers(deliveries) {
	const overs = [];
	let balls = [];
	let indices = [];
	let legal = 0;
	(deliveries || []).forEach((d, index) => {
		balls.push(d);
		indices.push(index);
		if (isLegalBall(d)) {
			legal++;
			if (legal === 6) {
				overs.push({ balls, indices, complete: true });
				balls = [];
				indices = [];
				legal = 0;
			}
		}
	});
	if (balls.length) overs.push({ balls, indices, complete: false });
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
	inningsNumber,
	canEdit,
) {
	const details = document.createElement("details");
	details.className = "over-team";
	details.open = sectionIsOpen(key, defaultOpen);
	details.addEventListener("toggle", () => {
		if (details.open) {
			el.querySelectorAll(".over-team[open]").forEach((other) => {
				if (other === details) return;
				other.open = false;
				overSectionOpen[other.dataset.sectionKey] = false;
			});
		}
		overSectionOpen[key] = details.open;
	});
	details.dataset.sectionKey = key;
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
		if (canEdit) {
			const hint = document.createElement("p");
			hint.className = "hint edit-delivery-hint";
			hint.textContent = "Tap any ball to edit its delivery.";
			body.append(hint);
		}
		for (let i = overs.length - 1; i >= 0; i--) {
			const ov = overs[i];
			const card = document.createElement("div");
			card.className =
				"over-card" + (markCurrent && !ov.complete ? " current" : "");
			const h = document.createElement("div");
			h.className = "over-card-head";
			const title = document.createElement("h3");
			const bowlersInOver = [
				...new Set(
					(ov.balls || [])
						.map((d) => (d && d.bowler ? formatPlayerName(d.bowler) : ""))
						.filter(Boolean),
				),
			];
			const bowlerName = bowlersInOver.length
				? bowlersInOver.join(" / ")
				: (markCurrent &&
						!ov.complete &&
						state &&
						state.crease &&
						state.crease.bowler
						? formatPlayerName(state.crease.bowler)
						: "") || "";
			title.textContent = bowlerName
				? `${bowlerName} (Over ${i + 1})${markCurrent && !ov.complete ? " · current" : ""}`
				: `Over ${i + 1}${markCurrent && !ov.complete ? " · current" : ""}`;
			const runs = document.createElement("span");
			runs.textContent = overRuns(ov.balls) + " runs";
			h.append(title, runs);
			const chips = document.createElement("div");
			chips.className = "over-card-balls";
			ov.balls.forEach((d, ballIndex) => {
				const onEdit = canEdit
					? () => editDelivery(inningsNumber, ov.indices[ballIndex], d)
					: null;
				chips.append(makeChip(d, onEdit));
			});
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
	const complete = isComplete();
	if (
		lastOverInnings !== state.innings ||
		lastOverComplete !== complete
	) {
		Object.keys(overSectionOpen).forEach((k) => delete overSectionOpen[k]);
		lastOverInnings = state.innings;
		lastOverComplete = complete;
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
		!complete,
		state.innings,
		isAdmin && !state.locked && !complete,
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
			1,
			isAdmin && !state.locked && !complete,
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
	if (activeScoreTab === tab) return;
	activeScoreTab = tab;
	if (current && !isNavigatingHistory) {
		const tabHash = tab === "scorecard" ? "&tab=scorecard" : "";
		pushNavState({ page: "match", matchId: current, tab }, "#m=" + current + tabHash, true);
	}
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
	openers = null,
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

	(batRoster || []).forEach((rawName) => {
		const name = formatPlayerName(rawName);
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

	(bowRoster || []).forEach((rawName) => {
		const name = formatPlayerName(rawName);
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

	if (openers && (isLive || (deliveries && deliveries.length > 0))) {
		const opS = formatPlayerName(openers.striker);
		const opNs = formatPlayerName(openers.non_striker);
		if (opS && batting[opS]) {
			batting[opS].hasBatted = true;
		}
		if (opNs && batting[opNs]) {
			batting[opNs].hasBatted = true;
		}
	}

	(deliveries || []).forEach((d) => {
		const bat = formatPlayerName(d.batter || d.striker);
		const ns = formatPlayerName(d.non_striker);
		const bow = formatPlayerName(d.bowler);
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
			const outPerson = formatPlayerName(d.dismissed_player || d.batter || d.striker);
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
			const nextB = formatPlayerName(d.next_batter);
			if (nextB && batting[nextB]) {
				batting[nextB].hasBatted = true;
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
		const crS = formatPlayerName(crease.striker);
		const crNs = formatPlayerName(crease.non_striker);
		if (crS && batting[crS]) {
			batting[crS].hasBatted = true;
			if (!batting[crS].isOut) {
				batting[crS].dismissal = "batting";
			}
		}
		if (crNs && batting[crNs]) {
			batting[crNs].hasBatted = true;
			if (!batting[crNs].isOut) {
				batting[crNs].dismissal = "not out";
			}
		}
	}

	const battingOrder = [];
	const seenBatters = new Set();
	const addBatter = (name) => {
		const formatted = formatPlayerName(name);
		if (!formatted || seenBatters.has(formatted)) return;
		if (batting[formatted] && batting[formatted].hasBatted) {
			seenBatters.add(formatted);
			battingOrder.push(formatted);
		}
	};

	if (openers) {
		addBatter(openers.striker);
		addBatter(openers.non_striker);
	}

	(deliveries || []).forEach((d) => {
		const s = d.striker || d.batter || (d.crease_before && d.crease_before.striker);
		const ns = d.non_striker || (d.crease_before && d.crease_before.non_striker);
		addBatter(s);
		addBatter(ns);
		if (d.dismissed_player) addBatter(d.dismissed_player);
		if (d.next_batter) addBatter(d.next_batter);
		if (d.crease_after) {
			addBatter(d.crease_after.striker);
			addBatter(d.crease_after.non_striker);
		}
	});

	if (crease) {
		addBatter(crease.striker);
		addBatter(crease.non_striker);
	}

	Object.keys(batting).forEach((name) => {
		addBatter(name);
	});

	const didNotBat = [];
	(batRoster || []).forEach((rawName) => {
		const formatted = formatPlayerName(rawName);
		if (!seenBatters.has(formatted)) {
			didNotBat.push(formatted);
		}
	});

	const bowlingOrder = [];
	const seenBowlers = new Set();
	const addBowler = (name) => {
		const formatted = formatPlayerName(name);
		if (!formatted || seenBowlers.has(formatted)) return;
		if (bowling[formatted]) {
			seenBowlers.add(formatted);
			bowlingOrder.push(formatted);
		}
	};
	if (openers && openers.bowler) addBowler(openers.bowler);
	(deliveries || []).forEach((d) => {
		if (d.bowler) addBowler(d.bowler);
	});
	if (crease && crease.bowler) addBowler(crease.bowler);
	(bowRoster || []).forEach((rawName) => addBowler(rawName));

	const oversGrouped = groupOvers(deliveries || []);
	oversGrouped.forEach((ov) => {
		if (ov.complete && ov.balls.length > 0) {
			const b = ov.balls[0].bowler;
			if (overRuns(ov.balls) === 0 && bowling[b]) {
				bowling[b].maidens++;
			}
		}
	});

	const maxW = Math.max(1, batRoster ? batRoster.length : 7);
	const isAllOut = totalWickets >= maxW;

	return {
		batting,
		bowling,
		extras,
		fow,
		totalRuns,
		totalWickets,
		legalBalls,
		batRoster,
		battingOrder,
		bowlingOrder,
		didNotBat,
		isAllOut,
	};
}
function renderScorecardHTML(title, data, isOpen, inningsKey) {
	const rr =
		data.legalBalls > 0
			? (data.totalRuns / (data.legalBalls / 6)).toFixed(2)
			: "0.00";
	const allOutBadge = data.isAllOut ? " · All Out" : "";
	let html = `
		<details class="over-team scorecard-innings" name="scorecard-accordion" data-innings="${inningsKey}" ${isOpen ? "open" : ""}>
			<summary class="over-team-summary scorecard-innings-head">
				<span class="over-team-name">${title}</span>
				<span class="over-team-score">${data.totalRuns}/${data.totalWickets} (${oversText(data.legalBalls)} Ov${allOutBadge})</span>
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

	(data.battingOrder || []).forEach((name) => {
		const b = data.batting[name];
		if (b && b.hasBatted) {
			const sr = b.balls > 0 ? ((b.runs / b.balls) * 100).toFixed(1) : "0.0";
			html += `
				<tr>
					<td class="sc-col-player">
						<span class="sc-player-name">${formatPlayerName(b.name)}${!b.isOut ? "*" : ""}</span>
						<span class="sc-dismissal">${b.dismissal}</span>
					</td>
					<td class="sc-num"><strong>${b.runs}</strong></td>
					<td class="sc-num">${b.balls}</td>
					<td class="sc-num">${b.fours}</td>
					<td class="sc-num">${b.sixes}</td>
					<td class="sc-num">${sr}</td>
				</tr>
			`;
		}
	});

	const didNotBat = (data.didNotBat || []).map(formatPlayerName);

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
					`<span class="sc-fow-item"><strong>${f.score}-${f.wicketNum}</strong> (${formatPlayerName(f.player)}, ${f.over} ov)</span>`,
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

	const bowlersWhoBowled = (data.bowlingOrder || Object.keys(data.bowling))
		.map((name) => data.bowling[name])
		.filter((b) => b && (b.balls > 0 || b.wides > 0 || b.noBalls > 0 || b.runs > 0));

	if (!bowlersWhoBowled.length) {
		html += `<tr><td colspan="8" class="hint" style="text-align:center">No bowling figures recorded yet.</td></tr>`;
	} else {
		bowlersWhoBowled.forEach((b) => {
			const ov = oversText(b.balls);
			const econ = b.balls > 0 ? (b.runs / (b.balls / 6)).toFixed(2) : "0.00";
			html += `
				<tr>
					<td class="sc-col-player"><strong>${formatPlayerName(b.name)}</strong></td>
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
		const i1Openers = i1.openers || null;
		const i1Data = computeInningsScorecard(
			i1.deliveries || [],
			i1BatRoster,
			i1BowRoster,
			i1.crease,
			false,
			i1Openers,
		);
		const i1Title = `Innings 1: ${i1.team || teamName(state, i1Side)}`;
		const isI1Open = openScorecardInningsKey === "innings-1";
		fullHTML += renderScorecardHTML(i1Title, i1Data, isI1Open, "innings-1");
	}

	const curSide = battingSide();
	const curBatRoster = battingRoster();
	const curBowRoster = bowlingRoster();
	const curOpeners =
		state.openers && Number(state.openers_innings) === Number(state.innings)
			? state.openers
			: null;
	const curData = computeInningsScorecard(
		state.deliveries || [],
		curBatRoster,
		curBowRoster,
		state.crease,
		!isComplete(),
		curOpeners,
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
	const maxW = maxWickets(state);
	const isAllOut = c.w >= maxW;
	$("sbOvers").textContent = oversText(c.legal) + (isAllOut ? " · All Out" : "");
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
	$("actionMessage").classList.toggle("hidden", isComplete());
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
	const deliveries = state.deliveries || [];
	const hasOpeners = hasValidInningsOpeners();
	const hasCrease = isCreaseValidForCurrentInnings();
	if (deliveries.length === 0 && !hasOpeners && !hasCrease) {
		hud.classList.add("hidden");
		return;
	}
	const cr = state.crease || {};
	const sName = cr.striker ? formatPlayerName(cr.striker) : "";
	const isLone = !cr.non_striker;
	const nsName = isLone ? "" : (cr.non_striker ? formatPlayerName(cr.non_striker) : "");
	const bName = cr.bowler ? formatPlayerName(cr.bowler) : "";
	if (!sName) {
		hud.classList.add("hidden");
		return;
	}
	hud.classList.remove("hidden");
	const c = calc();

	const sStat = c.batBalls[sName] || { r: 0, b: 0, f: 0, s: 0 };
	const nsStat = nsName ? (c.batBalls[nsName] || { r: 0, b: 0, f: 0, s: 0 }) : { r: 0, b: 0, f: 0, s: 0 };
	const bStat = bName ? (c.bowl[bName] || { r: 0, w: 0, b: 0, maidens: 0 }) : null;

	$("strikerName").textContent = sName;
	$("strikerStat").textContent = `${sStat.r} (${sStat.b}) · 4s: ${sStat.f} · 6s: ${sStat.s}`;

	const nonStrikerRow = $("nonStrikerRow");
	if (nonStrikerRow) {
		nonStrikerRow.classList.toggle("hidden", isLone);
		if (!isLone) {
			$("nonStrikerName").textContent = nsName;
			$("nonStrikerStat").textContent = `${nsStat.r} (${nsStat.b}) · 4s: ${nsStat.f} · 6s: ${nsStat.s}`;
		}
	}

	if (bName && bStat) {
		const bOvers = oversText(bStat.b);
		const econ = bStat.b > 0 ? ((bStat.r / bStat.b) * 6).toFixed(2) : "0.00";
		$("bowlerName").textContent = bName;
		$("bowlerStat").textContent = `${bOvers} - ${bStat.maidens || 0} - ${bStat.r} - ${bStat.w} · Econ: ${econ}`;
	} else {
		$("bowlerName").textContent = "Select Bowler";
		$("bowlerStat").textContent = "Tap Change to pick next bowler";
	}

	$("swapStrikeBtn").classList.toggle("hidden", !isAdmin || isComplete() || isLone);
	$("changeBowlerBtn").classList.toggle("hidden", !isAdmin || isComplete());
	const changeBatBtn = $("changeBattersBtn");
	if (changeBatBtn)
		changeBatBtn.classList.toggle("hidden", !isAdmin || isComplete() || isLone);
}
let modalResolve = null;
let modalValidate = null;
let modalCancelCallback = null;
let modalHistoryActive = false;
let isClosingModalFromPopstate = false;
let isClosingModalFromUI = false;
let isNavigatingHistory = false;
let modalReturnFocus = null;
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
function closeModal(ok, keepHistory = false) {
	const modal = $("modal");
	const activeElement = document.activeElement;
	if (modal.contains(activeElement)) {
		if (!keepHistory && modalReturnFocus && modalReturnFocus.isConnected) {
			modalReturnFocus.focus();
		} else if (activeElement && typeof activeElement.blur === "function") {
			activeElement.blur();
		}
	}
	if (!keepHistory) modalReturnFocus = null;
	modal.classList.add("hidden");
	modal.setAttribute("aria-hidden", "true");
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
		customEl.querySelectorAll("select").forEach((s) => {
			if (s._choices) {
				try { s._choices.destroy(); } catch (e) {}
				s._choices = null;
			}
		});
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
	const fieldsEl = $("modalFields");
	if (fieldsEl) {
		fieldsEl.classList.remove("overthrow-mode", "wide-nb-mode");
	}
	const wicketRow = $("modalWicketRow");
	if (wicketRow) {
		wicketRow.classList.remove("is-checked");
	}
	const wicketBox = $("modalWicket");
	if (wicketBox) {
		wicketBox.checked = false;
	}
	const cancelCb = modalCancelCallback;
	modalCancelCallback = null;
	if (!ok && typeof cancelCb === "function") {
		try {
			cancelCb();
		} catch (e) {}
	}
	if (modalResolve) {
		const r = modalResolve;
		modalResolve = null;
		modalValidate = null;
		r(!!ok);
	}
	if (modalHistoryActive && !isClosingModalFromPopstate && !keepHistory) {
		modalHistoryActive = false;
		isClosingModalFromUI = true;
		history.back();
	} else if (!keepHistory) {
		modalHistoryActive = false;
	}
}
function showModal({
	title,
	message,
	messageHtml = null,
	confirmLabel = "OK",
	showCancel = false,
	cancelLabel = "Cancel",
	onCancel = null,
	showClose = null,
	fields = false,
	balls = null,
	overNumber = 0,
	qr = null,
	customContent = null,
	modalClass = "",
	validate = null,
}) {
	const modal = $("modal");
	if (!modalHistoryActive) {
		const activeElement = document.activeElement;
		modalReturnFocus = activeElement instanceof HTMLElement && !modal.contains(activeElement)
			? activeElement
			: null;
	}
	modalValidate = validate || null;
	modalCancelCallback = onCancel || null;
	const modalCard = $("modal") ? $("modal").querySelector(".modal-card") : null;
	if (modalCard) {
		modalCard.className = "modal-card" + (modalClass ? " " + modalClass : "");
	}
	if ($("modalTitle")) {
		$("modalTitle").textContent = title || "";
		$("modalTitle").classList.toggle("hidden", !title);
	}
	if ($("modalMessage")) {
		if (messageHtml) {
			$("modalMessage").innerHTML = messageHtml;
		} else {
			$("modalMessage").textContent = message || "";
		}
	}
	$("modalOk").textContent = confirmLabel;
	const isClose = showClose !== null ? !!showClose : showCancel || !!qr;
	$("modalClose").classList.toggle("hidden", !isClose);
	const cancelBtn = $("modalCancel");
	if (cancelBtn) {
		cancelBtn.textContent = cancelLabel || "Cancel";
		cancelBtn.classList.toggle("hidden", !showCancel);
	}
	$("modalFields").classList.toggle("hidden", !fields);
	const customEl = $("modalCustom");
	if (customEl) {
		customEl.querySelectorAll("select").forEach((s) => {
			if (s._choices) {
				try { s._choices.destroy(); } catch (e) {}
				s._choices = null;
			}
		});
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
		const isWideNb = $("modalFields").classList.contains("wide-nb-mode");
		if (isWideNb) {
			document.querySelectorAll('input[name="modalAddon"]').forEach((r) => {
				r.checked = false;
				r._wasChecked = false;
				const parentOpt = r.closest(".modal-addon-opt");
				if (parentOpt) parentOpt.classList.remove("is-checked");
			});
		} else {
			const val = ovr ? "1" : "0";
			document.querySelectorAll('input[name="modalAddon"]').forEach((r) => {
				const isTarget = r.value === val;
				r.checked = isTarget;
				r._wasChecked = isTarget;
				const parentOpt = r.closest(".modal-addon-opt");
				if (parentOpt) parentOpt.classList.toggle("is-checked", isTarget);
			});
		}
		$("modalAddonLabel").textContent = ovr ? "Runs completed" : "Add-on runs";
	}
	$("modal").dataset.allowDismiss =
		showCancel || qr || isClose ? "1" : "0";
	modal.classList.remove("hidden");
	modal.setAttribute("aria-hidden", "false");
	document.addEventListener("keydown", modalKey);
	if (!modalHistoryActive && !isNavigatingHistory) {
		modalHistoryActive = true;
		history.pushState({ ...(history.state || {}), isModal: true }, "");
	}
	const focusTarget =
		($("modalCustom") && !$("modalCustom").classList.contains("hidden")
			? $("modalCustom").querySelector('input:not([type="hidden"]), select, textarea, button:not(.hidden)')
			: null) || $("modalOk");
	requestAnimationFrame(() => {
		if (!modal.classList.contains("hidden")) focusTarget.focus();
	});
	return new Promise((res) => {
		modalResolve = res;
	});
}
function addPlayerSelect(container, label, players, options = {}) {
	const row = document.createElement("div");
	row.className = "modal-custom-row";
	const labelEl = document.createElement("label");
	labelEl.textContent = label;
	const select = document.createElement("select");
	select.className = "app-select";
	select.required = options.required !== false;
	const placeholder = document.createElement("option");
	placeholder.value = "";
	placeholder.textContent = options.emptyLabel || "Select a player";
	placeholder.disabled = select.required && !options.allowEmpty;
	placeholder.selected = true;
	select.append(placeholder);
	(players || []).forEach((player) => {
		const option = document.createElement("option");
		option.value = player;
		option.textContent = player;
		select.append(option);
	});
	row.append(labelEl, select);
	container.append(row);
	if (options.value && (players || []).includes(options.value)) {
		select.value = options.value;
	}
	enhanceSelect(select, { searchEnabled: (players || []).length > 8 });
	return select;
}
async function saveCrease(crease, setAsOpeners = false) {
	const payload = { ...crease };
	if (setAsOpeners) payload.set_as_openers = true;
	const result = await api("set_crease", "POST", payload, current);
	state = result.state;
	render();
}
async function openInningsOpenerModal() {
	if (!isAdmin || !current || !state || isComplete()) return false;
	const dismissed = dismissedPlayers();
	const batters = battingRoster().filter((player) => !dismissed.has(player));
	const bowlers = bowlingRoster();
	if (!batters.length || !bowlers.length) {
		await showError("No available batters or bowlers to start this innings.");
		return false;
	}

	let strikerSelect;
	let nonStrikerSelect;
	let bowlerSelect;
	const warning = document.createElement("p");
	warning.className = "hint hidden";
	warning.setAttribute("role", "alert");
	warning.textContent = "Choose two different batters.";
	const currentCrease = state.crease || state.openers || {};
	const customContent = (container) => {
		container.append(warning);
		strikerSelect = addPlayerSelect(container, "Striker *", batters, {
			value: currentCrease.striker,
		});
		nonStrikerSelect = addPlayerSelect(
			container,
			"Non-striker" + (batters.length > 1 ? " *" : ""),
			batters,
			{
				value: currentCrease.non_striker,
				required: batters.length > 1,
				allowEmpty: batters.length <= 1,
				emptyLabel: batters.length > 1 ? "Select a player" : "No non-striker",
			},
		);
		bowlerSelect = addPlayerSelect(container, "Bowler *", bowlers, {
			value: currentCrease.bowler,
		});
	};
	const ok = await showModal({
		title: `Innings ${state.innings} openers`,
		message: "Select the batters and bowler to start this innings.",
		confirmLabel: "Start innings",
		showCancel: true,
		customContent,
		validate: () => {
			if (
				nonStrikerSelect.value &&
				nonStrikerSelect.value === strikerSelect.value
			) {
				warning.classList.remove("hidden");
				return false;
			}
			return true;
		},
	});
	if (!ok) return false;
	try {
		await saveCrease(
			{
				striker: strikerSelect.value,
				non_striker: nonStrikerSelect.value,
				bowler: bowlerSelect.value,
			},
			true,
		);
		return true;
	} catch (error) {
		await showError(error.message);
		return false;
	}
}
async function changeBattersModal() {
	if (!isAdmin || !current || !state || isComplete()) return;
	if (!(await ensureCreaseInitialized())) return;
	const dismissed = dismissedPlayers();
	const batters = battingRoster().filter((player) => !dismissed.has(player));
	if (batters.length < 2) {
		await showError("There are not two available batters to change.");
		return;
	}

	let strikerSelect;
	let nonStrikerSelect;
	const warning = document.createElement("p");
	warning.className = "hint hidden";
	warning.setAttribute("role", "alert");
	warning.textContent = "Choose two different batters.";
	const crease = state.crease || {};
	const customContent = (container) => {
		container.append(warning);
		strikerSelect = addPlayerSelect(container, "Striker *", batters, {
			value: crease.striker,
		});
		nonStrikerSelect = addPlayerSelect(container, "Non-striker *", batters, {
			value: crease.non_striker,
		});
	};
	const ok = await showModal({
		title: "Change batters",
		message: "Choose the two batters at the crease.",
		confirmLabel: "Save batters",
		showCancel: true,
		customContent,
		validate: () => {
			if (strikerSelect.value === nonStrikerSelect.value) {
				warning.classList.remove("hidden");
				return false;
			}
			return true;
		},
	});
	if (!ok) return;
	try {
		await saveCrease({
			striker: strikerSelect.value,
			non_striker: nonStrikerSelect.value,
			bowler: state.crease.bowler,
		});
	} catch (error) {
		await showError(error.message);
	}
}
async function chooseNextBowlerModal(previousBowler, currentBowler, canDismiss = true) {
	if (!isAdmin || !current || !state || isComplete()) return false;
	const bowlers = bowlingRoster();
	const previous = previousBowler ? formatPlayerName(previousBowler) : "";
	let choices = bowlers.filter((player) => player !== previous);
	if (!choices.length) choices = bowlers;
	if (!choices.length) {
		await showError("No available bowlers for this innings.");
		return false;
	}
	let bowlerSelect;
	const customContent = (container) => {
		bowlerSelect = addPlayerSelect(container, "Next bowler *", choices, {
			value: currentBowler && choices.includes(formatPlayerName(currentBowler))
				? formatPlayerName(currentBowler)
				: "",
		});
	};
	const ok = await showModal({
		title: "Choose bowler",
		message: previous
			? `${previous} bowled the previous over. Select a different bowler.`
			: "Select the bowler for the next over.",
		confirmLabel: "Set bowler",
		showCancel: canDismiss,
		customContent,
	});
	if (!ok) return false;
	try {
		await saveCrease({
			striker: state.crease.striker,
			non_striker: state.crease.non_striker || "",
			bowler: bowlerSelect.value,
		});
		return true;
	} catch (error) {
		await showError(error.message);
		return false;
	}
}
function getPreviousOverBowler() {
	const overs = groupOvers((state && state.deliveries) || []);
	for (let i = overs.length - 1; i >= 0; i--) {
		if (!overs[i].complete) continue;
		for (let j = overs[i].balls.length - 1; j >= 0; j--) {
			if (overs[i].balls[j].bowler) {
				return formatPlayerName(overs[i].balls[j].bowler);
			}
		}
	}
	return null;
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
		const inn1Side = inn1.side || bowlingSide();
		const inn1Team = inn1.team || bowlingTeamName();
		const inn2Team = battingTeamName();
		const inn1MaxW = maxWicketsForSide(inn1Side);
		const isInn1AllOut = (inn1.wickets || 0) >= inn1MaxW;
		const inn1Summary = isInn1AllOut
			? `${inn1Team} all out for ${inn1.total || 0} (${inn1.wickets} wkts) in ${oversText(inn1.legal || 0)} overs.`
			: `${inn1Team} scored ${inn1.total || 0}/${inn1.wickets || 0} in ${oversText(inn1.legal || 0)} overs.`;
		await showModal({
			title: isInn1AllOut ? "1st Innings Complete (All Out)" : "1st Innings Complete",
			message: `${inn1Summary}\nTarget for ${inn2Team} is ${state.target} runs. Ready to start 2nd innings?`,
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
async function openWicketDeliveryModal(extraType = "", initialRuns = 0) {
	if (!isAdmin || !current || isComplete()) return;
	const initialized = await ensureCreaseInitialized();
	if (!initialized || !isCreaseValidForCurrentInnings()) return;
	const cr = state.crease || {};
	const striker = cr.striker ? formatPlayerName(cr.striker) : "";
	const nonStriker = cr.non_striker ? formatPlayerName(cr.non_striker) : null;
	if (!striker) return;
	const isCurrentlyLone = !nonStriker;

	const bRoster = battingRoster();
	const outSet = new Set(
		(state.deliveries || [])
			.filter((d) => d.wicket)
			.map((d) => formatPlayerName(String(d.dismissed_player || d.batter || d.striker))),
	);
	const unbatted = bRoster.filter(
		(p) => p !== striker && (!nonStriker || p !== nonStriker) && !outSet.has(p),
	);

	const currentWickets = (state.deliveries || []).filter((d) => d.wicket).length;
	const maxW = maxWickets(state);

	// Case 1: Final wicket (All Out) -> all wickets lost or lone batter dismissed
	const isFinalWicket = currentWickets + 1 >= maxW || isCurrentlyLone;

	// Case 2: Transition to lone batter -> this dismissal leaves 1 batter standing alone
	const willBeLoneBatter = !isFinalWicket && unbatted.length === 0;

	let dismissal = "";
	let dismissedPlayer = "";
	let nextBatter = "";
	let runs = null;

	let selDismissal = null;
	let selPlayer = null;
	let selRuns = null;
	let selNext = null;

	const content = (container) => {
		const rowWarn = document.createElement("div");
		rowWarn.id = "wicketModalWarn";
		rowWarn.className = "modal-custom-row hidden";
		rowWarn.innerHTML = `<div style="background:#fee2e2;color:#991b1b;border:1px solid #f87171;border-radius:8px;padding:8px 12px;font-size:0.85rem;font-weight:600;width:100%;"></div>`;
		container.append(rowWarn);

		function showInlineWarn(msg) {
			const alertBox = container.querySelector("#wicketModalWarn div");
			if (alertBox) {
				alertBox.textContent = "⚠️ " + msg;
				rowWarn.classList.remove("hidden");
			}
		}

		const rowDismissal = document.createElement("div");
		rowDismissal.className = "modal-custom-row";
		rowDismissal.innerHTML = `<label>Dismissal Type *</label>`;
		selDismissal = document.createElement("select");
		selDismissal.className = "app-select";
		selDismissal.required = true;

		const optDismissalDef = document.createElement("option");
		optDismissalDef.value = "";
		optDismissalDef.textContent = "Select any option";
		optDismissalDef.disabled = true;
		optDismissalDef.selected = true;
		selDismissal.append(optDismissalDef);

		const isWideOrNb = extraType === "wide" || extraType === "no-ball";
		const dismissalList = isWideOrNb
			? ["run out", "stumped", "hit wicket"]
			: extraType === "overthrow"
			? ["run out"]
			: ["bowled", "caught", "lbw", "run out", "stumped", "hit wicket"];

		dismissalList.forEach((d) => {
			const opt = document.createElement("option");
			opt.value = d;
			opt.textContent = d.toUpperCase();
			selDismissal.append(opt);
		});
		selDismissal.value = "";
		rowDismissal.append(selDismissal);

		const rowPlayer = document.createElement("div");
		rowPlayer.className = "modal-custom-row hidden";
		rowPlayer.innerHTML = `<label>Dismissed Batter *</label>`;
		selPlayer = document.createElement("select");
		selPlayer.className = "app-select";
		selPlayer.required = true;

		const optPlayerDef = document.createElement("option");
		optPlayerDef.value = "";
		optPlayerDef.textContent = "Select any option";
		optPlayerDef.disabled = true;
		optPlayerDef.selected = true;
		selPlayer.append(optPlayerDef);

		const optStriker = document.createElement("option");
		optStriker.value = striker;
		optStriker.textContent = isCurrentlyLone
			? `${striker} (Lone Batter)`
			: `${striker} (Striker)`;
		selPlayer.append(optStriker);
		if (nonStriker) {
			const optNon = document.createElement("option");
			optNon.value = nonStriker;
			optNon.textContent = `${nonStriker} (Non-Striker)`;
			selPlayer.append(optNon);
		}
		selPlayer.value = "";
		rowPlayer.append(selPlayer);

		const rowRuns = document.createElement("div");
		rowRuns.className = "modal-custom-row hidden";
		rowRuns.innerHTML = `<label>Runs completed before dismissal *</label>`;
		selRuns = document.createElement("select");
		selRuns.className = "app-select";
		selRuns.required = true;
		selRuns.disabled = true;

		const optRunsDef = document.createElement("option");
		optRunsDef.value = "";
		optRunsDef.textContent = "Select any option";
		optRunsDef.disabled = true;
		optRunsDef.selected = true;
		selRuns.append(optRunsDef);

		[0, 1, 2, 3].forEach((r) => {
			const opt = document.createElement("option");
			opt.value = String(r);
			opt.textContent = r === 1 ? "1 run" : r + " runs";
			selRuns.append(opt);
		});
		selRuns.value = "";
		rowRuns.append(selRuns);

		const rowNext = document.createElement("div");
		rowNext.className = "modal-custom-row";
		if (isFinalWicket) {
			rowNext.innerHTML = `
				<div class="allout-alert" style="background:#fee2e2;color:#991b1b;border:1px solid #f87171;border-radius:8px;padding:10px 12px;font-size:0.9rem;font-weight:600;display:flex;align-items:center;gap:8px;width:100%;">
					<span style="font-size:1.2rem;">⚠️</span>
					<span>Final Wicket (${currentWickets + 1}/${maxW}) — All batters out. Innings will conclude immediately.</span>
				</div>
			`;
		} else if (willBeLoneBatter) {
			const loneName = dismissedPlayer === striker ? nonStriker : striker;
			rowNext.innerHTML = `
				<div class="lone-alert" style="background:#e0f2fe;color:#0369a1;border:1px solid #7dd3fc;border-radius:8px;padding:10px 12px;font-size:0.9rem;font-weight:600;display:flex;align-items:center;gap:8px;width:100%;">
					<span style="font-size:1.2rem;">🏏</span>
					<span>Last Batter Stands — <strong id="loneBatterNotice">${loneName || "Remaining batter"}</strong> will continue batting alone!</span>
				</div>
			`;
		} else {
			rowNext.innerHTML = `<label>Next Incoming Batter *</label>`;
			selNext = document.createElement("select");
			selNext.className = "app-select";
			selNext.required = true;

			const optNextDef = document.createElement("option");
			optNextDef.value = "";
			optNextDef.textContent = "Select any option";
			optNextDef.disabled = true;
			optNextDef.selected = true;
			selNext.append(optNextDef);

			unbatted.forEach((p) => {
				const opt = document.createElement("option");
				opt.value = p;
				opt.textContent = p;
				selNext.append(opt);
			});
			selNext.value = "";
			nextBatter = "";
			selNext.onchange = () => {
				nextBatter = selNext.value;
				rowWarn.classList.add("hidden");
			};
			rowNext.append(selNext);
		}

		function updateVisibility() {
			const dVal = (selDismissal && selDismissal.value) || dismissal || "";
			const isRunOut = dVal === "run out";
			rowPlayer.classList.toggle("hidden", !dVal);
			if (!dVal) {
				setSelectValue(selPlayer, "");
				dismissedPlayer = "";
			} else if (isRunOut) {
				if (isCurrentlyLone) {
					setSelectValue(selPlayer, striker);
					dismissedPlayer = striker;
				} else {
					setSelectValue(selPlayer, "");
					dismissedPlayer = "";
				}
			} else {
				setSelectValue(selPlayer, striker);
				dismissedPlayer = striker;
			}
			setSelectDisabled(selPlayer, !isRunOut || isCurrentlyLone);
			rowRuns.classList.toggle("hidden", !isRunOut);
			setSelectDisabled(selRuns, !isRunOut);
			if (!isRunOut) {
				runs = 0;
				setSelectValue(selRuns, "");
			} else {
				setSelectValue(selRuns, "");
				runs = null;
			}
			if (willBeLoneBatter) {
				const loneEl = $("loneBatterNotice");
				if (loneEl) {
					loneEl.textContent = (dismissedPlayer === striker ? nonStriker : striker) || "Remaining batter";
				}
			}
		}

		selDismissal.onchange = () => {
			dismissal = selDismissal.value;
			rowWarn.classList.add("hidden");
			updateVisibility();
		};
		selPlayer.onchange = () => {
			dismissedPlayer = selPlayer.value;
			rowWarn.classList.add("hidden");
			if (willBeLoneBatter) {
				const loneEl = $("loneBatterNotice");
				if (loneEl) {
					loneEl.textContent = (dismissedPlayer === striker ? nonStriker : striker) || "Remaining batter";
				}
			}
		};
		selRuns.onchange = () => {
			runs = selRuns.value === "" ? null : parseInt(selRuns.value, 10);
			rowWarn.classList.add("hidden");
		};

		container.append(rowDismissal, rowPlayer, rowRuns, rowNext);
		enhanceSelect(selDismissal);
		enhanceSelect(selPlayer);
		enhanceSelect(selRuns);
		if (selNext) {
			enhanceSelect(selNext);
		}
		updateVisibility();
	};

	let modalTitle = "Fall of Wicket";
	let modalMsg = "Record wicket details and next incoming batter:";
	let modalConfirm = "Record Wicket";

	if (isFinalWicket) {
		modalTitle = "Fall of Final Wicket (All Out)";
		modalMsg = "Record final dismissal details to conclude the innings:";
		modalConfirm = "Record Wicket (All Out)";
	} else if (willBeLoneBatter) {
		modalTitle = "Fall of Wicket — Lone Batter";
		modalMsg = "Record wicket details. Remaining batter will continue batting alone:";
		modalConfirm = "Record Wicket (Bat Alone)";
	}

	const ok = await showModal({
		title: modalTitle,
		message: modalMsg,
		confirmLabel: modalConfirm,
		showCancel: true,
		customContent: content,
		validate: () => {
			const dVal = (selDismissal && selDismissal.value) ? selDismissal.value : dismissal;
			if (!dVal) {
				const errBox = $("wicketModalWarn");
				if (errBox) {
					errBox.querySelector("div").textContent = "⚠️ Please select a dismissal type.";
					errBox.classList.remove("hidden");
				}
				if (selDismissal) selDismissal.focus();
				return false;
			}
			dismissal = dVal;
			const isRunOut = dismissal === "run out";
			if (isRunOut) {
				const pVal = (selPlayer && selPlayer.value) ? selPlayer.value : dismissedPlayer;
				if (!pVal) {
					const errBox = $("wicketModalWarn");
					if (errBox) {
						errBox.querySelector("div").textContent = "⚠️ Please select the dismissed batter.";
						errBox.classList.remove("hidden");
					}
					if (selPlayer) selPlayer.focus();
					return false;
				}
				dismissedPlayer = pVal;

				const rVal = (selRuns && selRuns.value !== "") ? parseInt(selRuns.value, 10) : runs;
				if (rVal === null || rVal === undefined || isNaN(rVal)) {
					const errBox = $("wicketModalWarn");
					if (errBox) {
						errBox.querySelector("div").textContent = "⚠️ Please select runs completed before dismissal.";
						errBox.classList.remove("hidden");
					}
					if (selRuns) selRuns.focus();
					return false;
				}
				runs = rVal;
			} else {
				dismissedPlayer = striker;
				runs = 0;
			}
			if (!isFinalWicket && !willBeLoneBatter) {
				const nb = (selNext && selNext.value) ? selNext.value : nextBatter;
				if (!nb) {
					const errBox = $("wicketModalWarn");
					if (errBox) {
						errBox.querySelector("div").textContent = "⚠️ Please select the next incoming batter.";
						errBox.classList.remove("hidden");
					}
					if (selNext) selNext.focus();
					return false;
				}
				nextBatter = nb;
			}
			return true;
		},
	});

	if (!ok) return;

	const completedRuns = (dismissal === "run out" && runs !== null && !isNaN(runs)) ? runs : 0;
	let extraRuns = 0;
	if (extraType === "wide") {
		extraRuns = 1 + completedRuns;
		runs = 0;
	} else if (extraType === "no-ball") {
		extraRuns = 1;
		runs = completedRuns;
	} else if (extraType === "bye" || extraType === "leg-bye") {
		extraRuns = completedRuns === 0 ? 1 : completedRuns;
		runs = 0;
	} else {
		runs = completedRuns;
	}

	await recordBallWithRotation({
		runs,
		extraType,
		extraRuns,
		wicket: true,
		dismissal,
		dismissedPlayer,
		nextBatter: !isFinalWicket && !willBeLoneBatter ? nextBatter : null,
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
	const initialized = await ensureCreaseInitialized();
	if (!initialized || !isCreaseValidForCurrentInnings()) return;

	try {
		const prev = state;
		const prevInnings = state.innings;
		const prevStatus = state.status;

		const cr = state.crease || {};
		const curStriker = cr.striker ? formatPlayerName(cr.striker) : "";
		const curNonStriker = cr.non_striker ? formatPlayerName(cr.non_striker) : null;
		const curBowler = cr.bowler ? formatPlayerName(cr.bowler) : "";
		if (!curStriker || !curBowler) {
			await openInningsOpenerModal();
			return;
		}

		const creaseBefore = {
			striker: curStriker,
			non_striker: curNonStriker,
			bowler: curBowler,
		};

		const maxW = maxWickets(state);
		const currentW = (state.deliveries || []).filter((d) => d.wicket).length;
		const isCurrentlyLone = !curNonStriker;
		const isAllOutWicket = wicket && (currentW + 1 >= maxW || isCurrentlyLone);

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
			const outPerson = formatPlayerName(dismissedPlayer || curStriker);
			const isStrikerOut = outPerson === curStriker;

			if (isAllOutWicket) {
				nextStriker = null;
				nextNonStriker = null;
			} else if (!nextBatter) {
				// Lone batter transition: surviving batter bats alone!
				const loneSurvivor = isStrikerOut ? curNonStriker : curStriker;
				nextStriker = loneSurvivor;
				nextNonStriker = null;
			} else {
				const incoming = formatPlayerName(nextBatter);
				if (isStrikerOut) {
					if (physicalRuns % 2 === 1) {
						nextStriker = curNonStriker;
						nextNonStriker = incoming;
					} else {
						nextStriker = incoming;
						nextNonStriker = curNonStriker;
					}
				} else {
					if (physicalRuns % 2 === 1) {
						nextStriker = incoming;
						nextNonStriker = curStriker;
					} else {
						nextStriker = curStriker;
						nextNonStriker = incoming;
					}
				}
			}
		} else {
			if (isCurrentlyLone) {
				nextStriker = curStriker;
				nextNonStriker = null;
			} else if (physicalRuns % 2 === 1) {
				nextStriker = curNonStriker;
				nextNonStriker = curStriker;
			}
		}

		const isLegal = !["wide", "no-ball"].includes(extraType);
		const currentLegal = (legalCount(prev) % 6) + (isLegal ? 1 : 0);
		const overEnded = isLegal && currentLegal === 6;

		if (overEnded && !isAllOutWicket && nextNonStriker) {
			const t = nextStriker;
			nextStriker = nextNonStriker;
			nextNonStriker = t;
		}

		const creaseAfter = isAllOutWicket
			? null
			: {
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
			dismissed_player: wicket ? formatPlayerName(dismissedPlayer || curStriker) : null,
			next_batter: wicket && !isAllOutWicket && nextBatter ? formatPlayerName(nextBatter) : null,
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
		if (state.innings === prevInnings && !isComplete()) {
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
		} else if (closed && !isComplete()) {
			await notifyOverComplete(closed, endedOverBalls(closed, r.state));
			if (state.crease) {
				state.crease.bowler = "";
			}
			render();
			await chooseNextBowlerModal(curBowler, null, false);
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
	const type = $("modalExtraType").value;
	const max = $("modalFields").classList.contains("overthrow-mode")
		? 3
		: $("modalFields").classList.contains("editing-delivery") &&
				(type === "" || type === "no-ball")
			? 6
			: 7;
	return Number.isNaN(n) ? 0 : Math.min(max, Math.max(0, n));
}
function deliveryValuesFromEdit(type, amount) {
	if (type === "wide") return { runs: 0, extra_runs: 1 + amount };
	if (type === "no-ball") return { runs: amount, extra_runs: 1 };
	if (type === "bye" || type === "leg-bye")
		return { runs: 0, extra_runs: Math.max(1, amount) };
	if (type === "penalty") return { runs: 0, extra_runs: amount };
	if (type === "overthrow") return { runs: amount, extra_runs: 4 };
	return { runs: amount, extra_runs: 0 };
}
function updateEditDeliveryFields() {
	const fields = $("modalFields");
	const type = $("modalExtraType").value;
	[
		"edit-normal",
		"edit-wide",
		"edit-no-ball",
		"edit-bye",
		"edit-leg-bye",
		"edit-penalty",
		"edit-overthrow",
	].forEach((name) => fields.classList.remove(name));
	fields.classList.add("edit-" + (type || "normal"));
	fields.classList.toggle("overthrow-mode", type === "overthrow");
	fields.classList.toggle("penalty-mode", type === "wide" || type === "no-ball");
	const labels = {
		"": "Runs",
		wide: "Additional wide runs",
		"no-ball": "Runs off the bat",
		bye: "Bye runs",
		"leg-bye": "Leg-bye runs",
		penalty: "Penalty runs",
		overthrow: "Runs completed",
	};
	$("modalAddonLabel").textContent = labels[type] || "Runs";
	const checked = document.querySelector('input[name="modalAddon"]:checked');
	const value = checked ? parseInt(checked.value, 10) : 0;
	const minimum = ["bye", "leg-bye", "overthrow"].includes(type) ? 1 : 0;
	const maximum =
		type === "overthrow" ? 3 : ["", "no-ball"].includes(type) ? 6 : 7;
	if (value < minimum || value > maximum) {
		const input = document.querySelector(
			'input[name="modalAddon"][value="' + minimum + '"]',
		);
		if (input) input.checked = true;
	}
}
function setEditDeliveryType(type) {
	$("modalExtraType").value = type;
	document.querySelectorAll('input[name="modalExtraTypePill"]').forEach((input) => {
		input.checked = input.value === type;
	});
}
function clearEditDeliveryFields() {
	const fields = $("modalFields");
	fields.classList.remove(
		"editing-delivery",
		"edit-normal",
		"edit-wide",
		"edit-no-ball",
		"edit-bye",
		"edit-leg-bye",
		"edit-penalty",
		"edit-overthrow",
	);
	fields.classList.remove("overthrow-mode", "penalty-mode");
	setEditDeliveryType("");
}
async function editDelivery(innings, index, delivery) {
	if (!isAdmin || !current || isComplete() || state.locked) return;
	const fields = $("modalFields");
	const editTypes = ["", "wide", "no-ball", "bye", "leg-bye", "penalty", "overthrow"];
	let type = editTypes.includes(delivery.extra_type || "")
		? delivery.extra_type || ""
		: "";
	setEditDeliveryType(type);
	fields.classList.add("editing-delivery");
	updateEditDeliveryFields();
	$("modalWicketRow").classList.remove("hidden");
	const pending = showModal({
		title: "Edit delivery",
		message: "Change this ball's runs, extras, or wicket.",
		confirmLabel: "Save delivery",
		showCancel: true,
		fields: true,
	});
	setEditDeliveryType(type);
	updateEditDeliveryFields();
	const amount =
		type === "wide"
			? Math.max(0, (delivery.extra_runs || 1) - 1)
			: type === "bye" || type === "leg-bye" || type === "penalty"
				? delivery.extra_runs || 1
				: delivery.runs || 0;
	const amountInput = document.querySelector(
		'input[name="modalAddon"][value="' + amount + '"]',
	);
	if (amountInput) amountInput.checked = true;
	$("modalWicket").checked = !!delivery.wicket;
	try {
		if (!(await pending)) return;
		type = $("modalExtraType").value;
		const additional = addonValue();
		const { runs, extra_runs: extraRuns } = deliveryValuesFromEdit(
			type,
			additional,
		);
		const wicket = $("modalWicket").checked;
		const previousInnings = state.innings;
		const updatedDelivery = {
			...delivery,
			runs,
			extra_type: type,
			extra_runs: extraRuns,
			wicket,
			dismissal: wicket ? delivery.dismissal || "bowled" : "",
		};
		const r = await api(
			"edit_delivery",
			"POST",
			{ innings, index, delivery: updatedDelivery },
			current,
		);
		state = r.state;
		render();
		if (isComplete() || state.innings !== previousInnings)
			await notifyPhaseChange();
		else $("actionMessage").textContent = "Delivery updated.";
	} catch (error) {
		await showError(error.message);
	} finally {
		clearEditDeliveryFields();
	}
}
$("modalExtraTypePills").addEventListener("change", (event) => {
	if (event.target.name !== "modalExtraTypePill") return;
	$("modalExtraType").value = event.target.value;
	updateEditDeliveryFields();
});
async function openDeliveryPopup(type) {
	if (!isAdmin || !current || isComplete()) return;
	clearEditDeliveryFields();
	const isWicket = type === "wicket";
	if (isWicket) {
		await openWicketDeliveryModal("");
		return;
	}
	const isOvr = type === "overthrow";
	const isPenalty = type === "wide" || type === "no-ball";
	document.querySelector('input[name="modalAddon"][value="0"]').checked = true;
	$("modalWicket").checked = isWicket;
	$("modalWicketRow").classList.toggle("hidden", isWicket);
	$("modalFields").classList.toggle("overthrow-mode", isOvr);
	$("modalFields").classList.toggle("penalty-mode", isPenalty);
	const msg = isOvr
		? "Runs completed, then 4 overthrows."
		: "Choose add-on runs, then mark the delivery.";
	let willOpenWicket = false;
	let additional = 0;
	const ok = await showModal({
		title: EXTRA_LABELS[type] || type,
		message: msg,
		confirmLabel: "Mark delivery",
		showCancel: true,
		fields: true,
		validate: () => {
			additional = addonValue();
			willOpenWicket = $("modalWicket").checked;
			if (willOpenWicket) {
				return { keepHistory: true };
			}
			return true;
		},
	});
	if (!ok) return;
	if (willOpenWicket) {
		await openWicketDeliveryModal(type, additional);
	} else {
		commitExtra(type, additional, false);
	}
}
document.querySelectorAll('.modal-addon input[name="modalAddon"]').forEach((r) => {
	r.addEventListener("click", function () {
		const parentOpt = this.closest(".modal-addon-opt");
		if (this._wasChecked) {
			this.checked = false;
			this._wasChecked = false;
			if (parentOpt) parentOpt.classList.remove("is-checked");
		} else {
			document.querySelectorAll('.modal-addon input[name="modalAddon"]').forEach((other) => {
				other._wasChecked = false;
				const otherParent = other.closest(".modal-addon-opt");
				if (otherParent) otherParent.classList.remove("is-checked");
			});
			this._wasChecked = true;
			if (parentOpt) parentOpt.classList.add("is-checked");
		}
	});
});
const modalWicketInput = $("modalWicket");
if (modalWicketInput) {
	modalWicketInput.addEventListener("change", function () {
		const row = $("modalWicketRow");
		if (row) row.classList.toggle("is-checked", this.checked);
	});
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
	const initialized = await ensureCreaseInitialized();
	if (!initialized || !isCreaseValidForCurrentInnings()) return;
	if (!state.crease || !state.crease.non_striker) return;
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
	const prevBowler = getPreviousOverBowler();
	const curBowler = state.crease && state.crease.bowler ? state.crease.bowler : null;
	const canDismiss = isCreaseValidForCurrentInnings();
	await chooseNextBowlerModal(prevBowler, curBowler, canDismiss);
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
$("modalOk").onclick = async () => {
	const custom = $("modalCustom");
	if (custom && !custom.classList.contains("hidden")) {
		const requiredSelects = custom.querySelectorAll("select[required]");
		for (const sel of requiredSelects) {
			if (sel.disabled || sel.closest(".hidden")) {
				continue;
			}
			if (!sel.value) {
				try {
					sel.focus();
					if (typeof sel.reportValidity === "function") {
						sel.reportValidity();
					}
				} catch (e) {}
				const warnBox =
					custom.querySelector("#wicketModalWarn") ||
					custom.querySelector("#openersModalWarn") ||
					custom.querySelector(".modal-warn");
				if (warnBox) {
					const alertDiv = warnBox.querySelector("div") || warnBox;
					const row = sel.closest(".modal-custom-row");
					const lbl = row ? row.querySelector("label") : null;
					alertDiv.textContent = "⚠️ Please select " + (lbl ? lbl.textContent.replace("*", "").trim() : "all required fields") + ".";
					warnBox.classList.remove("hidden");
				}
				if (sel._choices) {
					try {
						sel._choices.showDropdown();
					} catch (e) {}
				}
				return;
			}
		}
	}
	let keepHistory = false;
	if (typeof modalValidate === "function") {
		try {
			const valid = await modalValidate();
			if (!valid) return;
			if (valid && typeof valid === "object" && valid.keepHistory) {
				keepHistory = true;
			}
		} catch (err) {
			console.error("modalValidate error:", err);
			showError(err && err.message ? err.message : String(err));
			return;
		}
	}
	closeModal(true, keepHistory);
};
$("modalClose").onclick = () => closeModal(false);
if ($("modalCancel")) $("modalCancel").onclick = () => closeModal(false);
$("modal").onclick = (e) => {
	if (e.target === $("modal") && $("modal").dataset.allowDismiss === "1")
		closeModal(false);
};
window.addEventListener("popstate", async (event) => {
	if (isClosingModalFromUI) {
		isClosingModalFromUI = false;
		return;
	}
	if (modalHistoryActive) {
		modalHistoryActive = false;
		isClosingModalFromPopstate = true;
		closeModal(false, true);
		isClosingModalFromPopstate = false;
		if (modalReturnFocus && modalReturnFocus.isConnected) modalReturnFocus.focus();
		modalReturnFocus = null;
		return;
	}
	isNavigatingHistory = true;
	try {
		const resolved = window.CricketRouter.resolve();
		const route =
			event.state && event.state.cricketScreen
				? event.state
				: { cricketScreen: resolved.name, matchId: resolved.matchId };

		switch (route.cricketScreen) {
		case "matches":
			mainTab = "matches";
			stopPoll();
			current = null;
			editingMatch = false;
			setPendingExtra("");
			show("app");
			headerMode();
			loadMatches();
			break;
		case "stats":
			mainTab = "stats";
			stopPoll();
			current = null;
			editingMatch = false;
			setPendingExtra("");
			show("app");
			loadPlayerStats();
			break;
		case "toss":
			mainTab = "toss";
			stopPoll();
			current = null;
			editingMatch = false;
			setPendingExtra("");
			show("app");
			break;
		case "login":
			stopPoll();
			show("login");
			break;
		case "setup-create":
			if (!isAdmin) {
				setRoute("login", null, "replace");
				show("login");
				break;
			}
			stopPoll();
			editingMatch = false;
			fillSetup("create");
			break;
		case "setup-edit":
			if (!isAdmin) {
				setRoute("login", null, "replace");
				show("login");
				break;
			}
			if (!route.matchId) return;
			try {
				await openMatch(route.matchId, null);
				stopPoll();
				fillSetup("update");
			} catch (error) {
				showError(error.message);
			}
			break;
		case "score":
			if (!route.matchId) return;
			try {
				await openMatch(route.matchId, null);
			} catch (error) {
				showError(error.message);
			}
			break;
		}
	} finally {
		isNavigatingHistory = false;
	}
});
boot();
