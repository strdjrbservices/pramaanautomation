const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const logger = require('./logger');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 5000;

const DOWNLOAD_DIR = path.resolve(__dirname, 'downloads');
const LOGFILES_DIR = path.join(DOWNLOAD_DIR, 'logfiles');
const HTML_FILES_DIR = path.join(DOWNLOAD_DIR, 'HTMLFiles');
const REVISED_FILES_DIR = path.join(DOWNLOAD_DIR, 'RevisedFiles');
const NEW_FILES_REVISED_DIR = path.join(DOWNLOAD_DIR, 'new_files_revised');
const OLD_FILES_REVISED_DIR = path.join(DOWNLOAD_DIR, 'old_files_revised');
const PROCESSED_FILES_DIR = path.join(DOWNLOAD_DIR, 'oldfiles');
const LOG_FILE_PATH = path.resolve(__dirname, 'run-log.html');
const PAUSE_LOCK_FILE = path.join(__dirname, 'pause.lock');

let activeChildProcess = null;
let server;

if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

if (fs.existsSync(PAUSE_LOCK_FILE)) {
    try { fs.unlinkSync(PAUSE_LOCK_FILE); } catch (e) {}
}

const getSanitizedFilename = (originalname) => {
    const ext = path.extname(originalname);
    const baseName = path.basename(originalname, ext);
    const parts = baseName.split(' _ ');
    if (parts.length > 1) {
        return parts[0].trim() + ext;
    }
    return originalname;
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, DOWNLOAD_DIR);
    },
    filename: (req, file, cb) => {
        cb(null, getSanitizedFilename(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        const cleanName = getSanitizedFilename(file.originalname);
        if (fs.existsSync(path.join(DOWNLOAD_DIR, cleanName))) {
            return cb(new Error(`File "${cleanName}" (renamed from "${file.originalname}") already exists.`), false);
        }
        cb(null, true);
    }
});

const newFilesStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync(NEW_FILES_REVISED_DIR)) {
            fs.mkdirSync(NEW_FILES_REVISED_DIR, { recursive: true });
        }
        cb(null, NEW_FILES_REVISED_DIR);
    },
    filename: (req, file, cb) => {
        cb(null, getSanitizedFilename(file.originalname));
    }
});
const uploadNewFiles = multer({ 
    storage: newFilesStorage,
    fileFilter: (req, file, cb) => {
        if (!file.originalname.toLowerCase().endsWith('_revised.pdf')) {
            return cb(new Error('Only files ending with "_revised.pdf" are allowed.'), false);
        }
        cb(null, true);
    }
});

const oldFilesStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync(OLD_FILES_REVISED_DIR)) {
            fs.mkdirSync(OLD_FILES_REVISED_DIR, { recursive: true });
        }
        cb(null, OLD_FILES_REVISED_DIR);
    },
    filename: (req, file, cb) => {
        cb(null, getSanitizedFilename(file.originalname));
    }
});
const uploadOldFiles = multer({ storage: oldFilesStorage });

const htmlFilesStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync(HTML_FILES_DIR)) {
            fs.mkdirSync(HTML_FILES_DIR, { recursive: true });
        }
        cb(null, HTML_FILES_DIR);
    },
    filename: (req, file, cb) => {
        cb(null, getSanitizedFilename(file.originalname));
    }
});
const uploadHtmlFiles = multer({ 
    storage: htmlFilesStorage,
    fileFilter: (req, file, cb) => {
        if (!file.originalname.toLowerCase().endsWith('.html')) {
            return cb(new Error('Only HTML files are allowed.'), false);
        }
        cb(null, true);
    }
});

function generateFileListHtml(dirPath, relativePath, emptyMessage) {
    try {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        const files = fs.readdirSync(dirPath).filter(f => {
            try { return fs.statSync(path.join(dirPath, f)).isFile(); } catch { return false; }
        });
        if (files.length > 0) {
            return '<ul class="list-group list-group-flush">' +
                files.map(f => {
                    const lowerF = f.toLowerCase();
                    let icon = 'bi-file-earmark';
                    let colorClass = 'text-secondary';
                    let bgClass = 'bg-secondary-subtle';

                    if (lowerF.endsWith('.html')) {
                        icon = 'bi-filetype-html';
                        colorClass = 'text-success';
                        bgClass = 'bg-success-subtle';
                    } else if (lowerF.endsWith('.pdf')) {
                        icon = 'bi-file-earmark-pdf';
                        colorClass = 'text-danger';
                        bgClass = 'bg-danger-subtle';
                    } else if (lowerF.endsWith('.txt') || lowerF.endsWith('.log')) {
                        icon = 'bi-file-earmark-text';
                        colorClass = 'text-warning';
                        bgClass = 'bg-warning-subtle';
                    }
                    const filePath = relativePath ? `${relativePath}/${f}` : f;
                    return `
                    <li class="list-group-item d-flex justify-content-between align-items-center">
                        <div class="d-flex align-items-center overflow-hidden">
                            <div class="rounded-2 p-2 me-3 ${bgClass} ${colorClass} d-flex align-items-center justify-content-center flex-shrink-0" style="width: 38px; height: 38px;">
                                <i class="bi ${icon} fs-6"></i>
                            </div>
                            <span class="fw-medium text-truncate" title="${f}">${f}</span>
                        </div>
                        <div class="btn-group ms-2 action-buttons">
                            <a href="/files/${encodeURIComponent(filePath)}" target="_blank" class="btn btn-sm btn-light text-primary" title="Preview"><i class="bi bi-eye"></i></a>
                            <button class="btn btn-sm btn-light text-secondary" onclick="renameFile('${filePath}')" title="Rename"><i class="bi bi-pencil-square"></i></button>
                            <button class="btn btn-sm btn-light text-danger" onclick="deleteFile('${filePath}')" title="Delete"><i class="bi bi-trash"></i></button>
                        </div>
                    </li>`}).join('') +
                '</ul>';
        } else {
            return `<div class="d-flex flex-column align-items-center justify-content-center py-5 text-muted">
                <i class="bi bi-folder2-open display-4 mb-2 opacity-50"></i>
                <p class="mb-0 small">${emptyMessage}</p>
            </div>`;
        }
    } catch (err) {
        return '<div class="alert alert-danger" role="alert">Error reading directory.</div>';
    }
}

function getFilesHtml() {
    return generateFileListHtml(DOWNLOAD_DIR, '', 'No files found in downloads folder.');
}

function getHtmlFilesHtml() {
    return generateFileListHtml(HTML_FILES_DIR, 'HTMLFiles', 'No HTML files found.');
}

function getLogFilesHtml() {
    return generateFileListHtml(LOGFILES_DIR, 'logfiles', 'No log files found.');
}

function getNewFilesRevisedHtml() {
    return generateFileListHtml(NEW_FILES_REVISED_DIR, 'new_files_revised', 'No new revised files found.');
}

function getOldFilesRevisedHtml() {
    return generateFileListHtml(OLD_FILES_REVISED_DIR, 'old_files_revised', 'No old revised files found.');
}

function getProcessedFilesHtml() {
    return generateFileListHtml(PROCESSED_FILES_DIR, 'oldfiles', 'No processed files found.');
}

app.get('/', (req, res) => {
    const filesHtml = getFilesHtml();
    const logFilesHtml = getLogFilesHtml();
    const newFilesRevisedHtml = getNewFilesRevisedHtml();
    const oldFilesRevisedHtml = getOldFilesRevisedHtml();
    const processedFilesHtml = getProcessedFilesHtml();
    const htmlFilesHtml = getHtmlFilesHtml();

    res.send(`
<!DOCTYPE html>
<html lang="en" data-bs-theme="light">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Automation Dashboard</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bs-primary-rgb: 99, 102, 241;
            --bs-primary: #6366f1;
            --primary-gradient: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
            --success-gradient: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
            --danger-gradient: linear-gradient(135deg, #f43f5e 0%, #e11d48 100%);
            
            --bs-body-bg-light: #f1f5f9;
            --bs-body-bg-dark: #020617;
            --bs-body-color-light: #0f172a;
            --bs-body-color-dark: #e2e8f0;

            --card-bg-light: #ffffff;
            --card-bg-dark: #0f172a;
            --card-border-light: #e2e8f0;
            --card-border-dark: #1e293b;

            --border-radius: 0.75rem;
            --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
            --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
            --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
        }
        
        [data-bs-theme="light"] {
            --bs-body-bg: var(--bs-body-bg-light);
            --bs-body-color: var(--bs-body-color-light);
            --card-bg: var(--card-bg-light);
            --card-border: var(--card-border-light);
        }

        [data-bs-theme="dark"] {
            --bs-body-bg: var(--bs-body-bg-dark);
            --bs-body-color: var(--bs-body-color-dark);
            --card-bg: var(--card-bg-dark);
            --card-border: var(--card-border-dark);
        }
        
        body {
            font-family: 'Inter', sans-serif;
            background-color: var(--bs-body-bg);
            color: var(--bs-body-color);
            transition: background-color 0.3s ease, color 0.3s ease;
            min-height: 100vh;
            padding-bottom: 60px;
        }

        .main-header {
            background: var(--primary-gradient);
            color: white;
            padding: 4rem 0 6rem;
            margin-bottom: -4.5rem;
            border-radius: 0 0 2rem 2rem;
            box-shadow: var(--shadow-lg);
            position: relative;
            overflow: hidden;
        }
        
        .main-header::before {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            width: 150%;
            padding-bottom: 150%;
            border-radius: 50%;
            background-image: radial-gradient(circle, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0) 60%);
            transform: translate(-50%, -50%);
            animation: pulse 8s infinite ease-in-out;
        }

        @keyframes pulse {
            0% { transform: translate(-50%, -50%) scale(0.8); opacity: 0.5; }
            50% { transform: translate(-50%, -50%) scale(1.2); opacity: 1; }
            100% { transform: translate(-50%, -50%) scale(0.8); opacity: 0.5; }
        }

        .card {
            border: 1px solid var(--card-border);
            border-radius: var(--border-radius);
            box-shadow: var(--shadow-md);
            background-color: var(--card-bg);
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            margin-bottom: 1.5rem;
        }
        
        .card:hover {
            transform: translateY(-3px);
            box-shadow: var(--shadow-lg);
        }

        .card-header {
            background-color: transparent;
            border-bottom: 1px solid var(--card-border);
            padding: 1.25rem 1.5rem;
            font-weight: 600;
            font-size: 1.1rem;
            display: flex;
            align-items: center;
        }
        
        .card-body {
            padding: 1.5rem;
        }

        .upload-area {
            border: 2px dashed var(--bs-primary);
            background-color: rgba(var(--bs-primary-rgb), 0.05);
            border-radius: var(--border-radius);
            padding: 2rem;
            text-align: center;
            cursor: pointer;
            transition: all 0.2s ease;
            position: relative;
            overflow: hidden;
        }

        .upload-area:hover {
            background-color: rgba(var(--bs-primary-rgb), 0.1);
            transform: scale(1.01);
            border-style: solid;
        }
        
        .upload-area:hover .upload-icon {
            transform: translateY(-5px) scale(1.1);
        }
        
        .upload-icon {
            font-size: 3rem;
            color: var(--bs-primary);
            margin-bottom: 1rem;
            transition: transform 0.3s ease;
        }
        
        .log-frame {
            width: 100%;
            height: 500px;
            border: 1px solid var(--card-border);
            border-radius: var(--border-radius);
            background: #0f172a;
        }

        .theme-toggle {
            position: fixed;
            top: 1.25rem;
            right: 1.25rem;
            z-index: 1000;
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            color: var(--bs-body-color);
            width: 42px;
            height: 42px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s ease;
            box-shadow: var(--shadow-sm);
        }
        
        .theme-toggle:hover {
            transform: rotate(15deg) scale(1.1);
            box-shadow: var(--shadow-md);
            color: var(--bs-primary);
        }

        .btn {
            transition: all 0.2s ease;
            border-radius: 0.5rem;
            font-weight: 500;
            padding: 0.6rem 1.2rem;
        }

        .btn-primary {
            background: var(--primary-gradient);
            border: none;
            box-shadow: var(--shadow-sm);
        }
        
        .btn-primary:hover {
            filter: brightness(1.1);
            box-shadow: 0 4px 12px rgba(var(--bs-primary-rgb), 0.3);
            transform: translateY(-2px);
        }
        
        .btn-success {
            background: var(--success-gradient);
            border: none;
        }
        .btn-danger {
            background: var(--danger-gradient);
            border: none;
        }
        .list-group {
            padding-left: 0;
            list-style: none;
        }

        .list-group-item {
            background: var(--bs-body-bg);
            border: 1px solid var(--card-border);
            margin-bottom: 0.5rem;
            border-radius: 0.5rem !important;
            transition: all 0.2s ease;
            padding: 0.75rem 1.25rem;
        }
        
        .list-group-item:hover {
            border-color: var(--bs-primary);
            background: rgba(var(--bs-primary-rgb), 0.05);
            transform: translateX(2px);
        }
        
        .list-group-item .action-buttons {
            opacity: 0;
            transition: opacity 0.2s ease-in-out;
        }
        .list-group-item:hover .action-buttons {
            opacity: 1;
        }

        /* Custom Tabs */
        .nav-tabs {
            border-bottom: 1px solid var(--card-border);
            flex-wrap: nowrap;
            overflow-x: auto;
            overflow-y: hidden;
            -ms-overflow-style: none;
            scrollbar-width: none;
        }
        .nav-tabs::-webkit-scrollbar {
            display: none;
        }
        .nav-tabs .nav-link {
            border: none;
            border-bottom: 2px solid transparent;
            border-radius: 0;
            color: var(--bs-body-color);
            opacity: 0.7;
            font-weight: 500;
            padding: 0.75rem 1rem;
            font-size: 0.9rem;
            transition: all 0.2s;
            white-space: nowrap;
        }
        .nav-tabs .nav-link:hover {
            opacity: 1;
            border-bottom-color: var(--card-border);
        }
        .nav-tabs .nav-link.active {
            border-bottom-color: var(--bs-primary);
            color: var(--bs-primary);
            opacity: 1;
            font-weight: 600;
        }

        .folder-drop-zone {
            position: relative;
            border: 2px dashed transparent;
            border-radius: var(--border-radius);
            transition: all 0.3s ease;
            padding: 0.5rem;
        }
        
        .folder-drop-zone.drag-over {
            border-color: var(--primary-color);
            background-color: rgba(var(--bs-primary-rgb), 0.05);
        }
        
        .drop-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(var(--bs-body-bg-light-rgb, 241, 245, 249), 0.9);
            display: none;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 10;
            border-radius: var(--border-radius);
            backdrop-filter: blur(4px);
        }
        
        [data-bs-theme="dark"] .drop-overlay {
            background: rgba(var(--bs-body-bg-dark-rgb, 2, 6, 23), 0.9);
        }
        
        .folder-drop-zone.drag-over .drop-overlay {
            display: flex;
            animation: fadeIn 0.2s ease;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        
        .drop-overlay * {
            pointer-events: none;
        }
        
        /* Custom Scrollbar */
        ::-webkit-scrollbar {
            width: 6px;
            height: 6px;
        }
        ::-webkit-scrollbar-track {
            background: transparent;
        }
        ::-webkit-scrollbar-thumb {
            background: rgba(0,0,0,0.2);
            border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: rgba(0,0,0,0.3);
        }
        [data-bs-theme="dark"] ::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.2);
        }
        [data-bs-theme="dark"] ::-webkit-scrollbar-thumb:hover {
            background: rgba(255,255,255,0.3);
        }
        
        .progress {
            background-color: var(--card-border);
            height: 8px !important;
            border-radius: 4px !important;
        }
        .progress-bar {
            background: var(--primary-gradient);
        }
    </style>
</head>
<body>
    <button class="btn btn-outline-secondary theme-toggle rounded-circle p-2 shadow-sm" onclick="toggleTheme()" title="Toggle Theme">
        <i class="bi bi-moon-stars-fill" id="themeIcon"></i>
    </button>

    <div class="main-header text-center">
        <div class="container">
            <h1 class="display-5 fw-bold mb-2 tracking-tight"><i class="bi bi-robot me-3"></i>AutoFlow</h1>
            <p class="lead opacity-90 mb-0 fw-light">Intelligent Web Automation Dashboard</p>
        </div>
    </div>

    <div class="container" style="margin-top: -4.5rem;">
        <div class="row g-4">
            <!-- Left Column: Upload & Controls -->
            <div class="col-lg-4">
                <!-- Upload Card -->
                <div class="card h-100">
                    <div class="card-header">
                        <i class="bi bi-cloud-upload me-2 text-primary"></i>Upload Files
                    </div>
                    <div class="card-body d-flex flex-column">
                        <form action="/upload" method="post" enctype="multipart/form-data" id="uploadForm" class="flex-grow-1 d-flex flex-column">
                            <div class="mb-3">
                                <label class="form-label small fw-bold text-muted text-uppercase">Destination</label>
                                <input type="text" class="form-control-plaintext fw-bold text-primary px-2 border rounded bg-light" id="currentUploadDestination" value="Pending Files" readonly>
                            </div>
                            <div class="upload-area flex-grow-1 d-flex flex-column justify-content-center align-items-center mb-3" id="dropArea" onclick="document.getElementById('fileInput').click()">
                                <input type="file" name="files" id="fileInput" accept=".pdf,.html" multiple style="display: none" onchange="handleAutoUpload(this)">
                                <i class="bi bi-cloud-arrow-up upload-icon"></i>
                                <h5 class="fw-bold">Drop files here</h5>
                                <span id="filename" class="text-muted small">or click to browse</span>
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            <!-- Right Column: Queue & Actions -->
            <div class="col-lg-8">
                <div class="card h-100">
                    <div class="card-header d-flex justify-content-between align-items-center">
                        <span><i class="bi bi-list-check me-2 text-primary"></i>File Management</span>
                        <button class="btn btn-sm btn-outline-danger" onclick="clearDownloads()" title="Clear All Downloads">
                            <i class="bi bi-trash"></i> Clear All
                        </button>
                    </div>
                    <div class="card-body">
                        <ul class="nav nav-tabs mb-3" id="queueTabs" role="tablist">
                            <li class="nav-item" role="presentation">
                                <button class="nav-link active" id="pending-tab" data-bs-toggle="tab" data-bs-target="#pending-pane" type="button" role="tab">Download</button>
                            </li>
                            <li class="nav-item" role="presentation">
                                <button class="nav-link" id="html-tab" data-bs-toggle="tab" data-bs-target="#html-pane" type="button" role="tab">HTML</button>
                            </li>
                            <li class="nav-item" role="presentation">
                                <button class="nav-link" id="new-revised-tab" data-bs-toggle="tab" data-bs-target="#new-revised-pane" type="button" role="tab">New (Rev)</button>
                            </li>
                            <li class="nav-item" role="presentation">
                                <button class="nav-link" id="old-revised-tab" data-bs-toggle="tab" data-bs-target="#old-revised-pane" type="button" role="tab">Old (Rev)</button>
                            </li>
                            <li class="nav-item" role="presentation">
                                <button class="nav-link" id="processed-tab" data-bs-toggle="tab" data-bs-target="#processed-pane" type="button" role="tab">Processed</button>
                            </li>
                            <li class="nav-item" role="presentation">
                                <button class="nav-link" id="logs-tab" data-bs-toggle="tab" data-bs-target="#logs-pane" type="button" role="tab">Logs</button>
                            </li>
                        </ul>
                        
                        <div class="tab-content" id="queueTabsContent">
                            <div class="tab-pane fade show active folder-drop-zone" id="pending-pane" role="tabpanel" data-endpoint="/upload" data-name="Pending Files" style="min-height: 200px;">
                                <div id="filesListContainer" style="max-height: 280px; overflow-y: auto;">${filesHtml}</div>
                                <div class="drop-overlay">
                                    <i class="bi bi-cloud-upload display-4 text-primary"></i>
                                    <h5 class="mt-2">Drop to Upload (Pending)</h5>
                                </div>
                            </div>
                            <div class="tab-pane fade folder-drop-zone" id="html-pane" role="tabpanel" data-endpoint="/upload-html-form" data-name="HTML Files" style="min-height: 200px;">
                                <div id="htmlFilesListContainer" style="max-height: 300px; overflow-y: auto;">${htmlFilesHtml}</div>
                                <div class="drop-overlay rounded">
                                    <i class="bi bi-cloud-upload display-4 text-primary"></i>
                                    <h5 class="mt-2">Drop to Upload (HTML)</h5>
                                </div>
                            </div>
                            <div class="tab-pane fade folder-drop-zone" id="new-revised-pane" role="tabpanel" data-endpoint="/upload-new-revised-form" data-name="New Files (Revised)" style="min-height: 200px;">
                                <div id="newFilesRevisedListContainer" style="max-height: 300px; overflow-y: auto;">${newFilesRevisedHtml}</div>
                                <div class="drop-overlay rounded">
                                    <i class="bi bi-cloud-upload display-4 text-primary"></i>
                                    <h5 class="mt-2">Drop to Upload (New Revised)</h5>
                                </div>
                            </div>
                            <div class="tab-pane fade folder-drop-zone" id="old-revised-pane" role="tabpanel" data-endpoint="/upload-old-revised-form" data-name="Old Files (Revised)" style="min-height: 200px;">
                                <div id="oldFilesRevisedListContainer" style="max-height: 300px; overflow-y: auto;">${oldFilesRevisedHtml}</div>
                                <div class="drop-overlay rounded">
                                    <i class="bi bi-cloud-upload display-4 text-primary"></i>
                                    <h5 class="mt-2">Drop to Upload (Old Revised)</h5>
                                </div>
                            </div>
                            <div class="tab-pane fade" id="processed-pane" role="tabpanel" style="min-height: 200px;">
                                <div id="processedFilesListContainer" style="max-height: 280px; overflow-y: auto;">${processedFilesHtml}</div>
                            </div>
                            <div class="tab-pane fade" id="logs-pane" role="tabpanel" style="min-height: 200px;">
                                <div class="d-flex justify-content-end mb-2">
                                    <a href="/download-all-logs" class="btn btn-sm btn-outline-primary me-2" title="Download All" style="--bs-btn-padding-y: .25rem; --bs-btn-padding-x: .5rem; --bs-btn-font-size: .75rem;">
                                        <i class="bi bi-file-zip"></i>
                                    </a>
                                    <button class="btn btn-sm btn-outline-danger" onclick="deleteAllLogFiles()" title="Delete All" style="--bs-btn-padding-y: .25rem; --bs-btn-padding-x: .5rem; --bs-btn-font-size: .75rem;"><i class="bi bi-trash"></i></button>
                                </div>
                                <div id="logFilesListContainer" style="max-height: 300px; overflow-y: auto;">${logFilesHtml}</div>
                            </div>
                        </div>

                        <hr class="my-4">

                        <div class="row g-3 mb-3">
                            <div class="col-md-6">
                                <label for="username" class="form-label small fw-bold text-muted text-uppercase">Username</label>
                                <input type="text" class="form-control" id="username"  placeholder="Enter username">
                            </div>
                            <div class="col-md-6">
                                <label for="password" class="form-label small fw-bold text-muted text-uppercase">Password</label>
                                <input type="password" class="form-control" id="password"  placeholder="Enter password">
                            </div>
                        </div>

                        <div class="mb-3">
                            <label class="form-label small fw-bold text-muted text-uppercase">Automation Mode</label>
                            <select class="form-select" id="automationMode">
                                <option value="full">Full File Review</option>
                                <option value="revised">Revised File Review</option>
                                <option value="form1025">Form 1025 File Review</option>
                                <option value="form1073">Form 1073 File Review</option>
                            </select>
                        </div>

                        <div class="mb-4">
                            <div class="d-flex justify-content-between mb-2">
                                <span class="fw-bold small text-uppercase">Status</span>
                                <span id="progressText" class="small text-muted">Ready</span>
                            </div>
                            <div class="progress">
                                <div id="progressBar" class="progress-bar progress-bar-striped progress-bar-animated" role="progressbar" style="width: 0%"></div>
                            </div>
                        </div>

                        <div class="d-flex align-items-center justify-content-between bg-light-subtle p-3 rounded-3 mb-3 border">
                            <div class="form-check form-switch m-0">
                                <input class="form-check-input" type="checkbox" id="headlessCheckbox">
                                <label class="form-check-label small fw-bold" for="headlessCheckbox">Headless Mode</label>
                            </div>
                            <small class="text-muted">Run in background</small>
                        </div>

                        <div class="row g-2">
                            <div class="col-md-3">
                                <button id="runBtn" class="btn btn-success w-100 py-2" onclick="runAutomation()" title="Start">
                                    <i class="bi bi-play-fill">Start</i>
                                </button>
                            </div>
                            <div class="col-md-3">
                                <button id="pauseBtn" class="btn btn-warning w-100 py-2" onclick="pauseAutomation()" title="Pause" disabled>
                                    <i class="bi bi-pause-fill">Pause</i>
                                </button>
                                <button id="resumeBtn" class="btn btn-info w-100 py-2" onclick="resumeAutomation()" title="Resume" style="display:none;">
                                    <i class="bi bi-play-fill">Resume</i>
                                </button>
                            </div>
                            <div class="col-md-3">
                                <button id="stopBtn" class="btn btn-danger w-100 py-2" onclick="stopAutomation()" title="Stop">
                                    <i class="bi bi-stop-fill">Stop</i>
                                </button>
                            </div>
                            <div class="col-md-3">
                                <button id="killBtn" class="btn btn-dark w-100 py-2" onclick="killAllProcesses()" title="Kill Processes">
                                    <i class="bi bi-x-circle">Kill</i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Logs Section -->
        <div class="row mt-4">
            <div class="col-12">
                <div class="card">
                    <div class="card-header d-flex justify-content-between align-items-center">
                        <span><i class="bi bi-terminal me-2 text-primary"></i>System Logs</span>
                        <div class="btn-group">
                            <button id="toggleLogsBtn" class="btn btn-sm btn-outline-secondary" onclick="toggleLogs()" title="Hide Logs">
                                <i class="bi bi-eye-slash"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-danger" onclick="clearLogs()" title="Clear Logs">
                                <i class="bi bi-trash"></i>
                            </button>
                            <a href="/log" target="_blank" class="btn btn-sm btn-outline-primary" title="Open in New Tab">
                                <i class="bi bi-box-arrow-up-right"></i>
                            </a>
                            <a href="/download-log" class="btn btn-sm btn-outline-success ms-1" title="Download HTML Log">
                                <i class="bi bi-download"></i>
                            </a>
                        </div>
                    </div>
                    <div class="card-body p-2">
                        <iframe src="/log" class="log-frame" id="logFrame"></iframe>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Confirmation Modal -->
    <div class="modal fade" id="confirmationModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Confirm Action</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                    <p id="confirmationMessage">Are you sure you want to proceed?</p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                    <button type="button" class="btn btn-danger" id="confirmActionBtn">Confirm</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Toast Notification -->
    <div class="toast-container position-fixed bottom-0 end-0 p-3">
        <div id="validationToast" class="toast align-items-center text-bg-danger border-0" role="alert" aria-live="assertive" aria-atomic="true">
            <div class="d-flex">
                <div class="toast-body">
                    <i class="bi bi-exclamation-circle me-2"></i> Please select a file first.
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>

    <script>
        let confirmationModal;
        let pendingAction = null;

        document.addEventListener('DOMContentLoaded', () => {
            confirmationModal = new bootstrap.Modal(document.getElementById('confirmationModal'));
            document.getElementById('confirmActionBtn').addEventListener('click', () => {
                if (pendingAction) pendingAction();
                confirmationModal.hide();
            });

            // Initialize upload context based on active tab
            updateUploadContext(document.querySelector('#queueTabs .nav-link.active'));

            // Listen for tab changes to update upload destination
            const tabEls = document.querySelectorAll('button[data-bs-toggle="tab"]');
            tabEls.forEach(tabEl => {
                tabEl.addEventListener('shown.bs.tab', function (event) {
                    updateUploadContext(event.target);
                });
            });
        });

        function updateUploadContext(activeTab) {
            if (!activeTab) return;
            const targetSelector = activeTab.getAttribute('data-bs-target');
            const targetPane = document.querySelector(targetSelector);
            const endpoint = targetPane.getAttribute('data-endpoint');
            const name = targetPane.getAttribute('data-name');

            const uploadForm = document.getElementById('uploadForm');
            const destDisplay = document.getElementById('currentUploadDestination');
            const dropArea = document.getElementById('dropArea');
            const fileInput = document.getElementById('fileInput');

            if (endpoint) {
                uploadForm.action = endpoint;
                destDisplay.value = name;
                destDisplay.classList.remove('text-secondary');
                destDisplay.classList.add('text-primary');

                fileInput.disabled = false;

                dropArea.style.opacity = '1';
                dropArea.style.pointerEvents = 'auto';
                dropArea.style.cursor = 'pointer';
            } else {
                uploadForm.action = '#';
                destDisplay.value = 'Upload Not Available';
                destDisplay.classList.remove('text-primary');
                destDisplay.classList.add('text-secondary');

                fileInput.disabled = true;

                dropArea.style.opacity = '0.5';
                dropArea.style.pointerEvents = 'none';
                dropArea.style.cursor = 'default';
            }
        }

        // Handle Upload Form via AJAX for auto-refresh without reload
        document.getElementById('uploadForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!validateUpload(e)) return;

            const form = e.target;
            const filenameSpan = document.getElementById('filename');
            const dropArea = document.getElementById('dropArea');

            const originalText = filenameSpan.innerHTML;
            filenameSpan.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Uploading...';
            dropArea.style.pointerEvents = 'none';

            try {
                const response = await fetch(form.action, {
                    method: 'POST',
                    body: new FormData(form)
                });

                if (response.ok) {
                    refreshFileLists();
                    // Reset form UI
                    document.getElementById('fileInput').value = '';
                    document.getElementById('filename').innerText = 'or click to browse';
                    document.getElementById('filename').classList.remove('fw-bold', 'text-primary');
                    
                    // Show success toast
                    const toastEl = document.getElementById('validationToast');
                    const toastBody = toastEl.querySelector('.toast-body');
                    toastBody.innerHTML = '<i class="bi bi-check-circle me-2"></i> Upload successful.';
                    toastEl.classList.remove('text-bg-danger');
                    toastEl.classList.add('text-bg-success');
                    new bootstrap.Toast(toastEl).show();
                    
                    // Revert toast style after delay
                    setTimeout(() => {
                        toastEl.classList.add('text-bg-danger');
                        toastEl.classList.remove('text-bg-success');
                        toastBody.innerHTML = '<i class="bi bi-exclamation-circle me-2"></i> Please select a file first.';
                    }, 3000);
                } else {
                    alert('Upload failed.');
                    filenameSpan.innerHTML = originalText;
                }
            } catch (error) {
                alert('Error uploading: ' + error);
                filenameSpan.innerHTML = originalText;
            } finally {
                dropArea.style.pointerEvents = 'auto';
            }
        });

        function showConfirmation(message, action) {
            document.getElementById('confirmationMessage').innerText = message;
            pendingAction = action;
            confirmationModal.show();
        }

        function validateUpload(event) {
            const fileInput = document.getElementById('fileInput');
            if (!fileInput.files || fileInput.files.length === 0) {
                event.preventDefault();
                const toast = new bootstrap.Toast(document.getElementById('validationToast'));
                toast.show();
                return false;
            }
            return true;
        }

        function updateFilename(input) {
            if (input.files && input.files.length > 0) {
                if (input.files.length === 1) {
                    document.getElementById('filename').innerText = input.files[0].name;
                } else {
                    document.getElementById('filename').innerText = input.files.length + ' files selected';
                }
                document.getElementById('filename').classList.add('fw-bold', 'text-primary');
            }
        }

        function handleAutoUpload(input) {
            updateFilename(input);
            if (input.files && input.files.length > 0) {
                document.getElementById('uploadForm').requestSubmit();
            }
        }

        // Drag and Drop Support
        const dropArea = document.getElementById('dropArea');
        const fileInput = document.getElementById('fileInput');

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropArea.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        ['dragenter', 'dragover'].forEach(eventName => {
            dropArea.addEventListener(eventName, () => {
                dropArea.style.borderColor = '#6366f1';
                dropArea.style.backgroundColor = 'rgba(99, 102, 241, 0.1)';
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropArea.addEventListener(eventName, () => {
                dropArea.style.borderColor = '';
                dropArea.style.backgroundColor = '';
            }, false);
        });

        dropArea.addEventListener('drop', handleDrop, false);

        function handleDrop(e) {
            const dt = e.dataTransfer;
            const files = dt.files;
            
            if (files.length > 0) {
                let validFiles = true;
                for (let i = 0; i < files.length; i++) {
                    const name = files[i].name.toLowerCase();
                    if (!name.endsWith('.pdf') && !name.endsWith('.html')) {
                        validFiles = false;
                        break;
                    }
                }

                if (!validFiles) {
                    const toastEl = document.getElementById('validationToast');
                    const toastBody = toastEl.querySelector('.toast-body');
                    const originalText = toastBody.innerText;
                    toastBody.innerHTML = '<i class="bi bi-exclamation-circle me-2"></i> Please upload PDF or HTML files only.';
                    const toast = new bootstrap.Toast(toastEl);
                    toast.show();
                    setTimeout(() => { toastBody.innerText = originalText; }, 3000);
                    return;
                }
                fileInput.files = files;
                updateFilename(fileInput);
                document.getElementById('uploadForm').requestSubmit();
            }
        }

        // Folder Drop Zones Logic
        document.querySelectorAll('.folder-drop-zone').forEach(zone => {
            const overlay = zone.querySelector('.drop-overlay');
            
            zone.addEventListener('dragenter', (e) => {
                e.preventDefault();
                e.stopPropagation();
                zone.classList.add('drag-over');
            });

            zone.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                zone.classList.add('drag-over');
            });

            zone.addEventListener('dragleave', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.relatedTarget && !zone.contains(e.relatedTarget)) {
                    zone.classList.remove('drag-over');
                }
            });

            zone.addEventListener('drop', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                zone.classList.remove('drag-over');
                
                const files = e.dataTransfer.files;
                if (files.length === 0) return;

                const endpoint = zone.dataset.endpoint;
                const formData = new FormData();
                for (let i = 0; i < files.length; i++) {
                    formData.append('files', files[i]);
                }

                const originalText = overlay.innerHTML;
                overlay.style.display = 'flex';
                overlay.innerHTML = '<div class="spinner-border text-primary" role="status"></div><h5 class="mt-2">Uploading...</h5>';

                try {
                    const response = await fetch(endpoint, { method: 'POST', body: formData });
                    overlay.innerHTML = originalText;
                    overlay.style.display = '';

                    if (response.ok || response.redirected) {
                        refreshFileLists();
                        const toastEl = document.getElementById('validationToast');
                        const toastBody = toastEl.querySelector('.toast-body');
                        toastBody.innerHTML = '<i class="bi bi-check-circle me-2"></i> Uploaded to ' + zone.dataset.name;
                        toastEl.classList.remove('text-bg-danger');
                        toastEl.classList.add('text-bg-success');
                        const toast = new bootstrap.Toast(toastEl);
                        toast.show();
                    } else {
                        alert('Upload failed.');
                    }
                } catch (error) {
                    overlay.innerHTML = originalText;
                    overlay.style.display = '';
                    alert('Error uploading files: ' + error);
                }
            });
        });

        // Theme Management
        const htmlElement = document.documentElement;
        const themeIcon = document.getElementById('themeIcon');
        
        // Load saved theme
        const savedTheme = localStorage.getItem('theme') || 'light';
        setTheme(savedTheme);

        function toggleTheme() {
            const currentTheme = htmlElement.getAttribute('data-bs-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            setTheme(newTheme);
            localStorage.setItem('theme', newTheme);
        }

        function setTheme(theme) {
            htmlElement.setAttribute('data-bs-theme', theme);
            if (theme === 'dark') {
                themeIcon.classList.replace('bi-moon-stars-fill', 'bi-sun-fill');
            } else {
                themeIcon.classList.replace('bi-sun-fill', 'bi-moon-stars-fill');
            }
        }

        let progressInterval;
        let fileRefreshInterval;

        // Start polling for file updates immediately
        startFilePolling();

        function startFilePolling() {
            fileRefreshInterval = setInterval(refreshFileLists, 3000);
        }

        async function refreshFileLists() {
            const response = await fetch('/refresh-files');
            const data = await response.json();
            document.getElementById('filesListContainer').innerHTML = data.filesHtml;
            document.getElementById('htmlFilesListContainer').innerHTML = data.htmlFilesHtml;
            document.getElementById('newFilesRevisedListContainer').innerHTML = data.newFilesRevisedHtml;
            document.getElementById('oldFilesRevisedListContainer').innerHTML = data.oldFilesRevisedHtml;
            document.getElementById('processedFilesListContainer').innerHTML = data.processedFilesHtml;
        }

        async function runAutomation() {
            const btn = document.getElementById('runBtn');
            const stopBtn = document.getElementById('stopBtn');
            const pauseBtn = document.getElementById('pauseBtn');
            btn.disabled = true;
            // stopBtn.disabled = false;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
            
            // Reset progress bar
            const bar = document.getElementById('progressBar');
            const text = document.getElementById('progressText');
            bar.style.width = '0%';
            bar.classList.add('progress-bar-animated');
            bar.classList.remove('bg-success', 'bg-danger');
            text.innerText = 'Initializing...';
            pauseBtn.disabled = false;

            try {
                const headless = document.getElementById('headlessCheckbox').checked;
                const mode = document.getElementById('automationMode').value;
                const username = document.getElementById('username').value;
                const password = document.getElementById('password').value;
                const response = await fetch('/run', { 
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ headless, mode, username, password })
                });
                const data = await response.json();
                if (data.status === 'error') {
                    throw new Error(data.message);
                }
                // Start polling for progress
                startProgressPolling();
            } catch (error) {
                alert('Error starting automation: ' + error);
                btn.disabled = false;
                btn.innerHTML = '<i class="bi bi-play-fill"></i>';
                pauseBtn.disabled = true;
            }
            
            // Refresh iframe to ensure it picks up new logs
            document.getElementById('logFrame').src = document.getElementById('logFrame').src;
        }

        async function pauseAutomation() {
            try {
                const response = await fetch('/pause', { method: 'POST' });
                const data = await response.json();
                if (data.status !== 'paused') alert('Failed to pause');
            } catch (error) {
                alert('Error pausing: ' + error);
            }
        }

        async function resumeAutomation() {
            try {
                const response = await fetch('/resume', { method: 'POST' });
                const data = await response.json();
                if (data.status !== 'resumed') alert('Failed to resume');
            } catch (error) {
                alert('Error resuming: ' + error);
            }
        }

        function stopAutomation() {
            showConfirmation('Are you sure you want to stop the automation?', async () => {
                try {
                    const response = await fetch('/stop', { method: 'POST' });
                    const data = await response.json();
                    // The polling loop will detect the stop message in logs and update UI
                } catch (error) {
                    alert('Error stopping: ' + error);
                }
            });
        }

        function killAllProcesses() {
            showConfirmation('Are you sure you want to kill all processes?', async () => {
                try {
                    await fetch('/kill-all', { method: 'POST' });
                    const bar = document.getElementById('progressBar');
                    const btn = document.getElementById('runBtn');
                    const pauseBtn = document.getElementById('pauseBtn');
                    
                    bar.style.width = '0%';
                    bar.classList.remove('progress-bar-animated', 'bg-success', 'bg-danger');
                    document.getElementById('progressText').innerText = 'Processes killed.';
                    
                    pauseBtn.disabled = true;
                    btn.disabled = false;
                    btn.innerHTML = '<i class="bi bi-play-fill"></i>';
                } catch (error) {
                    alert('Error killing processes: ' + error);
                }
            });
        }

        function renameFile(oldPath) {
            const currentName = oldPath.split('/').pop();
            const newName = prompt('Enter the new name for the file:', currentName);

            if (newName && newName.trim() !== '' && newName.trim() !== currentName) {
                fetch('/rename-file', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ oldPath: oldPath, newName: newName.trim() })
                })
                .then(response => response.json())
                .then(data => {
                    if (data.status === 'renamed') {
                        refreshFileLists();
                    } else {
                        alert('Error renaming file: ' + data.message);
                    }
                })
                .catch(error => alert('Error: ' + error));
            }
        }

        function clearLogs() {
            showConfirmation('Are you sure you want to clear the logs?', async () => {
                try {
                    await fetch('/clear-logs', { method: 'POST' });
                    document.getElementById('logFrame').src = document.getElementById('logFrame').src;
                    
                    // Reset progress bar
                    const bar = document.getElementById('progressBar');
                    bar.style.width = '0%';
                    document.getElementById('progressText').innerText = 'Logs cleared.';
                } catch (error) {
                    alert('Error clearing logs: ' + error);
                }
            });
        }

        function clearDownloads() {
            showConfirmation('Are you sure you want to delete all files in all directories?', async () => {
                try {
                    await fetch('/clear-downloads', { method: 'POST' });
                    refreshFileLists();
                } catch (error) {
                    alert('Error clearing downloads: ' + error);
                }
            });
        }

        function deleteFile(filename) {
            showConfirmation('Are you sure you want to delete ' + filename + '?', async () => {
                try {
                    const response = await fetch('/delete/' + encodeURIComponent(filename), { method: 'POST' });
                    const data = await response.json();
                    if (data.status === 'deleted') {
                        refreshFileLists();
                    } else {
                        alert(data.message);
                    }
                } catch (error) {
                    alert('Error deleting file: ' + error);
                }
            });
        }

        function deleteAllLogFiles() {
            showConfirmation('Are you sure you want to delete all generated log files?', async () => {
                try {
                    const response = await fetch('/delete-all-logfiles', { method: 'POST' });
                    const data = await response.json();
                    if (data.status === 'cleared') {
                        refreshFileLists();
                    } else {
                        alert(data.message);
                    }
                } catch (error) {
                    alert('Error deleting log files: ' + error);
                }
            });
        }

        function toggleLogs() {
            const frame = document.getElementById('logFrame');
            const btn = document.getElementById('toggleLogsBtn');
            if (frame.style.display === 'none') {
                frame.style.display = 'block';
                btn.innerHTML = '<i class="bi bi-eye-slash"></i>';
                btn.title = 'Hide Logs';
            } else {
                frame.style.display = 'none';
                btn.innerHTML = '<i class="bi bi-eye"></i>';
                btn.title = 'Show Logs';
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
                    const pauseBtn = document.getElementById('pauseBtn');
                    const resumeBtn = document.getElementById('resumeBtn');
                    const stopBtn = document.getElementById('stopBtn');
                    
                    bar.style.width = data.progress + '%';
                    text.innerText = data.status;

                    if (data.progress >= 100 || data.status.includes('Error') || data.status.includes('Completed') || data.status.includes('Stopped')) {
                        clearInterval(progressInterval);
                        bar.classList.remove('progress-bar-animated');
                        if (data.status.includes('Error') || data.status.includes('Stopped')) bar.classList.add('bg-danger');
                        else bar.classList.add('bg-success');
                        
                        btn.disabled = false;
                        btn.innerHTML = '<i class="bi bi-play-fill"></i>';
                        pauseBtn.disabled = true;
                        resumeBtn.style.display = 'none';
                        pauseBtn.style.display = 'inline-block';
                        refreshFileLists();
                    } else if (data.isPaused) {
                        pauseBtn.style.display = 'none';
                        resumeBtn.style.display = 'inline-block';
                    } else {
                        pauseBtn.style.display = 'inline-block';
                        resumeBtn.style.display = 'none';
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

app.post('/upload', (req, res) => {
    upload.array('files')(req, res, (err) => {
        if (err) {
            return res.send(`<script>alert("${err.message}"); window.location.href = "/";</script>`);
        }
        if (!req.files || req.files.length === 0) {
            return res.status(400).send('No files uploaded.');
        }

        req.files.forEach(file => {
            if (file.originalname.toLowerCase().endsWith('.html')) {
                const oldPath = path.join(DOWNLOAD_DIR, file.filename);
                const newPath = path.join(HTML_FILES_DIR, file.filename);
                try {
                    if (!fs.existsSync(HTML_FILES_DIR)) fs.mkdirSync(HTML_FILES_DIR, { recursive: true });
                    fs.renameSync(oldPath, newPath);
                } catch (e) {
                    console.error(`Error moving HTML file ${file.filename}:`, e);
                }
            }
        });

        res.redirect('/');
    });
});

app.post('/upload-new-revised-form', (req, res) => {
    uploadNewFiles.array('files')(req, res, (err) => {
        if (err) {
            return res.send(`<script>alert("Upload failed: ${err.message.replace(/"/g, '\\"')}"); window.location.href="/";</script>`);
        }
        res.redirect('/');
    });
});

app.post('/upload-old-revised-form', (req, res) => {
    uploadOldFiles.array('files')(req, res, (err) => {
        if (err) {
            return res.send(`<script>alert("Upload failed: ${err.message.replace(/"/g, '\\"')}"); window.location.href="/";</script>`);
        }
        res.redirect('/');
    });
});

app.post('/upload-html-form', (req, res) => {
    uploadHtmlFiles.array('files')(req, res, (err) => {
        if (err) {
            return res.send(`<script>alert("Upload failed: ${err.message.replace(/"/g, '\\"')}"); window.location.href="/";</script>`);
        }
        res.redirect('/');
    });
});

app.post('/upload-new-revised', uploadNewFiles.array('files'), (req, res) => {
    res.json({ status: 'success', message: 'Files uploaded to new_files_revised' });
});

app.post('/upload-old-revised', uploadOldFiles.array('files'), (req, res) => {
    res.json({ status: 'success', message: 'Files uploaded to old_files_revised' });
});

app.get('/refresh-files', (req, res) => {
    res.json({
        filesHtml: getFilesHtml(),
        htmlFilesHtml: getHtmlFilesHtml(),
        logFilesHtml: getLogFilesHtml(),
        newFilesRevisedHtml: getNewFilesRevisedHtml(),
        oldFilesRevisedHtml: getOldFilesRevisedHtml(),
        processedFilesHtml: getProcessedFilesHtml()
    });
});

app.post('/run', (req, res) => {
    console.log('▶ Run request received. Body:', req.body);

    if (activeChildProcess) {
        return res.status(400).json({ status: 'error', message: 'Automation is already running.' });
    }

    const headless = (req.body && req.body.headless) ? 'true' : 'false';
    const mode = req.body.mode || 'full';
    const username = req.body.username || '';
    const password = req.body.password || '';
    console.log(`🚀 Spawning process with PUPPETEER_HEADLESS=${headless} AUTOMATION_MODE=${mode}`);

    const child = spawn('node', ['index.js'], {
        cwd: __dirname,
        env: {
            ...process.env,
            PUPPETEER_HEADLESS: headless,
            AUTOMATION_MODE: mode,
            WEBSITE_B_USERNAME: username,
            WEBSITE_B_PASSWORD: password
        }
    });
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

        const statusMessage = code === 0 ? 'Automation completed successfully' : 'Automation finished with errors.';
        const logMessage = `[SERVER] ${statusMessage}`;

        if (code === 0) {
            logger.success(logMessage);
        } else {
            logger.error(logMessage);
        }

        // Per user request, the server will no longer shut down automatically.
    });

    res.json({ status: 'started', message: 'Automation process started in the background.' });
});

app.post('/pause', (req, res) => {
    try {
        fs.writeFileSync(PAUSE_LOCK_FILE, 'paused');
        try {
            fs.appendFileSync(LOG_FILE_PATH, `<div class="log log-warn">[${new Date().toISOString()}] ⏸ Automation paused by user.</div>\n`);
        } catch (e) { }
        res.json({ status: 'paused', message: 'Automation paused.' });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

app.post('/resume', (req, res) => {
    try {
        if (fs.existsSync(PAUSE_LOCK_FILE)) {
            fs.unlinkSync(PAUSE_LOCK_FILE);
        }
        try {
            fs.appendFileSync(LOG_FILE_PATH, `<div class="log log-success">[${new Date().toISOString()}] ▶ Automation resumed by user.</div>\n`);
        } catch (e) { }
        res.json({ status: 'resumed', message: 'Automation resumed.' });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

app.post('/stop', (req, res) => {
    if (activeChildProcess) {
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

app.post('/kill-all', (req, res) => {
    if (activeChildProcess) {
        if (process.platform === 'win32') {
            exec(`taskkill /pid ${activeChildProcess.pid} /T /F`, () => { });
        } else {
            activeChildProcess.kill();
        }
        activeChildProcess = null;
    }

    if (process.platform === 'win32') {
        exec('wmic process where "name=\'node.exe\' and commandline like \'%index.js%\'" call terminate', () => { });
    } else {
        exec('pkill -f "node index.js"', () => { });
    }

    try {
        fs.appendFileSync(LOG_FILE_PATH, `<div class="log log-error">[${new Date().toISOString()}] ☠ Kill All Processes triggered.</div>\n`);
    } catch (e) { }

    if (fs.existsSync(PAUSE_LOCK_FILE)) {
        try { fs.unlinkSync(PAUSE_LOCK_FILE); } catch (e) {}
    }

    res.json({ status: 'killed', message: 'Processes killed and state reset.' });
});

app.post('/clear-logs', (req, res) => {
    logger.init();
    res.json({ status: 'cleared', message: 'Logs cleared.' });
});

app.post('/clear-downloads', (req, res) => {
    try {
        const dirs = [
            DOWNLOAD_DIR,
            LOGFILES_DIR,
            HTML_FILES_DIR,
            REVISED_FILES_DIR,
            NEW_FILES_REVISED_DIR,
            OLD_FILES_REVISED_DIR,
            PROCESSED_FILES_DIR
        ];

        dirs.forEach(dir => {
            if (fs.existsSync(dir)) {
                const files = fs.readdirSync(dir);
                for (const file of files) {
                    const filePath = path.join(dir, file);
                    try {
                        if (fs.statSync(filePath).isFile()) {
                            fs.unlinkSync(filePath);
                        }
                    } catch (e) { }
                }
            }
        });
        res.json({ status: 'cleared', message: 'All files in all directories cleared.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.post('/delete/:filename', (req, res) => {
    const filename = req.params.filename;
    const filepath = path.resolve(DOWNLOAD_DIR, filename);

    if (!filepath.startsWith(DOWNLOAD_DIR)) {
        return res.status(403).json({ status: 'error', message: 'Access denied.' });
    }

    try {
        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            res.json({ status: 'deleted', message: `File ${filename} deleted.` });
        } else {
            res.status(404).json({ status: 'error', message: 'File not found.' });
        }
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.post('/rename-file', (req, res) => {
    const { oldPath, newName } = req.body;

    if (!oldPath || !newName) {
        return res.status(400).json({ status: 'error', message: 'Old path and new name are required.' });
    }

    if (newName.includes('/') || newName.includes('\\') || newName.includes('..')) {
        return res.status(400).json({ status: 'error', message: 'Invalid new name. Slashes are not allowed.' });
    }

    const oldFullPath = path.resolve(DOWNLOAD_DIR, oldPath);
    const oldDir = path.dirname(oldFullPath);
    const newFullPath = path.join(oldDir, newName);

    if (!oldFullPath.startsWith(DOWNLOAD_DIR)) {
        return res.status(403).json({ status: 'error', message: 'Access denied.' });
    }

    try {
        if (!fs.existsSync(oldFullPath)) {
            return res.status(404).json({ status: 'error', message: 'File not found.' });
        }

        if (fs.existsSync(newFullPath)) {
            return res.status(409).json({ status: 'error', message: 'A file with the new name already exists.' });
        }

        fs.renameSync(oldFullPath, newFullPath);
        res.json({ status: 'renamed', message: `File renamed to ${newName}` });
    } catch (error) {
        console.error('Rename error:', error);
        res.status(500).json({ status: 'error', message: 'An internal error occurred during rename.' });
    }
});

app.get('/files/:filename', (req, res) => {
    const filename = req.params.filename;
    const filepath = path.join(DOWNLOAD_DIR, filename);
    if (fs.existsSync(filepath)) {
        res.sendFile(filepath);
    } else {
        res.status(404).send('File not found');
    }
});

app.post('/delete-all-logfiles', (req, res) => {
    try {
        if (fs.existsSync(LOGFILES_DIR)) {
            const files = fs.readdirSync(LOGFILES_DIR);
            for (const file of files) {
                fs.unlinkSync(path.join(LOGFILES_DIR, file));
            }
        }
        res.json({ status: 'cleared', message: 'All log files deleted.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.get('/download-all-logs', (req, res) => {
    if (!fs.existsSync(LOGFILES_DIR) || fs.readdirSync(LOGFILES_DIR).length === 0) {
        return res.status(404).send('No log files to download.');
    }

    const isWindows = process.platform === 'win32';
    const timestamp = Date.now();
    const archiveName = isWindows ? `logs-${timestamp}.zip` : `logs-${timestamp}.tar.gz`;
    const archivePath = path.join(DOWNLOAD_DIR, archiveName);

    let command;
    if (isWindows) {
        command = `powershell -Command "Compress-Archive -Path '${LOGFILES_DIR}\\*' -DestinationPath '${archivePath}' -Force"`;
    } else {
        command = `tar -czf "${archivePath}" -C "${LOGFILES_DIR}" .`;
    }

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error creating archive: ${error.message}`);
            return res.status(500).send('Failed to create archive.');
        }

        res.download(archivePath, archiveName, (err) => {
            if (err) console.error('Error sending download:', err);
            try {
                if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
            } catch (e) {
                console.error('Error cleaning up archive:', e);
            }
        });
    });
});

app.get('/progress', (req, res) => {
    if (!fs.existsSync(LOG_FILE_PATH)) {
        return res.json({ progress: 0, status: 'Waiting for logs...' });
    }

    try {
        const logContent = fs.readFileSync(LOG_FILE_PATH, 'utf8');
        let progress = 0;
        let status = 'Initializing...';
        const isPaused = fs.existsSync(PAUSE_LOCK_FILE);

        if (logContent.includes('An error occurred')) {
            status = 'Error detected. Check logs.';
        } else if (logContent.includes('Automation stopped by user')) {
            status = 'Stopped by user.';
        } else if (logContent.includes('✅ All files processed successfully!')) {
            progress = 100;
            status = 'Completed!';
        } else if (isPaused) {
            status = 'Paused';
        } else {
            let files = [];
            if (fs.existsSync(DOWNLOAD_DIR)) {
                files = fs.readdirSync(DOWNLOAD_DIR).filter(f => f.toLowerCase().endsWith('.pdf'));
            }
            const totalFiles = files.length || 1;

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
            milestonesPerFile.forEach(m => {
                const regex = new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
                const matches = logContent.match(regex);
                if (matches) completedSteps += matches.length;
            });

            const totalSteps = milestonesPerFile.length * totalFiles;
            progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
            if (progress >= 100) {
                progress = 100;
                status = 'Completed!';
            } else {
                status = `Processing... (${progress}%)`;
            }
        }

        res.json({ progress, status, isPaused });
    } catch (e) {
        res.json({ progress: 0, status: 'Error reading progress', isPaused: false });
    }
});

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

app.get('/download-log', (req, res) => {
    if (fs.existsSync(LOG_FILE_PATH)) {
        res.download(LOG_FILE_PATH, `automation-log-${Date.now()}.html`);
    } else {
        res.status(404).send('Log file not found.');
    }
});

server = app.listen(PORT, () => {
    console.log(`\n🚀 UI Server running at http://localhost:${PORT}`);
    console.log(`📂 Uploads will be saved to: ${DOWNLOAD_DIR}`);
});