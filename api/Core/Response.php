<?php

declare(strict_types=1);

namespace Cricket\Api\Core;

final class Response
{
  public static function success(mixed $data, int $status = 200): void
  {
    self::send(['success' => true, 'data' => $data], $status);
  }

  public static function failure(string $code, string $message, int $status): void
  {
    self::send(['success' => false, 'error' => ['code' => $code, 'message' => $message]], $status);
  }

  private static function send(array $payload, int $status): void
  {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
  }
}
