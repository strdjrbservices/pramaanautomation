const path = require('path');
const fs = require('fs');
const logger = require('./logger');
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
    sendEmail
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

    if (isFirstRun) {
        logger.log('Attempting to log in...');
        try {
            const loginTitleSelector = "::-p-xpath(//*[normalize-space(.)='DJRB Review'])";
            await page.waitForSelector(loginTitleSelector, { timeout: 10000 });
            logger.log('Login page title "DJRB Review" found.');

            await page.waitForSelector(WEBSITE_B_USERNAME_SELECTOR, { timeout: 30000 });
            logger.log('Login form found. Entering credentials...');

            await page.type(WEBSITE_B_USERNAME_SELECTOR, WEBSITE_B_USERNAME);
            await page.type(WEBSITE_B_PASSWORD_SELECTOR, WEBSITE_B_PASSWORD);

            await page.click(WEBSITE_B_LOGIN_BUTTON_SELECTOR);
            logger.log('Login button clicked. Waiting for response...');

            const welcomeTextSelector = "::-p-xpath(//*[contains(text(), 'Appraisal Tools')])";
            const loginErrorSelector = "::-p-xpath(//*[contains(@class, 'MuiAlert-root') and contains(., 'Invalid')])";

            await Promise.race([
                page.waitForSelector(welcomeTextSelector),
                page.waitForSelector(loginErrorSelector),
            ]);

            if (await page.$(loginErrorSelector)) {
                throw new Error('Login failed. The page displayed an "Invalid" credentials error.');
            }

            logger.success('Login successful! Welcome text found.');
        } catch (error) {
            throw new Error(`Login failed. Please check your credentials. Original error: ${error.message}`);
        }
    } else {
        logger.log('Skipping login for subsequent file, assuming session is active.');
        try {
            const welcomeTextSelector = "::-p-xpath(//*[contains(text(), 'Appraisal Tools')])";
            await page.waitForSelector(welcomeTextSelector, { timeout: 30000 });
            logger.success('Dashboard loaded, session is active.');
        } catch (error) {
            throw new Error(`Could not verify active session on subsequent run. Dashboard welcome text not found. Error: ${error.message}`);
        }
    }

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
    const htmlFilePath = path.join(DOWNLOAD_PATH, 'HTMLFIles', htmlFileName);

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

    const captureAndFormatTablesScript = () => {
        const tables = document.querySelectorAll('table');
        let capturedText = '';

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

                if (!isTargetTable) {
                    filteredData.push(cells);
                    return;
                }

                let keep = false;
                if (idxCorrected !== -1 && idxComment !== -1) {
                    if ((cells[idxCorrected] || '').toLowerCase().includes('not fulfilled') && (cells[idxComment] || '').length > 0) keep = true;
                }
                if (!keep && idxFinalOutput !== -1 && idxOldPdf !== -1 && idxNewPdf !== -1) {
                    if ((cells[idxFinalOutput] || '').toLowerCase() === 'no' && (cells[idxOldPdf] || '').length > 0 && (cells[idxNewPdf] || '').length > 0) keep = true;
                }
                if (!keep && idxStatus !== -1 && idxHtmlVal !== -1 && idxPdfVal !== -1) {
                    if ((cells[idxStatus] || '').toLowerCase() === 'mismatch' && (cells[idxHtmlVal] || '').length > 0 && (cells[idxPdfVal] || '').length > 0) keep = true;
                }

                if (keep) filteredData.push(cells);
            });

            const finalRows = [headers, ...filteredData];
            if (finalRows.length === 0 || finalRows[0].length === 0) return;

            const MAX_COL_WIDTH = 80;

            const colWidths = finalRows[0].map((_, i) => {
                const maxWidth = Math.max(...finalRows.map(row => (row[i] || '').length));
                return Math.min(maxWidth, MAX_COL_WIDTH);
            });

            const wrapText = (text, width) => {
                text = text || '';
                if (text.length <= width) {
                    return [text];
                }

                const words = text.split(' ');
                const resultLines = [];
                let currentLine = '';

                for (const word of words) {
                    if (word.length > width) {
                        if (currentLine.length > 0) {
                            resultLines.push(currentLine);
                        }
                        let tempWord = word;
                        while (tempWord.length > width) {
                            resultLines.push(tempWord.slice(0, width));
                            tempWord = tempWord.slice(width);
                        }
                        currentLine = tempWord;
                        continue;
                    }

                    if ((currentLine + ' ' + word).trim().length > width) {
                        resultLines.push(currentLine);
                        currentLine = word;
                    } else {
                        currentLine = (currentLine + ' ' + word).trim();
                    }
                }

                if (currentLine) {
                    resultLines.push(currentLine);
                }

                return resultLines.length > 0 ? resultLines : [''];
            };

            const separator = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+';
            let tableText = separator + '\n';

            finalRows.forEach((row, rowIndex) => {
                const wrappedCells = row.map((cell, i) => wrapText(cell || '', colWidths[i]));
                const maxLines = Math.max(...wrappedCells.map(lines => lines.length));

                for (let lineIndex = 0; lineIndex < maxLines; lineIndex++) {
                    const lineParts = wrappedCells.map((lines, colIndex) => {
                        const text = lines[lineIndex] || '';
                        return ' ' + text.padEnd(colWidths[colIndex]) + ' ';
                    });
                    tableText += '|' + lineParts.join('|') + '|\n';
                }

                if (rowIndex === 0) {
                    tableText += separator + '\n';
                }
            });

            tableText += separator + '\n';

            capturedText += tableText + '\n\n';
        });

        return capturedText;
    };

    logger.log('Capturing analysis output...');
    try {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const outputText = await page.evaluate(captureAndFormatTablesScript);

        const logFilesDir = path.join(DOWNLOAD_PATH, 'logfiles');
        if (!fs.existsSync(logFilesDir)) {
            fs.mkdirSync(logFilesDir, { recursive: true });
        }

        const outputFileName = `${path.basename(pdfFilePath, path.extname(pdfFilePath))}_Output.txt`;
        const outputFilePath = path.join(logFilesDir, outputFileName);
        const contentWithHeader = `--- Revision Verification ---\n\n${outputText}`;
        fs.writeFileSync(outputFilePath, contentWithHeader);
        logger.success(`Analysis output saved to: ${outputFilePath}`);
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
        const confirmationOutputText = await page.evaluate(captureAndFormatTablesScript);

        const logFilesDir = path.join(DOWNLOAD_PATH, 'logfiles');
        const outputFileName = `${path.basename(pdfFilePath, path.extname(pdfFilePath))}_Output.txt`;
        const outputFilePath = path.join(logFilesDir, outputFileName);

        const contentToAppend = `\n\n==========\n\n--- Confirmation Check Output ---\n\n${confirmationOutputText}`;
        fs.appendFileSync(outputFilePath, contentToAppend);

        logger.success(`Confirmation Check output appended to: ${outputFilePath}`);
    } catch (error) {
        logger.error(`Failed to capture and append confirmation output text: ${error.message}`);
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
        const pdfHtmlOutputText = await page.evaluate(captureAndFormatTablesScript);

        const logFilesDir = path.join(DOWNLOAD_PATH, 'logfiles');
        const outputFileName = `${path.basename(pdfFilePath, path.extname(pdfFilePath))}_Output.txt`;
        const outputFilePath = path.join(logFilesDir, outputFileName);

        const contentToAppend = `\n\n==========\n\n--- PDF/HTML Output ---\n\n${pdfHtmlOutputText}`;
        fs.appendFileSync(outputFilePath, contentToAppend);

        logger.success(`PDF/HTML output appended to: ${outputFilePath}`);
    } catch (error) {
        logger.error(`Failed to capture and append PDF/HTML output text: ${error.message}`);
    }


    logger.log('Waiting for 10 seconds after saving to DB...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    const logFilesDir = path.join(DOWNLOAD_PATH, 'logfiles');
    const outputFileName = `${path.basename(pdfFilePath, path.extname(pdfFilePath))}_Output.txt`;
    const outputFilePath = path.join(logFilesDir, outputFileName);

    if (fs.existsSync(outputFilePath)) {
        const fileContent = fs.readFileSync(outputFilePath, 'utf8');
        const status = fileContent.includes('|') ? "Action Required" : "Review Completed";
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
    await page.close();
    logger.log('--- Finished Revised File Review ---');
    await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
        logger.error(`❌ Error during Revised File Review: ${error.message}`);
        const runLogPath = path.join(__dirname, 'run-log.html');
        const logFilesDir = path.join(DOWNLOAD_PATH, 'logfiles');
        const outputFileName = `${path.basename(pdfFilePath, path.extname(pdfFilePath))}_Output.txt`;
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
        if (page && !page.isClosed()) {
            await page.close();
        }
        throw error;
    }
}

module.exports = { processRevisedFileReview };