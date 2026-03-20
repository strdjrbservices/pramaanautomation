const path = require('path');
const fs = require('fs');
const logger = require('./logger');
const {
    WEBSITE_B_URL,
    DOWNLOAD_PATH,
    FULL_FILE_REVIEW_BUTTON_SELECTOR,
    MAIN_LOADING_INDICATOR_SELECTOR,
    PDF_UPLOAD_SELECTOR,
    VERIFY_SUBJECT_ADDRESS_BUTTON_SELECTOR,
    VERIFY_state_requriment_seector,
    verify_Check_Client_Requirements,
    verify_Run_Escalation_Check,
    waitAndClick,
    processSidebarItem,
    clickAndWaitForExtraction,
    waitForDownload,
    sendEmail,
    performLogin
} = require('./utils');

const TIMEOUTS = {
    INITIAL: 900000, // 15 minutes
    LONG: 600000,    // 10 minutes
    NORMAL: 180000   // 3 minutes
};

async function processFileReview(browser, pdfFilePath, isFirstRun, config) {
    const { reviewType, formType, sidebarSections, optionalSections = [] } = config;

    logger.log(`\n--- Starting ${reviewType} ---`);
    const startTime = Date.now();
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    let errorLogPath = null;

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

        await waitAndClick(page, FULL_FILE_REVIEW_BUTTON_SELECTOR, "Full File Review");

        logger.log('Waiting for the extractor page to load...');
        try {
            await page.waitForSelector(MAIN_LOADING_INDICATOR_SELECTOR, { visible: true, timeout: 5000 });
            await page.waitForSelector(MAIN_LOADING_INDICATOR_SELECTOR, { hidden: true, timeout: 60000 });
        } catch (e) {
            // Continue if it times out, might not always be present
        }

        const uploadDocumentsHeader = "::-p-xpath(//h6[contains(., 'Upload Documents')])";
        await page.waitForSelector(uploadDocumentsHeader, { visible: true, timeout: 60000 });

        const formTypeDropdownSelector = "::-p-xpath(//label[contains(., 'Form Type')]/following-sibling::div//input)";
        await page.waitForSelector(formTypeDropdownSelector, { visible: true, timeout: 60000 });
        logger.log('Extractor page loaded.');

        logger.log(`Setting Form Type to '${formType}'...`);
        await page.click(formTypeDropdownSelector);
        const formTypeOptionSelector = `::-p-xpath(//li[@role='option' and contains(., '${formType}')])`;
        await waitAndClick(page, formTypeOptionSelector, `Form Type '${formType}'`);

        logger.log('Uploading PDF file...');
        const pdfUploadInput = await page.waitForSelector(PDF_UPLOAD_SELECTOR);
        await pdfUploadInput.uploadFile(pdfFilePath);
        logger.log('PDF file selected.');

        logger.log('Waiting for initial PDF processing to complete...');
        await page.waitForSelector(MAIN_LOADING_INDICATOR_SELECTOR, { hidden: true, timeout: 180000 }); // Wait up to 3 minutes

        for (const section of sidebarSections) {
            const timeout = section === 'Subject' ? TIMEOUTS.INITIAL : TIMEOUTS.LONG;
            await processSidebarItem(page, section, timeout);
        }

        for (const section of optionalSections) {
            logger.log(`Checking for optional section: ${section}`);
            const sidebarSelector = `::-p-xpath(//div[contains(@class, 'sidebar')]//a[.//span[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${section.toLowerCase()}')]])`;
            try {
                await page.waitForSelector(sidebarSelector, { visible: true, timeout: 5000 });
                await processSidebarItem(page, section, TIMEOUTS.LONG);
            } catch (error) {
                logger.log(`Optional section '${section}' not found. Skipping.`);
            }
        }

        const extractionSteps = [
            { selector: VERIFY_SUBJECT_ADDRESS_BUTTON_SELECTOR, name: "Run Full Analysis" },
            { selector: VERIFY_state_requriment_seector, name: "Check State Requirements" },
            { selector: verify_Check_Client_Requirements, name: "Check Client Requirements" },
            { selector: verify_Run_Escalation_Check, name: "Run Escalation Check" }
        ];

        for (const step of extractionSteps) {
            await clickAndWaitForExtraction(page, step.selector, step.name, TIMEOUTS.LONG);
        }

        logger.log('\n--- Generating and Storing Final Files ---');

        const generateErrorLogButtonSelector = "::-p-xpath(//button[contains(., 'Log')])";
        const errorLogDownloadPromise = waitForDownload(browserClient, 'LOG', TIMEOUTS.LONG);
        await waitAndClick(page, generateErrorLogButtonSelector, "LOG");
        const tempErrorLogPath = await errorLogDownloadPromise;

        const logFilesDir = path.join(DOWNLOAD_PATH, 'logfiles');
        if (!fs.existsSync(logFilesDir)) {
            fs.mkdirSync(logFilesDir, { recursive: true });
        }
        errorLogPath = path.join(logFilesDir, path.basename(tempErrorLogPath));
        fs.renameSync(tempErrorLogPath, errorLogPath);

        logger.success(`Error Log successfully stored at: ${errorLogPath}`);

        const generateSAVEButtonSelector = "::-p-xpath(//button[contains(., 'Save')])";
        await clickAndWaitForExtraction(page, generateSAVEButtonSelector, "Save", TIMEOUTS.LONG);

        logger.log('Waiting for 10 seconds after saving to DB...');
        await new Promise(resolve => setTimeout(resolve, 10000));

        const runLogPath = path.join(__dirname, 'run-log.html');
        const endTime = Date.now();
        const durationInMinutes = ((endTime - startTime) / 60000).toFixed(2);

        const htmlBody = `
            <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; background-color: #f9fafb;">
                <h2 style="color: #059669; border-bottom: 2px solid #059669; padding-bottom: 10px;">✅ Automation Success</h2>
                <p style="font-size: 16px;">The automation process for <strong>${path.basename(pdfFilePath)}</strong> has completed successfully.</p>
                <p><strong>Review Type:</strong> ${reviewType}<br>
                <strong>Duration:</strong> ${durationInMinutes} minutes</p>
                <div style="background-color: #ffffff; padding: 15px; border-radius: 8px; border: 1px solid #e5e7eb; margin-top: 20px;">
                    <p style="margin-top: 0; font-weight: bold; color: #4b5563;">Attached Files:</p>
                    <ul style="color: #6b7280;">
                        <li>Uploaded PDF</li>
                        <li>Generated Error Log</li>
                        <li>System Logs</li>
                    </ul>
                </div>
                <p style="font-size: 12px; color: #9ca3af; margin-top: 30px;">Generated by AutoFlow</p>
            </div>`;

        await sendEmail(
            `Automation Output: Success - ${reviewType} - ${path.basename(pdfFilePath)} - ${new Date().toLocaleString()}`,
            `The automation process for ${path.basename(pdfFilePath)} has completed successfully.\n\nAttached:\n- Uploaded PDF\n- Generated Log File\n- System Logs`,
            [pdfFilePath, errorLogPath, runLogPath],
            null,
            htmlBody
        );

        logger.success(`\n✅ ${reviewType} processing completed in ${durationInMinutes} minutes.`);
        logger.log(`--- Finished ${reviewType} ---`);
        await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
        logger.error(`❌ Error during ${reviewType}: ${error.stack}`);
        const runLogPath = path.join(__dirname, 'run-log.html');
        const attachments = [pdfFilePath, runLogPath];
        if (errorLogPath && fs.existsSync(errorLogPath)) {
            attachments.push(errorLogPath);
        }

        try {
            const errorScreenshotsDir = path.join(DOWNLOAD_PATH, 'error_screenshots');
            if (!fs.existsSync(errorScreenshotsDir)) {
                fs.mkdirSync(errorScreenshotsDir, { recursive: true });
            }
            const screenshotPath = path.join(errorScreenshotsDir, `error_screenshot_${Date.now()}.png`);
            if (page && !page.isClosed()) {
                await page.screenshot({ path: screenshotPath, fullPage: true });
                attachments.push(screenshotPath);
                logger.log(`Error screenshot saved to: ${screenshotPath}`);
            }
        } catch (screenshotError) {
            logger.error(`Failed to take error screenshot: ${screenshotError.message}`);
        }

        await sendEmail(
            `Automation Output: Failure - ${reviewType} - ${path.basename(pdfFilePath)} - ${new Date().toLocaleString()}`,
            `The automation process for ${path.basename(pdfFilePath)} failed.\n\nError: ${error.message}\n\nAttached:\n- Uploaded PDF\n- System Logs\n- Error Screenshot`,
            attachments
        );
        throw error;
    } finally {
        if (page && !page.isClosed()) {
            await page.close();
        }
    }
}

module.exports = { processFileReview };