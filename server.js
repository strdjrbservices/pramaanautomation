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
const HTML_FILES_DIR = path.join(DOWNLOAD_DIR, 'HTMLFIles');
const REVISED_FILES_DIR = path.join(DOWNLOAD_DIR, 'RevisedFiles');
const NEW_FILES_REVISED_DIR = path.join(DOWNLOAD_DIR, 'new_files_revised');
const OLD_FILES_REVISED_DIR = path.join(DOWNLOAD_DIR, 'old_files_revised');
const PROCESSED_FILES_DIR = path.join(DOWNLOAD_DIR, 'oldfiles');
const LOG_FILE_PATH = path.resolve(__dirname, 'run-log.html');

let activeChildProcess = null;

if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
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
const uploadNewFiles = multer({ storage: newFilesStorage });

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
const uploadHtmlFiles = multer({ storage: htmlFilesStorage });

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
                    <li class="list-group-item d-flex justify-content-between align-items-center p-3 mb-2 border-0 shadow-sm rounded-3">
                        <div class="d-flex align-items-center overflow-hidden">
                            <div class="rounded-3 p-2 me-3 ${bgClass} ${colorClass} d-flex align-items-center justify-content-center flex-shrink-0" style="width: 42px; height: 42px;">
                                <i class="bi ${icon} fs-5"></i>
                            </div>
                            <span class="fw-medium text-truncate" title="${f}">${f}</span>
                        </div>
                        <div class="btn-group ms-2 opacity-75">
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
    return generateFileListHtml(HTML_FILES_DIR, 'HTMLFIles', 'No HTML files found.');
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
            --primary-color: #4f46e5;
            --secondary-color: #8b5cf6;
            --primary-gradient: linear-gradient(135deg, #4f46e5 0%, #9333ea 100%);
            --success-gradient: linear-gradient(135deg, #10b981 0%, #059669 100%);
            --danger-gradient: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
            --card-bg-light: rgba(255, 255, 255, 0.9);
            --card-bg-dark: rgba(15, 23, 42, 0.85);
            --body-bg-light: #f8fafc;
            --body-bg-dark: #0f172a;
            --text-light: #1e293b;
            --text-dark: #e2e8f0;
            --border-light: rgba(0,0,0,0.05);
            --border-dark: rgba(255,255,255,0.08);
            --border-radius: 1rem;
            --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
            --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
        }
        
        body {
            font-family: 'Inter', sans-serif;
            background-color: var(--body-bg-light);
            color: var(--text-light);
            transition: background-color 0.3s ease, color 0.3s ease;
            min-height: 100vh;
            padding-bottom: 60px;
            background-image:
                radial-gradient(circle at 0% 0%, rgba(79, 70, 229, 0.08), transparent 40%),
                radial-gradient(circle at 100% 100%, rgba(139, 92, 246, 0.08), transparent 40%);
            background-attachment: fixed;
        }

        [data-bs-theme="dark"] body {
            background-color: var(--body-bg-dark);
            color: var(--text-dark);
            background-image:
                radial-gradient(circle at 0% 0%, rgba(79, 70, 229, 0.15), transparent 40%),
                radial-gradient(circle at 100% 100%, rgba(139, 92, 246, 0.15), transparent 40%);
        }

        .main-header {
            background: var(--primary-gradient);
            color: white;
            padding: 3.5rem 0 5rem;
            margin-bottom: -4rem;
            border-radius: 0 0 2.5rem 2.5rem;
            box-shadow: var(--shadow-lg);
            position: relative;
            overflow: hidden;
        }
        
        .main-header::before {
            content: '';
            position: absolute;
            top: 0; left: 0;
            width: 100%; height: 100%;
            background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
            animation: rotate 20s linear infinite;
        }

        .card {
            border: 1px solid rgba(255,255,255,0.5);
            border-radius: var(--border-radius);
            box-shadow: var(--shadow-md);
            background-color: var(--card-bg-light);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
            margin-bottom: 1.5rem;
        }

        [data-bs-theme="dark"] .card {
            background-color: var(--card-bg-dark);
            border-color: var(--border-dark);
        }
        
        .card:hover {
            transform: translateY(-2px);
            box-shadow: var(--shadow-lg);
        }

        .card-header {
            background-color: transparent;
            border-bottom: 1px solid var(--border-light);
            padding: 1.5rem;
            font-weight: 600;
            font-size: 1.1rem;
            display: flex;
            align-items: center;
        }

        [data-bs-theme="dark"] .card-header {
            border-bottom: 1px solid var(--border-dark);
        }
        
        .card-body {
            padding: 1.5rem;
        }

        .upload-area {
            border: 2px dashed var(--primary-color);
            background-color: rgba(79, 70, 229, 0.03);
            border-radius: var(--border-radius);
            padding: 2rem;
            text-align: center;
            cursor: pointer;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }

        [data-bs-theme="dark"] .upload-area {
            border-color: rgba(99, 102, 241, 0.4);
            background-color: rgba(15, 23, 42, 0.4);
        }

        .upload-area:hover {
            background-color: rgba(79, 70, 229, 0.08);
            transform: scale(1.02);
        }
        
        .upload-area:hover .upload-icon {
            transform: translateY(-5px);
        }
        
        .upload-icon {
            font-size: 3.5rem;
            background: var(--primary-gradient);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 1rem;
            transition: transform 0.3s ease;
        }
        
        .log-frame {
            width: 100%;
            height: 500px;
            border: none;
            border-radius: calc(var(--border-radius) - 0.5rem);
            background: #0f172a;
            box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);
        }

        .theme-toggle {
            position: fixed;
            top: 1.25rem;
            right: 1.25rem;
            z-index: 1000;
            background: var(--card-bg-light);
            backdrop-filter: blur(10px);
            border: 1px solid var(--border-light);
            color: var(--text-light);
            width: 42px;
            height: 42px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s ease;
            box-shadow: var(--shadow-sm);
        }
        
        [data-bs-theme="dark"] .theme-toggle {
            background: var(--card-bg-dark);
            border-color: var(--border-dark);
            color: var(--text-dark);
        }
        
        .theme-toggle:hover {
            transform: rotate(15deg) scale(1.1);
            box-shadow: var(--shadow-md);
        }

        .btn {
            transition: all 0.2s ease;
            border-radius: 0.75rem;
            font-weight: 500;
        }

        .btn-primary {
            background: var(--primary-gradient);
            border: none;
            padding: 0.6rem 1.5rem;
            box-shadow: var(--shadow-sm);
        }
        
        .btn-primary:hover {
            filter: brightness(110%);
            box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);
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
        
        .btn-outline-secondary {
            border-color: var(--border-light);
            color: #64748b;
        }
        
        [data-bs-theme="dark"] .btn-outline-secondary {
            border-color: #334155;
            color: #94a3b8;
        }
        
        .list-group {
            padding-left: 0;
            list-style: none;
        }

        .list-group-item {
            background: white;
            border: none;
            margin-bottom: 0.75rem;
            box-shadow: var(--shadow-sm);
            border-radius: 0.75rem !important;
            transition: all 0.2s ease;
        }

        [data-bs-theme="dark"] .list-group-item {
            background: rgba(255,255,255,0.03);
        }
        
        .list-group-item:hover {
            transform: translateX(4px);
            box-shadow: var(--shadow-md);
        }

        /* Custom Tabs */
        .nav-tabs {
            border-bottom: none;
            gap: 0.5rem;
            padding: 0.35rem;
            background: rgba(0,0,0,0.04);
            border-radius: 1rem;
            display: inline-flex;
            flex-wrap: wrap;
        }
        [data-bs-theme="dark"] .nav-tabs {
            background: rgba(255,255,255,0.05);
        }
        .nav-tabs .nav-link {
            border: none;
            border-radius: 0.75rem;
            color: var(--text-light);
            font-weight: 500;
            padding: 0.5rem 1rem;
            font-size: 0.9rem;
            transition: all 0.2s;
        }
        [data-bs-theme="dark"] .nav-tabs .nav-link {
            color: var(--text-dark);
            opacity: 0.7;
        }
        .nav-tabs .nav-link:hover {
            background: rgba(255,255,255,0.5);
            opacity: 1;
        }
        [data-bs-theme="dark"] .nav-tabs .nav-link:hover {
            background: rgba(255,255,255,0.1);
        }
        .nav-tabs .nav-link.active {
            background: white;
            color: var(--primary-color);
            box-shadow: var(--shadow-sm);
            opacity: 1;
        }
        [data-bs-theme="dark"] .nav-tabs .nav-link.active {
            background: var(--primary-color);
            color: white;
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
            background-color: rgba(79, 70, 229, 0.05);
            box-shadow: var(--shadow-md);
        }
        
        .drop-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(255, 255, 255, 0.95);
            display: none;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 10;
            border-radius: var(--border-radius);
            backdrop-filter: blur(4px);
        }
        
        [data-bs-theme="dark"] .drop-overlay {
            background: rgba(15, 23, 42, 0.95);
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
            background-color: var(--border-light);
            height: 12px !important;
            border-radius: 6px !important;
            box-shadow: inset 0 1px 2px rgba(0,0,0,0.1);
        }
        [data-bs-theme="dark"] .progress {
            background-color: var(--border-dark);
        }
        .progress-bar {
            background: var(--primary-gradient);
            box-shadow: 0 0 10px rgba(79, 70, 229, 0.5);
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

    <div class="container" style="margin-top: -4rem;">
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
                                <label for="uploadDestination" class="form-label small fw-bold text-muted text-uppercase">Destination</label>
                                <select class="form-select" id="uploadDestination" onchange="updateUploadAction()">
                                    <option value="/upload" selected>Download</option>
                                    <option value="/upload-new-revised-form">New Files (Revised)</option>
                                    <option value="/upload-old-revised-form">Old Files (Revised)</option>
                                    <option value="/upload-html-form">HTML Files</option>
                                </select>
                            </div>
                            <div class="upload-area flex-grow-1 d-flex flex-column justify-content-center align-items-center mb-3" id="dropArea" onclick="document.getElementById('fileInput').click()">
                                <input type="file" name="files" id="fileInput" accept=".pdf,.html" multiple style="display: none" onchange="updateFilename(this)">
                                <i class="bi bi-cloud-arrow-up upload-icon"></i>
                                <h5 class="fw-bold">Drop files here</h5>
                                <span id="filename" class="text-muted small">or click to browse</span>
                            </div>
                            <button type="submit" class="btn btn-primary w-100 py-2 fw-bold shadow-sm" id="uploadBtn">
                                <i class="bi bi-upload me-2"></i>Upload
                            </button>
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
                        <ul class="nav nav-tabs mb-4" id="queueTabs" role="tablist">
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
                                <div id="filesListContainer" style="max-height: 300px; overflow-y: auto;">${filesHtml}</div>
                                <div class="drop-overlay">
                                    <i class="bi bi-cloud-upload display-4 text-primary"></i>
                                    <h5 class="mt-2">Drop to Upload (Pending)</h5>
                                </div>
                            </div>
                            <div class="tab-pane fade folder-drop-zone" id="html-pane" role="tabpanel" data-endpoint="/upload-html-form" data-name="HTML Files" style="min-height: 200px;">
                                <div id="htmlFilesListContainer" style="max-height: 300px; overflow-y: auto;">${htmlFilesHtml}</div>
                                <div class="drop-overlay">
                                    <i class="bi bi-cloud-upload display-4 text-primary"></i>
                                    <h5 class="mt-2">Drop to Upload (HTML)</h5>
                                </div>
                            </div>
                            <div class="tab-pane fade folder-drop-zone" id="new-revised-pane" role="tabpanel" data-endpoint="/upload-new-revised-form" data-name="New Files (Revised)" style="min-height: 200px;">
                                <div id="newFilesRevisedListContainer" style="max-height: 300px; overflow-y: auto;">${newFilesRevisedHtml}</div>
                                <div class="drop-overlay">
                                    <i class="bi bi-cloud-upload display-4 text-primary"></i>
                                    <h5 class="mt-2">Drop to Upload (New Revised)</h5>
                                </div>
                            </div>
                            <div class="tab-pane fade folder-drop-zone" id="old-revised-pane" role="tabpanel" data-endpoint="/upload-old-revised-form" data-name="Old Files (Revised)" style="min-height: 200px;">
                                <div id="oldFilesRevisedListContainer" style="max-height: 300px; overflow-y: auto;">${oldFilesRevisedHtml}</div>
                                <div class="drop-overlay">
                                    <i class="bi bi-cloud-upload display-4 text-primary"></i>
                                    <h5 class="mt-2">Drop to Upload (Old Revised)</h5>
                                </div>
                            </div>
                            <div class="tab-pane fade" id="processed-pane" role="tabpanel" style="min-height: 200px;">
                                <div id="processedFilesListContainer" style="max-height: 300px; overflow-y: auto;">${processedFilesHtml}</div>
                            </div>
                            <div class="tab-pane fade" id="logs-pane" role="tabpanel" style="min-height: 200px;">
                                <div class="d-flex justify-content-end mb-2">
                                    <a href="/download-all-logs" class="btn btn-sm btn-outline-primary me-1" title="Download All" style="--bs-btn-padding-y: .25rem; --bs-btn-padding-x: .5rem; --bs-btn-font-size: .75rem;">
                                        <i class="bi bi-file-zip"></i>
                                    </a>
                                    <button class="btn btn-sm btn-outline-danger" onclick="deleteAllLogFiles()" title="Delete All" style="--bs-btn-padding-y: .25rem; --bs-btn-padding-x: .5rem; --bs-btn-font-size: .75rem;"><i class="bi bi-trash"></i></button>
                                </div>
                                <div id="logFilesListContainer" style="max-height: 300px; overflow-y: auto;">${logFilesHtml}</div>
                            </div>
                        </div>

                        <hr class="my-4 opacity-10">

                        <div class="mb-3">
                            <label class="form-label small fw-bold text-muted text-uppercase">Automation Mode</label>
                            <select class="form-select" id="automationMode">
                                <option value="full">Full File Review</option>
                                <option value="revised">Revised File Review</option>
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

                        <div class="d-flex align-items-center justify-content-between bg-body-tertiary p-3 rounded-3 mb-3">
                            <div class="form-check form-switch m-0">
                                <input class="form-check-input" type="checkbox" id="headlessCheckbox">
                                <label class="form-check-label small fw-bold" for="headlessCheckbox">Headless Mode</label>
                            </div>
                            <small class="text-muted">Run in background</small>
                        </div>

                        <div class="row g-2">
                            <div class="col-md-6">
                                <button id="runBtn" class="btn btn-success w-100 py-2" onclick="runAutomation()" title="Start">
                                    <i class="bi bi-play-fill">Start</i>
                                </button>
                            </div>
                            <div class="col-md-3">
                                <button id="stopBtn" class="btn btn-danger w-100 py-2" onclick="stopAutomation()" title="Stop">
                                    <i class="bi bi-stop-fill">Stop</i>
                                </button>
                            </div>
                            <div class="col-md-3">
                                <button id="killBtn" class="btn btn-dark w-100 py-2" onclick="killAllProcesses()" title="Kill Processes">
                                    <i class="bi bi-x-circle">Kill Processes</i>
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
        });

        // Handle Upload Form via AJAX for auto-refresh without reload
        document.getElementById('uploadForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!validateUpload(e)) return;

            const form = e.target;
            const btn = document.getElementById('uploadBtn');
            const originalText = btn.innerHTML;
            
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Uploading...';

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
                }
            } catch (error) {
                alert('Error uploading: ' + error);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        });

        function updateUploadAction() {
            const select = document.getElementById('uploadDestination');
            const form = document.getElementById('uploadForm');
            form.action = select.value;
        }

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

            try {
                const headless = document.getElementById('headlessCheckbox').checked;
                const mode = document.getElementById('automationMode').value;
                const response = await fetch('/run', { 
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ headless, mode })
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
            }
            
            // Refresh iframe to ensure it picks up new logs
            document.getElementById('logFrame').src = document.getElementById('logFrame').src;
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
                    
                    bar.style.width = '0%';
                    bar.classList.remove('progress-bar-animated', 'bg-success', 'bg-danger');
                    document.getElementById('progressText').innerText = 'Processes killed.';
                    
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
                        refreshFileLists();
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
    console.log(`🚀 Spawning process with PUPPETEER_HEADLESS=${headless} AUTOMATION_MODE=${mode}`);

    const child = spawn('node', ['index.js'], { 
        cwd: __dirname,
        env: { ...process.env, PUPPETEER_HEADLESS: headless, AUTOMATION_MODE: mode }
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
    });

    res.json({ status: 'started', message: 'Automation process started in the background.' });
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
            exec(`taskkill /pid ${activeChildProcess.pid} /T /F`, () => {});
        } else {
            activeChildProcess.kill();
        }
        activeChildProcess = null;
    }
    
    if (process.platform === 'win32') {
        exec('wmic process where "name=\'node.exe\' and commandline like \'%index.js%\'" call terminate', () => {});
    } else {
        exec('pkill -f "node index.js"', () => {});
    }

    try {
        fs.appendFileSync(LOG_FILE_PATH, `<div class="log log-error">[${new Date().toISOString()}] ☠ Kill All Processes triggered.</div>\n`);
    } catch (e) {}
    
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

        if (logContent.includes('An error occurred')) {
            status = 'Error detected. Check logs.';
        } else if (logContent.includes('Automation stopped by user')) {
            status = 'Stopped by user.';
        } else if (logContent.includes('✅ All files processed successfully!')) {
            progress = 100;
            status = 'Completed!';
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

        res.json({ progress, status });
    } catch (e) {
        res.json({ progress: 0, status: 'Error reading progress' });
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

app.listen(PORT, () => {
    console.log(`\n🚀 UI Server running at http://localhost:${PORT}`);
    console.log(`📂 Uploads will be saved to: ${DOWNLOAD_DIR}`);
});