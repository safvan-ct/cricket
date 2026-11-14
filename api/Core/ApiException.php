<?php

declare(strict_types=1);

namespace Cricket\Api\Core;

use RuntimeException;

final class ApiException extends RuntimeException
{
  public function __construct(
    public string $errorCode,
    string $message,
    public int $httpStatus = 400
  ) {
    parent::__construct($message);
  }
}
