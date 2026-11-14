<?php

declare(strict_types=1);

namespace Cricket\Api\Core;

final class Request
{
  private function __construct(
    public string $action,
    public array $query,
    public array $body
  ) {}

  public static function fromGlobals(string $action, ?int $routeId = null): self
  {
    $rawBody = (string)file_get_contents('php://input');
    $decoded = json_decode($rawBody, true);
    if ($rawBody !== '' && json_last_error() !== JSON_ERROR_NONE) {
      throw new ApiException('invalid_json', 'Request body must contain valid JSON', 400);
    }
    if ($rawBody !== '' && !is_array($decoded)) {
      throw new ApiException('invalid_json', 'Request body must be a JSON object or array', 400);
    }
    $query = $_GET;
    if ($routeId !== null) $query['id'] = $routeId;
    return new self($action, $query, is_array($decoded) ? $decoded : []);
  }

  public function id(): int
  {
    return max(0, (int)($this->query['id'] ?? 0));
  }
}
