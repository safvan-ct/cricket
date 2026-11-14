<?php

declare(strict_types=1);

namespace Cricket\Api\Controllers;

final class LogoutController extends ActionController
{
  protected function action(): string { return 'logout'; }
}
