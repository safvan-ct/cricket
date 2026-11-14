<?php

declare(strict_types=1);

use Cricket\Api\Controllers\CreateController;
use Cricket\Api\Controllers\DeleteController;
use Cricket\Api\Controllers\DeliveryController;
use Cricket\Api\Controllers\EditDeliveryController;
use Cricket\Api\Controllers\EndInningsController;
use Cricket\Api\Controllers\EndMatchController;
use Cricket\Api\Controllers\GetController;
use Cricket\Api\Controllers\ListController;
use Cricket\Api\Controllers\LoginController;
use Cricket\Api\Controllers\LogoutController;
use Cricket\Api\Controllers\MarkCompleteController;
use Cricket\Api\Controllers\PlayerCreateController;
use Cricket\Api\Controllers\PlayerDeleteController;
use Cricket\Api\Controllers\PlayerStatsController;
use Cricket\Api\Controllers\PlayerToggleActiveController;
use Cricket\Api\Controllers\PlayerUpdateController;
use Cricket\Api\Controllers\PlayersController;
use Cricket\Api\Controllers\SetCreaseController;
use Cricket\Api\Controllers\StatusController;
use Cricket\Api\Controllers\UndoController;
use Cricket\Api\Controllers\UpdateController;
use Cricket\Api\Core\ApiException;
use Cricket\Api\Core\Request;
use Cricket\Api\Core\Response;
use Cricket\Api\Repositories\MatchRepository;
use Cricket\Api\Repositories\PlayerRepository;
use Cricket\Api\Services\ApiService;

const ADMIN_SESSION_LIFETIME = 2592000;

function normalizePlayerName(mixed $value): string
{
  $value = trim((string)$value);
  if ($value === '') return '';
  if (is_numeric($value)) return 'Player ' . $value;
  if (preg_match('/^(.*?)\s*\((.*?)\)$/u', $value, $m)) {
    return normalizePlayerName($m[1]) . ' (' . trim($m[2]) . ')';
  }
  $lower = mb_strtolower($value, 'UTF-8');
  return (string)preg_replace_callback('/(^|[\s\-\.\/\'])([a-z])/u', fn($m) => $m[1] . strtoupper($m[2]), $lower);
}

function cleanRoster(mixed $raw, int $count, string $prefix = 'Player'): array
{
  $values = is_array($raw) ? array_values($raw) : [];
  $roster = [];
  for ($i = 0; $i < $count; $i++) {
    $name = normalizePlayerName(trim((string)($values[$i] ?? '')));
    $roster[] = $name !== '' ? $name : $prefix . ' ' . ($i + 1);
  }
  return $roster;
}

function ensureRosters(array &$state): void
{
  $a = max(2, (int)($state['players_a'] ?? $state['players'] ?? 7));
  $b = max(2, (int)($state['players_b'] ?? $state['players'] ?? 7));
  $state['roster_a'] = cleanRoster($state['roster_a'] ?? null, $a);
  $state['roster_b'] = cleanRoster($state['roster_b'] ?? null, $b);
}

function inningsStats(array $deliveries): array
{
  $total = $wickets = $legal = 0;
  foreach ($deliveries as $delivery) {
    $total += (int)($delivery['runs'] ?? 0) + (int)($delivery['extra_runs'] ?? 0);
    if (!empty($delivery['wicket'])) $wickets++;
    if (!in_array($delivery['extra_type'] ?? '', ['wide', 'no-ball'], true)) $legal++;
  }
  return ['total' => $total, 'w' => $wickets, 'legal' => $legal];
}

require_once __DIR__ . '/Core/ApiException.php';
require_once __DIR__ . '/Core/Request.php';
require_once __DIR__ . '/Core/Response.php';
require_once __DIR__ . '/Repositories/MatchRepository.php';
require_once __DIR__ . '/Repositories/PlayerRepository.php';
require_once __DIR__ . '/Services/ApiService.php';
spl_autoload_register(static function (string $class): void {
  $prefix = 'Cricket\\Api\\Controllers\\';
  if (!str_starts_with($class, $prefix)) return;
  $file = __DIR__ . '/Controllers/' . substr($class, strlen($prefix)) . '.php';
  if (is_file($file)) require_once $file;
});
require_once __DIR__ . '/storage.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

$cookieParams = session_get_cookie_params();
$isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (int)($_SERVER['SERVER_PORT'] ?? 0) === 443;
ini_set('session.gc_maxlifetime', (string)ADMIN_SESSION_LIFETIME);
session_set_cookie_params([
  'lifetime' => ADMIN_SESSION_LIFETIME,
  'path' => $cookieParams['path'],
  'domain' => $cookieParams['domain'],
  'secure' => $isHttps || !empty($cookieParams['secure']),
  'httponly' => true,
  'samesite' => 'Lax',
]);
session_start();

try {
  $configPath = __DIR__ . '/../config/config.php';
  if (!file_exists($configPath)) {
    throw new ApiException('setup_required', 'Setup required: create config/config.php from config.example.php', 503);
  }
  $config = require $configPath;
  $pdo = new PDO(
    'mysql:host=' . $config['db_host'] . ';dbname=' . $config['db_name'] . ';charset=utf8mb4',
    $config['db_user'],
    $config['db_pass'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
  );
  ensureNormalizedStorage($pdo);

  $action = (string)($_GET['action'] ?? '');
  $routeId = null;
  if ($action === '') {
    $path = parse_url((string)($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?: '/';
    $path = preg_replace('#/+#', '/', $path);
    $path = rtrim($path, '/') ?: '/';
    $method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    $scriptDirectory = rtrim(str_replace('\\', '/', dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/api/index.php'))), '/');
    if ($scriptDirectory !== '' && $scriptDirectory !== '/' && str_starts_with($path, $scriptDirectory . '/')) {
      $path = substr($path, strlen($scriptDirectory));
    }
    $routes = [
      '/status' => ['GET' => 'status'],
      '/login' => ['POST' => 'login'],
      '/logout' => ['POST' => 'logout'],
      '/matches' => ['GET' => 'list', 'POST' => 'create'],
      '/players' => ['GET' => 'players', 'POST' => 'player_create'],
      '/players/stats' => ['GET' => 'player_stats'],
    ];
    if (isset($routes[$path])) {
      if (!isset($routes[$path][$method])) {
        throw new ApiException('method_not_allowed', 'Method not allowed', 405);
      }
      $action = $routes[$path][$method];
    } elseif (preg_match('#^/players/(\d+)/toggle-active$#', $path, $match)) {
      if (!in_array($method, ['PATCH', 'POST'], true)) {
        throw new ApiException('method_not_allowed', 'Method not allowed', 405);
      }
      $action = 'player_toggle_active';
      $routeId = (int)$match[1];
    } elseif (preg_match('#^/players/(\d+)$#', $path, $match)) {
      $playerActions = ['PUT' => 'player_update', 'PATCH' => 'player_update', 'DELETE' => 'player_delete'];
      if (!isset($playerActions[$method])) {
        throw new ApiException('method_not_allowed', 'Method not allowed', 405);
      }
      $action = $playerActions[$method];
      $routeId = (int)$match[1];
    } elseif (preg_match('#^/matches/(\d+)$#', $path, $match)) {
      $matchActions = ['GET' => 'get', 'PUT' => 'update', 'PATCH' => 'update', 'DELETE' => 'delete'];
      if (!isset($matchActions[$method])) {
        throw new ApiException('method_not_allowed', 'Method not allowed', 405);
      }
      $action = $matchActions[$method];
      $routeId = (int)$match[1];
    } elseif (preg_match('#^/matches/(\d+)/(set_crease|delivery|edit_delivery|end_innings|end_match|mark_complete|undo|delete|update)$#', $path, $match)) {
      if ($method !== 'POST' && !($match[2] === 'update' && in_array($method, ['PUT', 'PATCH'], true))) {
        throw new ApiException('method_not_allowed', 'Method not allowed', 405);
      }
      $action = $match[2];
      $routeId = (int)$match[1];
    } else {
      throw new ApiException('not_found', 'Unknown action', 404);
    }
  }

  $controllerClasses = [
    'status' => StatusController::class, 'login' => LoginController::class, 'logout' => LogoutController::class,
    'list' => ListController::class, 'players' => PlayersController::class,
    'player_create' => PlayerCreateController::class, 'player_update' => PlayerUpdateController::class,
    'player_delete' => PlayerDeleteController::class, 'player_toggle_active' => PlayerToggleActiveController::class,
    'player_stats' => PlayerStatsController::class, 'create' => CreateController::class, 'get' => GetController::class,
    'update' => UpdateController::class, 'set_crease' => SetCreaseController::class, 'delivery' => DeliveryController::class,
    'edit_delivery' => EditDeliveryController::class, 'end_innings' => EndInningsController::class,
    'end_match' => EndMatchController::class, 'mark_complete' => MarkCompleteController::class,
    'undo' => UndoController::class, 'delete' => DeleteController::class,
  ];
  if (!isset($controllerClasses[$action])) throw new ApiException('not_found', 'Unknown action', 404);
  $service = new ApiService(new MatchRepository($pdo), new PlayerRepository($pdo), $config);
  $controller = new $controllerClasses[$action]($service);
  $request = Request::fromGlobals($action, $routeId);
  $result = $controller->handle($request);
  $status = 200;
  if (isset($result['status'], $result['data']) && is_int($result['status'])) {
    $status = $result['status'];
    $result = $result['data'];
  }
  Response::success($result, $status);
} catch (ApiException $e) {
  Response::failure($e->errorCode, $e->getMessage(), $e->httpStatus);
} catch (Throwable $e) {
  error_log('Cricket API error: ' . $e->getMessage());
  Response::failure('internal_error', 'The request could not be completed.', 500);
}
