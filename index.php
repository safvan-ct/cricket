<?php
$configPath = __DIR__ . '/config/config.php';
$config = file_exists($configPath) ? require $configPath : [];
$qrUrl = $config['app_url'] ?? $config['qr_url'] ?? $config['qr_value'] ?? '';
?>
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
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Cricket">
  <link rel="stylesheet" href="assets/style.css?v=<?php echo filemtime(__DIR__ . '/assets/style.css') ?>">
</head>

<body data-qr-url="<?php echo htmlspecialchars($qrUrl, ENT_QUOTES, 'UTF-8'); ?>">
  <header>
    <div class="brand"><span class="ball">●</span>
      <div><b>CRICKET</b><small>LIVE SCOREBOARD</small></div>
    </div>
    <div class="header-actions">
      <button id="qrBtn" class="ghost qr-btn" aria-label="Show QR code" title="Scan QR code">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <path d="M2 2h8v8H2V2zm2 2v4h4V4H4zm10-2h8v8h-8V2zm2 2v4h4V4h-4zM2 14h8v8H2v-8zm2 2v4h4v-4H4zm10 0h2v2h-2v-2zm4 0h2v2h-2v-2zm-4 4h2v2h-2v-2zm4 0h2v2h-2v-2zm-2-2h2v2h-2v-2zm4-2h2v2h-2v-2zm0 4h2v2h-2v-2zM5 5h2v2H5V5zm12 0h2v2h-2V5zM5 17h2v2H5v-2z"/>
        </svg>
      </button>
      <button id="loginBtn" class="ghost">Sign in</button>
      <button id="logout" class="ghost hidden">Sign out</button>
    </div>
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

      <div class="main-tabs" id="mainTabs">
        <button type="button" id="tabMatches" class="main-tab-btn active">🏏 Matches</button>
        <button type="button" id="tabStats" class="main-tab-btn">📊 Player Stats</button>
      </div>

      <div id="matchesView" class="panel">
        <h2>Saved matches</h2>
        <div id="matchList" class="match-list"></div>
      </div>

      <div id="statsView" class="panel hidden">
        <div class="stats-header">
          <div class="stats-title-group">
            <h2>Player Statistics</h2>
            <p class="hint" style="margin:2px 0 0">Career statistics aggregated across completed matches</p>
          </div>
          <button type="button" id="addPlayerBtn" class="primary narrow hidden">＋ Add player</button>
        </div>

        <div class="leaderboard-grid" id="leaderboardGrid"></div>

        <div class="player-directory-section">
          <div class="player-directory-head">
            <h3>Player Directory</h3>
            <div class="search-filter-box">
              <input type="text" id="playerDirSearch" placeholder="Search players..." class="stats-search-input">
            </div>
          </div>
          <div class="table-wrap">
            <table class="player-stats-table" id="playerStatsTable">
              <thead>
                <tr>
                  <th class="sc-col-player">Player</th>
                  <th>Mat</th>
                  <th>Runs</th>
                  <th>HS</th>
                  <th>Avg</th>
                  <th>SR</th>
                  <th>Wkts</th>
                  <th>BBI</th>
                  <th>Econ</th>
                </tr>
              </thead>
              <tbody id="playerStatsBody"></tbody>
            </table>
          </div>
          <div id="playerStatsPagination" class="pagination-bar"></div>
        </div>
      </div>

      <div id="setupView" class="panel hidden">
        <div class="section-head">
          <h2 id="setupTitle">Create match</h2>
          <button class="ghost" id="cancelSetup" style="margin-bottom:12px">Cancel</button>
        </div>

        <form id="setupForm" class="form-stack">
          <div class="team-block">
            <div class="team-inputs-row">
              <label class="team-name-col">Team A name<input id="teamA" required value="PAREL"></label>
              <label class="team-players-col">Players<input id="playersA" type="number" min="2" max="15" value="7" required></label>
            </div>
            <div id="rosterAWrap" class="roster-wrap">
              <div class="roster-header-row">
                <span class="subhead roster-title">Team A Players (<span id="countA">0</span>/<span id="maxA">7</span>)</span>
                <button type="button" id="autoFillA" class="ghost-btn-sm">Auto-fill</button>
              </div>
              <div id="selectedChipsA" class="selected-chips"></div>
              <div class="chip-input-row">
                <input type="text" id="playerSearchA" class="chip-search-input" placeholder="Search or add player...">
                <button type="button" id="addChipA" class="chip-add-btn">Add</button>
              </div>
              <div class="pool-wrap">
                <span class="pool-hint">Tap from common pool:</span>
                <div id="poolChipsA" class="pool-chips"></div>
              </div>
            </div>
          </div>

          <div class="team-block">
            <div class="team-inputs-row">
              <label class="team-name-col">Team B name<input id="teamB" required value="BNA"></label>
              <label class="team-players-col">Players<input id="playersB" type="number" min="2" max="15" value="7" required></label>
            </div>
            <div id="rosterBWrap" class="roster-wrap">
              <div class="roster-header-row">
                <span class="subhead roster-title">Team B Players (<span id="countB">0</span>/<span id="maxB">7</span>)</span>
                <button type="button" id="autoFillB" class="ghost-btn-sm">Auto-fill</button>
              </div>
              <div id="selectedChipsB" class="selected-chips"></div>
              <div class="chip-input-row">
                <input type="text" id="playerSearchB" class="chip-search-input" placeholder="Search or add player...">
                <button type="button" id="addChipB" class="chip-add-btn">Add</button>
              </div>
              <div class="pool-wrap">
                <span class="pool-hint">Tap from common pool:</span>
                <div id="poolChipsB" class="pool-chips"></div>
              </div>
            </div>
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
        <div class="crease-hud" id="creaseHud">
          <div class="crease-card batters-card">
            <div class="crease-card-head">
              <span class="subhead">Batters</span>
              <div class="crease-actions-group">
                <button type="button" id="changeBattersBtn" class="change-batters-btn" title="Change active batters">Change ▾</button>
                <button type="button" id="swapStrikeBtn" class="swap-strike-btn" title="Swap Strike">⇄ Swap strike</button>
              </div>
            </div>
            <div class="batters-list">
              <div class="crease-row active-striker" id="strikerRow">
                <div class="batter-meta">
                  <span class="strike-icon" title="On strike">🏏</span>
                  <span class="player-name" id="strikerName">—</span>
                  <span class="badge strike-badge">STRIKE</span>
                </div>
                <div class="player-stats" id="strikerStat">0 (0) · 4s: 0 · 6s: 0</div>
              </div>
              <div class="crease-row" id="nonStrikerRow">
                <div class="batter-meta">
                  <span class="strike-icon muted">•</span>
                  <span class="player-name" id="nonStrikerName">—</span>
                </div>
                <div class="player-stats" id="nonStrikerStat">0 (0) · 4s: 0 · 6s: 0</div>
              </div>
            </div>
          </div>
          <div class="crease-card bowler-card">
            <div class="crease-card-head">
              <span class="subhead">Bowler</span>
              <button type="button" id="changeBowlerBtn" class="change-bowler-btn">Change ▾</button>
            </div>
            <div class="crease-row bowler-row">
              <div class="bowler-meta">
                <span class="bowler-icon">⚾</span>
                <span class="player-name" id="bowlerName">—</span>
              </div>
              <div class="player-stats" id="bowlerStat">0.0 - 0 - 0 - 0 · Econ: 0.00</div>
            </div>
          </div>
        </div>

        <div class="score-tabs">
          <button type="button" id="tabLive" class="tab-btn active">Live & Scoring</button>
          <button type="button" id="tabScorecard" class="tab-btn">Full Scorecard</button>
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
        <div id="scorecardView" class="panel hidden">
          <div id="scorecardContent"></div>
        </div>
        <input type="hidden" id="batter" value="1"><input type="hidden" id="bowler" value="1">
      </div>
    </section>
  </main>

  <div id="modal" class="modal hidden" aria-hidden="true">
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <button type="button" id="modalClose" class="modal-close" aria-label="Close">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <h2 id="modalTitle">Confirm</h2>
      <p id="modalMessage"></p>
      <div id="modalQr" class="modal-qr hidden">
        <div id="modalQrCode" class="modal-qr-code"></div>
        <a id="modalQrUrl" class="modal-qr-link" target="_blank" rel="noopener"></a>
      </div>
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
      <div id="modalCustom" class="modal-custom hidden"></div>
      <div class="modal-actions">
        <button id="modalCancel" type="button" class="ghost hidden">Cancel</button>
        <button id="modalOk" class="primary">OK</button>
      </div>
    </div>
  </div>

  <script src="assets/qrcode.min.js?v=<?php echo filemtime(__DIR__ . '/assets/qrcode.min.js') ?>"></script>
  <script src="assets/app.js?v=<?php echo filemtime(__DIR__ . '/assets/app.js') ?>"></script>
</body>

</html>