<?php

declare(strict_types=1);

namespace Cricket\Api\Repositories;

use PDO;

final class PlayerRepository
{
  public function __construct(private PDO $pdo) {}

  public function ensureTable(): void
  {
    static $ready = false;
    if ($ready) return;
    $this->pdo->exec("CREATE TABLE IF NOT EXISTS players (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      role VARCHAR(50) DEFAULT 'All-Rounder',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $activeColumn = $this->pdo->query("SHOW COLUMNS FROM players LIKE 'is_active'")->fetch(PDO::FETCH_ASSOC);
    if (!$activeColumn) {
      $this->pdo->exec('ALTER TABLE players ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1');
    }
    $ready = true;
  }

  public function all(): array
  {
    $this->ensureTable();
    return $this->pdo->query('SELECT id, name, is_active, created_at FROM players ORDER BY name ASC')->fetchAll(PDO::FETCH_ASSOC);
  }

  public function statsPlayers(): array
  {
    $this->ensureTable();
    return $this->pdo->query('SELECT id, name, is_active FROM players ORDER BY name ASC')->fetchAll(PDO::FETCH_ASSOC);
  }

  public function insert(string $name): int
  {
    $st = $this->pdo->prepare('INSERT INTO players (name) VALUES (?)');
    $st->execute([$name]);
    return (int)$this->pdo->lastInsertId();
  }

  public function rename(int $id, string $name): bool
  {
    $st = $this->pdo->prepare('UPDATE players SET name = ? WHERE id = ?');
    $st->execute([$name, $id]);
    return $st->rowCount() > 0;
  }

  public function delete(int $id): void
  {
    $st = $this->pdo->prepare('DELETE FROM players WHERE id = ?');
    $st->execute([$id]);
  }

  public function toggle(int $id, ?bool $active): ?array
  {
    if ($active === null) {
      $st = $this->pdo->prepare('UPDATE players SET is_active = 1 - is_active WHERE id = ?');
      $st->execute([$id]);
    } else {
      $st = $this->pdo->prepare('UPDATE players SET is_active = ? WHERE id = ?');
      $st->execute([$active ? 1 : 0, $id]);
    }
    $st = $this->pdo->prepare('SELECT id, name, is_active FROM players WHERE id = ?');
    $st->execute([$id]);
    return $st->fetch(PDO::FETCH_ASSOC) ?: null;
  }
}
