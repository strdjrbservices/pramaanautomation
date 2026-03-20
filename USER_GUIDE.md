# AutoFlow Automation Dashboard User Guide

Welcome to the **AutoFlow Automation Dashboard**. This interface allows you to manage files, configure automation settings, and monitor the progress of your file review workflows efficiently.

## 1. Dashboard Layout

The dashboard is split into three main areas:

*   **Upload Area (Left)**: A drag-and-drop zone. The destination folder automatically updates based on the tab selected in the File Management panel.
*   **File Management & Controls (Right)**:
    *   **Tabs**: Navigate between Pending Files, HTML, Revised Files, Processed Files, Logs, and Errors.
    *   **Inputs**: Fields for credentials and automation mode selection.
    *   **Action Buttons**: Start, Pause/Resume, Stop, and Kill controls.
*   **System Logs (Bottom)**: A live view of the automation script's output.

## 2. Basic Configuration

Before running any process, ensure the following are set:

1.  **Credentials**: Enter your `Username` and `Password` in the provided fields.
2.  **Headless Mode**:
    *   **Checked**: The browser runs in the background (faster, no visible window).
    *   **Unchecked**: You can see the browser performing actions (useful for debugging).

## 3. Running an Automation

### Option A: Standard Reviews (Full, Form 1025, Form 1073)

1.  **Select Tab**: Click the **File Review** tab.
2.  **Upload**: Drag and drop your PDF files into the upload area on the left.
3.  **Select Mode**: Choose the desired mode from the dropdown (e.g., `Full File Review`, `Form 1025`, `Form 1073`).
4.  **Start**: Click the **Start** button.

### Option B: Revised File Review

This workflow compares an Old PDF, a New PDF, and an HTML file.

1.  **Upload New PDF**: Select the **New (Rev)** tab. Upload the revised PDF (filename must usually end in `_revised.pdf`).
2.  **Upload Old PDF**: Select the **Old (Rev)** tab. Upload the original PDF.
3.  **Upload HTML**: Select the **HTML** tab. Upload the corresponding HTML file.
4.  **Select Mode**: Choose `Revised File Review` from the dropdown.
5.  **Start**: Click the **Start** button.

## 4. Monitoring Progress

*   **Status Bar**: Displays the current step (e.g., "Extraction of Subject section...").
*   **Live Logs**: Watch the bottom panel for real-time updates.
*   **Email Notifications**: You will receive an email upon success or failure with attachments.

## 5. File Management & Results

*   **Processed Files**: Once completed, PDFs move to the **Processed** tab.
*   **Logs & Output**: Excel output reports and error logs are saved in the **Logs** tab. You can download them individually or as a ZIP.
*   **Errors**: If the automation fails, a screenshot of the browser is saved in the **Errors** tab to help identify the issue.

## 6. Controls & Troubleshooting

| Button | Description |
| :--- | :--- |
| **Start** | Initiates the automation process. |
| **Pause** | Temporarily halts the automation. Click **Resume** to continue. |
| **Stop** | Gracefully stops the automation after the current operation finishes. |
| **Kill** | Forcefully terminates all processes immediately. Use this if the system freezes. |
| **Clear All** | Permanently deletes **ALL** files in all categories. Use with caution. |

## 7. File Renaming & Deleting

In any file list tab:
*   Click the **Preview (Eye)** icon to view a file.
*   Click the **Rename (Pencil)** icon to change a filename.
*   Click the **Delete (Trash)** icon to remove a specific file.

---

**Note**: Error screenshots older than 3 days are automatically deleted by the system.
