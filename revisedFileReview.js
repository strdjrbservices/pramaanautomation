const path = require('path');
const fs = require('fs');
const logger = require('./logger');
let xlsx;
try {
    xlsx = require('xlsx');
} catch (e) {
}
const {
    WEBSITE_B_URL,
    WEBSITE_B_USERNAME,
    WEBSITE_B_PASSWORD,
    WEBSITE_B_USERNAME_SELECTOR,
    WEBSITE_B_PASSWORD_SELECTOR,
    WEBSITE_B_LOGIN_BUTTON_SELECTOR,
    REVISED_FILE_REVIEW_BUTTON_SELECTOR,
    MAIN_LOADING_INDICATOR_SELECTOR,
    NEW_FILE_UPLOAD_SELECTOR_REVISED,
    OLD_PDF_UPLOAD_SELECTOR,
    HTML_UPLOAD_SELECTOR_REVISED,
    REVISED_PROCESS_BUTTON_SELECTOR,
    CONFIRMATION_CHECKLIST_BUTTON_SELECTOR,
    DOWNLOAD_PATH,
    waitAndClick,
    clickAndWaitForExtraction,
    waitForDownload,
    sendEmail,
    performLogin
} = require('./utils');

async function processRevisedFileReview(browser, pdfFilePath, isFirstRun = false) {
    logger.log('\n--- Starting Revised File Review ---');
    const startTime = Date.now();
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    try {

    const browserClient = await browser.target().createCDPSession();
    await browserClient.send('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: DOWNLOAD_PATH,
        eventsEnabled: true,
    });

    logger.log(`Navigating to ${WEBSITE_B_URL}...`);
    await page.goto(WEBSITE_B_URL, { waitUntil: 'networkidle2' });

    await performLogin(page, isFirstRun);

    await page.waitForNetworkIdle({ idleTime: 500 });

    await waitAndClick(page, REVISED_FILE_REVIEW_BUTTON_SELECTOR, "Revised File Review");

    logger.log('Waiting for the revised review page to load...');
    try {
        await page.waitForSelector(MAIN_LOADING_INDICATOR_SELECTOR, { visible: true, timeout: 5000 });
        await page.waitForSelector(MAIN_LOADING_INDICATOR_SELECTOR, { hidden: true, timeout: 60000 });
    } catch (e) {
    }

    await page.waitForSelector(NEW_FILE_UPLOAD_SELECTOR_REVISED, { timeout: 60000 });
    await page.waitForSelector(HTML_UPLOAD_SELECTOR_REVISED, { timeout: 60000 });
    logger.log('Revised review page loaded with upload inputs.');

    const fileName = path.basename(pdfFilePath);

    logger.log('Uploading old file (PDF)...');
    try {
        const oldFileInput = await page.waitForSelector(OLD_PDF_UPLOAD_SELECTOR, { timeout: 5000 });
        const oldPdfPath = path.join(DOWNLOAD_PATH, 'old_files_revised', fileName);

        if (fs.existsSync(oldPdfPath)) {
            await oldFileInput.uploadFile(oldPdfPath);
            logger.log(`Old file (PDF) selected from: ${oldPdfPath}`);
        } else {
            logger.warn(`File not found in 'old_files_revised': ${oldPdfPath}. Skipping Old PDF upload.`);
        }
    } catch (e) {
        logger.warn('Old PDF upload input not found or timed out. Skipping.');
    }

    logger.log('Uploading new file (PDF)...');
    const newFileInput = await page.waitForSelector(NEW_FILE_UPLOAD_SELECTOR_REVISED);

    let revisedPdfPath = path.join(DOWNLOAD_PATH, 'new_files_revised', fileName);

    if (!fs.existsSync(revisedPdfPath)) {
        const ext = path.extname(fileName);
        const baseName = path.basename(fileName, ext);
        const candidates = [
            `${baseName}_revised${ext}`,
            `${baseName} Revised${ext}`,
            `${baseName}_Revised${ext}`
        ];

        for (const candidate of candidates) {
            const candidatePath = path.join(DOWNLOAD_PATH, 'new_files_revised', candidate);
            if (fs.existsSync(candidatePath)) {
                revisedPdfPath = candidatePath;
                break;
            }
        }
    }

    if (fs.existsSync(revisedPdfPath)) {
        await newFileInput.uploadFile(revisedPdfPath);
        logger.log(`New file (PDF) selected from: ${revisedPdfPath}`);
    } else {
        throw new Error(`File not found in 'new_files_revised': ${fileName} (or variations). Please ensure the file exists in the New Files (Revised Input) folder.`);
    }

    const htmlFileName = path.basename(pdfFilePath).replace(/\.pdf$/i, '.html');
    const htmlFilePath = path.join(DOWNLOAD_PATH, 'HTMLFiles', htmlFileName);

    if (fs.existsSync(htmlFilePath)) {
        logger.log(`Found corresponding HTML file: ${htmlFilePath}`);
        logger.log(`Uploading HTML file from: ${htmlFilePath}`);
        const htmlFileInput = await page.waitForSelector(HTML_UPLOAD_SELECTOR_REVISED);
        await htmlFileInput.uploadFile(htmlFilePath);
        logger.log('HTML file selected.');
    } else {
        logger.warn(`Corresponding HTML file not found at '${htmlFilePath}'. Skipping HTML upload.`);
    }

    logger.log('Waiting for initial file processing to complete...');
    await page.waitForSelector(MAIN_LOADING_INDICATOR_SELECTOR, { hidden: true, timeout: 180000 }); // Wait up to 3 minutes

    logger.log('Waiting 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    const TIMEOUTS = {
        INITIAL: 900000, // 15 minutes
        LONG: 600000,    // 10 minutes
        NORMAL: 180000   // 3 minutes
    };

    const extractionSteps = [
        { selector: REVISED_PROCESS_BUTTON_SELECTOR, name: "Run Revised Analysis" }
    ];

    for (const step of extractionSteps) {
        await clickAndWaitForExtraction(page, step.selector, step.name, TIMEOUTS.LONG);
    }

    const captureTablesDataScript = () => {
        const tables = document.querySelectorAll('table');
        const allTablesData = [];

        tables.forEach(table => {
            const rows = Array.from(table.querySelectorAll('tr'));
            if (rows.length === 0) return;

            const headerRow = rows[0];
            const headers = Array.from(headerRow.querySelectorAll('th, td')).map(c => c.innerText.replace(/\n/g, ' ').trim());

            const getIdx = (name) => headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));

            const idxCorrected = getIdx('Corrected/Not Corrected');
            const idxComment = getIdx('Comment');
            const idxFinalOutput = getIdx('Final Output');
            const idxOldPdf = getIdx('Old PDF');
            const idxNewPdf = getIdx('new PDF');
            const idxStatus = getIdx('Status');
            const idxHtmlVal = getIdx('Value from HTML');
            const idxPdfVal = getIdx('Value from PDF');

            const isTargetTable = (idxCorrected !== -1) || (idxFinalOutput !== -1) || (idxStatus !== -1);
            const dataRows = rows.slice(1);
            const filteredData = [];

            dataRows.forEach(row => {
                const cells = Array.from(row.querySelectorAll('th, td')).map(cell => cell.innerText.replace(/\n/g, ' ').trim());
                // Per user request, include all rows (fulfilled, yes, match) in the output.
                // This means we no longer filter rows.
                filteredData.push(cells);
            });

            const finalRows = [headers, ...filteredData];
            if (finalRows.length > 1) { // Only add if there are data rows
                allTablesData.push(finalRows);
            }
        });

        return allTablesData;
    };

    const workbookData = [];
    let hasMismatch = false;

    logger.log('Capturing analysis output...');
    try {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const revisionTables = await page.evaluate(captureTablesDataScript);
        if (revisionTables.length > 0) {
            workbookData.push({ name: 'Revision Verification', tables: revisionTables });
            hasMismatch = true;
        }
        logger.success(`Captured data for 'Revision Verification'.`);
    } catch (error) {
        logger.error(`Failed to capture output text: ${error.message}`);
    }

    logger.log('Waiting 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    await waitAndClick(page, CONFIRMATION_CHECKLIST_BUTTON_SELECTOR, "Confirmation Checklist");

    logger.log('Waiting 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    logger.log('Uploading old PDF again after checklist...');
    try {
        const oldFileInput = await page.waitForSelector(OLD_PDF_UPLOAD_SELECTOR, { timeout: 5000 });
        const oldPdfPath = path.join(DOWNLOAD_PATH, 'old_files_revised', fileName);

        if (fs.existsSync(oldPdfPath)) {
            await oldFileInput.uploadFile(oldPdfPath);
            logger.log(`Old file (PDF) re-uploaded from: ${oldPdfPath}`);
        } else {
            logger.warn(`File not found in 'old_files_revised': ${oldPdfPath}. Skipping re-upload of Old PDF.`);
        }
    } catch (e) {
        logger.warn('Old PDF upload input not found or timed out for re-upload. Skipping.');
    }

    logger.log('Waiting for 15 seconds...');
    await new Promise(resolve => setTimeout(resolve, 15000));

    const confirmationCheckSelector = "::-p-xpath(//button[normalize-space()='Run Confirmation Check'])";
    await waitAndClick(page, confirmationCheckSelector, "Run Confirmation Check");

    logger.log('Waiting for Confirmation Check output...');
    try {
        await page.waitForSelector(MAIN_LOADING_INDICATOR_SELECTOR, { visible: true, timeout: 5000 });
        logger.log('Loading indicator appeared for "Run Confirmation Check".');
    } catch (e) {
        logger.warn('Loading indicator for "Run Confirmation Check" did not appear. Clicking again.');
        await waitAndClick(page, confirmationCheckSelector, "Run Confirmation Check (2nd attempt)");
        try {
            await page.waitForSelector(MAIN_LOADING_INDICATOR_SELECTOR, { visible: true, timeout: 5000 });
            logger.log('Loading indicator appeared for "Run Confirmation Check" on 2nd attempt.');
        } catch (e2) {
            logger.warn('Loading indicator did not appear after 2nd attempt. Continuing to wait for it to be hidden.');
        }
    }
    await page.waitForSelector(MAIN_LOADING_INDICATOR_SELECTOR, { hidden: true, timeout: 300000 });

    logger.log('Waiting 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    logger.log('Capturing and appending Confirmation Check output...');
    try {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const confirmationTables = await page.evaluate(captureTablesDataScript);
        if (confirmationTables.length > 0) {
            workbookData.push({ name: 'Confirmation Check', tables: confirmationTables });
            hasMismatch = true;
        }
        logger.success(`Captured data for 'Confirmation Check'.`);
    } catch (error) {
        logger.error(`Failed to capture confirmation output text: ${error.message}`);
    }

    logger.log('Waiting 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    await waitAndClick(page, "::-p-xpath(//button[normalize-space()='PDF/HTML'])", "PDF/HTML Button");

    logger.log('Waiting for PDF/HTML output...');
    try {
        await page.waitForSelector(MAIN_LOADING_INDICATOR_SELECTOR, { visible: true, timeout: 5000 });
    } catch (e) {

    }
    await page.waitForSelector(MAIN_LOADING_INDICATOR_SELECTOR, { hidden: true, timeout: 300000 });

    logger.log('Waiting 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    logger.log('Capturing and appending PDF/HTML output...');
    try {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for UI to settle
        const pdfHtmlTables = await page.evaluate(captureTablesDataScript);
        if (pdfHtmlTables.length > 0) {
            workbookData.push({ name: 'PDF_HTML Output', tables: pdfHtmlTables });
            hasMismatch = true;
        }
        logger.success(`Captured data for 'PDF/HTML Output'.`);
    } catch (error) {
        logger.error(`Failed to capture PDF/HTML output text: ${error.message}`);
    }

    const logFilesDir = path.join(DOWNLOAD_PATH, 'logfiles');
    if (!fs.existsSync(logFilesDir)) {
        fs.mkdirSync(logFilesDir, { recursive: true });
    }
    const outputFileName = `${path.basename(pdfFilePath, path.extname(pdfFilePath))}_Output.xlsx`;
    const outputFilePath = path.join(logFilesDir, outputFileName);

    if (workbookData.length > 0) {
        if (xlsx) {
            const wb = xlsx.utils.book_new();
            const allRowsForSingleSheet = [];
            const rowMetadata = []; // { type: 'sectionHeader' | 'tableHeader' | 'data' | 'empty', sectionIndex: number }

            workbookData.forEach((sheetData, sheetIndex) => {
                if (sheetIndex > 0) {
                    allRowsForSingleSheet.push([]);
                    rowMetadata.push({ type: 'empty', sectionIndex: sheetIndex });
                    allRowsForSingleSheet.push([]);
                    rowMetadata.push({ type: 'empty', sectionIndex: sheetIndex });
                }

                allRowsForSingleSheet.push([`--- ${sheetData.name} ---`]);
                rowMetadata.push({ type: 'sectionHeader', sectionIndex: sheetIndex });

                allRowsForSingleSheet.push([]);
                rowMetadata.push({ type: 'empty', sectionIndex: sheetIndex });

                sheetData.tables.forEach((table, tableIndex) => {
                    if (tableIndex > 0) {
                        allRowsForSingleSheet.push([]); // separator row between tables
                        rowMetadata.push({ type: 'empty', sectionIndex: sheetIndex });
                    }
                    table.forEach((row, i) => {
                        allRowsForSingleSheet.push(row);
                        rowMetadata.push({
                            type: i === 0 ? 'tableHeader' : 'data',
                            sectionIndex: sheetIndex
                        });
                    });
                });
            });

            if (allRowsForSingleSheet.length > 0) {
                const ws = xlsx.utils.aoa_to_sheet(allRowsForSingleSheet);

                // Style definitions
                const sectionHeaderStyles = [
                    { font: { bold: true, sz: 14, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "4F81BD" } }, alignment: { horizontal: "center" } }, // Blue
                    { font: { bold: true, sz: 14, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "C0504D" } }, alignment: { horizontal: "center" } }, // Red
                    { font: { bold: true, sz: 14, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "9BBB59" } }, alignment: { horizontal: "center" } }  // Green
                ];
                const tableHeaderStyle = {
                    font: { bold: true },
                    fill: { fgColor: { rgb: "BFBFBF" } }, // Grey
                    border: { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } }
                };
                const dataCellStyles = [
                    { fill: { fgColor: { rgb: "DCE6F1" } }, border: { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } } }, // Light Blue
                    { fill: { fgColor: { rgb: "F2DCDB" } }, border: { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } } }, // Light Red
                    { fill: { fgColor: { rgb: "E6EED5" } }, border: { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } } }  // Light Green
                ];

                if (!ws['!merges']) ws['!merges'] = [];

                rowMetadata.forEach((meta, R) => {
                    const row = allRowsForSingleSheet[R];
                    if (!row) return;

                    let style;
                    switch (meta.type) {
                        case 'sectionHeader':
                            style = sectionHeaderStyles[meta.sectionIndex % sectionHeaderStyles.length];
                            const cellAddress = xlsx.utils.encode_cell({ r: R, c: 0 });
                            if (ws[cellAddress]) ws[cellAddress].s = style;
                            ws['!merges'].push({ s: { r: R, c: 0 }, e: { r: R, c: 15 } });
                            break;
                        case 'tableHeader':
                            style = tableHeaderStyle;
                            for (let C = 0; C < row.length; ++C) {
                                const cellAddress = xlsx.utils.encode_cell({ r: R, c: C });
                                if (ws[cellAddress]) ws[cellAddress].s = style;
                            }
                            break;
                        case 'data':
                            style = dataCellStyles[meta.sectionIndex % dataCellStyles.length];
                            for (let C = 0; C < row.length; ++C) {
                                const cellAddress = xlsx.utils.encode_cell({ r: R, c: C });
                                if (ws[cellAddress]) ws[cellAddress].s = style;
                            }
                            break;
                    }
                });

                // Auto-fit columns
                const colWidths = allRowsForSingleSheet.reduce((acc, row) => {
                    row.forEach((cell, C) => {
                        const cellLen = cell ? String(cell).length : 0;
                        if (!acc[C] || cellLen > acc[C]) acc[C] = cellLen;
                    });
                    return acc;
                }, []);
                ws['!cols'] = colWidths.map(w => ({ wch: Math.min(w + 2, 60) }));

                xlsx.utils.book_append_sheet(wb, ws, 'Analysis Output');
                xlsx.writeFile(wb, outputFilePath);
                logger.success(`Analysis output saved to: ${outputFilePath}`);
            }
        } else {
            logger.warn('`xlsx` package not found. Skipping Excel report generation. Please run `npm install xlsx`.');
        }
    }

    logger.log('Waiting for 10 seconds after saving to DB...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    if (fs.existsSync(outputFilePath)) {
        const status = hasMismatch ? "Action Required" : "Review Completed";
        const runLogPath = path.join(__dirname, 'run-log.html');

        await sendEmail(
            `Automation Output: ${status} - ${path.basename(pdfFilePath)} - ${new Date().toLocaleString()}`,
            `The automation process for ${path.basename(pdfFilePath)} has completed.\n\nStatus: ${status}\n\nPlease find the attached output file, uploaded PDF, and system logs.`,
            [outputFilePath, pdfFilePath, runLogPath]
        );
    }

    const endTime = Date.now();
    const durationInMinutes = ((endTime - startTime) / 60000).toFixed(2);
    logger.success(`\n✅ Revised File Review processing completed in ${durationInMinutes} minutes.`);
    logger.log('--- Finished Revised File Review ---');
    await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
        logger.error(`❌ Error during Revised File Review: ${error.message}`);
        const runLogPath = path.join(__dirname, 'run-log.html');
        const logFilesDir = path.join(DOWNLOAD_PATH, 'logfiles');
        const outputFileName = `${path.basename(pdfFilePath, path.extname(pdfFilePath))}_Output.xlsx`;
        const outputFilePath = path.join(logFilesDir, outputFileName);

        const attachments = [pdfFilePath, runLogPath];
        if (fs.existsSync(outputFilePath)) {
            attachments.push(outputFilePath);
        }

        try {
            const screenshotPath = path.join(DOWNLOAD_PATH, `error_screenshot_${Date.now()}.png`);
            if (page && !page.isClosed()) {
                await page.screenshot({ path: screenshotPath, fullPage: true });
                attachments.push(screenshotPath);
            }
        } catch (screenshotError) {
            logger.error(`Failed to take error screenshot: ${screenshotError.message}`);
        }

        await sendEmail(
            `Automation Output: Failure - Revised File Review - ${path.basename(pdfFilePath)} - ${new Date().toLocaleString()}`,
            `The automation process for ${path.basename(pdfFilePath)} failed.\n\nError: ${error.message}\n\nAttached:\n- Uploaded PDF\n- System Logs\n- Partial Output (if available)\n- Error Screenshot`,
            attachments
        );
        throw error;
    } finally {
        if (page && !page.isClosed()) {
            await page.close();
        }
    }
}

module.exports = { processRevisedFileReview };