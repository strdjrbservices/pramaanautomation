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
    FULL_FILE_REVIEW_BUTTON_SELECTOR,
    MAIN_LOADING_INDICATOR_SELECTOR,
    PDF_UPLOAD_SELECTOR,
    VERIFY_SUBJECT_ADDRESS_BUTTON_SELECTOR,
    DOWNLOAD_PATH,
    waitAndClick,
    processSidebarItem,
    clickAndWaitForExtraction,
    waitForDownload,
    sendEmail
} = require('./utils');

async function processFullFileReview(browser, pdfFilePath, isFirstRun = false) {
    logger.log('\n--- Starting Full File Review ---');
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

    await waitAndClick(page, FULL_FILE_REVIEW_BUTTON_SELECTOR, "Full File Review");

    logger.log('Waiting for the extractor page to load...');
    try {
        await page.waitForSelector(MAIN_LOADING_INDICATOR_SELECTOR, { visible: true, timeout: 5000 });
        await page.waitForSelector(MAIN_LOADING_INDICATOR_SELECTOR, { hidden: true, timeout: 60000 });
    } catch (e) {
    }

    const uploadDocumentsHeader = "::-p-xpath(//h6[contains(., 'Upload Documents')])";
    await page.waitForSelector(uploadDocumentsHeader, { visible: true, timeout: 60000 });

    const formTypeDropdownSelector = "::-p-xpath(//label[contains(., 'Form Type')]/following-sibling::div//input)";
    await page.waitForSelector(formTypeDropdownSelector, { visible: true, timeout: 60000 });
    logger.log('Extractor page loaded.');

    logger.log("Setting Form Type to '1004'...");
    await page.click(formTypeDropdownSelector);
    const formTypeOptionSelector = "::-p-xpath(//li[@role='option' and contains(., '1004')])";
    await waitAndClick(page, formTypeOptionSelector, "Form Type '1004'");

    logger.log('Uploading PDF file...');
    const pdfUploadInput = await page.waitForSelector(PDF_UPLOAD_SELECTOR);
    await pdfUploadInput.uploadFile(pdfFilePath);
    logger.log('PDF file selected.');

    logger.log('Waiting for initial PDF processing to complete...');
    await page.waitForSelector(MAIN_LOADING_INDICATOR_SELECTOR, { hidden: true, timeout: 180000 }); // Wait up to 3 minutes

    const TIMEOUTS = {
        INITIAL: 900000, // 15 minutes
        LONG: 600000,    // 10 minutes
        NORMAL: 180000   // 3 minutes
    };

    await processSidebarItem(page, 'Subject', TIMEOUTS.INITIAL);
    await processSidebarItem(page, 'Contract', TIMEOUTS.LONG);
    await processSidebarItem(page, 'Neighborhood', TIMEOUTS.LONG);
    await processSidebarItem(page, 'Site', TIMEOUTS.LONG);
    await processSidebarItem(page, 'Improvements', TIMEOUTS.LONG);
    await processSidebarItem(page, 'Sales Comparison Approach', TIMEOUTS.LONG);
    await processSidebarItem(page, 'Sales GRID Section', TIMEOUTS.LONG);
    await processSidebarItem(page, 'Sales History', TIMEOUTS.LONG);
    await processSidebarItem(page, 'RECONCILIATION', TIMEOUTS.LONG);
    await processSidebarItem(page, 'Cost Approach', TIMEOUTS.LONG);
    await processSidebarItem(page, 'Income Approach', TIMEOUTS.LONG);
    await processSidebarItem(page, 'PUD Information', TIMEOUTS.LONG);
    await processSidebarItem(page, 'Market Conditions', TIMEOUTS.LONG);
    await processSidebarItem(page, 'CONDO/CO-OP', TIMEOUTS.LONG);
    await processSidebarItem(page, 'CERTIFICATION', TIMEOUTS.LONG);
    await processSidebarItem(page, 'Prompt Analysis', TIMEOUTS.LONG);

    const extractionSteps = [
        { selector: VERIFY_SUBJECT_ADDRESS_BUTTON_SELECTOR, name: "Run Full Analysis" }
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
    await sendEmail(
        `Automation Output: Success - Full File Review - ${path.basename(pdfFilePath)} - ${new Date().toLocaleString()}`,
        `The automation process for ${path.basename(pdfFilePath)} has completed successfully.\n\nAttached:\n- Uploaded PDF\n- Generated Log File\n- System Logs`,
        [pdfFilePath, errorLogPath, runLogPath]
    );

    const endTime = Date.now();
    const durationInMinutes = ((endTime - startTime) / 60000).toFixed(2);
    logger.success(`\n✅ Full File Review processing completed in ${durationInMinutes} minutes.`);
    await page.close();
    logger.log('--- Finished Full File Review ---');
    await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
        logger.error(`❌ Error during Full File Review: ${error.message}`);
        const runLogPath = path.join(__dirname, 'run-log.html');
        const attachments = [pdfFilePath, runLogPath];
        if (errorLogPath && fs.existsSync(errorLogPath)) {
            attachments.push(errorLogPath);
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
            `Automation Output: Failure - Full File Review - ${path.basename(pdfFilePath)} - ${new Date().toLocaleString()}`,
            `The automation process for ${path.basename(pdfFilePath)} failed.\n\nError: ${error.message}\n\nAttached:\n- Uploaded PDF\n- System Logs\n- Error Screenshot`,
            attachments
        );
        if (page && !page.isClosed()) {
            await page.close();
        }
        throw error;
    }
}

module.exports = { processFullFileReview };