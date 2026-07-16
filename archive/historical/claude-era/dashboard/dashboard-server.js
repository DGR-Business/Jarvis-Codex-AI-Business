const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = 5050;
const WORKSPACE = path.resolve(__dirname);
const FOR_REVIEW_DIR = path.resolve(__dirname, '..', 'for-review');
const APPROVED_DIR = path.resolve(__dirname, '..', 'for-review', 'approved');
const DENIED_DIR = path.resolve(__dirname, '..', 'for-review', 'denied');
const REVISION_DIR = path.resolve(__dirname, '..', 'for-review', 'revision-needed');
const LOGS_DIR = path.resolve(__dirname, '..', 'logs');
const MANIFEST_PATH = path.join(__dirname, 'scheduled-tasks-manifest.json');
const MAX_EVENTS = 100;

// Dashboard routing
const PAGES = {
  '/': 'dashboard-aurora.html',
  '/index.html': 'dashboard-aurora.html',
  '/dashboard-aurora.html': 'dashboard-aurora.html',
  '/dashboard-aurora-v2.html': 'dashboard-aurora-v2.html'
};

// In-memory ring buffer
const eventBuffer = [];

function addEvent(evt) {
  evt.timestamp = evt.timestamp || new Date().toISOString();
  eventBuffer.push(evt);
  if (eventBuffer.length > MAX_EVENTS) eventBuffer.shift();
  broadcast(evt);
}

// --- HTTP Server ---
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && PAGES[req.url]) {
    const htmlPath = path.join(WORKSPACE, PAGES[req.url]);
    fs.readFile(htmlPath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Dashboard variant not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/for-review') {
    // Internal files that should not appear in operator approval inbox
    const INTERNAL_FILES = ['review-status.json'];
    const INTERNAL_PREFIXES = ['AUDIT-SYSTEM-', 'AUDIT-SYNTHESIS-'];
    function isInternalFile(name) {
      if (INTERNAL_FILES.includes(name)) return true;
      for (const prefix of INTERNAL_PREFIXES) {
        if (name.startsWith(prefix)) return true;
      }
      return false;
    }
    const result = { pending: [], approved: [] };
    try {
      const files = fs.readdirSync(FOR_REVIEW_DIR);
      for (const f of files) {
        const fp = path.join(FOR_REVIEW_DIR, f);
        const stat = fs.statSync(fp);
        if (stat.isFile() && !isInternalFile(f)) {
          result.pending.push({ file: f, modified: stat.mtime.toISOString(), size: stat.size });
        }
      }
    } catch (e) { /* for-review/ may not exist yet */ }
    try {
      const files = fs.readdirSync(APPROVED_DIR);
      for (const f of files) {
        const fp = path.join(APPROVED_DIR, f);
        const stat = fs.statSync(fp);
        if (stat.isFile()) {
          result.approved.push({ file: f, modified: stat.mtime.toISOString(), size: stat.size });
        }
      }
    } catch (e) { /* approved/ may not exist yet */ }
    // Sort both by modified date, newest first
    result.pending.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    result.approved.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === 'POST' && req.url === '/events') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const evt = JSON.parse(body);
        addEvent(evt);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(400);
        res.end('{"error":"Invalid JSON"}');
      }
    });
    return;
  }

  // --- File serving endpoint ---
  var fileMatch = req.method === 'GET' && req.url.match(/^\/api\/file\/(pending|approved)\/(.+)$/);
  if (fileMatch) {
    var category = fileMatch[1];
    var filename = decodeURIComponent(fileMatch[2]);
    var baseDir = category === 'approved' ? APPROVED_DIR : FOR_REVIEW_DIR;
    var filePath = path.resolve(baseDir, filename);

    // Security: prevent directory traversal
    if (!filePath.startsWith(baseDir + path.sep) && filePath !== baseDir) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // Determine MIME type
    var extMatch = filename.match(/\.([^.]+)$/);
    var ext = extMatch ? extMatch[1].toLowerCase() : '';
    var mimeTypes = {
      'pdf': 'application/pdf',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'md': 'text/plain; charset=utf-8',
      'txt': 'text/plain; charset=utf-8',
      'json': 'application/json',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };
    var contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.stat(filePath, function(err, stat) {
      if (err || !stat.isFile()) {
        res.writeHead(404);
        res.end('File not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Disposition': 'inline; filename="' + filename.replace(/"/g, '\\"') + '"',
        'Content-Length': stat.size
      });
      fs.createReadStream(filePath).pipe(res);
    });
    return;
  }

  // --- Open in Explorer endpoint ---
  if (req.method === 'POST' && req.url.match(/^\/api\/open-folder\/(pending|approved)$/)) {
    var folderCategory = req.url.match(/^\/api\/open-folder\/(pending|approved)$/)[1];
    var dirPath = folderCategory === 'approved' ? APPROVED_DIR : FOR_REVIEW_DIR;
    require('child_process').exec('explorer.exe "' + dirPath + '"');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }

  // GET /api/scheduled-tasks — returns scheduled tasks manifest
  if (req.method === 'GET' && req.url === '/api/scheduled-tasks') {
    fs.readFile(MANIFEST_PATH, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    });
    return;
  }

  // --- Approval Action Helpers ---
  function ensureDir(dir) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch(e) {}
  }

  function validateFilename(filename) {
    return filename && !filename.includes('..') && !filename.includes('/') && !filename.includes('\\');
  }

  function appendActionLog(action, filename) {
    ensureDir(LOGS_DIR);
    var timestamp = new Date().toISOString();
    var line = timestamp + ' | APPROVE | DASHBOARD-' + action.toUpperCase() + ' | ' + action + ': ' + filename + ' | \u2014 | Approved: ' + (action === 'APPROVE' ? 'YES' : 'NO') + '\n';
    try { fs.appendFileSync(path.join(LOGS_DIR, 'external-actions.log'), line); } catch(e) {}
  }

  function updateReviewStatus(filename, status) {
    var statusPath = path.join(FOR_REVIEW_DIR, 'review-status.json');
    try {
      var data = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
      if (Array.isArray(data)) {
        for (var i = 0; i < data.length; i++) {
          if (data[i].file === filename || data[i].filename === filename) {
            data[i].status = status;
            data[i].reviewed = new Date().toISOString();
            break;
          }
        }
      } else if (typeof data === 'object' && data !== null) {
        if (data[filename]) {
          data[filename].status = status;
          data[filename].reviewed = new Date().toISOString();
        }
      }
      fs.writeFileSync(statusPath, JSON.stringify(data, null, 2));
    } catch(e) { /* review-status.json may not exist or be unparseable */ }
  }

  function broadcastReviewUpdate() {
    var msg = JSON.stringify({ type: 'review-update' });
    wss.clients.forEach(function(client) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
  }

  // POST /api/approve/:filename
  var approveMatch = req.method === 'POST' && req.url.match(/^\/api\/approve\/(.+)$/);
  if (approveMatch) {
    var filename = decodeURIComponent(approveMatch[1]);
    if (!validateFilename(filename)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end('{"error":"Invalid filename"}');
      return;
    }
    var srcPath = path.join(FOR_REVIEW_DIR, filename);
    if (!fs.existsSync(srcPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"File not found"}');
      return;
    }
    ensureDir(APPROVED_DIR);
    var destPath = path.join(APPROVED_DIR, filename);
    try {
      fs.renameSync(srcPath, destPath);
    } catch(e) {
      // renameSync can fail across drives; fall back to copy+delete
      fs.copyFileSync(srcPath, destPath);
      fs.unlinkSync(srcPath);
    }
    updateReviewStatus(filename, 'approved');
    appendActionLog('APPROVE', filename);
    broadcastReviewUpdate();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true,"action":"approved"}');
    return;
  }

  // POST /api/deny/:filename
  var denyMatch = req.method === 'POST' && req.url.match(/^\/api\/deny\/(.+)$/);
  if (denyMatch) {
    var filename = decodeURIComponent(denyMatch[1]);
    if (!validateFilename(filename)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end('{"error":"Invalid filename"}');
      return;
    }
    var srcPath = path.join(FOR_REVIEW_DIR, filename);
    if (!fs.existsSync(srcPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"File not found"}');
      return;
    }
    ensureDir(DENIED_DIR);
    var destPath = path.join(DENIED_DIR, filename);
    try {
      fs.renameSync(srcPath, destPath);
    } catch(e) {
      fs.copyFileSync(srcPath, destPath);
      fs.unlinkSync(srcPath);
    }
    updateReviewStatus(filename, 'rejected');
    appendActionLog('DENY', filename);
    broadcastReviewUpdate();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true,"action":"denied"}');
    return;
  }

  // POST /api/send-back/:filename
  var sendBackMatch = req.method === 'POST' && req.url.match(/^\/api\/send-back\/(.+)$/);
  if (sendBackMatch) {
    var filename = decodeURIComponent(sendBackMatch[1]);
    if (!validateFilename(filename)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end('{"error":"Invalid filename"}');
      return;
    }
    var srcPath = path.join(FOR_REVIEW_DIR, filename);
    if (!fs.existsSync(srcPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"File not found"}');
      return;
    }
    var reqBody = '';
    req.on('data', function(chunk) { reqBody += chunk; });
    req.on('end', function() {
      var note = '';
      try { note = JSON.parse(reqBody).note || ''; } catch(e) {}
      ensureDir(REVISION_DIR);
      var destPath = path.join(REVISION_DIR, filename);
      try {
        fs.renameSync(srcPath, destPath);
      } catch(e) {
        fs.copyFileSync(srcPath, destPath);
        fs.unlinkSync(srcPath);
      }
      if (note) {
        fs.writeFileSync(path.join(REVISION_DIR, filename + '.note.md'), note);
      }
      updateReviewStatus(filename, 'revision-needed');
      appendActionLog('SEND-BACK', filename);
      broadcastReviewUpdate();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true,"action":"sent-back"}');
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// --- WebSocket Server ---
const wss = new WebSocket.Server({ server });

function broadcast(evt) {
  const msg = JSON.stringify({ type: 'event', data: evt });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

wss.on('connection', (ws) => {
  // Send buffered events on connect
  ws.send(JSON.stringify({ type: 'init', data: eventBuffer }));
});

// --- File Watcher: for-review/ ---
function watchDir(dir) {
  try {
    fs.watch(dir, { persistent: false }, () => {
      const msg = JSON.stringify({ type: 'review-update' });
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
      });
    });
  } catch (e) { /* directory may not exist yet */ }
}
watchDir(FOR_REVIEW_DIR);
watchDir(APPROVED_DIR);
watchDir(DENIED_DIR);
watchDir(REVISION_DIR);

// Watch scheduled-tasks manifest file for changes
try {
  fs.watch(MANIFEST_PATH, { persistent: false }, () => {
    const msg = JSON.stringify({ type: 'scheduled-tasks-update' });
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
  });
} catch (e) { /* manifest file may not exist yet */ }

// --- Start ---
server.listen(PORT, () => {
  console.log(`Dashboard server running at http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop');
});
