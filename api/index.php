<?php

declare(strict_types=1);
session_start();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
$configPath = __DIR__ . '/../config/config.php';
if (!file_exists($configPath)) {
  http_response_code(503);
  echo json_encode(['error' => 'Setup required: create config/config.php from config.example.php']);
  exit;
}
$config = require $configPath;
function respond($data, int $status = 200): never
{
  http_response_code($status);
  echo json_encode($data, JSON_UNESCAPED_UNICODE);
  exit;
}
function body(): array
{
  $raw = file_get_contents('php://input');
  $v = json_decode($raw ?: '{}', true);
  return is_array($v) ? $v : [];
}
try {
  $pdo = new PDO('mysql:host=' . $config['db_host'] . ';dbname=' . $config['db_name'] . ';charset=utf8mb4', $config['db_user'], $config['db_pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
} catch (Throwable $e) {
  respond(['error' => 'Database connection failed. Check config/config.php and database setup.'], 500);
}
$action = $_GET['action'] ?? '';
if ($action === 'login') {
  $b = body();
  if (!hash_equals((string)$config['admin_password'], (string)($b['password'] ?? ''))) respond(['error' => 'Incorrect password'], 401);
  session_regenerate_id(true);
  $_SESSION['cricket_admin'] = true;
  respond(['ok' => true]);
}
if ($action === 'status') {
  $qrUrl = $config['app_url'] ?? $config['qr_url'] ?? $config['qr_value'] ?? '';
  respond(['authenticated' => !empty($_SESSION['cricket_admin']), 'app_url' => $qrUrl]);
}
if ($action === 'logout') {
  $_SESSION = [];
  session_destroy();
  respond(['ok' => true]);
}
function requireAdmin(): void
{
  if (empty($_SESSION['cricket_admin'])) respond(['error' => 'Admin sign-in required'], 401);
}
function cleanRoster(mixed $raw, int $count, string $prefix = 'Player'): array
{
  $list = is_array($raw) ? array_values($raw) : [];
  $out = [];
  for ($i = 1; $i <= $count; $i++) {
    $idx = $i - 1;
    $val = isset($list[$idx]) ? trim((string)$list[$idx]) : '';
    $out[] = $val !== '' ? $val : ($prefix . ' ' . $i);
  }
  return $out;
}
function ensureRosters(array &$s): void
{
  $pA = max(2, (int)($s['players_a'] ?? $s['players'] ?? 7));
  $pB = max(2, (int)($s['players_b'] ?? $s['players'] ?? 7));
  $s['roster_a'] = cleanRoster($s['roster_a'] ?? null, $pA, 'Player');
  $s['roster_b'] = cleanRoster($s['roster_b'] ?? null, $pB, 'Player');
}
function ensurePlayersTable(PDO $pdo): void
{
  static $checked = false;
  if ($checked) return;
  $pdo->exec("CREATE TABLE IF NOT EXISTS players (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    role VARCHAR(50) DEFAULT 'All-Rounder',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
  $checked = true;
}

function registerRosterPlayers(PDO $pdo, array $names): void
{
  ensurePlayersTable($pdo);
  $ins = $pdo->prepare("INSERT IGNORE INTO players (name) VALUES (?)");
  foreach ($names as $name) {
    $n = trim((string)$name);
    if ($n !== '') {
      $ins->execute([$n]);
    }
  }
}

function normalizePlayerName(mixed $val): string
{
  $v = trim((string)$val);
  if ($v === '') return '';
  if (is_numeric($v)) return 'Player ' . $v;
  return $v;
}

function initPlayerStatsRow(mixed $name, int $id = 0): array
{
  $name = (string)$name;
  return [
    'id' => $id,
    'name' => $name,
    'matches' => 0,
    'batting' => [
      'innings' => 0,
      'runs' => 0,
      'balls' => 0,
      'fours' => 0,
      'sixes' => 0,
      'not_outs' => 0,
      'high_score' => 0,
      'high_score_not_out' => false,
      'hs_display' => '0',
      'fifties' => 0,
      'hundreds' => 0,
      'dismissals' => 0,
      'average' => null,
      'strike_rate' => 0.0,
    ],
    'bowling' => [
      'innings' => 0,
      'balls' => 0,
      'overs' => '0.0',
      'maidens' => 0,
      'runs' => 0,
      'wickets' => 0,
      'best_bowling_w' => 0,
      'best_bowling_r' => 9999,
      'best_bowling' => '—',
      'three_wickets' => 0,
      'five_wickets' => 0,
      'economy' => 0.0,
      'average' => null,
      'strike_rate' => null,
    ],
    'match_log' => []
  ];
}

function computeAllPlayerStats(PDO $pdo, ?string $targetPlayer = null): array
{
  ensurePlayersTable($pdo);
  $matches = $pdo->query("SELECT id, title, state_json, created_at, updated_at FROM matches ORDER BY id ASC")->fetchAll(PDO::FETCH_ASSOC);
  $playersQuery = $pdo->query("SELECT id, name FROM players ORDER BY name ASC")->fetchAll(PDO::FETCH_ASSOC);

  $stats = [];
  foreach ($playersQuery as $p) {
    $name = (string)$p['name'];
    $stats[$name] = initPlayerStatsRow($name, (int)$p['id']);
  }

  foreach ($matches as $m) {
    $s = json_decode($m['state_json'], true) ?: [];
    // User requirement: completed matches only!
    if (($s['status'] ?? '') !== 'complete') {
      continue;
    }

    $mId = (int)$m['id'];
    $mTitle = (string)$m['title'];
    $mDate = (string)($m['created_at'] ?? '');

    $rosterA = $s['roster_a'] ?? [];
    $rosterB = $s['roster_b'] ?? [];
    $allRoster = array_unique(array_merge($rosterA, $rosterB));

    foreach ($allRoster as $pName) {
      $pName = normalizePlayerName($pName);
      if ($pName === '') continue;
      if (!isset($stats[$pName])) {
        $stats[$pName] = initPlayerStatsRow($pName);
      }
      $stats[$pName]['matches']++;
    }

    $inningsList = [];
    if (!empty($s['innings_1'])) {
      $i1 = $s['innings_1'];
      $i1Side = $i1['side'] ?? (($s['batting_first'] ?? 'A') === 'B' ? 'B' : 'A');
      $inningsList[] = [
        'side' => $i1Side,
        'bat_roster' => $i1Side === 'B' ? $rosterB : $rosterA,
        'bow_roster' => $i1Side === 'B' ? $rosterA : $rosterB,
        'deliveries' => $i1['deliveries'] ?? [],
        'team' => $i1['team'] ?? ($i1Side === 'B' ? ($s['team_b'] ?? 'Team B') : ($s['team_a'] ?? 'Team A')),
        'opp' => $i1Side === 'B' ? ($s['team_a'] ?? 'Team A') : ($s['team_b'] ?? 'Team B'),
      ];
    }
    // Innings 2
    if (!empty($s['deliveries']) || (int)($s['innings'] ?? 1) === 2 || !empty($s['innings_2'])) {
      $i2Side = (!empty($s['innings_1']) && ($s['innings_1']['side'] ?? '') === 'B') ? 'A' : 'B';
      if (empty($s['innings_1'])) {
        $i2Side = ($s['batting_first'] ?? 'A') === 'B' ? 'B' : 'A';
      }
      $i2Deliveries = $s['deliveries'] ?? [];
      $inningsList[] = [
        'side' => $i2Side,
        'bat_roster' => $i2Side === 'B' ? $rosterB : $rosterA,
        'bow_roster' => $i2Side === 'B' ? $rosterA : $rosterB,
        'deliveries' => $i2Deliveries,
        'team' => $i2Side === 'B' ? ($s['team_b'] ?? 'Team B') : ($s['team_a'] ?? 'Team A'),
        'opp' => $i2Side === 'B' ? ($s['team_a'] ?? 'Team A') : ($s['team_b'] ?? 'Team B'),
      ];
    }

    foreach ($inningsList as $inn) {
      $dels = $inn['deliveries'];
      $batRoster = $inn['bat_roster'];
      $bowRoster = $inn['bow_roster'];

      $innBat = [];
      $innBowl = [];
      foreach ($batRoster as $bn) {
        $bn = normalizePlayerName($bn);
        if ($bn !== '') {
          $innBat[$bn] = ['runs' => 0, 'balls' => 0, 'fours' => 0, 'sixes' => 0, 'hasBatted' => false, 'isOut' => false, 'dismissal' => 'not out'];
        }
      }
      foreach ($bowRoster as $bwn) {
        $bwn = normalizePlayerName($bwn);
        if ($bwn !== '') {
          $innBowl[$bwn] = ['balls' => 0, 'runs' => 0, 'maidens' => 0, 'wickets' => 0, 'hasBowled' => false];
        }
      }

      $currentOverBalls = [];
      $currentOverBowler = null;

      foreach ($dels as $d) {
        $bat = normalizePlayerName($d['batter'] ?? $d['striker'] ?? '');
        $ns = normalizePlayerName($d['non_striker'] ?? '');
        $bow = normalizePlayerName($d['bowler'] ?? '');
        $runs = (int)($d['runs'] ?? 0);
        $exr = (int)($d['extra_runs'] ?? 0);
        $exType = (string)($d['extra_type'] ?? '');
        $ballTotal = $runs + $exr;
        $isLegal = !in_array($exType, ['wide', 'no-ball'], true);
        $bowlerCharge = in_array($exType, ['bye', 'leg-bye'], true) ? 0 : $ballTotal;

        if ($bat !== '') {
          if (!isset($innBat[$bat])) $innBat[$bat] = ['runs' => 0, 'balls' => 0, 'fours' => 0, 'sixes' => 0, 'hasBatted' => false, 'isOut' => false, 'dismissal' => 'not out'];
          $innBat[$bat]['hasBatted'] = true;
          $innBat[$bat]['runs'] += $runs + ($exType === 'overthrow' ? $exr : 0);
          if ($isLegal) $innBat[$bat]['balls']++;
          if ($runs === 4 && $exType !== 'overthrow') $innBat[$bat]['fours']++;
          if ($runs === 6 && $exType !== 'overthrow') $innBat[$bat]['sixes']++;
        }
        if ($ns !== '') {
          if (!isset($innBat[$ns])) $innBat[$ns] = ['runs' => 0, 'balls' => 0, 'fours' => 0, 'sixes' => 0, 'hasBatted' => false, 'isOut' => false, 'dismissal' => 'not out'];
          $innBat[$ns]['hasBatted'] = true;
        }

        if ($bow !== '') {
          if (!isset($innBowl[$bow])) $innBowl[$bow] = ['balls' => 0, 'runs' => 0, 'maidens' => 0, 'wickets' => 0, 'hasBowled' => false];
          $innBowl[$bow]['hasBowled'] = true;
          $innBowl[$bow]['runs'] += $bowlerCharge;
          if ($isLegal) $innBowl[$bow]['balls']++;
        }

        if (!empty($d['wicket'])) {
          $dismissed = normalizePlayerName($d['dismissed_player'] ?? $bat);
          if ($dismissed !== '') {
            if (!isset($innBat[$dismissed])) $innBat[$dismissed] = ['runs' => 0, 'balls' => 0, 'fours' => 0, 'sixes' => 0, 'hasBatted' => false, 'isOut' => false, 'dismissal' => 'not out'];
            $innBat[$dismissed]['hasBatted'] = true;
            $innBat[$dismissed]['isOut'] = true;
            $innBat[$dismissed]['dismissal'] = (string)($d['dismissal'] ?? 'bowled');
          }
          $disType = (string)($d['dismissal'] ?? 'bowled');
          if ($bow !== '' && !in_array($disType, ['run out', 'retired hurt'], true)) {
            $innBowl[$bow]['wickets']++;
          }
        }

        if ($bow !== '') {
          $currentOverBowler = $bow;
          $currentOverBalls[] = ['charge' => $bowlerCharge, 'legal' => $isLegal];
          $legalInOver = count(array_filter($currentOverBalls, fn($x) => $x['legal']));
          if ($legalInOver === 6) {
            $overRuns = array_sum(array_column($currentOverBalls, 'charge'));
            if ($overRuns === 0 && isset($innBowl[$currentOverBowler])) {
              $innBowl[$currentOverBowler]['maidens']++;
            }
            $currentOverBalls = [];
            $currentOverBowler = null;
          }
        }
      }

      foreach ($innBat as $pName => $bData) {
        if (!$bData['hasBatted']) continue;
        if (!isset($stats[$pName])) $stats[$pName] = initPlayerStatsRow($pName);
        $b = &$stats[$pName]['batting'];
        $b['innings']++;
        $b['runs'] += $bData['runs'];
        $b['balls'] += $bData['balls'];
        $b['fours'] += $bData['fours'];
        $b['sixes'] += $bData['sixes'];
        if (!$bData['isOut']) {
          $b['not_outs']++;
        } else {
          $b['dismissals']++;
        }
        if ($bData['runs'] >= 100) $b['hundreds']++;
        elseif ($bData['runs'] >= 50) $b['fifties']++;

        if ($bData['runs'] > $b['high_score']) {
          $b['high_score'] = $bData['runs'];
          $b['high_score_not_out'] = !$bData['isOut'];
        } elseif ($bData['runs'] === $b['high_score'] && !$bData['isOut']) {
          $b['high_score_not_out'] = true;
        }

        $stats[$pName]['match_log'][] = [
          'match_id' => $mId,
          'title' => $mTitle,
          'date' => $mDate,
          'team' => $inn['team'],
          'opp' => $inn['opp'],
          'type' => 'batting',
          'runs' => $bData['runs'],
          'balls' => $bData['balls'],
          'fours' => $bData['fours'],
          'sixes' => $bData['sixes'],
          'is_out' => $bData['isOut'],
          'dismissal' => $bData['dismissal'],
        ];
      }

      foreach ($innBowl as $pName => $bwData) {
        if (!$bwData['hasBowled']) continue;
        if (!isset($stats[$pName])) $stats[$pName] = initPlayerStatsRow($pName);
        $bw = &$stats[$pName]['bowling'];
        $bw['innings']++;
        $bw['balls'] += $bwData['balls'];
        $bw['runs'] += $bwData['runs'];
        $bw['wickets'] += $bwData['wickets'];
        $bw['maidens'] += $bwData['maidens'];
        if ($bwData['wickets'] >= 5) $bw['five_wickets']++;
        elseif ($bwData['wickets'] >= 3) $bw['three_wickets']++;

        $curW = $bwData['wickets'];
        $curR = $bwData['runs'];
        if ($curW > $bw['best_bowling_w'] || ($curW === $bw['best_bowling_w'] && $curW > 0 && $curR < $bw['best_bowling_r'])) {
          $bw['best_bowling_w'] = $curW;
          $bw['best_bowling_r'] = $curR;
          $bw['best_bowling'] = "{$curW}/{$curR}";
        }

        $ovFormatted = floor($bwData['balls'] / 6) . '.' . ($bwData['balls'] % 6);
        $stats[$pName]['match_log'][] = [
          'match_id' => $mId,
          'title' => $mTitle,
          'date' => $mDate,
          'team' => $inn['opp'],
          'opp' => $inn['team'],
          'type' => 'bowling',
          'overs' => $ovFormatted,
          'maidens' => $bwData['maidens'],
          'runs_conceded' => $bwData['runs'],
          'wickets' => $bwData['wickets'],
          'econ' => $bwData['balls'] > 0 ? round(($bwData['runs'] / ($bwData['balls'] / 6)), 2) : 0.00
        ];
      }
    }
  }

  foreach ($stats as $pName => &$p) {
    $b = &$p['batting'];
    $dis = $b['dismissals'];
    $b['average'] = $dis > 0 ? round($b['runs'] / $dis, 2) : ($b['innings'] > 0 ? (float)$b['runs'] : null);
    $b['strike_rate'] = $b['balls'] > 0 ? round(($b['runs'] / $b['balls']) * 100, 2) : 0.00;
    $b['hs_display'] = $b['high_score'] . ($b['high_score_not_out'] ? '*' : '');

    $bw = &$p['bowling'];
    $ovCount = floor($bw['balls'] / 6);
    $ballRem = $bw['balls'] % 6;
    $bw['overs'] = "{$ovCount}.{$ballRem}";
    $bw['economy'] = $bw['balls'] > 0 ? round($bw['runs'] / ($bw['balls'] / 6), 2) : 0.00;
    $bw['average'] = $bw['wickets'] > 0 ? round($bw['runs'] / $bw['wickets'], 2) : null;
    $bw['strike_rate'] = $bw['wickets'] > 0 ? round($bw['balls'] / $bw['wickets'], 2) : null;
    if ($bw['best_bowling_w'] === 0) {
      $bw['best_bowling'] = '—';
    }
  }
  unset($p);

  return $stats;
}

function getLeaderboards(array $stats): array
{
  $topRuns = array_values(array_filter($stats, fn($p) => $p['batting']['runs'] > 0));
  usort($topRuns, function($a, $b) {
    if ($b['batting']['runs'] !== $a['batting']['runs']) return $b['batting']['runs'] <=> $a['batting']['runs'];
    return ($b['batting']['strike_rate'] <=> $a['batting']['strike_rate']);
  });

  $topWickets = array_values(array_filter($stats, fn($p) => $p['bowling']['wickets'] > 0));
  usort($topWickets, function($a, $b) {
    if ($b['bowling']['wickets'] !== $a['bowling']['wickets']) return $b['bowling']['wickets'] <=> $a['bowling']['wickets'];
    return ($a['bowling']['economy'] <=> $b['bowling']['economy']);
  });

  $topSixes = array_values(array_filter($stats, fn($p) => $p['batting']['sixes'] > 0));
  usort($topSixes, fn($a, $b) => $b['batting']['sixes'] <=> $a['batting']['sixes']);

  $bestEcon = array_values(array_filter($stats, fn($p) => $p['bowling']['balls'] >= 6));
  usort($bestEcon, fn($a, $b) => $a['bowling']['economy'] <=> $b['bowling']['economy']);

  return [
    'top_runs' => array_slice($topRuns, 0, 10),
    'top_wickets' => array_slice($topWickets, 0, 10),
    'top_sixes' => array_slice($topSixes, 0, 10),
    'best_economy' => array_slice($bestEcon, 0, 10),
  ];
}

function allMatches(PDO $pdo): array
{
  $rows = $pdo->query('SELECT id,title,state_json,created_at,updated_at FROM matches ORDER BY id DESC')->fetchAll();
  foreach ($rows as &$r) {
    $s = json_decode($r['state_json'], true) ?: [];
    ensureRosters($s);
    $r = ['id' => (int)$r['id'], 'title' => $r['title'], 'state' => $s, 'created_at' => $r['created_at'], 'updated_at' => $r['updated_at']];
  }
  return $rows;
}
if ($action === 'list') respond(['matches' => allMatches($pdo)]);
if ($action === 'players') {
  ensurePlayersTable($pdo);
  $rows = $pdo->query('SELECT id, name, created_at FROM players ORDER BY name ASC')->fetchAll();
  respond(['players' => $rows]);
}
if ($action === 'player_create') {
  requireAdmin();
  $b = body();
  $name = trim((string)($b['name'] ?? ''));
  if ($name === '') respond(['error' => 'Player name is required'], 422);
  ensurePlayersTable($pdo);
  try {
    $st = $pdo->prepare('INSERT INTO players(name) VALUES(?)');
    $st->execute([$name]);
    $newId = (int)$pdo->lastInsertId();
    respond(['ok' => true, 'player' => ['id' => $newId, 'name' => $name]], 201);
  } catch (PDOException $e) {
    $st = $pdo->prepare('SELECT id, name FROM players WHERE name=?');
    $st->execute([$name]);
    $existing = $st->fetch();
    if ($existing) {
      respond(['ok' => true, 'player' => ['id' => (int)$existing['id'], 'name' => $existing['name']]]);
    }
    respond(['error' => 'Could not save player: ' . $e->getMessage()], 422);
  }
}
if ($action === 'player_update') {
  requireAdmin();
  $b = body();
  $pId = (int)($b['id'] ?? 0);
  $name = trim((string)($b['name'] ?? ''));
  if ($pId <= 0 || $name === '') respond(['error' => 'Valid ID and name required'], 422);
  ensurePlayersTable($pdo);
  $st = $pdo->prepare('UPDATE players SET name=? WHERE id=?');
  $st->execute([$name, $pId]);
  respond(['ok' => true, 'player' => ['id' => $pId, 'name' => $name]]);
}
if ($action === 'player_delete') {
  requireAdmin();
  $b = body();
  $pId = (int)($b['id'] ?? 0);
  if ($pId <= 0) respond(['error' => 'Valid player ID required'], 422);
  ensurePlayersTable($pdo);
  $st = $pdo->prepare('DELETE FROM players WHERE id=?');
  $st->execute([$pId]);
  respond(['ok' => true]);
}
if ($action === 'player_stats') {
  $target = isset($_GET['name']) ? trim((string)$_GET['name']) : null;
  $allStats = computeAllPlayerStats($pdo, $target);
  $leaderboards = getLeaderboards($allStats);
  if ($target !== null && $target !== '') {
    $playerData = $allStats[$target] ?? null;
    if (!$playerData) {
      $playerData = initPlayerStatsRow($target);
    }
    respond(['ok' => true, 'player' => $playerData, 'leaderboards' => $leaderboards]);
  }
  respond(['ok' => true, 'stats' => array_values($allStats), 'leaderboards' => $leaderboards]);
}
if ($action === 'create') {
  requireAdmin();
  $b = body();
  $a = trim((string)($b['team_a'] ?? 'Team A'));
  $c = trim((string)($b['team_b'] ?? 'Team B'));
  $playersA = max(2, min(15, (int)($b['players_a'] ?? $b['players'] ?? 7)));
  $playersB = max(2, min(15, (int)($b['players_b'] ?? $b['players'] ?? 7)));
  $overs = max(1, min(50, (int)($b['overs'] ?? 6)));
  $bat = ($b['batting_first'] ?? 'A') === 'B' ? 'B' : 'A';
  if ($a === '' || $c === '') respond(['error' => 'Enter both team names'], 422);
  $rosterA = cleanRoster($b['roster_a'] ?? null, $playersA, 'Player');
  $rosterB = cleanRoster($b['roster_b'] ?? null, $playersB, 'Player');
  $state = [
    'team_a' => $a,
    'team_b' => $c,
    'players_a' => $playersA,
    'players_b' => $playersB,
    'players' => max($playersA, $playersB),
    'roster_a' => $rosterA,
    'roster_b' => $rosterB,
    'overs_limit' => $overs,
    'batting_first' => $bat,
    'innings' => 1,
    'status' => 'live',
    'deliveries' => [],
    'crease' => null,
    'openers' => null,
    'openers_innings' => null,
    'created' => date('c')
  ];
  $st = $pdo->prepare('INSERT INTO matches(title,state_json) VALUES(?,?)');
  $st->execute([$a . ' vs ' . $c, json_encode($state)]);
  $newMatchId = (int)$pdo->lastInsertId();
  registerRosterPlayers($pdo, array_merge($rosterA, $rosterB));
  respond(['id' => $newMatchId, 'state' => $state], 201);
}
function teamName(array $s, string $side): string
{
  return $side === 'B' ? (string)$s['team_b'] : (string)$s['team_a'];
}
function battingSide(array $s): string
{
  $first = (($s['batting_first'] ?? 'A') === 'B') ? 'B' : 'A';
  return ((int)($s['innings'] ?? 1) === 2) ? ($first === 'A' ? 'B' : 'A') : $first;
}
function battingPlayers(array $s): int
{
  $side = battingSide($s);
  if ($side === 'B') return max(2, (int)($s['players_b'] ?? $s['players'] ?? 7));
  return max(2, (int)($s['players_a'] ?? $s['players'] ?? 7));
}
function inningsStats(array $deliveries): array
{
  $total = 0;
  $w = 0;
  $legal = 0;
  foreach ($deliveries as $d) {
    $total += (int)($d['runs'] ?? 0) + (int)($d['extra_runs'] ?? 0);
    if (!empty($d['wicket'])) $w++;
    $ex = $d['extra_type'] ?? '';
    if (!in_array($ex, ['wide', 'no-ball'], true)) $legal++;
  }
  return ['total' => $total, 'w' => $w, 'legal' => $legal];
}
function snapshotInnings(array $s, array $stats): array
{
  return [
    'team' => teamName($s, battingSide($s)),
    'side' => battingSide($s),
    'deliveries' => $s['deliveries'] ?? [],
    'total' => $stats['total'],
    'wickets' => $stats['w'],
    'legal' => $stats['legal'],
    'crease' => $s['crease'] ?? null,
    'openers' => $s['openers'] ?? null,
    'openers_innings' => $s['openers_innings'] ?? null
  ];
}
function closeFirstInnings(array &$s): void
{
  $stats = inningsStats($s['deliveries'] ?? []);
  $s['innings_1'] = snapshotInnings($s, $stats);
  $s['target'] = $stats['total'] + 1;
  $s['innings'] = 2;
  $s['deliveries'] = [];
  $s['crease'] = null;
  $s['openers'] = null;
  $s['openers_innings'] = null;
  $s['status'] = 'live';
  unset($s['innings_2'], $s['result']);
}
function resultFor(array $s, array $inn2): array
{
  $t1 = (int)($s['innings_1']['total'] ?? 0);
  $t2 = (int)$inn2['total'];
  $first = (($s['batting_first'] ?? 'A') === 'B') ? 'B' : 'A';
  $chaseName = teamName($s, battingSide($s));
  $firstName = teamName($s, $first);
  $target = (int)($s['target'] ?? ($t1 + 1));
  if ($t2 >= $target) {
    $remain = max(0, battingPlayers($s) - (int)$inn2['wickets']);
    $wk = $remain === 1 ? 'wicket' : 'wickets';
    return ['winner' => $chaseName, 'text' => $chaseName . ' won by ' . $remain . ' ' . $wk];
  }
  if ($t2 === $t1) return ['winner' => '', 'text' => 'Match tied'];
  $runs = $t1 - $t2;
  $rn = $runs === 1 ? 'run' : 'runs';
  return ['winner' => $firstName, 'text' => $firstName . ' won by ' . $runs . ' ' . $rn];
}
function completeMatch(array &$s): void
{
  $stats = inningsStats($s['deliveries'] ?? []);
  $s['innings_2'] = snapshotInnings($s, $stats);
  $s['result'] = resultFor($s, $s['innings_2']);
  $s['status'] = 'complete';
}
function markCompleted(array &$s): void
{
  if (!empty($s['locked'])) return;
  if (($s['status'] ?? '') !== 'complete') {
    if ((int)($s['innings'] ?? 1) === 2) completeMatch($s);
    else {
      $stats = inningsStats($s['deliveries'] ?? []);
      $s['innings_1'] = snapshotInnings($s, $stats);
      $s['status'] = 'complete';
      $s['result'] = ['winner' => '', 'text' => 'Match complete'];
    }
  }
  $s['locked'] = true;
}
function inningsShouldClose(array $s): bool
{
  $stats = inningsStats($s['deliveries'] ?? []);
  $oversDone = $stats['legal'] >= ((int)$s['overs_limit']) * 6;
  $chased = ((int)($s['innings'] ?? 1) === 2) && isset($s['target']) && $stats['total'] >= (int)$s['target'];
  return $oversDone || $chased;
}
function applyAutoClose(array &$s): void
{
  if (($s['status'] ?? '') !== 'live') return;
  if (!inningsShouldClose($s)) return;
  if ((int)($s['innings'] ?? 1) === 1) closeFirstInnings($s);
  else completeMatch($s);
}
function loadMatchForUpdate(PDO $pdo, int $id): array
{
  $st = $pdo->prepare('SELECT state_json FROM matches WHERE id=? FOR UPDATE');
  $st->execute([$id]);
  $r = $st->fetch();
  if (!$r) {
    $pdo->rollBack();
    respond(['error' => 'Match not found'], 404);
  }
  return json_decode($r['state_json'], true) ?: [];
}
function saveMatch(PDO $pdo, int $id, array $s): void
{
  $st = $pdo->prepare('UPDATE matches SET state_json=? WHERE id=?');
  $st->execute([json_encode($s), $id]);
}

$id = (int)($_GET['id'] ?? 0);
if ($action === 'get') {
  $st = $pdo->prepare('SELECT id,title,state_json FROM matches WHERE id=?');
  $st->execute([$id]);
  $r = $st->fetch();
  if (!$r) respond(['error' => 'Match not found'], 404);
  $s = json_decode($r['state_json'], true) ?: [];
  ensureRosters($s);
  respond(['id' => (int)$r['id'], 'title' => $r['title'], 'state' => $s]);
}
if ($action === 'update') {
  requireAdmin();
  $b = body();
  $pdo->beginTransaction();
  $s = loadMatchForUpdate($pdo, $id);
  ensureRosters($s);
  if (($s['status'] ?? '') === 'complete') {
    $pdo->rollBack();
    respond(['error' => 'Match is complete'], 422);
  }
  $a = trim((string)($b['team_a'] ?? ''));
  $c = trim((string)($b['team_b'] ?? ''));
  if ($a === '' || $c === '') {
    $pdo->rollBack();
    respond(['error' => 'Enter both team names'], 422);
  }
  $playersA = max(2, min(15, (int)($b['players_a'] ?? 7)));
  $playersB = max(2, min(15, (int)($b['players_b'] ?? 7)));
  $overs = max(1, min(50, (int)($b['overs'] ?? 6)));
  $usage = function (array $s, string $side): array {
    $w = 0;
    $legal = 0;
    $balls = 0;
    foreach (['innings_1', 'innings_2'] as $k) {
      if (!empty($s[$k]['side']) && $s[$k]['side'] === $side) {
        $w = max($w, (int)($s[$k]['wickets'] ?? 0));
        $legal = max($legal, (int)($s[$k]['legal'] ?? 0));
        $balls += count($s[$k]['deliveries'] ?? []);
      }
    }
    if (battingSide($s) === $side) {
      $st = inningsStats($s['deliveries'] ?? []);
      $w = max($w, $st['w']);
      $legal = max($legal, $st['legal']);
      $balls += count($s['deliveries'] ?? []);
    }
    return ['w' => $w, 'legal' => $legal, 'balls' => $balls];
  };
  $useA = $usage($s, 'A');
  $useB = $usage($s, 'B');
  if ($playersA < $useA['w'] || $playersB < $useB['w']) {
    $pdo->rollBack();
    respond(['error' => 'Player count cannot be less than wickets already fallen'], 422);
  }
  $minOvers = (int)ceil(max($useA['legal'], $useB['legal']) / 6);
  if ($overs < $minOvers) {
    $pdo->rollBack();
    respond(['error' => 'Overs cannot be less than overs already bowled'], 422);
  }
  $started = $useA['balls'] + $useB['balls'] > 0;
  $s['team_a'] = $a;
  $s['team_b'] = $c;
  $s['players_a'] = $playersA;
  $s['players_b'] = $playersB;
  $s['players'] = max($playersA, $playersB);
  $s['roster_a'] = cleanRoster($b['roster_a'] ?? ($s['roster_a'] ?? null), $playersA, 'Player');
  $s['roster_b'] = cleanRoster($b['roster_b'] ?? ($s['roster_b'] ?? null), $playersB, 'Player');
  $s['overs_limit'] = $overs;
  if (!$started) $s['batting_first'] = (($b['batting_first'] ?? 'A') === 'B') ? 'B' : 'A';
  foreach (['innings_1', 'innings_2'] as $k) {
    if (!empty($s[$k]['side'])) $s[$k]['team'] = teamName($s, (string)$s[$k]['side']);
  }
  $title = $a . ' vs ' . $c;
  saveMatch($pdo, $id, $s);
  $st = $pdo->prepare('UPDATE matches SET title=? WHERE id=?');
  $st->execute([$title, $id]);
  registerRosterPlayers($pdo, array_merge($s['roster_a'], $s['roster_b']));
  $pdo->commit();
  respond(['ok' => true, 'title' => $title, 'state' => $s]);
}
if ($action === 'set_crease') {
  requireAdmin();
  $b = body();
  $pdo->beginTransaction();
  $s = loadMatchForUpdate($pdo, $id);
  ensureRosters($s);
  if (($s['status'] ?? '') === 'complete') {
    $pdo->rollBack();
    respond(['error' => 'Match is complete'], 422);
  }
  $crease = [
    'striker' => trim((string)($b['striker'] ?? '')),
    'non_striker' => trim((string)($b['non_striker'] ?? '')),
    'bowler' => trim((string)($b['bowler'] ?? ''))
  ];
  $s['crease'] = $crease;
  if (!empty($b['set_as_openers']) || empty($s['openers'])) {
    $s['openers'] = $crease;
    $s['openers_innings'] = (int)($s['innings'] ?? 1);
  }
  saveMatch($pdo, $id, $s);
  $pdo->commit();
  respond(['ok' => true, 'state' => $s]);
}
if ($action === 'delivery') {
  requireAdmin();
  $b = body();
  $pdo->beginTransaction();
  $s = loadMatchForUpdate($pdo, $id);
  ensureRosters($s);
  if (($s['status'] ?? '') === 'complete') {
    $pdo->rollBack();
    respond(['error' => 'Match is complete'], 422);
  }
  $d = $b['delivery'] ?? [];
  $allowed = [
    'runs', 'extra_type', 'extra_runs', 'wicket', 'dismissal',
    'dismissed_player', 'batter', 'bowler', 'striker', 'non_striker',
    'next_batter', 'strike_rotated', 'crease_before', 'crease_after'
  ];
  $item = [];
  foreach ($allowed as $k) {
    $item[$k] = $d[$k] ?? null;
  }
  $item['extra_type'] = $item['extra_type'] ?? '';
  $item['runs'] = max(0, min(6, (int)$item['runs']));
  $item['extra_runs'] = max(0, min(10, (int)$item['extra_runs']));
  $item['wicket'] = !empty($item['wicket']);
  $item['created'] = date('c');
  if (!in_array($item['extra_type'], ['', 'wide', 'no-ball', 'bye', 'overthrow'], true)) {
    $pdo->rollBack();
    respond(['error' => 'Invalid extra type'], 422);
  }
  $s['deliveries'][] = $item;
  if (!empty($b['crease']) && is_array($b['crease'])) {
    $s['crease'] = $b['crease'];
  } elseif (!empty($item['crease_after']) && is_array($item['crease_after'])) {
    $s['crease'] = $item['crease_after'];
  }
  if (!empty($b['openers']) && is_array($b['openers'])) {
    $s['openers'] = $b['openers'];
  }
  applyAutoClose($s);
  saveMatch($pdo, $id, $s);
  $pdo->commit();
  respond(['ok' => true, 'state' => $s]);
}
if ($action === 'end_innings') {
  requireAdmin();
  $pdo->beginTransaction();
  $s = loadMatchForUpdate($pdo, $id);
  ensureRosters($s);
  if (($s['status'] ?? '') !== 'live' || (int)($s['innings'] ?? 1) !== 1) {
    $pdo->rollBack();
    respond(['error' => 'Can only end the first innings while it is live'], 422);
  }
  closeFirstInnings($s);
  saveMatch($pdo, $id, $s);
  $pdo->commit();
  respond(['ok' => true, 'state' => $s]);
}
if ($action === 'end_match') {
  requireAdmin();
  $pdo->beginTransaction();
  $s = loadMatchForUpdate($pdo, $id);
  ensureRosters($s);
  if (($s['status'] ?? '') !== 'live' || (int)($s['innings'] ?? 1) !== 2) {
    $pdo->rollBack();
    respond(['error' => 'Can only end the match during the second innings'], 422);
  }
  completeMatch($s);
  saveMatch($pdo, $id, $s);
  $pdo->commit();
  respond(['ok' => true, 'state' => $s]);
}
if ($action === 'mark_complete') {
  requireAdmin();
  $pdo->beginTransaction();
  $s = loadMatchForUpdate($pdo, $id);
  ensureRosters($s);
  if (!empty($s['locked'])) {
    $pdo->rollBack();
    respond(['error' => 'Match is marked completed'], 422);
  }
  markCompleted($s);
  saveMatch($pdo, $id, $s);
  $pdo->commit();
  respond(['ok' => true, 'state' => $s]);
}
if ($action === 'undo') {
  requireAdmin();
  $pdo->beginTransaction();
  $s = loadMatchForUpdate($pdo, $id);
  ensureRosters($s);
  if (!empty($s['locked'])) {
    $pdo->rollBack();
    respond(['error' => 'Match is marked completed'], 422);
  }
  if (($s['status'] ?? '') === 'complete') {
    $s['status'] = 'live';
    unset($s['result'], $s['innings_2']);
  } elseif ((int)($s['innings'] ?? 1) === 2 && empty($s['deliveries']) && !empty($s['innings_1'])) {
    $s['deliveries'] = $s['innings_1']['deliveries'] ?? [];
    $s['crease'] = $s['innings_1']['crease'] ?? null;
    $s['openers'] = $s['innings_1']['openers'] ?? null;
    $s['openers_innings'] = $s['innings_1']['openers_innings'] ?? 1;
    $s['innings'] = 1;
    $s['status'] = 'live';
    unset($s['target'], $s['innings_1'], $s['result'], $s['innings_2']);
  } else {
    if (empty($s['deliveries'])) {
      $pdo->rollBack();
      respond(['error' => 'Nothing to undo'], 422);
    }
    $popped = array_pop($s['deliveries']);
    if (!empty($s['deliveries'])) {
      $last = end($s['deliveries']);
      $s['crease'] = $last['crease_after'] ?? ($popped['crease_before'] ?? ($s['openers'] ?? null));
    } else {
      $s['crease'] = $popped['crease_before'] ?? ($s['openers'] ?? null);
    }
  }
  saveMatch($pdo, $id, $s);
  $pdo->commit();
  respond(['ok' => true, 'state' => $s]);
}
if ($action === 'delete') {
  requireAdmin();
  $pdo->beginTransaction();
  $s = loadMatchForUpdate($pdo, $id);
  if (!empty($s['locked'])) {
    $pdo->rollBack();
    respond(['error' => 'Match is marked completed'], 422);
  }
  $st = $pdo->prepare('DELETE FROM matches WHERE id=?');
  $st->execute([$id]);
  $pdo->commit();
  respond(['ok' => true]);
}
respond(['error' => 'Unknown action'], 404);
