<!doctype html>
<html lang="en">

<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Scoreboard</title>
  <link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="assets/icon-192.png">
  <link rel="manifest" href="manifest.webmanifest">
  <meta name="theme-color" content="#002868">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Cricket">
  <link rel="stylesheet" href="assets/style.css?v=<?php echo filemtime(__DIR__ . '/assets/style.css') ?>">
</head>

<body>
  <header>
    <div class="brand"><span class="ball">●</span>
      <div><b>CRICKET</b><small>LIVE SCOREBOARD</small></div>
    </div>
    <button id="loginBtn" class="ghost">Sign in</button>
    <button id="logout" class="ghost hidden">Sign out</button>
  </header>

  <main>
    <section id="login" class="panel narrow hidden">
      <h1>Admin sign in</h1>
      <p>Sign in to create matches and record deliveries. Anyone can view scores without signing in.</p>
      <form id="loginForm">
        <label>
          Admin password
          <span class="password-field">
            <input id="password" type="password" required autocomplete="current-password">
            <button type="button" id="togglePassword" class="password-toggle" aria-label="Show password" aria-pressed="false">
              <svg id="eyeOpen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                <circle cx="12" cy="12" r="3" />
              </svg><svg id="eyeOff" class="hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M3 3l18 18" />
                <path d="M10.6 10.6A3 3 0 0 0 12 15a3 3 0 0 0 2.4-4.4" />
                <path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a18.4 18.4 0 0 1-3.2 4.2" />
                <path d="M6.1 6.1C3.8 7.8 2 12 2 12s3.5 7 10 7a10.7 10.7 0 0 0 4.1-.8" />
              </svg>
            </button>
          </span>
        </label>
        <button class="primary" style="margin-top: 10px;">Sign in</button>
        <button type="button" id="backToMatches" class="ghost" style="width:100%;margin-top:8px;margin-bottom:16px">Back to matches</button>
        <p id="loginError" class="error"></p>
      </form>
    </section>

    <section id="app" class="hidden">
      <div class="topline">
        <div>
          <p class="eyebrow">MATCH CENTRE</p>
          <h1>Scoreboard</h1>
        </div>
        <button id="newMatch" class="primary">＋ New match</button>
        <button id="updateMatch" class="primary hidden">Update match info</button>
      </div>

      <div id="matchesView" class="panel">
        <h2>Saved matches</h2>
        <div id="matchList" class="match-list"></div>
      </div>

      <div id="setupView" class="panel hidden">
        <div class="section-head">
          <h2 id="setupTitle">Create match</h2>
          <button class="ghost" id="cancelSetup" style="margin-bottom:12px">Cancel</button>
        </div>

        <form id="setupForm" class="form-stack">
          <div class="team-block">
            <label>Team A name<input id="teamA" required value="PAREL"></label>
            <label>Number of players<input id="playersA" type="number" min="2" max="15" value="7" required></label>
          </div>

          <div class="team-block">
            <label>Team B name<input id="teamB" required value="BNA"></label>
            <label>Number of players<input id="playersB" type="number" min="2" max="15" value="7" required></label>
          </div>

          <label>Overs per innings<input id="overs" type="number" min="1" max="50" value="6" required></label>

          <div class="toss-block">
            <p class="subhead" style="margin-top:0">🪙 Toss — who bats first?</p>
            <div class="toss-options">
              <label class="toss-radio">
                <input type="radio" name="batting" id="battingA" value="A" checked>
                <span class="toss-pill" id="pillA">PAREL</span>
              </label>
              <label class="toss-radio">
                <input type="radio" name="batting" id="battingB" value="B">
                <span class="toss-pill" id="pillB">BNA</span>
              </label>
            </div>
            <p id="tossNote" class="hint hidden">Toss is locked after the first ball.</p>
          </div>

          <button id="setupSubmit" class="primary" style="width:100%;padding:14px">Create match</button>
        </form>
      </div>

      <div id="scoreView" class="hidden">
        <div class="section-head"><button id="back" class="ghost">← Matches</button>
          <span id="matchTitle" class="eyebrow"></span>
        </div>
        <div class="score-hero">
          <div class="sb-line1">
            <span id="sbTeam" class="sb-team-name"></span>
            <span id="sbTotal" class="sb-runs">0</span>
            <span class="sb-slash">/</span><span id="sbWickets" class="sb-runs">0</span>
            <span class="sb-ov">(<span id="sbOvers">0.0</span>)</span>
            <span class="sb-rr-inline">RR <strong id="sbRR">0.00</strong></span>
          </div>
          <div class="sb-line2">
            <span id="sbNeedBlock" class="hidden">Need <strong id="sbNeed">—</strong> from <strong id="sbNeedBalls">—</strong> balls · RRR <strong id="sbRRR">—</strong></span>
            <span id="sbResult" class="sb-result hidden"></span>
          </div>
          <div class="this-over">
            <div class="this-over-head">
              <span class="subhead">This over</span>
              <span id="thisOverRuns">0 runs</span>
            </div>
            <div class="this-over-balls" id="recent"></div>
          </div>
        </div>
        <div class="panel" id="recordPanel">
          <div class="keypad">
            <button data-run="0">0</button>
            <button data-run="1">1</button>
            <button data-run="2">2</button>
            <button data-run="3">3</button>
            <button data-run="4" class="boundary">4</button>
            <button data-run="6" class="boundary">6</button>
            <button data-extra="wide">Wide</button>
            <button data-extra="no-ball">No-ball</button>
            <button data-extra="wicket" class="wicket-btn">Wicket</button>
          </div>
          <hr class="keypad-sep">
          <div class="score-actions">
            <button id="undo" class="ghost">↶ Undo</button>
            <button id="endInnings" class="ghost">End innings</button>
            <button id="endMatch" class="ghost hidden">End match</button>
            <button data-extra="overthrow" class="ghost">Ovr 4</button>
          </div>
          <p id="actionMessage" class="hint">Tap a run, or an extra / wicket to add on runs.</p>
        </div>
        <div id="overCards"></div>
        <input type="hidden" id="batter" value="1"><input type="hidden" id="bowler" value="1">
      </div>
    </section>
  </main>

  <div id="modal" class="modal hidden" aria-hidden="true">
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <button type="button" id="modalClose" class="modal-close" aria-label="Close">×</button>
      <h2 id="modalTitle">Confirm</h2>
      <p id="modalMessage"></p>
      <div id="modalBalls" class="modal-balls hidden"></div>
      <div id="modalFields" class="modal-fields hidden">
        <p id="modalAddonLabel" class="modal-addon-label">Add-on runs</p>
        <div class="modal-addon" role="radiogroup" aria-label="Add-on runs">
          <label class="modal-addon-opt"><input type="radio" name="modalAddon" value="0" checked>0</label>
          <label class="modal-addon-opt"><input type="radio" name="modalAddon" value="1">1</label>
          <label class="modal-addon-opt"><input type="radio" name="modalAddon" value="2">2</label>
          <label class="modal-addon-opt"><input type="radio" name="modalAddon" value="3">3</label>
          <label class="modal-addon-opt"><input type="radio" name="modalAddon" value="4">4</label>
          <label class="modal-addon-opt"><input type="radio" name="modalAddon" value="5">5</label>
          <label class="modal-addon-opt"><input type="radio" name="modalAddon" value="6">6</label>
        </div>
        <label id="modalWicketRow" class="modal-check"><input id="modalWicket" type="checkbox"> Wicket</label>
      </div>
      <div class="modal-actions">
        <button id="modalOk" class="primary">OK</button>
      </div>
    </div>
  </div>

  <script src="assets/app.js?v=<?php echo filemtime(__DIR__ . '/assets/app.js') ?>"></script>
</body>

</html>