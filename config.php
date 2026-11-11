<?php
// CampusVoice settings. Edit the values after "?:" for your own database.
// On hosts like Railway the environment variables are picked up automatically.
return [
  'host' => getenv('DB_HOST') ?: (getenv('MYSQLHOST') ?: 'localhost'),
  'port' => getenv('DB_PORT') ?: (getenv('MYSQLPORT') ?: '3306'),
  'name' => getenv('DB_NAME') ?: (getenv('MYSQLDATABASE') ?: 'campusvoice'),
  'user' => getenv('DB_USER') ?: (getenv('MYSQLUSER') ?: 'root'),   // XAMPP default: root
  'pass' => getenv('DB_PASS') ?: (getenv('MYSQLPASSWORD') ?: ''),   // XAMPP default: empty

  // Admin account that is created automatically if no admin exists yet.
  'admin_email'    => 'admin@school.edu',
  'admin_password' => 'Admin123!',
];
