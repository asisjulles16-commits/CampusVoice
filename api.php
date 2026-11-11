<?php
// CampusVoice API – one endpoint, many actions:  api.php?action=login  (JSON POST)
// Works on PHP 7.4+ with MySQL/MariaDB.

$cfg = require __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const CATEGORIES = ['Event', 'Canteen', 'Library', 'Facilities', 'Academics', 'Other'];

function out($data, $code = 200) {
  http_response_code($code);
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
  exit;
}
function fail($msg, $code = 400) { out(['error' => $msg], $code); }

// ---------- Request checks ----------
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail('POST only.', 405);
// Requiring JSON blocks simple cross-site form posts (CSRF).
if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) fail('Invalid request.', 415);
$in = json_decode(file_get_contents('php://input') ?: '', true);
if (!is_array($in)) $in = [];
$action = $_GET['action'] ?? '';

session_set_cookie_params([
  'lifetime' => 0, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax',
  'secure' => !empty($_SERVER['HTTPS']) || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'),
]);
session_start();

// ---------- Database ----------
try {
  $pdo = new PDO(
    "mysql:host={$cfg['host']};port={$cfg['port']};dbname={$cfg['name']};charset=utf8mb4",
    $cfg['user'], $cfg['pass'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]
  );
  $pdo->exec("SET time_zone = '+00:00'");
} catch (PDOException $e) {
  error_log('CampusVoice DB: ' . $e->getMessage());
  fail('Cannot connect to the database. Check config.php.', 500);
}

// Creates the tables from schema.sql the first time (so no manual import is needed on hosts without phpMyAdmin).
function ensure_schema() {
  global $pdo;
  if ($pdo->query("SHOW TABLES LIKE 'users'")->fetch()) return;
  $sql = @file_get_contents(__DIR__ . '/schema.sql');
  if ($sql === false) fail('schema.sql is missing.', 500);
  $sql = preg_replace('/^\s*--.*$/m', '', $sql);
  foreach (array_filter(array_map('trim', explode(';', $sql))) as $statement) $pdo->exec($statement);
}

function q($sql, $params = []) {
  global $pdo;
  $st = $pdo->prepare($sql);
  $st->execute($params);
  return $st;
}

// ---------- Helpers ----------
function text_len($s) { return function_exists('mb_strlen') ? mb_strlen($s, 'UTF-8') : strlen($s); }
function iso($s) { return $s ? str_replace(' ', 'T', $s) . 'Z' : ''; }
function str_in($key, $max, $required = true) {
  global $in;
  $v = isset($in[$key]) && is_string($in[$key]) ? trim($in[$key]) : '';
  if ($required && $v === '') fail('Please complete all required fields.');
  if (text_len($v) > $max) fail('One of the fields is too long.');
  return $v;
}
function user_json($u) {
  return [
    'id' => (string)$u['id'], 'name' => $u['name'], 'studentId' => $u['student_id'],
    'email' => $u['email'], 'role' => $u['role'], 'createdAt' => iso($u['created_at']),
  ];
}
function current_user() {
  if (empty($_SESSION['uid'])) return null;
  $u = q('SELECT * FROM users WHERE id = ?', [$_SESSION['uid']])->fetch();
  return $u ?: null;
}
function need_user() {
  $u = current_user();
  if (!$u) fail('Please log in again.', 401);
  return $u;
}
function need_admin() {
  $u = need_user();
  if ($u['role'] !== 'admin') fail('Admins only.', 403);
  return $u;
}
function notify($userId, $message, $ideaId = null) {
  if (!$userId) return;
  q('INSERT INTO notifications (user_id, message, idea_id) VALUES (?, ?, ?)', [$userId, $message, $ideaId]);
}
function find_idea($id) {
  $r = q('SELECT * FROM ideas WHERE id = ?', [(int)$id])->fetch();
  if (!$r) fail('That idea could not be found.', 404);
  return $r;
}

// Saves a data-URL image into /uploads and returns "uploads/<file>". Returns '' if none given.
function save_image($dataUrl) {
  if (!is_string($dataUrl) || $dataUrl === '') return '';
  if (!preg_match('#^data:image/(png|jpe?g|gif|webp);base64,#i', $dataUrl, $m)) fail('Please upload a PNG, JPG, GIF or WEBP image.');
  $bin = base64_decode(substr($dataUrl, strlen($m[0])), true);
  if ($bin === false || strlen($bin) > 2 * 1024 * 1024) fail('Please use an image smaller than 1.5 MB.');
  $info = @getimagesizefromstring($bin);
  $exts = [IMAGETYPE_PNG => 'png', IMAGETYPE_JPEG => 'jpg', IMAGETYPE_GIF => 'gif', IMAGETYPE_WEBP => 'webp'];
  if (!$info || !isset($exts[$info[2]])) fail('That file is not a valid image.');
  $dir = __DIR__ . '/uploads';
  if (!is_dir($dir) && !@mkdir($dir, 0755, true)) fail('Upload folder is missing.', 500);
  $name = bin2hex(random_bytes(12)) . '.' . $exts[$info[2]];
  if (file_put_contents("$dir/$name", $bin) === false) fail('Could not save the image.', 500);
  return 'uploads/' . $name;
}
function delete_upload($path) {
  if (is_string($path) && preg_match('#^uploads/[a-f0-9]{24}\.(png|jpg|gif|webp)$#', $path)) @unlink(__DIR__ . '/' . $path);
}

function ensure_admin($cfg) {
  if (q("SELECT id FROM users WHERE role = 'admin' LIMIT 1")->fetch()) return;
  try {
    q("INSERT INTO users (name, student_id, email, password_hash, role) VALUES (?, ?, ?, ?, 'admin')",
      ['CampusVoice Admin', 'ADMIN', strtolower($cfg['admin_email']), password_hash($cfg['admin_password'], PASSWORD_DEFAULT)]);
  } catch (PDOException $e) { /* another request created it first */ }
}

function idea_json($r, $votes, $comments, $viewer) {
  $isAdmin = $viewer['role'] === 'admin';
  $mine = (int)$r['author_id'] === (int)$viewer['id'];
  return [
    'id' => (string)$r['id'],
    'title' => $r['title'], 'category' => $r['category'], 'description' => $r['description'],
    'photo' => $r['photo'], 'anonymous' => (bool)$r['anonymous'],
    // Hide who wrote an anonymous idea from other students.
    'authorId' => ($r['anonymous'] && !$isAdmin && !$mine) ? '0' : (string)$r['author_id'],
    'status' => $r['status'],
    'votes' => $votes[$r['id']] ?? [],
    'comments' => $comments[$r['id']] ?? [],
    'rejectionReason' => (string)$r['rejection_reason'],
    'adminNote' => (string)$r['admin_note'],
    'internalNote' => $isAdmin ? (string)$r['internal_note'] : '',
    'priority' => (bool)$r['priority'],
    'proofPhoto' => $r['proof_photo'],
    'implementedDate' => (string)$r['implemented_date'],
    'createdAt' => iso($r['created_at']), 'updatedAt' => iso($r['updated_at']),
  ];
}

// ---------- Actions ----------
try {
  ensure_schema();
  ensure_admin($cfg);

  switch ($action) {

    case 'register': {
      $name = str_in('name', 80);
      $studentId = str_in('studentId', 40);
      $email = strtolower(str_in('email', 120));
      $password = isset($in['password']) && is_string($in['password']) ? $in['password'] : '';
      if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Please enter a valid email address.');
      if (strlen($password) < 6) fail('Password must be at least 6 characters.');
      if (q('SELECT id FROM users WHERE student_id = ? OR email = ?', [$studentId, $email])->fetch())
        fail('That student ID or email is already registered.', 409);
      q("INSERT INTO users (name, student_id, email, password_hash, role) VALUES (?, ?, ?, ?, 'student')",
        [$name, $studentId, $email, password_hash($password, PASSWORD_DEFAULT)]);
      out(['ok' => true]);
    }

    case 'login': {
      $ident = strtolower(str_in('identifier', 120));
      $password = isset($in['password']) && is_string($in['password']) ? $in['password'] : '';
      $u = q('SELECT * FROM users WHERE student_id = ? OR email = ? LIMIT 1', [$ident, $ident])->fetch();
      if (!$u || !password_verify($password, $u['password_hash'])) {
        usleep(300000); // slows down password guessing
        fail('Invalid student ID/email or password.', 401);
      }
      session_regenerate_id(true);
      $_SESSION['uid'] = (int)$u['id'];
      out(['user' => user_json($u)]);
    }

    case 'logout': {
      $_SESSION = [];
      session_destroy();
      out(['ok' => true]);
    }

    case 'me': {
      $u = current_user();
      out(['user' => $u ? user_json($u) : null]);
    }

    case 'state': {
      $me = need_user();
      $isAdmin = $me['role'] === 'admin';

      if ($isAdmin) {
        $users = array_map('user_json', q('SELECT * FROM users ORDER BY created_at DESC')->fetchAll());
      } else { // students only get id + name of other students
        $users = array_map(function ($u) { return ['id' => (string)$u['id'], 'name' => $u['name']]; },
          q("SELECT id, name FROM users WHERE role = 'student'")->fetchAll());
      }

      $votes = [];
      foreach (q('SELECT idea_id, user_id, choice FROM votes')->fetchAll() as $v)
        $votes[$v['idea_id']][] = ['userId' => (string)$v['user_id'], 'choice' => $v['choice']];
      $comments = [];
      foreach (q('SELECT id, idea_id, user_id, text, created_at FROM comments ORDER BY id')->fetchAll() as $c)
        $comments[$c['idea_id']][] = ['id' => (string)$c['id'], 'userId' => (string)$c['user_id'], 'text' => $c['text'], 'createdAt' => iso($c['created_at'])];

      $ideas = array_map(function ($r) use ($votes, $comments, $me) { return idea_json($r, $votes, $comments, $me); },
        q('SELECT * FROM ideas ORDER BY created_at DESC, id DESC')->fetchAll());

      $notes = array_map(function ($n) {
        return ['id' => (string)$n['id'], 'userId' => (string)$n['user_id'], 'message' => $n['message'],
                'ideaId' => $n['idea_id'] === null ? null : (string)$n['idea_id'],
                'createdAt' => iso($n['created_at']), 'read' => (bool)$n['is_read']];
      }, q('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 300', [$me['id']])->fetchAll());

      out(['users' => $users, 'ideas' => $ideas, 'notifications' => $notes]);
    }

    case 'createIdea': {
      $me = need_user();
      if ($me['role'] !== 'student') fail('Only students can post ideas.', 403);
      $title = str_in('title', 100);
      $desc = str_in('description', 1500);
      $cat = $in['category'] ?? '';
      if (!in_array($cat, CATEGORIES, true)) fail('Please choose a category.');
      $photo = save_image($in['photo'] ?? '');
      q('INSERT INTO ideas (author_id, title, category, description, photo, anonymous) VALUES (?, ?, ?, ?, ?, ?)',
        [$me['id'], $title, $cat, $desc, $photo, empty($in['anonymous']) ? 0 : 1]);
      $ideaId = (int)$GLOBALS['pdo']->lastInsertId();
      q("INSERT INTO notifications (user_id, message, idea_id) SELECT id, ?, ? FROM users WHERE role = 'student' AND id <> ?",
        ['A new campus idea was posted: "' . $title . '".', $ideaId, $me['id']]);
      out(['id' => (string)$ideaId]);
    }

    case 'vote': {
      $me = need_user();
      if ($me['role'] !== 'student') fail('Only students can vote.', 403);
      $idea = find_idea($in['ideaId'] ?? 0);
      $choice = $in['choice'] ?? '';
      if (!in_array($choice, ['Agree', 'Disagree'], true)) fail('Invalid vote.');
      if ((int)$idea['author_id'] === (int)$me['id']) fail('You cannot vote on your own idea.');

      $prev = q('SELECT choice FROM votes WHERE idea_id = ? AND user_id = ?', [$idea['id'], $me['id']])->fetch();
      if ($prev && $prev['choice'] === $choice) {
        q('DELETE FROM votes WHERE idea_id = ? AND user_id = ?', [$idea['id'], $me['id']]);
        $msg = 'Your vote has been removed.';
      } elseif ($prev) {
        q('UPDATE votes SET choice = ? WHERE idea_id = ? AND user_id = ?', [$choice, $idea['id'], $me['id']]);
        $msg = 'Your vote has been changed.';
      } else {
        q('INSERT INTO votes (idea_id, user_id, choice) VALUES (?, ?, ?)', [$idea['id'], $me['id'], $choice]);
        notify($idea['author_id'], $me['name'] . ' ' . strtolower($choice) . 'd your idea "' . $idea['title'] . '".', $idea['id']);
        $msg = 'Your vote has been recorded.';
      }
      q('UPDATE ideas SET updated_at = UTC_TIMESTAMP() WHERE id = ?', [$idea['id']]);
      out(['message' => $msg]);
    }

    case 'comment': {
      $me = need_user();
      $idea = find_idea($in['ideaId'] ?? 0);
      $text = str_in('text', 500);
      q('INSERT INTO comments (idea_id, user_id, text) VALUES (?, ?, ?)', [$idea['id'], $me['id'], $text]);
      if ((int)$idea['author_id'] !== (int)$me['id'])
        notify($idea['author_id'], $me['name'] . ' commented on your idea "' . $idea['title'] . '".', $idea['id']);
      out(['ok' => true]);
    }

    case 'markRead': {
      $me = need_user();
      q('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [$me['id']]);
      out(['ok' => true]);
    }

    // ----- admin only -----
    case 'setStatus': {
      need_admin();
      $idea = find_idea($in['ideaId'] ?? 0);
      if (($in['status'] ?? '') !== 'Under Review') fail('Invalid status.');
      q("UPDATE ideas SET status = 'Under Review', rejection_reason = '', updated_at = UTC_TIMESTAMP() WHERE id = ?", [$idea['id']]);
      if ($idea['status'] !== 'Under Review')
        notify($idea['author_id'], 'Your idea "' . $idea['title'] . '" is now under review.', $idea['id']);
      out(['ok' => true]);
    }

    case 'decide': {
      need_admin();
      $idea = find_idea($in['ideaId'] ?? 0);
      $type = $in['type'] ?? '';
      $note = str_in('note', 1000, false);
      $title = $idea['title'];
      $pending = in_array($idea['status'], ['Open', 'Under Review'], true);

      if ($type === 'approve' && $pending) {
        q("UPDATE ideas SET status = 'Approved', admin_note = ?, rejection_reason = '', updated_at = UTC_TIMESTAMP() WHERE id = ?", [$note, $idea['id']]);
        notify($idea['author_id'], 'Good news! Your idea "' . $title . '" was approved.' . ($note !== '' ? ' Admin: ' . $note : ''), $idea['id']);
      } elseif ($type === 'reject' && $pending) {
        if ($note === '') fail('Please provide a reason for rejection.');
        q("UPDATE ideas SET status = 'Rejected', rejection_reason = ?, admin_note = '', updated_at = UTC_TIMESTAMP() WHERE id = ?", [$note, $idea['id']]);
        notify($idea['author_id'], 'Your idea "' . $title . '" was not approved. Reason: ' . $note, $idea['id']);
      } elseif ($type === 'implement' && $idea['status'] === 'Approved') {
        $date = $in['date'] ?? '';
        $d = DateTime::createFromFormat('Y-m-d', is_string($date) ? $date : '');
        if (!$d || $d->format('Y-m-d') !== $date) fail('Please select the implementation date.');
        $proof = save_image($in['proof'] ?? '');
        if ($proof !== '') { delete_upload($idea['proof_photo']); } else { $proof = $idea['proof_photo']; }
        q("UPDATE ideas SET status = 'Implemented', implemented_date = ?, proof_photo = ?, admin_note = IF(? <> '', ?, admin_note), updated_at = UTC_TIMESTAMP() WHERE id = ?",
          [$date, $proof, $note, $note, $idea['id']]);
        notify($idea['author_id'], 'Your idea "' . $title . '" has been implemented! 🚀', $idea['id']);
      } else {
        fail('That action is not available for this suggestion.');
      }
      out(['ok' => true]);
    }

    case 'togglePin': {
      need_admin();
      $idea = find_idea($in['ideaId'] ?? 0);
      q('UPDATE ideas SET priority = 1 - priority WHERE id = ?', [$idea['id']]);
      out(['priority' => !$idea['priority']]);
    }

    case 'saveNote': {
      need_admin();
      $idea = find_idea($in['ideaId'] ?? 0);
      q('UPDATE ideas SET internal_note = ? WHERE id = ?', [str_in('note', 600, false), $idea['id']]);
      out(['ok' => true]);
    }

    case 'deleteIdea': {
      need_admin();
      $idea = find_idea($in['ideaId'] ?? 0);
      q('DELETE FROM ideas WHERE id = ?', [$idea['id']]);
      delete_upload($idea['photo']);
      delete_upload($idea['proof_photo']);
      out(['ok' => true]);
    }

    default:
      fail('Unknown action.', 404);
  }
} catch (PDOException $e) {
  error_log('CampusVoice SQL: ' . $e->getMessage());
  fail('Server error. Please try again.', 500);
}
