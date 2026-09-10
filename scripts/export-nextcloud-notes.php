<?php
// Run inside the existing Nextcloud container as www-data. Reads only note data.
declare(strict_types=1);
define('OC_CONSOLE', 1);
require_once '/var/www/html/lib/base.php';
$userId = $argv[1] ?? '3chan';
$user = \OC::$server->getUserManager()->get($userId);
if (!$user) { throw new RuntimeException('Nextcloud user not found'); }
\OC::$server->getUserSession()->setUser($user);
\OC_Util::setupFS($userId);
$service = \OCP\Server::get(\OCA\Notes\Service\NotesService::class);
$result = $service->getAll($userId, false);
$notes = [];
foreach ($result['notes'] as $note) {
    $data = $note->getData();
    if ($data['error']) { throw new RuntimeException('Cannot read note ' . $data['id']); }
    $raw = $note->getFile()->getContent();
    $data['sourceSha256'] = hash('sha256', $raw);
    $data['sourceBytes'] = strlen($raw);
    $data['contentSha256'] = hash('sha256', $data['content']);
    $data['created'] = $note->getFile()->getCreationTime();
    $notes[] = $data;
}
echo json_encode(['user' => $userId, 'categories' => $result['categories'], 'notes' => $notes], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
