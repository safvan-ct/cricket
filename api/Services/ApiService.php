<?php

declare(strict_types=1);

namespace Cricket\Api\Services;

use Cricket\Api\Core\ApiException;
use Cricket\Api\Core\Request;
use Cricket\Api\Repositories\MatchRepository;
use Cricket\Api\Repositories\PlayerRepository;
use PDOException;

final class ApiService
{
  private const EXTRA_TYPES = ['', 'wide', 'no-ball', 'bye', 'leg-bye', 'penalty', 'overthrow'];

  public function __construct(
    private MatchRepository $matches,
    private PlayerRepository $players,
    private array $config
  ) {}

  public function handle(string $action, Request $request): array
  {
    return match ($action) {
      'status' => $this->status(),
      'login' => $this->login($request),
      'logout' => $this->logout(),
      'list' => ['matches' => $this->matches->all()],
      'players' => $this->listPlayers(),
      'player_create' => $this->createPlayer($request),
      'player_update' => $this->updatePlayer($request),
      'player_delete' => $this->deletePlayer($request),
      'player_toggle_active' => $this->togglePlayer($request),
      'player_stats' => $this->playerStats($request),
      'create' => $this->createMatch($request),
      'get' => $this->getMatch($request->id()),
      'update' => $this->updateMatch($request),
      'set_crease' => $this->setCrease($request),
      'delivery' => $this->addDelivery($request),
      'edit_delivery' => $this->editDelivery($request),
      'end_innings' => $this->endInnings($request->id()),
      'end_match' => $this->endMatch($request->id()),
      'mark_complete' => $this->markComplete($request->id()),
      'undo' => $this->undo($request->id()),
      'delete' => $this->deleteMatch($request->id()),
      default => throw new ApiException('not_found', 'Unknown action', 404),
    };
  }

  private function status(): array
  {
    if (!empty($_SESSION['cricket_admin'])) {
      setcookie(session_name(), session_id(), [
        'expires' => time() + 2592000,
        'path' => '/',
        'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
        'httponly' => true,
        'samesite' => 'Lax',
      ]);
    }
    return [
      'authenticated' => !empty($_SESSION['cricket_admin']),
      'app_url' => $this->config['app_url'] ?? $this->config['qr_url'] ?? $this->config['qr_value'] ?? '',
    ];
  }

  private function login(Request $request): array
  {
    if (!hash_equals((string)($this->config['admin_password'] ?? ''), (string)($request->body['password'] ?? ''))) {
      throw new ApiException('unauthorized', 'Incorrect password', 401);
    }
    session_regenerate_id(true);
    $_SESSION['cricket_admin'] = true;
    $_SESSION['cricket_logged_at'] = time();
    return ['ok' => true];
  }

  private function logout(): array
  {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
      $params = session_get_cookie_params();
      setcookie(session_name(), '', [
        'expires' => time() - 42000,
        'path' => $params['path'] ?? '/',
        'domain' => $params['domain'] ?? '',
        'secure' => $params['secure'] ?? false,
        'httponly' => true,
        'samesite' => 'Lax',
      ]);
    }
    session_destroy();
    return ['ok' => true];
  }

  private function admin(): void
  {
    if (empty($_SESSION['cricket_admin'])) throw new ApiException('unauthorized', 'Admin sign-in required', 401);
  }

  private function listPlayers(): array
  {
    $rows = $this->players->all();
    foreach ($rows as &$row) $row['name'] = self::normalizeName($row['name']);
    unset($row);
    return ['players' => $rows];
  }

  private function createPlayer(Request $request): array
  {
    $this->admin();
    $name = $this->playerName($request->body);
    try {
      $id = $this->players->insert($name);
    } catch (PDOException $e) {
      if (!self::isDuplicateKey($e)) throw $e;
      throw new ApiException('duplicate_player', "A player named '$name' already exists. Please provide a unique jersey # or identifier.", 422);
    }
    return ['status' => 201, 'data' => ['ok' => true, 'player' => ['id' => $id, 'name' => $name]]];
  }

  private function updatePlayer(Request $request): array
  {
    $this->admin();
    $id = $request->id() ?: (int)($request->body['id'] ?? 0);
    if ($id <= 0 || trim((string)($request->body['name'] ?? '')) === '') {
      throw new ApiException('validation_error', 'Valid ID and name required', 422);
    }
    $name = $this->playerName($request->body);
    try {
      $this->players->rename($id, $name);
    } catch (PDOException $e) {
      if (!self::isDuplicateKey($e)) throw $e;
      throw new ApiException('duplicate_player', "A player named '$name' already exists. Please choose a different jersey # or identifier.", 422);
    }
    return ['ok' => true, 'player' => ['id' => $id, 'name' => $name]];
  }

  private function deletePlayer(Request $request): array
  {
    $this->admin();
    $id = $request->id() ?: (int)($request->body['id'] ?? 0);
    if ($id <= 0) throw new ApiException('validation_error', 'Valid player ID required', 422);
    $this->players->delete($id);
    return ['ok' => true];
  }

  private function togglePlayer(Request $request): array
  {
    $this->admin();
    $id = $request->id() ?: (int)($request->body['id'] ?? 0);
    if ($id <= 0) throw new ApiException('validation_error', 'Valid player ID required', 422);
    $active = array_key_exists('is_active', $request->body) ? (bool)$request->body['is_active'] : null;
    return ['ok' => true, 'player' => $this->players->toggle($id, $active)];
  }

  private function playerStats(Request $request): array
  {
    $target = trim((string)($request->query['name'] ?? ''));
    $rows = $this->players->statsPlayers();
    $stats = [];
    foreach ($rows as $row) {
      $name = self::normalizeName($row['name']);
      $stats[$name] = self::emptyStats($name, (int)$row['id'], (int)$row['is_active']);
    }
    foreach ($this->matches->completed() as $match) {
      $state = $match['state'] ?? null;
      if (!is_array($state)) continue;
      $rosters = array_unique(array_merge($state['roster_a'] ?? [], $state['roster_b'] ?? []));
      foreach ($rosters as $name) {
        $name = self::normalizeName($name);
        if ($name === '') continue;
        if (!isset($stats[$name])) $stats[$name] = self::emptyStats($name);
        $stats[$name]['matches']++;
      }
      $innings = [];
      if (!empty($state['innings_1'])) $innings[] = self::statsInnings($state, $state['innings_1'], $match);
      if (!empty($state['innings_2'])) $innings[] = self::statsInnings($state, $state['innings_2'], $match);
      elseif ((int)($state['innings'] ?? 1) === 2 || !empty($state['deliveries'])) {
        $side = (($state['batting_first'] ?? 'A') === 'B') ? 'A' : 'B';
        $innings[] = self::statsInnings($state, ['side' => $side, 'deliveries' => $state['deliveries'] ?? []], $match);
      }
      foreach ($innings as $inn) self::aggregateInnings($stats, $inn);
    }
    foreach ($stats as &$player) {
      $bat = &$player['batting'];
      $bat['average'] = $bat['dismissals'] > 0 ? round($bat['runs'] / $bat['dismissals'], 2) : null;
      $bat['strike_rate'] = $bat['balls'] > 0 ? round(($bat['runs'] / $bat['balls']) * 100, 2) : 0.0;
      $bat['hs_display'] = (string)$bat['high_score'] . ($bat['high_score_not_out'] ? '*' : '');
      $bw = &$player['bowling'];
      $bw['overs'] = floor($bw['balls'] / 6) . '.' . ($bw['balls'] % 6);
      $bw['economy'] = $bw['balls'] > 0 ? round($bw['runs'] / ($bw['balls'] / 6), 2) : 0.0;
      $bw['average'] = $bw['wickets'] > 0 ? round($bw['runs'] / $bw['wickets'], 2) : null;
      $bw['strike_rate'] = $bw['wickets'] > 0 ? round($bw['balls'] / $bw['wickets'], 2) : null;
      if ($bw['best_bowling_w'] === 0) $bw['best_bowling'] = '—';
    }
    unset($player, $bat, $bw);
    $result = ['ok' => true, 'stats' => array_values($stats), 'leaderboards' => self::leaderboards($stats)];
    if ($target !== '') {
      $target = self::normalizeName($target);
      $result['player'] = $stats[$target] ?? self::emptyStats($target);
      unset($result['stats']);
    }
    return $result;
  }

  private static function statsInnings(array $state, array $innings, array $match): array
  {
    $side = ($innings['side'] ?? 'A') === 'B' ? 'B' : 'A';
    return [
      'side' => $side,
      'team' => self::teamName($state, $side),
      'opp' => self::teamName($state, $side === 'A' ? 'B' : 'A'),
      'deliveries' => $innings['deliveries'] ?? [],
      'title' => self::teamName($state, 'A') . ' vs ' . self::teamName($state, 'B'),
      'match_id' => (int)$match['id'],
      'date' => $match['created_at'] ?? '',
    ];
  }

  private static function aggregateInnings(array &$stats, array $innings): void
  {
    $batting = [];
    $bowling = [];
    $currentOver = [];
    $overBowler = null;
    foreach ($innings['deliveries'] as $delivery) {
      $batter = self::normalizeName($delivery['batter'] ?? $delivery['striker'] ?? '');
      $nonStriker = self::normalizeName($delivery['non_striker'] ?? '');
      $bowler = self::normalizeName($delivery['bowler'] ?? '');
      $runs = (int)($delivery['runs'] ?? 0);
      $extra = (int)($delivery['extra_runs'] ?? 0);
      $type = (string)($delivery['extra_type'] ?? '');
      $legal = !in_array($type, ['wide', 'no-ball'], true);
      $charge = in_array($type, ['bye', 'leg-bye'], true) ? 0 : $runs + $extra;
      foreach ([$batter, $nonStriker] as $name) {
        if ($name !== '' && !isset($batting[$name])) $batting[$name] = ['runs'=>0,'balls'=>0,'fours'=>0,'sixes'=>0,'batted'=>false,'out'=>false,'dismissal'=>'not out'];
      }
      if ($batter !== '') {
        $batting[$batter]['batted'] = true;
        $batting[$batter]['runs'] += $runs + ($type === 'overthrow' ? $extra : 0);
        if ($legal) $batting[$batter]['balls']++;
        if ($runs === 4 && $type !== 'overthrow') $batting[$batter]['fours']++;
        if ($runs === 6 && $type !== 'overthrow') $batting[$batter]['sixes']++;
      }
      if ($nonStriker !== '') $batting[$nonStriker]['batted'] = true;
      if ($bowler !== '') {
        if (!isset($bowling[$bowler])) $bowling[$bowler] = ['balls'=>0,'runs'=>0,'wickets'=>0,'maidens'=>0,'bowled'=>false];
        $bowling[$bowler]['bowled'] = true;
        $bowling[$bowler]['runs'] += $charge;
        if ($legal) $bowling[$bowler]['balls']++;
        $overBowler = $bowler;
        $currentOver[] = ['legal' => $legal, 'charge' => $charge];
        $legalInOver = count(array_filter($currentOver, fn($ball) => $ball['legal']));
        if ($legalInOver === 6) {
          if (array_sum(array_column($currentOver, 'charge')) === 0 && isset($bowling[$overBowler])) {
            $bowling[$overBowler]['maidens']++;
          }
          $currentOver = [];
          $overBowler = null;
        }
      }
      if (!empty($delivery['wicket'])) {
        $dismissed = self::normalizeName($delivery['dismissed_player'] ?? $batter);
        if ($dismissed !== '') {
          if (!isset($batting[$dismissed])) $batting[$dismissed] = ['runs'=>0,'balls'=>0,'fours'=>0,'sixes'=>0,'batted'=>false,'out'=>false,'dismissal'=>'not out'];
          $batting[$dismissed]['batted'] = true;
          $batting[$dismissed]['out'] = true;
          $batting[$dismissed]['dismissal'] = (string)($delivery['dismissal'] ?? 'bowled');
        }
        if ($bowler !== '' && !in_array((string)($delivery['dismissal'] ?? 'bowled'), ['run out', 'retired hurt'], true)) $bowling[$bowler]['wickets']++;
      }
    }
    foreach ($batting as $name => $line) {
      if (!$line['batted']) continue;
      if (!isset($stats[$name])) $stats[$name] = self::emptyStats($name);
      $b =& $stats[$name]['batting'];
      $b['innings']++; $b['runs'] += $line['runs']; $b['balls'] += $line['balls'];
      $b['fours'] += $line['fours']; $b['sixes'] += $line['sixes'];
      if ($line['out']) $b['dismissals']++; else $b['not_outs']++;
      if ($line['runs'] >= 100) $b['hundreds']++; elseif ($line['runs'] >= 50) $b['fifties']++;
      if ($line['runs'] > $b['high_score']) { $b['high_score'] = $line['runs']; $b['high_score_not_out'] = !$line['out']; }
      elseif ($line['runs'] === $b['high_score'] && !$line['out']) $b['high_score_not_out'] = true;
      $stats[$name]['match_log'][] = [
        'match_id'=>$innings['match_id'],'title'=>$innings['title'],'date'=>$innings['date'],
        'team'=>$innings['team'],'opp'=>$innings['opp'],'type'=>'batting','runs'=>$line['runs'],
        'balls'=>$line['balls'],'fours'=>$line['fours'],'sixes'=>$line['sixes'],
        'is_out'=>$line['out'],'dismissal'=>$line['dismissal'],
      ];
    }
    foreach ($bowling as $name => $line) {
      if (!$line['bowled']) continue;
      if (!isset($stats[$name])) $stats[$name] = self::emptyStats($name);
      $b =& $stats[$name]['bowling'];
      $b['innings']++; $b['balls'] += $line['balls']; $b['runs'] += $line['runs'];
      $b['wickets'] += $line['wickets']; $b['maidens'] += $line['maidens'];
      if ($line['wickets'] >= 5) $b['five_wickets']++; elseif ($line['wickets'] >= 3) $b['three_wickets']++;
      if ($line['wickets'] > $b['best_bowling_w'] || ($line['wickets'] === $b['best_bowling_w'] && $line['wickets'] > 0 && $line['runs'] < $b['best_bowling_r'])) {
        $b['best_bowling_w'] = $line['wickets']; $b['best_bowling_r'] = $line['runs']; $b['best_bowling'] = $line['wickets'] . '/' . $line['runs'];
      }
      $stats[$name]['match_log'][] = [
        'match_id'=>$innings['match_id'],'title'=>$innings['title'],'date'=>$innings['date'],
        'team'=>$innings['opp'],'opp'=>$innings['team'],'type'=>'bowling',
        'overs'=>floor($line['balls']/6).'.'.($line['balls']%6),'maidens'=>$line['maidens'],
        'runs_conceded'=>$line['runs'],'wickets'=>$line['wickets'],
        'econ'=>$line['balls'] > 0 ? round($line['runs'] / ($line['balls']/6), 2) : 0.00,
      ];
    }
  }

  private static function leaderboards(array $stats): array
  {
    $runs = array_values(array_filter($stats, fn($p) => $p['batting']['runs'] > 0));
    usort($runs, fn($a, $b) => [$b['batting']['runs'], $b['batting']['strike_rate']] <=> [$a['batting']['runs'], $a['batting']['strike_rate']]);
    $wickets = array_values(array_filter($stats, fn($p) => $p['bowling']['wickets'] > 0));
    usort($wickets, fn($a, $b) => [$b['bowling']['wickets'], $a['bowling']['economy']] <=> [$a['bowling']['wickets'], $b['bowling']['economy']]);
    $sixes = array_values(array_filter($stats, fn($p) => $p['batting']['sixes'] > 0));
    usort($sixes, fn($a, $b) => $b['batting']['sixes'] <=> $a['batting']['sixes']);
    $economy = array_values(array_filter($stats, fn($p) => $p['bowling']['balls'] >= 6));
    usort($economy, fn($a, $b) => $a['bowling']['economy'] <=> $b['bowling']['economy']);
    return ['top_runs'=>array_slice($runs,0,10),'top_wickets'=>array_slice($wickets,0,10),
      'top_sixes'=>array_slice($sixes,0,10),'best_economy'=>array_slice($economy,0,10)];
  }

  private static function emptyStats(string $name, int $id = 0, int $active = 1): array
  {
    return [
      'id' => $id, 'name' => $name, 'is_active' => $active, 'matches' => 0,
      'batting' => [
        'innings' => 0, 'runs' => 0, 'balls' => 0, 'fours' => 0, 'sixes' => 0,
        'not_outs' => 0, 'high_score' => 0, 'high_score_not_out' => false, 'hs_display' => '0',
        'fifties' => 0, 'hundreds' => 0, 'dismissals' => 0, 'average' => null, 'strike_rate' => 0.0,
      ],
      'bowling' => [
        'innings' => 0, 'balls' => 0, 'overs' => '0.0', 'maidens' => 0, 'runs' => 0,
        'wickets' => 0, 'best_bowling_w' => 0, 'best_bowling_r' => 9999, 'best_bowling' => '—',
        'three_wickets' => 0, 'five_wickets' => 0, 'economy' => 0.0, 'average' => null, 'strike_rate' => null,
      ],
      'match_log' => [],
    ];
  }

  private function playerName(array $body): string
  {
    $raw = trim((string)($body['name'] ?? ''));
    if ($raw === '') throw new ApiException('validation_error', 'Player name is required', 422);
    $name = self::normalizeName($raw);
    $tag = trim((string)($body['tag'] ?? ''));
    if ($tag !== '' && !preg_match('/\(' . preg_quote($tag, '/') . '\)$/', $name)) {
      $name = rtrim((string)preg_replace('/\s*\(.*?\)$/', '', $name)) . ' (' . $tag . ')';
    }
    return $name;
  }

  private static function isDuplicateKey(PDOException $exception): bool
  {
    return (string)$exception->getCode() === '23000'
      || (isset($exception->errorInfo[1]) && (int)$exception->errorInfo[1] === 1062);
  }

  private function createMatch(Request $request): array
  {
    $this->admin();
    $b = $request->body;
    $a = trim((string)($b['team_a'] ?? 'Team A'));
    $other = trim((string)($b['team_b'] ?? 'Team B'));
    if ($a === '' || $other === '') throw new ApiException('validation_error', 'Enter both team names', 422);
    $playersA = max(2, min(15, (int)($b['players_a'] ?? $b['players'] ?? 7)));
    $playersB = max(2, min(15, (int)($b['players_b'] ?? $b['players'] ?? 7)));
    $state = [
      'team_a' => $a, 'team_b' => $other, 'players_a' => $playersA, 'players_b' => $playersB,
      'players' => max($playersA, $playersB), 'roster_a' => self::cleanRoster($b['roster_a'] ?? null, $playersA),
      'roster_b' => self::cleanRoster($b['roster_b'] ?? null, $playersB),
      'overs_limit' => max(1, min(50, (int)($b['overs'] ?? 6))),
      'batting_first' => ($b['batting_first'] ?? 'A') === 'B' ? 'B' : 'A',
      'innings' => 1, 'status' => 'live', 'deliveries' => [], 'crease' => null,
      'openers' => null, 'openers_innings' => null, 'created' => date('c'),
    ];
    $this->matches->begin();
    try {
      $id = $this->matches->create($state);
      $this->matches->commit();
    } catch (\Throwable $e) {
      $this->matches->rollback();
      throw $e;
    }
    return ['status' => 201, 'data' => ['id' => $id, 'state' => $state]];
  }

  private function getMatch(int $id): array
  {
    $state = $this->matches->find($id);
    if (!$state) throw new ApiException('not_found', 'Match not found', 404);
    return ['id' => $id, 'title' => $state['team_a'] . ' vs ' . $state['team_b'], 'state' => $state];
  }

  private function updateMatch(Request $request): array
  {
    $this->admin();
    $id = $request->id();
    $b = $request->body;
    $this->matches->begin();
    try {
      $s = $this->matches->requireForUpdate($id);
      self::ensureRosters($s);
      if (($s['status'] ?? '') === 'complete') throw new ApiException('invalid_state', 'Match is complete', 422);
      $a = trim((string)($b['team_a'] ?? ''));
      $other = trim((string)($b['team_b'] ?? ''));
      if ($a === '' || $other === '') throw new ApiException('validation_error', 'Enter both team names', 422);
      $playersA = max(2, min(15, (int)($b['players_a'] ?? 7)));
      $playersB = max(2, min(15, (int)($b['players_b'] ?? 7)));
      $overs = max(1, min(50, (int)($b['overs'] ?? 6)));
      $usageA = self::sideUsage($s, 'A');
      $usageB = self::sideUsage($s, 'B');
      if ($playersA < $usageA['w'] || $playersB < $usageB['w']) throw new ApiException('validation_error', 'Player count cannot be less than wickets already fallen', 422);
      if ($overs < (int)ceil(max($usageA['legal'], $usageB['legal']) / 6)) throw new ApiException('validation_error', 'Overs cannot be less than overs already bowled', 422);
      $started = $usageA['balls'] + $usageB['balls'] > 0;
      $s['team_a'] = $a; $s['team_b'] = $other;
      $s['players_a'] = $playersA; $s['players_b'] = $playersB; $s['players'] = max($playersA, $playersB);
      $s['roster_a'] = self::cleanRoster($b['roster_a'] ?? $s['roster_a'], $playersA);
      $s['roster_b'] = self::cleanRoster($b['roster_b'] ?? $s['roster_b'], $playersB);
      $s['overs_limit'] = $overs;
      if (!$started) $s['batting_first'] = ($b['batting_first'] ?? 'A') === 'B' ? 'B' : 'A';
      foreach (['innings_1', 'innings_2'] as $key) {
        if (!empty($s[$key]['side'])) $s[$key]['team'] = self::teamName($s, (string)$s[$key]['side']);
      }
      $this->matches->save($id, $s);
      $this->matches->commit();
      return ['ok' => true, 'title' => $a . ' vs ' . $other, 'state' => $s];
    } catch (\Throwable $e) {
      $this->matches->rollback();
      throw $e;
    }
  }

  private function setCrease(Request $request): array
  {
    $this->admin();
    return $this->mutate($request->id(), function (array &$s) use ($request): void {
      self::ensureRosters($s);
      if (($s['status'] ?? '') === 'complete') throw new ApiException('invalid_state', 'Match is complete', 422);
      if (self::inningsShouldClose($s)) throw new ApiException('invalid_state', 'Current innings is already finished', 422);
      $b = $request->body;
      $s['crease'] = [
        'striker' => trim((string)($b['striker'] ?? '')),
        'non_striker' => trim((string)($b['non_striker'] ?? '')),
        'bowler' => trim((string)($b['bowler'] ?? '')),
      ];
      if (!empty($b['set_as_openers']) || empty($s['openers'])) {
        $s['openers'] = $s['crease'];
        $s['openers_innings'] = (int)($s['innings'] ?? 1);
      }
    });
  }

  private function addDelivery(Request $request): array
  {
    $this->admin();
    return $this->mutate($request->id(), function (array &$s) use ($request): void {
      self::ensureRosters($s);
      if (($s['status'] ?? '') === 'complete') throw new ApiException('invalid_state', 'Match is complete', 422);
      if (self::inningsShouldClose($s)) throw new ApiException('invalid_state', 'Current innings is already finished', 422);
      $b = $request->body;
      $d = is_array($b['delivery'] ?? null) ? $b['delivery'] : [];
      $allowed = ['runs', 'extra_type', 'extra_runs', 'wicket', 'dismissal', 'dismissed_player',
        'batter', 'bowler', 'striker', 'non_striker', 'next_batter', 'strike_rotated', 'crease_before', 'crease_after'];
      $item = [];
      foreach ($allowed as $key) $item[$key] = $d[$key] ?? null;
      $item['extra_type'] = $item['extra_type'] ?? '';
      $item['runs'] = max(0, min(6, (int)$item['runs']));
      $item['extra_runs'] = max(0, min(10, (int)$item['extra_runs']));
      $item['wicket'] = !empty($item['wicket']);
      if (!in_array($item['extra_type'], self::EXTRA_TYPES, true)) throw new ApiException('validation_error', 'Invalid extra type', 422);
      $item['created'] = date('c');
      $s['deliveries'][] = $item;
      if (!empty($b['crease']) && is_array($b['crease'])) $s['crease'] = $b['crease'];
      elseif (!empty($item['crease_after']) && is_array($item['crease_after'])) $s['crease'] = $item['crease_after'];
      if (!empty($b['openers']) && is_array($b['openers'])) $s['openers'] = $b['openers'];
      self::applyAutoClose($s);
    });
  }

  private function editDelivery(Request $request): array
  {
    $this->admin();
    $b = $request->body;
    $innings = filter_var($b['innings'] ?? null, FILTER_VALIDATE_INT);
    $index = filter_var($b['index'] ?? null, FILTER_VALIDATE_INT);
    if ($innings === false || !in_array($innings, [1, 2], true) || $index === false || $index < 0) {
      throw new ApiException('validation_error', 'Invalid delivery', 422);
    }
    return $this->mutate($request->id(), function (array &$s) use ($b, $innings, $index): void {
      if (($s['status'] ?? '') !== 'live' || !empty($s['locked'])) throw new ApiException('invalid_state', 'Only deliveries in a live, unlocked match can be edited', 422);
      $current = (int)($s['innings'] ?? 1);
      if ($innings === 1 && $current === 1) { $deliveries = $s['deliveries'] ?? []; $location = 'current'; }
      elseif ($innings === 1 && $current === 2 && isset($s['innings_1'])) { $deliveries = $s['innings_1']['deliveries'] ?? []; $location = 'first'; }
      elseif ($innings === 2 && $current === 2) { $deliveries = $s['deliveries'] ?? []; $location = 'current'; }
      else throw new ApiException('invalid_state', 'This innings cannot be edited', 422);
      if (!array_key_exists($index, $deliveries)) throw new ApiException('not_found', 'Delivery not found', 404);
      if (!is_array($b['delivery'] ?? null)) throw new ApiException('validation_error', 'Invalid delivery', 422);
      $d = array_merge($deliveries[$index], $b['delivery']);
      $allowed = ['runs', 'extra_type', 'extra_runs', 'wicket', 'dismissal', 'dismissed_player', 'batter', 'bowler'];
      $item = [];
      foreach ($allowed as $key) $item[$key] = $d[$key] ?? null;
      $item['extra_type'] = $item['extra_type'] ?? '';
      $item['runs'] = max(0, min(6, (int)$item['runs']));
      $item['extra_runs'] = max(0, min(10, (int)$item['extra_runs']));
      $item['wicket'] = !empty($item['wicket']);
      $item['dismissal'] = $item['wicket'] ? ((string)$item['dismissal'] ?: 'bowled') : '';
      $item['created'] = $deliveries[$index]['created'] ?? date('c');
      if (!in_array($item['extra_type'], self::EXTRA_TYPES, true)) throw new ApiException('validation_error', 'Invalid extra type', 422);
      $deliveries[$index] = $item;
      $stats = self::inningsStats($deliveries);
      $side = $innings === 1 ? ((($s['batting_first'] ?? 'A') === 'B') ? 'B' : 'A') : ((($s['batting_first'] ?? 'A') === 'B') ? 'A' : 'B');
      $maxPlayers = (int)($side === 'B' ? ($s['players_b'] ?? $s['players'] ?? 7) : ($s['players_a'] ?? $s['players'] ?? 7));
      if ($stats['legal'] > (int)($s['overs_limit'] ?? 0) * 6 || $stats['w'] > $maxPlayers) {
        throw new ApiException('validation_error', 'The edited delivery would exceed this innings limit', 422);
      }
      if ($location === 'current') { $s['deliveries'] = $deliveries; self::applyAutoClose($s); }
      else {
        $s['innings_1']['deliveries'] = $deliveries;
        $s['innings_1']['total'] = $stats['total'];
        $s['innings_1']['wickets'] = $stats['w'];
        $s['innings_1']['legal'] = $stats['legal'];
        $s['target'] = $stats['total'] + 1;
        self::applyAutoClose($s);
      }
    });
  }

  private function endInnings(int $id): array
  {
    $this->admin();
    return $this->mutate($id, function (array &$s): void {
      self::ensureRosters($s);
      if (($s['status'] ?? '') !== 'live' || (int)($s['innings'] ?? 1) !== 1) throw new ApiException('invalid_state', 'Can only end the first innings while it is live', 422);
      self::closeFirstInnings($s);
    });
  }

  private function endMatch(int $id): array
  {
    $this->admin();
    return $this->mutate($id, function (array &$s): void {
      self::ensureRosters($s);
      if (($s['status'] ?? '') !== 'live' || (int)($s['innings'] ?? 1) !== 2) throw new ApiException('invalid_state', 'Can only end the match during the second innings', 422);
      self::completeMatch($s);
    });
  }

  private function markComplete(int $id): array
  {
    $this->admin();
    return $this->mutate($id, function (array &$s): void {
      self::ensureRosters($s);
      if (!empty($s['locked'])) throw new ApiException('invalid_state', 'Match is marked completed', 422);
      self::markCompleted($s);
    });
  }

  private function undo(int $id): array
  {
    $this->admin();
    return $this->mutate($id, function (array &$s): void {
      self::ensureRosters($s);
      if (!empty($s['locked'])) throw new ApiException('invalid_state', 'Match is marked completed', 422);
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
        if (empty($s['deliveries'])) throw new ApiException('invalid_state', 'Nothing to undo', 422);
        $popped = array_pop($s['deliveries']);
        if (!empty($s['deliveries'])) {
          $last = end($s['deliveries']);
          $s['crease'] = $last['crease_after'] ?? ($popped['crease_before'] ?? ($s['openers'] ?? null));
        } else $s['crease'] = $popped['crease_before'] ?? ($s['openers'] ?? null);
      }
    });
  }

  private function deleteMatch(int $id): array
  {
    $this->admin();
    $this->matches->begin();
    try {
      $state = $this->matches->requireForUpdate($id);
      if (!empty($state['locked'])) throw new ApiException('invalid_state', 'Match is marked completed', 422);
      $this->matches->delete($id);
      $this->matches->commit();
      return ['ok' => true];
    } catch (\Throwable $e) {
      $this->matches->rollback();
      throw $e;
    }
  }

  private function mutate(int $id, callable $change): array
  {
    $this->matches->begin();
    try {
      $state = $this->matches->requireForUpdate($id);
      $change($state);
      $this->matches->save($id, $state);
      $this->matches->commit();
      return ['ok' => true, 'state' => $state];
    } catch (\Throwable $e) {
      $this->matches->rollback();
      throw $e;
    }
  }

  private static function cleanRoster(mixed $raw, int $count): array
  {
    $values = is_array($raw) ? array_values($raw) : [];
    $roster = [];
    for ($i = 0; $i < $count; $i++) {
      $name = self::normalizeName(trim((string)($values[$i] ?? '')));
      $roster[] = $name !== '' ? $name : 'Player ' . ($i + 1);
    }
    return $roster;
  }

  private static function ensureRosters(array &$s): void
  {
    $a = max(2, (int)($s['players_a'] ?? $s['players'] ?? 7));
    $b = max(2, (int)($s['players_b'] ?? $s['players'] ?? 7));
    $s['roster_a'] = self::cleanRoster($s['roster_a'] ?? null, $a);
    $s['roster_b'] = self::cleanRoster($s['roster_b'] ?? null, $b);
  }

  private static function normalizeName(mixed $value): string
  {
    $value = trim((string)$value);
    if ($value === '') return '';
    if (is_numeric($value)) return 'Player ' . $value;
    if (preg_match('/^(.*?)\s*\((.*?)\)$/u', $value, $m)) return self::normalizeName($m[1]) . ' (' . trim($m[2]) . ')';
    $lower = mb_strtolower($value, 'UTF-8');
    return (string)preg_replace_callback('/(^|[\s\-\.\/\'])([a-z])/u', fn($m) => $m[1] . strtoupper($m[2]), $lower);
  }

  private static function teamName(array $s, string $side): string
  {
    return (string)($side === 'B' ? ($s['team_b'] ?? 'Team B') : ($s['team_a'] ?? 'Team A'));
  }

  private static function battingSide(array $s): string
  {
    $first = ($s['batting_first'] ?? 'A') === 'B' ? 'B' : 'A';
    return (int)($s['innings'] ?? 1) === 2 ? ($first === 'A' ? 'B' : 'A') : $first;
  }

  private static function inningsStats(array $deliveries): array
  {
    $total = $wickets = $legal = 0;
    foreach ($deliveries as $d) {
      $total += (int)($d['runs'] ?? 0) + (int)($d['extra_runs'] ?? 0);
      if (!empty($d['wicket'])) $wickets++;
      if (!in_array($d['extra_type'] ?? '', ['wide', 'no-ball'], true)) $legal++;
    }
    return ['total' => $total, 'w' => $wickets, 'legal' => $legal];
  }

  private static function battingPlayers(array $s): int
  {
    $side = self::battingSide($s);
    return max(2, (int)($side === 'B' ? ($s['players_b'] ?? $s['players'] ?? 7) : ($s['players_a'] ?? $s['players'] ?? 7)));
  }

  private static function inningsShouldClose(array $s): bool
  {
    $stats = self::inningsStats($s['deliveries'] ?? []);
    return $stats['legal'] >= (int)($s['overs_limit'] ?? 6) * 6
      || ((int)($s['innings'] ?? 1) === 2 && isset($s['target']) && $stats['total'] >= (int)$s['target'])
      || $stats['w'] >= self::battingPlayers($s);
  }

  private static function snapshot(array $s, array $stats): array
  {
    $side = self::battingSide($s);
    return [
      'team' => self::teamName($s, $side), 'side' => $side, 'deliveries' => $s['deliveries'] ?? [],
      'total' => $stats['total'], 'wickets' => $stats['w'], 'legal' => $stats['legal'],
      'crease' => $s['crease'] ?? null, 'openers' => $s['openers'] ?? null,
      'openers_innings' => $s['openers_innings'] ?? null,
    ];
  }

  private static function closeFirstInnings(array &$s): void
  {
    $stats = self::inningsStats($s['deliveries'] ?? []);
    $s['innings_1'] = self::snapshot($s, $stats);
    $s['target'] = $stats['total'] + 1;
    $s['innings'] = 2;
    $s['deliveries'] = [];
    $s['crease'] = $s['openers'] = $s['openers_innings'] = null;
    $s['status'] = 'live';
    unset($s['innings_2'], $s['result']);
  }

  private static function resultFor(array $s, array $inn): array
  {
    $firstTotal = (int)($s['innings_1']['total'] ?? 0);
    $total = (int)$inn['total'];
    $firstSide = ($s['batting_first'] ?? 'A') === 'B' ? 'B' : 'A';
    $chase = self::teamName($s, self::battingSide($s));
    $first = self::teamName($s, $firstSide);
    $target = (int)($s['target'] ?? ($firstTotal + 1));
    if ($total >= $target) {
      $remaining = max(0, self::battingPlayers($s) - (int)$inn['wickets']);
      return ['winner' => $chase, 'text' => $chase . ' won by ' . $remaining . ' ' . ($remaining === 1 ? 'wicket' : 'wickets')];
    }
    if ($total === $firstTotal) return ['winner' => '', 'text' => 'Match tied'];
    $runs = $firstTotal - $total;
    return ['winner' => $first, 'text' => $first . ' won by ' . $runs . ' ' . ($runs === 1 ? 'run' : 'runs')];
  }

  private static function completeMatch(array &$s): void
  {
    $inn = self::snapshot($s, self::inningsStats($s['deliveries'] ?? []));
    $s['innings_2'] = $inn;
    $s['result'] = self::resultFor($s, $inn);
    $s['status'] = 'complete';
    $s['crease'] = null;
  }

  private static function markCompleted(array &$s): void
  {
    if (empty($s['locked'])) {
      if (($s['status'] ?? '') !== 'complete') {
        if ((int)($s['innings'] ?? 1) === 2) self::completeMatch($s);
        else {
          $s['innings_1'] = self::snapshot($s, self::inningsStats($s['deliveries'] ?? []));
          $s['status'] = 'complete';
          $s['result'] = ['winner' => '', 'text' => 'Match complete'];
        }
      }
      $s['locked'] = true;
    }
  }

  private static function applyAutoClose(array &$s): void
  {
    if (($s['status'] ?? '') !== 'live' || !self::inningsShouldClose($s)) return;
    if ((int)($s['innings'] ?? 1) === 1) self::closeFirstInnings($s);
    else self::completeMatch($s);
  }

  private static function sideUsage(array $s, string $side): array
  {
    $usage = ['w' => 0, 'legal' => 0, 'balls' => 0];
    foreach (['innings_1', 'innings_2'] as $key) {
      if (($s[$key]['side'] ?? '') === $side) {
        $usage['w'] = max($usage['w'], (int)($s[$key]['wickets'] ?? 0));
        $usage['legal'] = max($usage['legal'], (int)($s[$key]['legal'] ?? 0));
        $usage['balls'] += count($s[$key]['deliveries'] ?? []);
      }
    }
    if (self::battingSide($s) === $side) {
      $stats = self::inningsStats($s['deliveries'] ?? []);
      $usage['w'] = max($usage['w'], $stats['w']);
      $usage['legal'] = max($usage['legal'], $stats['legal']);
      $usage['balls'] += count($s['deliveries'] ?? []);
    }
    return $usage;
  }
}
