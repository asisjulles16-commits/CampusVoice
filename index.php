<?php
// Lets PHP hosts (like Railway) open the site at "/". Shows index.html.
header('Content-Type: text/html; charset=utf-8');
readfile(__DIR__ . '/index.html');
