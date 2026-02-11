const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'run-log.html');

function getTimestamp() {
    return new Date().toISOString();
}

function writeLog(level, message) {
    const logEntry = `<div class="log log-${level}">[${getTimestamp()}] ${message}</div>\n`;
    console.log(`[${level.toUpperCase()}] ${message}`);
    try {
        fs.appendFileSync(LOG_FILE, logEntry);
    } catch (e) {
        console.error("Failed to write to log file:", e);
    }
}

module.exports = {
    init: () => {
        const header = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="refresh" content="5">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Automation Log</title>
    <style>
        body { font-family: Consolas, "Courier New", monospace; background-color: #1e1e1e; color: #d4d4d4; margin: 0; padding: 20px; font-size: 14px; }
        .log { white-space: pre-wrap; word-wrap: break-word; }
        .log-info { color: #d4d4d4; }
        .log-warn { color: #ffd700; }
        .log-error { color: #f44336; font-weight: bold; }
        .log-success { color: #4caf50; font-weight: bold; }
    </style>
    <script>
        window.onload = function() {
            window.scrollTo(0, document.body.scrollHeight);
        };
    </script>
</head>
<body>
    <h1>Automation Run Log</h1>
    <p>This page will auto-refresh every 5 seconds.</p>
    <div id="log-container">
`;
        fs.writeFileSync(LOG_FILE, header);
    },
    log: (msg) => writeLog('info', msg),
    success: (msg) => writeLog('success', msg),
    error: (msg) => writeLog('error', msg),
    warn: (msg) => writeLog('warn', msg)
};
