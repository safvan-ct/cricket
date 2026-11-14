(function (global) {
	"use strict";

	function basePath() {
		return (document.body.dataset.basePath || "").replace(/\/+$/, "");
	}

	function localPath(pathname) {
		const base = basePath();
		if (!base) return pathname || "/";
		if (pathname === base) return "/";
		return pathname.indexOf(`${base}/`) === 0 ? pathname.slice(base.length) : pathname;
	}

	function routePath(route, id) {
		const path = route.build ? route.build(id) : route.path;
		return `${basePath()}${path}` || "/";
	}

	function resolve(url) {
		const currentUrl = url || new URL(window.location.href);
		const legacyMatch = currentUrl.hash.match(/^#m=(\d+)/);
		if (legacyMatch) return { name: "score", matchId: legacyMatch[1], legacy: true };

		const path = localPath(currentUrl.pathname);
		for (const route of global.CricketRoutes) {
			const match = path.match(route.match);
			if (match) return { name: route.name, matchId: match[1] || null };
		}
		return { name: "matches", matchId: null, unknown: true };
	}

	function navigate(name, matchId, mode) {
		const route = global.CricketRoutes.find((candidate) => candidate.name === name);
		if (!route) throw new Error(`Unknown route: ${name}`);
		if ((route.name === "score" || route.name === "setup-edit") && !/^\d+$/.test(String(matchId || ""))) {
			throw new Error(`Route ${name} requires a numeric match id`);
		}

		const url = new URL(window.location.href);
		url.pathname = routePath(route, matchId);
		url.hash = "";
		const state = {
			...(window.history.state || {}),
			cricketScreen: name,
			matchId: matchId == null ? null : String(matchId),
		};
		if (mode === "replace") window.history.replaceState(state, "", url);
		else window.history.pushState(state, "", url);
	}

	global.CricketRouter = { resolve, navigate };
})(window);
