<?php

declare(strict_types=1);

namespace Cricket\Api\Controllers;

final class PlayerToggleActiveController extends ActionController
{
  protected function action(): string { return 'player_toggle_active'; }
}
