<?php

declare(strict_types=1);

namespace Cricket\Api\Controllers;

final class EndInningsController extends ActionController
{
  protected function action(): string { return 'end_innings'; }
}
