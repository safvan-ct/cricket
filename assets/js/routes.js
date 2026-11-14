(function (global) {
	"use strict";

	global.CricketRoutes = [
		{ name: "matches", path: "/matches", match: /^\/(?:matches)?\/?$/ },
		{ name: "login", path: "/login", match: /^\/login\/?$/ },
		{ name: "setup-create", path: "/matches/new", match: /^\/matches\/new\/?$/ },
		{
			name: "setup-edit",
			path: "/matches/:id/edit",
			match: /^\/matches\/(\d+)\/edit\/?$/,
			build: (id) => `/matches/${encodeURIComponent(id)}/edit`,
		},
		{
			name: "score",
			path: "/matches/:id",
			match: /^\/matches\/(\d+)\/?$/,
			build: (id) => `/matches/${encodeURIComponent(id)}`,
		},
	];
})(window);
