<?php

declare(strict_types=1);

namespace Cricket\Api\Repositories;

use PDO;
use RuntimeException;
use Cricket\Api\Core\ApiException;

final class MatchRepository
{
  public function __construct(private PDO $pdo) {}

  public function begin(): void { $this->pdo->beginTransaction(); }
  public function commit(): void { $this->pdo->commit(); }
  public function rollback(): void { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); }
  public function inTransaction(): bool { return $this->pdo->inTransaction(); }

  public function find(int $id, bool $lock = false): ?array
  {
    return loadNormalizedMatchState($this->pdo, $id, $lock);
  }

  public function requireForUpdate(int $id): array
  {
    $st = $this->pdo->prepare('SELECT id FROM matches WHERE id = ? FOR UPDATE');
    $st->execute([$id]);
    if (!$st->fetchColumn()) throw new ApiException('not_found', 'Match not found', 404);
    $state = $this->find($id, true);
    if (!$state) throw new ApiException('not_found', 'Match not found', 404);
    return $state;
  }

  public function save(int $id, array $state): void
  {
    persistNormalizedMatch($this->pdo, $id, $state);
  }

  public function create(array $state): int
  {
    $st = $this->pdo->prepare(
      'INSERT INTO matches
       (team_a, team_b, players_a, players_b, overs_limit, batting_first, current_innings, status)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)'
    );
    $st->execute([
      $state['team_a'], $state['team_b'], $state['players_a'], $state['players_b'],
      $state['overs_limit'], $state['batting_first'], $state['status'],
    ]);
    $id = (int)$this->pdo->lastInsertId();
    $this->save($id, $state);
    return $id;
  }

  public function all(): array
  {
    $rows = $this->pdo->query('SELECT id, created_at, updated_at FROM matches ORDER BY id DESC')->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$row) {
      $state = $this->find((int)$row['id']);
      if (!$state) throw new RuntimeException('Match disappeared while building match list');
      $row = [
        'id' => (int)$row['id'],
        'title' => $state['team_a'] . ' vs ' . $state['team_b'],
        'state' => $state,
        'created_at' => $row['created_at'],
        'updated_at' => $row['updated_at'],
      ];
    }
    return $rows;
  }

  public function delete(int $id): void
  {
    $st = $this->pdo->prepare('DELETE FROM matches WHERE id = ?');
    $st->execute([$id]);
  }

  public function completed(): array
  {
    $rows = $this->pdo->query("SELECT id, created_at FROM matches WHERE status = 'complete' ORDER BY id ASC")->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$row) {
      $row['state'] = $this->find((int)$row['id']);
    }
    return $rows;
  }

}
