<?php
function cricket_env(string $key, string $default = ''): string {
    $value = getenv($key);
    if ($value === false || $value === '') {
        $value = $_ENV[$key] ?? $_SERVER[$key] ?? '';
    }
    return ($value === '' || $value === false) ? $default : (string)$value;
}

return [
    'db_host' => cricket_env('CRICKET_DB_HOST', 'localhost'),
    'db_name' => cricket_env('CRICKET_DB_NAME', 'cricket_score'),
    'db_user' => cricket_env('CRICKET_DB_USER', 'root'),
    'db_pass' => cricket_env('CRICKET_DB_PASS', ''),
    'admin_password' => cricket_env('CRICKET_ADMIN_PASSWORD', 'admin@123'),
];
