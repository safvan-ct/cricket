<?php

declare(strict_types=1);

function storageColumnExists(PDO $pdo, string $table, string $column): bool
{
  $st = $pdo->prepare(
    'SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?'
  );
  $st->execute([$table, $column]);
  return (bool)$st->fetchColumn();
}

function storageEnsureColumn(PDO $pdo, string $table, string $column, string $definition): void
{
  if (!storageColumnExists($pdo, $table, $column)) {
    $pdo->exec("ALTER TABLE `$table` ADD COLUMN `$column` $definition");
  }
}

function storageEnsureIndex(PDO $pdo, string $table, string $index, string $definition): void
{
  $st = $pdo->prepare(
    'SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?'
  );
  $st->execute([$table, $index]);
  if (!$st->fetchColumn()) {
    $pdo->exec("ALTER TABLE `$table` ADD $definition");
  }
}

function ensureNormalizedStorage(PDO $pdo): void
{
  $lockExpression = "CONCAT('cricket-schema-', LEFT(SHA2(DATABASE(), 256), 24))";
  $lock = $pdo->query("SELECT GET_LOCK($lockExpression, 30)")->fetchColumn();
  if ((string)$lock !== '1') {
    throw new RuntimeException('Could not acquire the database schema migration lock');
  }
  try {
    $schemaPath = __DIR__ . '/../schema.sql';
    $schema = file_get_contents($schemaPath);
    if ($schema === false) {
      throw new RuntimeException('Unable to read schema.sql');
    }
    foreach (array_filter(array_map('trim', explode(';', $schema))) as $statement) {
      $pdo->exec($statement);
    }

    storageEnsureColumn($pdo, 'players', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1');
    storageEnsureColumn($pdo, 'matches', 'team_a', "VARCHAR(150) NOT NULL DEFAULT ''");
    storageEnsureColumn($pdo, 'matches', 'team_b', "VARCHAR(150) NOT NULL DEFAULT ''");
    storageEnsureColumn($pdo, 'matches', 'players_a', 'TINYINT UNSIGNED NOT NULL DEFAULT 7');
    storageEnsureColumn($pdo, 'matches', 'players_b', 'TINYINT UNSIGNED NOT NULL DEFAULT 7');
    storageEnsureColumn($pdo, 'matches', 'overs_limit', 'TINYINT UNSIGNED NOT NULL DEFAULT 6');
    storageEnsureColumn($pdo, 'matches', 'batting_first', "CHAR(1) NOT NULL DEFAULT 'A'");
    storageEnsureColumn($pdo, 'matches', 'current_innings', 'TINYINT UNSIGNED NOT NULL DEFAULT 1');
    storageEnsureColumn($pdo, 'matches', 'status', "VARCHAR(16) NOT NULL DEFAULT 'live'");
    storageEnsureColumn($pdo, 'matches', 'locked', 'TINYINT(1) NOT NULL DEFAULT 0');
    storageEnsureColumn($pdo, 'matches', 'target', 'SMALLINT UNSIGNED DEFAULT NULL');
    storageEnsureColumn($pdo, 'matches', 'result_winner_side', 'CHAR(1) DEFAULT NULL');
    storageEnsureColumn($pdo, 'matches', 'result_text', 'VARCHAR(255) DEFAULT NULL');
    storageEnsureIndex($pdo, 'players', 'idx_players_active_name', 'INDEX `idx_players_active_name` (`is_active`, `name`)');
    storageEnsureIndex($pdo, 'matches', 'idx_matches_status_created', 'INDEX `idx_matches_status_created` (`status`, `created_at`, `id`)');
    storageEnsureIndex($pdo, 'matches', 'idx_matches_created', 'INDEX `idx_matches_created` (`created_at`, `id`)');

    if (storageColumnExists($pdo, 'matches', 'state_json')) {
      $legacyIds = $pdo->query('SELECT id FROM matches ORDER BY id')->fetchAll(PDO::FETCH_COLUMN);
      $legacyState = $pdo->prepare('SELECT state_json FROM matches WHERE id = ?');
      foreach ($legacyIds as $legacyId) {
        $legacyState->execute([(int)$legacyId]);
        $json = $legacyState->fetchColumn();
        try {
          $state = json_decode((string)$json, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException $e) {
          throw new RuntimeException('Cannot migrate match ' . (int)$legacyId . ': invalid legacy state JSON', 0, $e);
        }
        if (!is_array($state)) {
          throw new RuntimeException('Cannot migrate match ' . (int)$legacyId . ': legacy state is not an object');
        }
        $pdo->beginTransaction();
        try {
          persistNormalizedMatch($pdo, (int)$legacyId, $state);
          $pdo->commit();
        } catch (Throwable $e) {
          if ($pdo->inTransaction()) $pdo->rollBack();
          throw $e;
        }
      }
      $pdo->exec('ALTER TABLE matches DROP COLUMN state_json');
    }
    if (storageColumnExists($pdo, 'matches', 'title')) {
      $pdo->exec('ALTER TABLE matches DROP COLUMN title');
    }
  } finally {
    $pdo->query("SELECT RELEASE_LOCK($lockExpression)")->fetchColumn();
  }
}

function storagePlayerId(PDO $pdo, string $name): ?int
{
  $name = normalizePlayerName($name);
  if ($name === '') return null;

  $st = $pdo->prepare('INSERT IGNORE INTO players (name) VALUES (?)');
  $st->execute([$name]);
  $st = $pdo->prepare('SELECT id FROM players WHERE name = ?');
  $st->execute([$name]);
  $id = $st->fetchColumn();
  return $id === false ? null : (int)$id;
}

function storageRosterEntry(PDO $pdo, int $matchId, string $side, string $name, bool $active = false, int $order = 0): ?int
{
  $name = normalizePlayerName($name);
  if ($name === '') return null;

  $playerId = storagePlayerId($pdo, $name);
  if ($active) {
    $st = $pdo->prepare(
      'SELECT id FROM match_roster
       WHERE match_id = ? AND side = ? AND display_name = ? AND batting_order = ?
       ORDER BY id ASC LIMIT 1'
    );
    $st->execute([$matchId, $side, $name, $order]);
  } else {
    $st = $pdo->prepare(
      'SELECT id FROM match_roster
       WHERE match_id = ? AND side = ? AND display_name = ?
       ORDER BY is_active DESC, id ASC LIMIT 1'
    );
    $st->execute([$matchId, $side, $name]);
  }
  $rosterId = $st->fetchColumn();
  if ($rosterId !== false) {
    if ($active) {
      $update = $pdo->prepare(
        'UPDATE match_roster
         SET player_id = COALESCE(player_id, ?), is_active = 1, batting_order = ?
         WHERE id = ?'
      );
      $update->execute([$playerId, $order, (int)$rosterId]);
    }
    return (int)$rosterId;
  }

  $insert = $pdo->prepare(
    'INSERT INTO match_roster (match_id, side, player_id, display_name, batting_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?)'
  );
  $insert->execute([$matchId, $side, $playerId, $name, $order, $active ? 1 : 0]);
  return (int)$pdo->lastInsertId();
}

function storageRosterIds(PDO $pdo, int $matchId): array
{
  $st = $pdo->prepare(
    'SELECT id, side, display_name
     FROM match_roster WHERE match_id = ?
     ORDER BY is_active DESC, id ASC'
  );
  $st->execute([$matchId]);
  $ids = ['A' => [], 'B' => []];
  foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $row) {
    $name = normalizePlayerName((string)$row['display_name']);
    $side = $row['side'] === 'B' ? 'B' : 'A';
    if ($name !== '' && !isset($ids[$side][$name])) $ids[$side][$name] = (int)$row['id'];
  }
  return $ids;
}

function storageRosterId(PDO $pdo, int $matchId, string $side, mixed $name, array &$rosterIds): ?int
{
  $name = normalizePlayerName($name);
  if ($name === '') return null;
  if (isset($rosterIds[$side][$name])) return $rosterIds[$side][$name];
  $rosterId = storageRosterEntry($pdo, $matchId, $side, $name);
  if ($rosterId !== null) $rosterIds[$side][$name] = $rosterId;
  return $rosterId;
}

function storageCreaseIds(PDO $pdo, int $matchId, string $battingSide, string $bowlingSide, mixed $crease, array &$rosterIds): array
{
  $crease = is_array($crease) ? $crease : [];
  return [
    storageRosterId($pdo, $matchId, $battingSide, $crease['striker'] ?? '', $rosterIds),
    storageRosterId($pdo, $matchId, $battingSide, $crease['non_striker'] ?? '', $rosterIds),
    storageRosterId($pdo, $matchId, $bowlingSide, $crease['bowler'] ?? '', $rosterIds),
  ];
}

function storageDateTime(mixed $value): string
{
  $timestamp = is_string($value) && $value !== '' ? strtotime($value) : false;
  return date('Y-m-d H:i:s', $timestamp === false ? time() : $timestamp);
}

function storageSideForInnings(array $state, int $innings): string
{
  $first = ($state['batting_first'] ?? 'A') === 'B' ? 'B' : 'A';
  return $innings === 2 ? ($first === 'A' ? 'B' : 'A') : $first;
}

function storageInningsState(array $state, int $number): ?array
{
  $snapshotKey = 'innings_' . $number;
  if (isset($state[$snapshotKey]) && is_array($state[$snapshotKey])) {
    return $state[$snapshotKey];
  }
  if ((int)($state['innings'] ?? 1) !== $number) return null;

  return [
    'side' => storageSideForInnings($state, $number),
    'deliveries' => $state['deliveries'] ?? [],
    'total' => null,
    'wickets' => null,
    'legal' => null,
    'crease' => $state['crease'] ?? null,
    'openers' => $state['openers'] ?? null,
    'openers_innings' => $state['openers_innings'] ?? null,
  ];
}

function storageDeliveryValues(PDO $pdo, int $matchId, int $inningsNumber, array $delivery, array &$rosterIds): array
{
  $battingSide = storageSideForInnings(['batting_first' => $delivery['_batting_first'] ?? 'A'], $inningsNumber);
  $bowlingSide = $battingSide === 'A' ? 'B' : 'A';
  $before = $delivery['crease_before'] ?? null;
  $after = $delivery['crease_after'] ?? null;
  [$beforeStriker, $beforeNonStriker, $beforeBowler] =
    storageCreaseIds($pdo, $matchId, $battingSide, $bowlingSide, $before, $rosterIds);
  [$afterStriker, $afterNonStriker, $afterBowler] =
    storageCreaseIds($pdo, $matchId, $battingSide, $bowlingSide, $after, $rosterIds);

  return [
    max(0, min(6, (int)($delivery['runs'] ?? 0))),
    (string)($delivery['extra_type'] ?? ''),
    max(0, min(10, (int)($delivery['extra_runs'] ?? 0))),
    !empty($delivery['wicket']) ? 1 : 0,
    isset($delivery['dismissal']) ? (string)$delivery['dismissal'] : null,
    storageRosterId($pdo, $matchId, $battingSide, $delivery['batter'] ?? $delivery['striker'] ?? '', $rosterIds),
    storageRosterId($pdo, $matchId, $battingSide, $delivery['striker'] ?? '', $rosterIds),
    storageRosterId($pdo, $matchId, $battingSide, $delivery['non_striker'] ?? '', $rosterIds),
    storageRosterId($pdo, $matchId, $bowlingSide, $delivery['bowler'] ?? '', $rosterIds),
    storageRosterId($pdo, $matchId, $battingSide, $delivery['dismissed_player'] ?? '', $rosterIds),
    storageRosterId($pdo, $matchId, $battingSide, $delivery['next_batter'] ?? '', $rosterIds),
    array_key_exists('strike_rotated', $delivery) && $delivery['strike_rotated'] !== null
      ? (!empty($delivery['strike_rotated']) ? 1 : 0)
      : null,
    $beforeStriker,
    $beforeNonStriker,
    $beforeBowler,
    $afterStriker,
    $afterNonStriker,
    $afterBowler,
    storageDateTime($delivery['created'] ?? null),
  ];
}

function storageUpsertDeliveryBatch(PDO $pdo, int $rowCount, array $values): void
{
  if ($rowCount === 0) return;
  $rowPlaceholder = '(' . implode(', ', array_fill(0, 21, '?')) . ')';
  $sql =
    'INSERT INTO deliveries
     (innings_id, sequence_number, runs, extra_type, extra_runs, is_wicket, dismissal,
      batter_id, striker_id, non_striker_id, bowler_id, dismissed_player_id, next_batter_id,
      strike_rotated, crease_before_striker_id, crease_before_non_striker_id, crease_before_bowler_id,
      crease_after_striker_id, crease_after_non_striker_id, crease_after_bowler_id, created_at)
     VALUES ' . implode(', ', array_fill(0, $rowCount, $rowPlaceholder)) . '
     ON DUPLICATE KEY UPDATE runs = VALUES(runs), extra_type = VALUES(extra_type),
      extra_runs = VALUES(extra_runs), is_wicket = VALUES(is_wicket), dismissal = VALUES(dismissal),
      batter_id = VALUES(batter_id), striker_id = VALUES(striker_id), non_striker_id = VALUES(non_striker_id),
      bowler_id = VALUES(bowler_id), dismissed_player_id = VALUES(dismissed_player_id),
      next_batter_id = VALUES(next_batter_id), strike_rotated = VALUES(strike_rotated),
      crease_before_striker_id = VALUES(crease_before_striker_id),
      crease_before_non_striker_id = VALUES(crease_before_non_striker_id),
      crease_before_bowler_id = VALUES(crease_before_bowler_id),
      crease_after_striker_id = VALUES(crease_after_striker_id),
      crease_after_non_striker_id = VALUES(crease_after_non_striker_id),
      crease_after_bowler_id = VALUES(crease_after_bowler_id), created_at = VALUES(created_at)';
  $pdo->prepare($sql)->execute($values);
}

function persistNormalizedMatch(PDO $pdo, int $matchId, array $state): void
{
  ensureRosters($state);
  $teamA = trim((string)($state['team_a'] ?? 'Team A'));
  $teamB = trim((string)($state['team_b'] ?? 'Team B'));
  $playersA = max(2, min(15, (int)($state['players_a'] ?? $state['players'] ?? 7)));
  $playersB = max(2, min(15, (int)($state['players_b'] ?? $state['players'] ?? 7)));
  $currentInnings = ((int)($state['innings'] ?? 1) === 2) ? 2 : 1;
  $winner = (string)($state['result']['winner'] ?? '');
  $winnerSide = $winner !== '' && $winner === $teamA ? 'A' : ($winner !== '' && $winner === $teamB ? 'B' : null);

  $update = $pdo->prepare(
    'UPDATE matches SET team_a = ?, team_b = ?, players_a = ?, players_b = ?,
     overs_limit = ?, batting_first = ?, current_innings = ?, status = ?, locked = ?,
     target = ?, result_winner_side = ?, result_text = ?
     WHERE id = ?'
  );
  $update->execute([
    $teamA,
    $teamB,
    $playersA,
    $playersB,
    max(1, min(50, (int)($state['overs_limit'] ?? 6))),
    ($state['batting_first'] ?? 'A') === 'B' ? 'B' : 'A',
    $currentInnings,
    (string)($state['status'] ?? 'live'),
    !empty($state['locked']) ? 1 : 0,
    isset($state['target']) ? max(0, (int)$state['target']) : null,
    $winnerSide,
    isset($state['result']['text']) ? (string)$state['result']['text'] : null,
    $matchId,
  ]);
  if ($update->rowCount() === 0) {
    $check = $pdo->prepare('SELECT 1 FROM matches WHERE id = ?');
    $check->execute([$matchId]);
    if (!$check->fetchColumn()) throw new RuntimeException('Match not found while saving normalized state');
  }

  foreach (['A', 'B'] as $side) {
    $deactivate = $pdo->prepare('UPDATE match_roster SET is_active = 0 WHERE match_id = ? AND side = ?');
    $deactivate->execute([$matchId, $side]);
    $roster = $side === 'A' ? $state['roster_a'] : $state['roster_b'];
    foreach (array_values($roster) as $index => $name) {
      storageRosterEntry($pdo, $matchId, $side, (string)$name, true, $index + 1);
    }
  }
  $rosterIds = storageRosterIds($pdo, $matchId);

  $inningsStates = [];
  for ($number = 1; $number <= 2; $number++) {
    $inningsState = storageInningsState($state, $number);
    if ($inningsState !== null) $inningsStates[$number] = $inningsState;
  }
  $existing = $pdo->prepare('SELECT id, innings_number FROM innings WHERE match_id = ?');
  $existing->execute([$matchId]);
  foreach ($existing->fetchAll(PDO::FETCH_ASSOC) as $row) {
    if (!isset($inningsStates[(int)$row['innings_number']])) {
      $delete = $pdo->prepare('DELETE FROM innings WHERE id = ?');
      $delete->execute([(int)$row['id']]);
    }
  }

  foreach ($inningsStates as $number => $inn) {
    $side = ($inn['side'] ?? storageSideForInnings($state, (int)$number)) === 'B' ? 'B' : 'A';
    $bowlingSide = $side === 'A' ? 'B' : 'A';
    $deliveries = is_array($inn['deliveries'] ?? null) ? array_values($inn['deliveries']) : [];
    $stats = inningsStats($deliveries);
    $total = isset($inn['total']) ? (int)$inn['total'] : $stats['total'];
    $wickets = isset($inn['wickets']) ? (int)$inn['wickets'] : $stats['w'];
    $legalBalls = isset($inn['legal']) ? (int)$inn['legal'] : $stats['legal'];
    $crease = $inn['crease'] ?? null;
    $openers = $inn['openers'] ?? null;
    [$strikerId, $nonStrikerId, $bowlerId] =
      storageCreaseIds($pdo, $matchId, $side, $bowlingSide, $crease, $rosterIds);
    [$openerStrikerId, $openerNonStrikerId, $openerBowlerId] =
      storageCreaseIds($pdo, $matchId, $side, $bowlingSide, $openers, $rosterIds);
    $closed = isset($state['innings_' . $number]) || ($state['status'] ?? '') === 'complete';
    $target = $number === 2 && isset($state['target']) ? (int)$state['target'] : null;

    $upsert = $pdo->prepare(
      'INSERT INTO innings
       (match_id, innings_number, batting_side, is_closed, total_runs, wickets, legal_balls, target,
        striker_id, non_striker_id, bowler_id, opener_striker_id, opener_non_striker_id, opener_bowler_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE batting_side = VALUES(batting_side), is_closed = VALUES(is_closed),
        total_runs = VALUES(total_runs), wickets = VALUES(wickets), legal_balls = VALUES(legal_balls),
        target = VALUES(target), striker_id = VALUES(striker_id), non_striker_id = VALUES(non_striker_id),
        bowler_id = VALUES(bowler_id), opener_striker_id = VALUES(opener_striker_id),
        opener_non_striker_id = VALUES(opener_non_striker_id), opener_bowler_id = VALUES(opener_bowler_id)'
    );
    $upsert->execute([
      $matchId, $number, $side, $closed ? 1 : 0, max(0, $total), max(0, $wickets),
      max(0, $legalBalls), $target, $strikerId, $nonStrikerId, $bowlerId,
      $openerStrikerId, $openerNonStrikerId, $openerBowlerId,
    ]);
    $selectInnings = $pdo->prepare('SELECT id FROM innings WHERE match_id = ? AND innings_number = ?');
    $selectInnings->execute([$matchId, $number]);
    $inningsId = (int)$selectInnings->fetchColumn();

    $batchRows = 0;
    $batchValues = [];
    foreach ($deliveries as $index => $delivery) {
      $delivery['_batting_first'] = $state['batting_first'] ?? 'A';
      $values = storageDeliveryValues($pdo, $matchId, (int)$number, $delivery, $rosterIds);
      array_push($batchValues, $inningsId, $index + 1, ...$values);
      $batchRows++;
      if ($batchRows === 100) {
        storageUpsertDeliveryBatch($pdo, $batchRows, $batchValues);
        $batchRows = 0;
        $batchValues = [];
      }
    }
    storageUpsertDeliveryBatch($pdo, $batchRows, $batchValues);
    $deleteTrailing = $pdo->prepare('DELETE FROM deliveries WHERE innings_id = ? AND sequence_number > ?');
    $deleteTrailing->execute([$inningsId, count($deliveries)]);
  }
}

function storagePlayerName(array $rosterById, mixed $id): ?string
{
  if ($id === null || (int)$id <= 0) return null;
  return $rosterById[(int)$id] ?? null;
}

function storageReadCrease(array $row, array $rosterById, string $prefix = ''): ?array
{
  $striker = storagePlayerName($rosterById, $row[$prefix . 'striker_id'] ?? null);
  $nonStriker = storagePlayerName($rosterById, $row[$prefix . 'non_striker_id'] ?? null);
  $bowler = storagePlayerName($rosterById, $row[$prefix . 'bowler_id'] ?? null);
  if (!$striker && !$nonStriker && !$bowler) return null;
  return ['striker' => $striker, 'non_striker' => $nonStriker, 'bowler' => $bowler];
}

function storageReadDelivery(PDO $pdo, array $row, array $rosterById): array
{
  return [
    'runs' => (int)$row['runs'],
    'extra_type' => (string)$row['extra_type'],
    'extra_runs' => (int)$row['extra_runs'],
    'wicket' => (bool)$row['is_wicket'],
    'dismissal' => $row['dismissal'],
    'batter' => storagePlayerName($rosterById, $row['batter_id']),
    'striker' => storagePlayerName($rosterById, $row['striker_id']),
    'non_striker' => storagePlayerName($rosterById, $row['non_striker_id']),
    'bowler' => storagePlayerName($rosterById, $row['bowler_id']),
    'dismissed_player' => storagePlayerName($rosterById, $row['dismissed_player_id']),
    'next_batter' => storagePlayerName($rosterById, $row['next_batter_id']),
    'strike_rotated' => $row['strike_rotated'] === null ? null : (bool)$row['strike_rotated'],
    'crease_before' => storageReadCrease($row, $rosterById, 'crease_before_'),
    'crease_after' => storageReadCrease($row, $rosterById, 'crease_after_'),
    'created' => date('c', strtotime((string)$row['created_at'])),
  ];
}

function loadNormalizedMatchState(PDO $pdo, int $matchId, bool $forUpdate = false): ?array
{
  $sql = 'SELECT * FROM matches WHERE id = ?' . ($forUpdate ? ' FOR UPDATE' : '');
  $matchQuery = $pdo->prepare($sql);
  $matchQuery->execute([$matchId]);
  $match = $matchQuery->fetch(PDO::FETCH_ASSOC);
  if (!$match) return null;

  $rosterQuery = $pdo->prepare(
    'SELECT id, side, display_name, is_active, batting_order
     FROM match_roster WHERE match_id = ? ORDER BY side, is_active DESC, batting_order, id'
  );
  $rosterQuery->execute([$matchId]);
  $rosterRows = $rosterQuery->fetchAll(PDO::FETCH_ASSOC);
  $rosterById = [];
  $activeRoster = ['A' => [], 'B' => []];
  foreach ($rosterRows as $rosterRow) {
    $rosterById[(int)$rosterRow['id']] = (string)$rosterRow['display_name'];
    if ((int)$rosterRow['is_active'] === 1) {
      $activeRoster[$rosterRow['side']][] = [
        'order' => (int)$rosterRow['batting_order'],
        'name' => (string)$rosterRow['display_name'],
      ];
    }
  }
  foreach (['A', 'B'] as $side) {
    usort($activeRoster[$side], fn($a, $b) => $a['order'] <=> $b['order']);
    $activeRoster[$side] = array_values(array_map(fn($p) => $p['name'], $activeRoster[$side]));
  }

  $inningsQuery = $pdo->prepare('SELECT * FROM innings WHERE match_id = ? ORDER BY innings_number');
  $inningsQuery->execute([$matchId]);
  $inningsRows = [];
  foreach ($inningsQuery->fetchAll(PDO::FETCH_ASSOC) as $inningsRow) {
    $deliveriesQuery = $pdo->prepare(
      'SELECT * FROM deliveries WHERE innings_id = ? ORDER BY sequence_number'
    );
    $deliveriesQuery->execute([(int)$inningsRow['id']]);
    $deliveries = [];
    foreach ($deliveriesQuery->fetchAll(PDO::FETCH_ASSOC) as $deliveryRow) {
      $deliveries[] = storageReadDelivery($pdo, $deliveryRow, $rosterById);
    }
    $inningsNumber = (int)$inningsRow['innings_number'];
    $inningsRows[$inningsNumber] = [
      'row' => $inningsRow,
      'deliveries' => $deliveries,
      'crease' => storageReadCrease($inningsRow, $rosterById),
      'openers' => storageReadCrease($inningsRow, $rosterById, 'opener_'),
    ];
  }

  $currentNumber = ((int)$match['current_innings'] === 2) ? 2 : 1;
  $current = $inningsRows[$currentNumber] ?? null;
  $state = [
    'team_a' => (string)$match['team_a'],
    'team_b' => (string)$match['team_b'],
    'players_a' => (int)$match['players_a'],
    'players_b' => (int)$match['players_b'],
    'players' => max((int)$match['players_a'], (int)$match['players_b']),
    'roster_a' => $activeRoster['A'],
    'roster_b' => $activeRoster['B'],
    'overs_limit' => (int)$match['overs_limit'],
    'batting_first' => $match['batting_first'] === 'B' ? 'B' : 'A',
    'innings' => $currentNumber,
    'status' => (string)$match['status'],
    'deliveries' => $current['deliveries'] ?? [],
    'crease' => $current['crease'] ?? null,
    'openers' => $current['openers'] ?? null,
    'openers_innings' => $current && $current['openers'] ? $currentNumber : null,
    'created' => date('c', strtotime((string)$match['created_at'])),
    'locked' => (bool)$match['locked'],
  ];
  if ($match['target'] !== null) $state['target'] = (int)$match['target'];

  foreach ([1, 2] as $number) {
    if (!isset($inningsRows[$number])) continue;
    $entry = $inningsRows[$number];
    $row = $entry['row'];
    $shouldExposeSnapshot = (int)$row['is_closed'] === 1 || $number < $currentNumber;
    if ($number === 1 && $currentNumber === 2) $shouldExposeSnapshot = true;
    if ($number === 2 && $state['status'] === 'complete') $shouldExposeSnapshot = true;
    if (!$shouldExposeSnapshot) continue;

    $snapshot = [
      'team' => $number === 1
        ? (($row['batting_side'] === 'B') ? $state['team_b'] : $state['team_a'])
        : (($row['batting_side'] === 'B') ? $state['team_b'] : $state['team_a']),
      'side' => $row['batting_side'],
      'deliveries' => $entry['deliveries'],
      'total' => (int)$row['total_runs'],
      'wickets' => (int)$row['wickets'],
      'legal' => (int)$row['legal_balls'],
      'crease' => $entry['crease'],
      'openers' => $entry['openers'],
      'openers_innings' => $entry['openers'] ? $number : null,
    ];
    $state['innings_' . $number] = $snapshot;
  }

  if ($match['result_text'] !== null) {
    $winnerSide = $match['result_winner_side'];
    $state['result'] = [
      'winner' => $winnerSide === 'A' ? $state['team_a'] : ($winnerSide === 'B' ? $state['team_b'] : ''),
      'text' => (string)$match['result_text'],
    ];
  }
  return $state;
}
