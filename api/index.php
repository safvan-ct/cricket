<?php

declare(strict_types=1);

$sessionLifetime = 30 * 86400; // 30 days
@ini_set('session.gc_maxlifetime', (string)$sessionLifetime);
@ini_set('session.cookie_lifetime', (string)$sessionLifetime);

$sessionSavePath = __DIR__ . '/../storage/sessions';
if (!is_dir($sessionSavePath)) {
  @mkdir($sessionSavePath, 0750, true);
  if (is_dir($sessionSavePath)) {
    @file_put_contents($sessionSavePath . '/.htaccess', "Require all denied\nDeny from all\n");
  }
}
if (is_dir($sessionSavePath) && is_writable($sessionSavePath)) {
  @session_save_path($sessionSavePath);
}

$isHttps = (
  (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ||
  (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower((string)$_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https') ||
  (!empty($_SERVER['HTTP_CF_VISITOR']) && str_contains((string)$_SERVER['HTTP_CF_VISITOR'], '"https"')) ||
  (!empty($_SERVER['SERVER_PORT']) && (int)$_SERVER['SERVER_PORT'] === 443)
);

session_name('cricket_admin_session');
session_set_cookie_params([
  'lifetime' => $sessionLifetime,
  'path' => '/',
  'domain' => '',
  'secure' => $isHttps,
  'httponly' => true,
  'samesite' => 'Lax'
]);

session_start();

function refreshAdminSessionCookie(int $lifetime, bool $isHttps): void
{
  if (!empty($_SESSION['cricket_admin'])) {
    setcookie(session_name(), session_id(), [
      'expires' => time() + $lifetime,
      'path' => '/',
      'domain' => '',
      'secure' => $isHttps,
      'httponly' => true,
      'samesite' => 'Lax'
    ]);
  }
}

refreshAdminSessionCookie($sessionLifetime, $isHttps);
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
  $_SESSION['cricket_logged_at'] = time();

  setcookie(session_name(), session_id(), [
    'expires' => time() + $sessionLifetime,
    'path' => '/',
    'domain' => '',
    'secure' => $isHttps,
    'httponly' => true,
    'samesite' => 'Lax'
  ]);

  respond(['ok' => true]);
}
if ($action === 'status') {
  $qrUrl = $config['app_url'] ?? $config['qr_url'] ?? $config['qr_value'] ?? '';
  $auth = !empty($_SESSION['cricket_admin']);
  if ($auth) {
    setcookie(session_name(), session_id(), [
      'expires' => time() + $sessionLifetime,
      'path' => '/',
      'domain' => '',
      'secure' => $isHttps,
      'httponly' => true,
      'samesite' => 'Lax'
    ]);
  }
  respond(['authenticated' => $auth, 'app_url' => $qrUrl]);
}
if ($action === 'logout') {
  $_SESSION = [];
  if (ini_get('session.use_cookies')) {
    $params = session_get_cookie_params();
    setcookie(
      session_name(),
      '',
      [
        'expires' => time() - 42000,
        'path' => $params['path'] ?? '/',
        'domain' => $params['domain'] ?? '',
        'secure' => $params['secure'] ?? false,
        'httponly' => $params['httponly'] ?? true,
        'samesite' => $params['samesite'] ?? 'Lax'
      ]
    );
  }
  session_destroy();
  respond(['ok' => true]);
}
function requireAdmin(): void
{
  if (empty($_SESSION['cricket_admin'])) respond(['error' => 'Admin sign-in required'], 401);
}
function allMatches(PDO $pdo): array
{
  $rows = $pdo->query('SELECT id,title,state_json,created_at,updated_at FROM matches ORDER BY id DESC')->fetchAll();
  foreach ($rows as &$r) {
    $s = json_decode($r['state_json'], true) ?: [];
    $r = ['id' => (int)$r['id'], 'title' => $r['title'], 'state' => $s, 'created_at' => $r['created_at'], 'updated_at' => $r['updated_at']];
  }
  return $rows;
}
if ($action === 'list') respond(['matches' => allMatches($pdo)]);
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
  $state = ['team_a' => $a, 'team_b' => $c, 'players_a' => $playersA, 'players_b' => $playersB, 'players' => max($playersA, $playersB), 'overs_limit' => $overs, 'batting_first' => $bat, 'innings' => 1, 'status' => 'live', 'deliveries' => [], 'created' => date('c')];
  $st = $pdo->prepare('INSERT INTO matches(title,state_json) VALUES(?,?)');
  $st->execute([$a . ' vs ' . $c, json_encode($state)]);
  respond(['id' => (int)$pdo->lastInsertId(), 'state' => $state], 201);
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
  return ['team' => teamName($s, battingSide($s)), 'side' => battingSide($s), 'deliveries' => $s['deliveries'] ?? [], 'total' => $stats['total'], 'wickets' => $stats['w'], 'legal' => $stats['legal']];
}
function closeFirstInnings(array &$s): void
{
  $stats = inningsStats($s['deliveries'] ?? []);
  $s['innings_1'] = snapshotInnings($s, $stats);
  $s['target'] = $stats['total'] + 1;
  $s['innings'] = 2;
  $s['deliveries'] = [];
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
  $allOut = $stats['w'] >= battingPlayers($s);
  $chased = ((int)($s['innings'] ?? 1) === 2) && isset($s['target']) && $stats['total'] >= (int)$s['target'];
  return $oversDone || $allOut || $chased;
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
  respond(['id' => (int)$r['id'], 'title' => $r['title'], 'state' => json_decode($r['state_json'], true)]);
}
if ($action === 'update') {
  requireAdmin();
  $b = body();
  $pdo->beginTransaction();
  $s = loadMatchForUpdate($pdo, $id);
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
  $s['overs_limit'] = $overs;
  if (!$started) $s['batting_first'] = (($b['batting_first'] ?? 'A') === 'B') ? 'B' : 'A';
  foreach (['innings_1', 'innings_2'] as $k) {
    if (!empty($s[$k]['side'])) $s[$k]['team'] = teamName($s, (string)$s[$k]['side']);
  }
  $title = $a . ' vs ' . $c;
  saveMatch($pdo, $id, $s);
  $st = $pdo->prepare('UPDATE matches SET title=? WHERE id=?');
  $st->execute([$title, $id]);
  $pdo->commit();
  respond(['ok' => true, 'title' => $title, 'state' => $s]);
}
if ($action === 'delivery') {
  requireAdmin();
  $b = body();
  $pdo->beginTransaction();
  $s = loadMatchForUpdate($pdo, $id);
  if (($s['status'] ?? '') === 'complete') {
    $pdo->rollBack();
    respond(['error' => 'Match is complete'], 422);
  }
  $d = $b['delivery'] ?? [];
  $allowed = ['runs', 'extra_type', 'extra_runs', 'wicket', 'dismissal', 'dismissed_player', 'batter', 'bowler'];
  $item = [];
  foreach ($allowed as $k) {
    $item[$k] = $d[$k] ?? null;
  }
  $item['extra_type'] = $item['extra_type'] ?? '';
  $item['runs'] = max(0, min(10, (int)$item['runs']));
  $item['extra_runs'] = max(0, min(10, (int)$item['extra_runs']));
  $item['wicket'] = !empty($item['wicket']);
  $item['created'] = date('c');
  if (!in_array($item['extra_type'], ['', 'wide', 'no-ball', 'bye', 'overthrow'], true)) {
    $pdo->rollBack();
    respond(['error' => 'Invalid extra type'], 422);
  }
  $s['deliveries'][] = $item;
  applyAutoClose($s);
  saveMatch($pdo, $id, $s);
  $pdo->commit();
  respond(['ok' => true, 'state' => $s]);
}
if ($action === 'end_innings') {
  requireAdmin();
  $pdo->beginTransaction();
  $s = loadMatchForUpdate($pdo, $id);
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
  if (!empty($s['locked'])) {
    $pdo->rollBack();
    respond(['error' => 'Match is marked completed'], 422);
  }
  if (($s['status'] ?? '') === 'complete') {
    $s['status'] = 'live';
    unset($s['result'], $s['innings_2']);
  } elseif ((int)($s['innings'] ?? 1) === 2 && empty($s['deliveries']) && !empty($s['innings_1'])) {
    $s['deliveries'] = $s['innings_1']['deliveries'] ?? [];
    $s['innings'] = 1;
    $s['status'] = 'live';
    unset($s['target'], $s['innings_1'], $s['result'], $s['innings_2']);
  } else {
    if (empty($s['deliveries'])) {
      $pdo->rollBack();
      respond(['error' => 'Nothing to undo'], 422);
    }
    array_pop($s['deliveries']);
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
