const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const logger = require('./logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Define paths based on your project structure
const DOWNLOAD_DIR = path.resolve(__dirname, 'downloads');
const LOG_FILE_PATH = path.resolve(__dirname, 'run-log.html');

let activeChildProcess = null;

// Ensure the downloads directory exists
if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

// Configure Multer storage to save files to the downloads folder
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, DOWNLOAD_DIR);
    },
    filename: (req, file, cb) => {
        // Save using the original file name
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: storage });

// Route: Serve the UI
app.get('/', (req, res) => {
    // Generate a list of existing files in the downloads folder
    let filesHtml = '';
    try {
        if (!fs.existsSync(DOWNLOAD_DIR)) {
            fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
        }
        const files = fs.readdirSync(DOWNLOAD_DIR);
        if (files.length > 0) {
            filesHtml = '<ul class="list-group">' + 
                files.map(f => `
                    <li class="list-group-item d-flex justify-content-between align-items-center">
                        <span>📄 ${f}</span>
                        <span class="badge bg-primary rounded-pill">Ready</span>
                    </li>`).join('') + 
                '</ul>';
        } else {
            filesHtml = '<div class="alert alert-light text-center" role="alert">No files found in downloads folder.</div>';
        }
    } catch (err) {
        filesHtml = '<div class="alert alert-danger" role="alert">Error reading downloads directory.</div>';
    }

    // Return the HTML page
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Automation Dashboard</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background-color: #f8f9fa; padding-top: 40px; }
        .card { border: none; box-shadow: 0 4px 6px rgba(0,0,0,0.1); margin-bottom: 20px; }
        .upload-area { border: 2px dashed #dee2e6; border-radius: 8px; padding: 40px; text-align: center; cursor: pointer; transition: border-color 0.3s; }
        .upload-area:hover { border-color: #0d6efd; }
        .log-frame { width: 100%; height: 400px; border: 1px solid #dee2e6; border-radius: 4px; background: #1e1e1e; }
        .status-badge { font-size: 0.8em; }
    </style>
</head>
<body>
    <div class="container">
        <div class="row justify-content-center">
            <div class="col-md-8">
                <div class="text-center mb-4">
                    <h1 class="display-6">Web Automation Dashboard</h1>
                    <p class="text-muted">Upload PDFs and trigger the automation workflow</p>
                </div>

                <!-- Upload Section -->
                <div class="card">
                    <div class="card-body">
                        <h5 class="card-title mb-3">1. Upload File</h5>
                        <form action="/upload" method="post" enctype="multipart/form-data" id="uploadForm">
                            <div class="upload-area" onclick="document.getElementById('fileInput').click()">
                                <input type="file" name="file" id="fileInput" accept=".pdf" style="display: none" onchange="updateFilename(this)">
                                <div class="mb-2">📂</div>
                                <span id="filename" class="text-muted">Click to select a PDF file</span>
                            </div>
                            <div class="d-grid gap-2 mt-3">
                                <button type="submit" class="btn btn-primary">Upload PDF</button>
                            </div>
                        </form>
                    </div>
                </div>

                <!-- Files & Actions Section -->
                <div class="card">
                    <div class="card-body">
                        <h5 class="card-title mb-3">2. Manage & Run</h5>
                        <div class="mb-3">
                            <div class="d-flex justify-content-between align-items-center mb-2">
                                <label class="form-label text-muted text-uppercase fw-bold m-0" style="font-size: 12px;">Files in Queue</label>
                                <button class="btn btn-sm btn-outline-danger py-0" onclick="clearDownloads()" style="font-size: 12px;">🗑 Delete All</button>
                            </div>
                            ${filesHtml}
                        </div>
                        
                        <div class="mb-4">
                            <label class="form-label text-muted text-uppercase fw-bold" style="font-size: 12px;">Automation Progress</label>
                            <div class="progress" style="height: 25px;">
                                <div id="progressBar" class="progress-bar progress-bar-striped progress-bar-animated" role="progressbar" style="width: 0%;" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">0%</div>
                            </div>
                            <small id="progressText" class="text-muted d-block text-center mt-1">Ready to start</small>
                        </div>

                        <div class="d-grid gap-2 d-md-flex justify-content-md-center">
                            <button id="runBtn" class="btn btn-success btn-lg flex-grow-1" onclick="runAutomation()">
                                ▶ Run Automation
                            </button>
                            <button id="stopBtn" class="btn btn-danger btn-lg flex-grow-1" onclick="stopAutomation()" disabled>
                                ⏹ Stop
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Logs Section -->
                <div class="card">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-center mb-3">
                            <h5 class="card-title m-0">Live Logs</h5>
                            <div>
                                <button class="btn btn-sm btn-outline-danger me-2" onclick="clearLogs()">🗑 Clear Logs</button>
                                <a href="/log" target="_blank" class="btn btn-sm btn-outline-secondary">Open in New Tab</a>
                            </div>
                        </div>
                        <iframe src="/log" class="log-frame" id="logFrame"></iframe>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        function updateFilename(input) {
            if (input.files && input.files[0]) {
                document.getElementById('filename').innerText = input.files[0].name;
                document.getElementById('filename').classList.add('fw-bold', 'text-dark');
            }
        }

        let progressInterval;

        async function runAutomation() {
            const btn = document.getElementById('runBtn');
            const stopBtn = document.getElementById('stopBtn');
            btn.disabled = true;
            stopBtn.disabled = false;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Running...';
            
            // Reset progress bar
            const bar = document.getElementById('progressBar');
            const text = document.getElementById('progressText');
            bar.style.width = '0%';
            bar.innerText = '0%';
            bar.classList.add('progress-bar-animated');
            bar.classList.remove('bg-success', 'bg-danger');
            text.innerText = 'Initializing...';

            try {
                const response = await fetch('/run', { method: 'POST' });
                const data = await response.json();
                if (data.status === 'error') {
                    throw new Error(data.message);
                }
                // Start polling for progress
                startProgressPolling();
            } catch (error) {
                alert('Error starting automation: ' + error);
                btn.disabled = false;
                stopBtn.disabled = true;
                btn.innerHTML = '▶ Run Automation';
            }
            
            // Refresh iframe to ensure it picks up new logs
            document.getElementById('logFrame').src = document.getElementById('logFrame').src;
        }

        async function stopAutomation() {
            if (!confirm('Are you sure you want to stop the automation?')) return;
            
            try {
                const response = await fetch('/stop', { method: 'POST' });
                const data = await response.json();
                // The polling loop will detect the stop message in logs and update UI
            } catch (error) {
                alert('Error stopping: ' + error);
            }
        }

        async function clearLogs() {
            if (!confirm('Are you sure you want to clear the logs?')) return;
            try {
                await fetch('/clear-logs', { method: 'POST' });
                document.getElementById('logFrame').src = document.getElementById('logFrame').src;
                
                // Reset progress bar
                const bar = document.getElementById('progressBar');
                bar.style.width = '0%';
                bar.innerText = '0%';
                document.getElementById('progressText').innerText = 'Logs cleared.';
            } catch (error) {
                alert('Error clearing logs: ' + error);
            }
        }

        async function clearDownloads() {
            if (!confirm('Are you sure you want to delete all files in the downloads folder?')) return;
            try {
                await fetch('/clear-downloads', { method: 'POST' });
                window.location.reload();
            } catch (error) {
                alert('Error clearing downloads: ' + error);
            }
        }

        function startProgressPolling() {
            if (progressInterval) clearInterval(progressInterval);
            progressInterval = setInterval(async () => {
                try {
                    const response = await fetch('/progress');
                    const data = await response.json();
                    
                    const bar = document.getElementById('progressBar');
                    const text = document.getElementById('progressText');
                    const btn = document.getElementById('runBtn');
                    const stopBtn = document.getElementById('stopBtn');
                    
                    bar.style.width = data.progress + '%';
                    bar.innerText = data.progress + '%';
                    text.innerText = data.status;

                    if (data.progress >= 100 || data.status.includes('Error') || data.status.includes('Completed') || data.status.includes('Stopped')) {
                        clearInterval(progressInterval);
                        bar.classList.remove('progress-bar-animated');
                        if (data.status.includes('Error') || data.status.includes('Stopped')) bar.classList.add('bg-danger');
                        else bar.classList.add('bg-success');
                        
                        btn.disabled = false;
                        stopBtn.disabled = true;
                        btn.innerHTML = '▶ Run Automation';
                    }
                } catch (e) {
                    console.error('Error fetching progress:', e);
                }
            }, 1000);
        }
    </script>
</body>
</html>
    `);
});

// Route: Handle File Upload
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }
    // Redirect back to home page to show the updated list
    res.redirect('/');
});

// Route: Trigger Automation
app.post('/run', (req, res) => {
    if (activeChildProcess) {
        return res.status(400).json({ status: 'error', message: 'Automation is already running.' });
    }

    const child = spawn('node', ['index.js'], { cwd: __dirname });
    activeChildProcess = child;

    child.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
    });

    child.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
    });

    child.on('close', (code) => {
        console.log(`Child process exited with code ${code}`);
        activeChildProcess = null;
    });

    res.json({ status: 'started', message: 'Automation process started in the background.' });
});

// Route: Stop Automation
app.post('/stop', (req, res) => {
    if (activeChildProcess) {
        // Kill the process tree to ensure Chrome instances are also closed
        if (process.platform === 'win32') {
            exec(`taskkill /pid ${activeChildProcess.pid} /T /F`, (err) => {
                if (err) console.error(`Error killing process tree: ${err}`);
            });
        } else {
            activeChildProcess.kill();
        }
        activeChildProcess = null;
        
        try {
            fs.appendFileSync(LOG_FILE_PATH, `<div class="log log-error">[${new Date().toISOString()}] 🛑 Automation stopped by user.</div>\n`);
        } catch (e) { console.error("Error writing to log:", e); }

        res.json({ status: 'stopped', message: 'Automation process stopped.' });
    } else {
        res.json({ status: 'ignored', message: 'No active process to stop.' });
    }
});

// Route: Clear Logs
app.post('/clear-logs', (req, res) => {
    logger.init();
    res.json({ status: 'cleared', message: 'Logs cleared.' });
});

// Route: Clear Downloads
app.post('/clear-downloads', (req, res) => {
    try {
        if (fs.existsSync(DOWNLOAD_DIR)) {
            const files = fs.readdirSync(DOWNLOAD_DIR);
            for (const file of files) {
                fs.unlinkSync(path.join(DOWNLOAD_DIR, file));
            }
        }
        res.json({ status: 'cleared', message: 'Downloads folder cleared.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Route: Get Progress
app.get('/progress', (req, res) => {
    if (!fs.existsSync(LOG_FILE_PATH)) {
        return res.json({ progress: 0, status: 'Waiting for logs...' });
    }

    try {
        const logContent = fs.readFileSync(LOG_FILE_PATH, 'utf8');
        
        // Calculate total expected steps based on files
        let files = [];
        if (fs.existsSync(DOWNLOAD_DIR)) {
            files = fs.readdirSync(DOWNLOAD_DIR).filter(f => f.toLowerCase().endsWith('.pdf'));
        }
        const totalFiles = files.length || 1;

        // Milestones that happen for every file
        const milestonesPerFile = [
            'Extractor page loaded',
            'Extraction of Subject section completed',
            'Extraction of Contract section completed',
            'Extraction of Neighborhood section completed',
            'Extraction of Site section completed',
            'Extraction of Improvements section completed',
            'Extraction of Sales Comparison Approach section completed',
            'Extraction of Sales GRID Section section completed',
            'Extraction of Sales History section completed',
            'Extraction of RECONCILIATION section completed',
            'Extraction of Cost Approach section completed',
            'Extraction of Income Approach section completed',
            'Extraction of PUD Information section completed',
            'Extraction of Market Conditions section completed',
            'Extraction of CONDO/CO-OP section completed',
            'Extraction of CERTIFICATION section completed',
            '"Run Full Analysis" operation completed',
            '"Save" operation completed'
        ];

        let completedSteps = 0;
        // Count occurrences of per-file milestones
        milestonesPerFile.forEach(m => {
            const regex = new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
            const matches = logContent.match(regex);
            if (matches) completedSteps += matches.length;
        });

        const totalSteps = milestonesPerFile.length * totalFiles;
        let progress = Math.round((completedSteps / totalSteps) * 100);
        if (progress > 100) progress = 100;

        let status = progress === 100 ? 'Completed!' : `Processing... (${progress}%)`;
        if (logContent.includes('An error occurred')) status = 'Error detected. Check logs.';
        if (logContent.includes('Automation stopped by user')) status = 'Stopped by user.';

        res.json({ progress, status });
    } catch (e) {
        res.json({ progress: 0, status: 'Error reading progress' });
    }
});

// Route: View Logs (Serves the run-log.html created by logger.js)
app.get('/log', (req, res) => {
    if (fs.existsSync(LOG_FILE_PATH)) {
        res.sendFile(LOG_FILE_PATH);
    } else {
        res.status(404).send(`
            <h2 style="font-family: sans-serif; text-align: center; margin-top: 50px;">
                Log file not found.
            </h2>
            <p style="font-family: sans-serif; text-align: center;">
                Run the automation script to generate logs.
            </p>
        `);
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`\n🚀 UI Server running at http://localhost:${PORT}`);
    console.log(`📂 Uploads will be saved to: ${DOWNLOAD_DIR}`);
});