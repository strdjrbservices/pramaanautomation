(function() {
    // CSS styles for the help button and modal
    const styles = `
        #help-btn {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background-color: #007bff;
            color: white;
            border: none;
            border-radius: 50%;
            width: 60px;
            height: 60px;
            font-size: 24px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background-color 0.3s;
        }
        #help-btn:hover {
            background-color: #0056b3;
        }
        #help-modal {
            display: none;
            position: fixed;
            z-index: 10000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            overflow: auto;
            background-color: rgba(0,0,0,0.5);
            backdrop-filter: blur(2px);
        }
        #help-modal-content {
            background-color: #fefefe;
            margin: 5% auto;
            padding: 30px;
            border: 1px solid #888;
            width: 80%;
            max-width: 900px;
            border-radius: 8px;
            position: relative;
            max-height: 80vh;
            overflow-y: auto;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            box-shadow: 0 5px 15px rgba(0,0,0,0.3);
        }
        .help-actions {
            position: absolute;
            top: 15px;
            right: 20px;
            display: flex;
            gap: 15px;
            align-items: center;
        }
        .help-action-btn {
            color: #aaa;
            font-size: 24px;
            cursor: pointer;
            background: none;
            border: none;
            padding: 0;
            transition: color 0.2s;
        }
        .help-action-btn:hover {
            color: #333;
        }
        #help-close {
            font-size: 28px;
            font-weight: bold;
        }
        /* User Guide Content Styles */
        #help-modal-content h1 { border-bottom: 2px solid #eee; padding-bottom: 10px; margin-top: 0; color: #2c3e50; }
        #help-modal-content h2 { margin-top: 25px; color: #34495e; border-bottom: 1px solid #eee; padding-bottom: 5px; }
        #help-modal-content h3 { margin-top: 20px; color: #4a6fa5; }
        #help-modal-content ul, #help-modal-content ol { padding-left: 25px; margin-bottom: 15px; }
        #help-modal-content li { margin-bottom: 5px; }
        #help-modal-content code { background-color: #f8f9fa; padding: 2px 5px; border-radius: 4px; font-family: monospace; color: #e83e8c; border: 1px solid #e9ecef; }
        #help-modal-content table { border-collapse: collapse; width: 100%; margin: 20px 0; font-size: 0.95em; }
        #help-modal-content th, #help-modal-content td { border: 1px solid #ddd; padding: 10px; text-align: left; }
        #help-modal-content th { background-color: #f2f2f2; font-weight: bold; }
        #help-modal-content tr:nth-child(even) { background-color: #f9f9f9; }
        #help-modal-content hr { border: 0; height: 1px; background: #ddd; margin: 30px 0; }
        @media print {
            body > * { display: none !important; }
            #help-modal { display: block !important; position: static !important; background: none !important; }
            #help-modal-content { width: 100% !important; max-width: none !important; border: none !important; box-shadow: none !important; margin: 0 !important; padding: 0 !important; max-height: none !important; overflow: visible !important; }
            .help-actions, #help-btn { display: none !important; }
        }
    `;

    // User Guide Content (Based on USER_GUIDE.md)
    const userGuideHTML = `
        <h1>AutoFlow Automation Dashboard User Guide</h1>
        <p>Welcome to the <strong>AutoFlow Automation Dashboard</strong>. This interface allows you to manage files, configure automation settings, and monitor the progress of your file review workflows efficiently.</p>

        <h2>1. Dashboard Layout</h2>
        <p>The dashboard is split into three main areas:</p>
        <ul>
            <li><strong>Upload Area (Left)</strong>: A drag-and-drop zone. The destination folder automatically updates based on the tab selected in the File Management panel.</li>
            <li><strong>File Management & Controls (Right)</strong>:
                <ul>
                    <li><strong>Tabs</strong>: Navigate between Pending Files, HTML, Revised Files, Processed Files, Logs, and Errors.</li>
                    <li><strong>Inputs</strong>: Fields for credentials and automation mode selection.</li>
                    <li><strong>Action Buttons</strong>: Start, Pause/Resume, Stop, and Kill controls.</li>
                </ul>
            </li>
            <li><strong>System Logs (Bottom)</strong>: A live view of the automation script's output.</li>
        </ul>

        <h2>2. Basic Configuration</h2>
        <p>Before running any process, ensure the following are set:</p>
        <ol>
            <li><strong>Credentials</strong>: Enter your <code>Username</code> and <code>Password</code> in the provided fields.</li>
            <li><strong>Headless Mode</strong>:
                <ul>
                    <li><strong>Checked</strong>: The browser runs in the background (faster, no visible window).</li>
                    <li><strong>Unchecked</strong>: You can see the browser performing actions (useful for debugging).</li>
                </ul>
            </li>
        </ol>

        <h2>3. Running an Automation</h2>
        <h3>Option A: Standard Reviews (Full, Form 1025, Form 1073)</h3>
        <ol>
            <li><strong>Select Tab</strong>: Click the <strong>File Review</strong> tab.</li>
            <li><strong>Upload</strong>: Drag and drop your PDF files into the upload area on the left.</li>
            <li><strong>Select Mode</strong>: Choose the desired mode from the dropdown (e.g., <code>Full File Review</code>, <code>Form 1025</code>, <code>Form 1073</code>).</li>
            <li><strong>Start</strong>: Click the <strong>Start</strong> button.</li>
        </ol>

        <h3>Option B: Revised File Review</h3>
        <p>This workflow compares an Old PDF, a New PDF, and an HTML file.</p>
        <ol>
            <li><strong>Upload New PDF</strong>: Select the <strong>New (Rev)</strong> tab. Upload the revised PDF (filename must usually end in <code>_revised.pdf</code>).</li>
            <li><strong>Upload Old PDF</strong>: Select the <strong>Old (Rev)</strong> tab. Upload the original PDF.</li>
            <li><strong>Upload HTML</strong>: Select the <strong>HTML</strong> tab. Upload the corresponding HTML file.</li>
            <li><strong>Select Mode</strong>: Choose <code>Revised File Review</code> from the dropdown.</li>
            <li><strong>Start</strong>: Click the <strong>Start</strong> button.</li>
        </ol>

        <h2>4. Monitoring Progress</h2>
        <ul>
            <li><strong>Status Bar</strong>: Displays the current step (e.g., "Extraction of Subject section...").</li>
            <li><strong>Live Logs</strong>: Watch the bottom panel for real-time updates.</li>
            <li><strong>Email Notifications</strong>: You will receive an email upon success or failure with attachments.</li>
        </ul>

        <h2>5. File Management & Results</h2>
        <ul>
            <li><strong>Processed Files</strong>: Once completed, PDFs move to the <strong>Processed</strong> tab.</li>
            <li><strong>Logs & Output</strong>: Excel output reports and error logs are saved in the <strong>Logs</strong> tab. You can download them individually or as a ZIP.</li>
            <li><strong>Errors</strong>: If the automation fails, a screenshot of the browser is saved in the <strong>Errors</strong> tab to help identify the issue.</li>
        </ul>

        <h2>6. Controls & Troubleshooting</h2>
        <table>
            <thead><tr><th>Button</th><th>Description</th></tr></thead>
            <tbody>
                <tr><td><strong>Start</strong></td><td>Initiates the automation process.</td></tr>
                <tr><td><strong>Pause</strong></td><td>Temporarily halts the automation. Click <strong>Resume</strong> to continue.</td></tr>
                <tr><td><strong>Stop</strong></td><td>Gracefully stops the automation after the current operation finishes.</td></tr>
                <tr><td><strong>Kill</strong></td><td>Forcefully terminates all processes immediately. Use this if the system freezes.</td></tr>
                <tr><td><strong>Clear All</strong></td><td>Permanently deletes <strong>ALL</strong> files in all categories. Use with caution.</td></tr>
            </tbody>
        </table>

        <h2>7. File Renaming & Deleting</h2>
        <p>In any file list tab:</p>
        <ul>
            <li>Click the <strong>Preview (Eye)</strong> icon to view a file.</li>
            <li>Click the <strong>Rename (Pencil)</strong> icon to change a filename.</li>
            <li>Click the <strong>Delete (Trash)</strong> icon to remove a specific file.</li>
        </ul>
        <hr>
        <p><strong>Note</strong>: Error screenshots older than 2 days are automatically deleted by the system.</p>
    `;

    // Inject styles
    const styleSheet = document.createElement("style");
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);

    // Create Floating Button
    const btn = document.createElement("button");
    btn.id = "help-btn";
    btn.innerHTML = '<i class="bi bi-question-lg"></i>';
    btn.title = "Help / User Guide";
    document.body.appendChild(btn);

    // Create Modal
    const modal = document.createElement("div");
    modal.id = "help-modal";
    modal.innerHTML = `
        <div id="help-modal-content">
            <div class="help-actions">
                <button class="help-action-btn" id="help-print" title="Print Guide"><i class="bi bi-printer"></i></button>
                <button class="help-action-btn" id="help-close" title="Close">&times;</button>
            </div>
            ${userGuideHTML}
        </div>`;
    document.body.appendChild(modal);

    // Logic
    btn.onclick = () => modal.style.display = "block";
    document.getElementById("help-close").onclick = () => modal.style.display = "none";
    document.getElementById("help-print").onclick = () => window.print();
    window.onclick = (event) => { if (event.target == modal) modal.style.display = "none"; };
})();