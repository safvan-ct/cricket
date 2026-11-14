<?php

declare(strict_types=1);

namespace Cricket\Api\Controllers;

use Cricket\Api\Core\Request;
use Cricket\Api\Services\ApiService;

abstract class ActionController
{
  public function __construct(protected ApiService $service) {}

  abstract protected function action(): string;

  final public function handle(Request $request): array
  {
    return $this->service->handle($this->action(), $request);
  }
}
