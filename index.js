const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const WEBSITE_B_URL = 'https://qa-pramaan.vercel.app/';

const WEBSITE_B_USERNAME = 'Abhi';
const WEBSITE_B_PASSWORD = 'Admin';

const WEBSITE_B_USERNAME_SELECTOR = "::-p-xpath(//label[contains(., 'Username')]/following-sibling::div/input)";
const WEBSITE_B_PASSWORD_SELECTOR = "::-p-xpath(//label[contains(., 'Password')]/following-sibling::div/input)";
const WEBSITE_B_LOGIN_BUTTON_SELECTOR = 'button[type="submit"]';
const PDF_UPLOAD_SELECTOR = "::-p-xpath(//div[contains(@class, 'MuiPaper-root') and .//*[contains(., 'PDF')]]//input[@type='file'])";
const SUBMIT_BUTTON_SELECTOR = '#submit-form-button';
const MAIN_LOADING_INDICATOR_SELECTOR = "::-p-xpath(//*[contains(@class, 'MuiCircularProgress-root')])";

const FULL_FILE_REVIEW_BUTTON_SELECTOR = "::-p-xpath(//a[@href='/extractor']//div[@class='MuiBox-root css-mskaiy'])";
//const PROMPT_ANALYSIS_BUTTON_SELECTOR = "::-p-xpath(//span[normalize-space()='Prompt Analysis'])";
const VERIFY_SUBJECT_ADDRESS_BUTTON_SELECTOR = "::-p-xpath(//button[normalize-space()='Run Full Analysis'])";
// const MATCH_COMP_ADDRESSES_BUTTON_SELECTOR = "::-p-xpath(//button[normalize-space()='Match Comp Addresses'])";
// const VERIFY_PHOTO_LABELS_BUTTON_SELECTOR = "::-p-xpath(//button[normalize-space()='Verify Photo Labels & Duplicates'])";
// const PAGE_PRESENT_CHECKER_SELECTOR = "::-p-xpath(//button[normalize-space()='Page Present Check'])";
// const COMPARE_ROOM_COUNTS_BUTTON_SELECTOR = "::-p-xpath(//button[normalize-space()='Compare Room Counts'])";
const PIN_SIDEBAR_BUTTON_SELECTOR = "::-p-xpath(//button[@aria-label='Pin Sidebar']//*[name()='svg'])";
const DOWNLOAD_PATH = path.resolve(__dirname, 'downloads');

/**
 * Waits for a download to complete by listening for the 'Browser.downloadProgress' event.
 * This is a more robust method for handling downloads.
 * @param {import('puppeteer').CDPSession} browserClient - The browser-level CDP session.
 * @param {string} expectedFileType - A string to identify the file, e.g., 'Final PDF' or 'Error Log'.
 * @param {number} [timeoutMs=180000] - Timeout in milliseconds.
 * @returns {Promise<string>} - The path of the downloaded file.
 */

const waitForDownload = (browserClient, expectedFileType, timeoutMs = 180000) => {
    logger.log(`Waiting for ${expectedFileType} download to complete...`);
    return new Promise((resolve, reject) => {
        let bytesReceived = 0;
        const timeout = setTimeout(() => {
            browserClient.off('Browser.downloadProgress', onProgress);
            reject(new Error(`Timeout waiting for ${expectedFileType} download to complete. Bytes received: ${bytesReceived}`));
        }, timeoutMs);

        const onProgress = (event) => {
            if (event.state === 'inProgress') {
                bytesReceived = event.receivedBytes;
            }
            if (event.state === 'completed') {
                logger.log(`${expectedFileType} download completed: ${event.guid}`);
                clearTimeout(timeout);
                browserClient.off('Browser.downloadProgress', onProgress);
                if (!event.filePath) {
                    reject(new Error(`Download of ${expectedFileType} completed, but no filePath was provided.`));
                    return;
                }
                resolve(event.filePath);
            } else if (event.state === 'canceled') {
                logger.error(`${expectedFileType} download canceled: ${event.guid}`);
                clearTimeout(timeout);
                browserClient.off('Browser.downloadProgress', onProgress);
                reject(new Error(`${expectedFileType} download was canceled.`));
            }
        };

        browserClient.on('Browser.downloadProgress', onProgress);
    });
};

/**
 * Validates that a list of fields in the "Subject" section are not empty.
 * @param {import('puppeteer').Page} page - The Puppeteer page instance.
 */

/**
 * A helper function that waits for a selector to be visible, then clicks it.
 * @param {import('puppeteer').Page} page
 * @param {string} selector
 * @param {string} elementNameForLog
 */
async function waitAndClick(page, selector, elementNameForLog, retries = 3) {
    logger.log(`Waiting for and clicking "${elementNameForLog}"...`);
    const isSidebarItem = elementNameForLog.includes('sidebar item');

    for (let i = 0; i <= retries; i++) {
        try {
            if (isSidebarItem) {
                const sidebarContainerSelector = "::-p-xpath(//div[contains(@class, 'sidebar')])";
                const sidebarContainer = await page.waitForSelector(sidebarContainerSelector);
                await sidebarContainer.evaluate(el => el.scrollIntoView());
            }

            const element = await page.waitForSelector(selector, { timeout: 30000 });
            await element.scrollIntoView();
            await element.click();
            logger.success(`"${elementNameForLog}" clicked successfully.`);

            if (isSidebarItem) {
                // After clicking a sidebar item, the sidebar is open. Try to pin it.
                try {
                    const pinButton = await page.waitForSelector(PIN_SIDEBAR_BUTTON_SELECTOR, { timeout: 2000, visible: true });
                    logger.log('Pinning the sidebar...');
                    await pinButton.click();
                    logger.success('Sidebar pinned.');
                } catch (e) {
                    // Not an error, sidebar is likely already pinned or doesn't have a pin button.
                    logger.log('Sidebar pin button not found, assuming it is already pinned.');
                }
            }

            return;
        } catch (error) {
            logger.warn(`Attempt ${i + 1} failed for "${elementNameForLog}". Error: ${error.message}`);
            if (i < retries) {
                const delay = 5000;
                logger.log(`Retrying in ${delay / 1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                logger.warn(`Skipping "${elementNameForLog}" after all attempts failed.`);
                return;
            }
        }
    }
}
/**
 * Clicks a sidebar item, waits for its corresponding spinner to appear and then disappear.
 * This function is flexible and handles sections with different loading times.
 * @param {import('puppeteer').Page} page
 * @param {string} sectionName - The text of the sidebar item to click.
 * @param {number} timeout - The maximum time to wait in milliseconds.
 */
async function processSidebarItem(page, sectionName, timeout) {
    logger.log(`--- Processing Sidebar Item: ${sectionName} (Timeout: ${timeout / 1000}s) ---`);
    const startTime = Date.now();

    const sidebarSelector = `::-p-xpath(//div[contains(@class, 'sidebar')]//a[.//span[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${sectionName.toLowerCase()}')]])`;
    await waitAndClick(page, sidebarSelector, `${sectionName} sidebar item`);

    const spinnerSelector = `::-p-xpath(//div[contains(@class, 'sidebar')]//a[.//span[contains(text(), '${sectionName}')]]//*[contains(@class, 'MuiCircularProgress-root')])`;

    logger.log(`Waiting for ${sectionName} processing to begin...`);
    try {
        await page.waitForSelector(spinnerSelector, { visible: true, timeout: 3000 });
        logger.log(`Spinner for ${sectionName} appeared.`);
    } catch (e) {
        logger.warn(`Spinner for ${sectionName} did not appear. Clicking again to ensure extraction starts.`);
        await waitAndClick(page, sidebarSelector, `${sectionName} sidebar item (2nd attempt)`);
    }

    logger.log(`Waiting for ${sectionName} processing to complete...`);
    await page.waitForSelector(spinnerSelector, { hidden: true, timeout: timeout });

    await page.waitForSelector(MAIN_LOADING_INDICATOR_SELECTOR, { hidden: true, timeout: timeout });

    const endTime = Date.now();
    const durationInSeconds = ((endTime - startTime) / 1000).toFixed(2);
    logger.success(`Extraction of ${sectionName} section completed in ${durationInSeconds}s.`);
}
/**
 * Clicks a button and waits for the main loading indicator to disappear.
 * @param {import('puppeteer').Page} page
 * @param {string} selector
 * @param {string} elementNameForLog
 * @param {number} timeout
 */
async function clickAndWaitForExtraction(page, selector, elementNameForLog, timeout) {
    await waitAndClick(page, selector, elementNameForLog);
    logger.log(`Waiting for "${elementNameForLog}" extraction to complete...`);

    // To make this more robust, we first wait for the loading indicator to appear,
    // and then we wait for it to disappear. This avoids race conditions where
    // the operation is too fast and the indicator is gone before we start waiting.
    try {
        await page.waitForSelector(MAIN_LOADING_INDICATOR_SELECTOR, { visible: true, timeout: 5000 });
        logger.log(`Loading indicator appeared for "${elementNameForLog}".`);
    } catch (error) {
        logger.warn(`Loading indicator for "${elementNameForLog}" did not appear within 5s. The operation might have been too fast. Continuing to wait for it to be hidden.`);
    }

    await page.waitForSelector(MAIN_LOADING_INDICATOR_SELECTOR, { hidden: true, timeout: timeout });
    logger.success(`"${elementNameForLog}" operation completed.`);
}
/**
 * This function navigates to Website B and uploads the Files.
 * @param {import('puppeteer').Browser} browser 
 * @param {string} pdfFilePath 
 */
async function processWebsiteB(browser, pdfFilePath, isFirstRun = false) {
    logger.log('\n--- Starting Website B ---');
    const startTime = Date.now();
    const page = await browser.newPage();

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
        // Loader might not appear or appeared/disappeared too quickly
    }

    // Wait for the "Upload Documents" header to confirm page load
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

    // await waitAndClick(page, PROMPT_ANALYSIS_BUTTON_SELECTOR, "Prompt Analysis");

    const extractionSteps = [
        { selector: VERIFY_SUBJECT_ADDRESS_BUTTON_SELECTOR, name: "Run Full Analysis" }
    ];

    for (const step of extractionSteps) {
        await clickAndWaitForExtraction(page, step.selector, step.name, TIMEOUTS.LONG);
    }
    logger.log('\n--- Generating and Storing Final Files ---');

    // const generatePdfButtonSelector = "::-p-xpath(//button[contains(., 'Generate PDF')])";
    // await waitAndClick(page, generatePdfButtonSelector, "Generate PDF");
    // logger.success(`Final PDF successfully stored at: ${finalPdfPath}`);

    const generateErrorLogButtonSelector = "::-p-xpath(//button[contains(., 'Log')])";
    const errorLogDownloadPromise = waitForDownload(browserClient, 'LOG', TIMEOUTS.LONG);
    await waitAndClick(page, generateErrorLogButtonSelector, "LOG");
    const tempErrorLogPath = await errorLogDownloadPromise;

    const logFilesDir = path.join(DOWNLOAD_PATH, 'logfiles');
    if (!fs.existsSync(logFilesDir)) {
        fs.mkdirSync(logFilesDir, { recursive: true });
    }
    const errorLogPath = path.join(logFilesDir, path.basename(tempErrorLogPath));
    fs.renameSync(tempErrorLogPath, errorLogPath);

    logger.success(`Error Log successfully stored at: ${errorLogPath}`);

    const generateSAVEButtonSelector = "::-p-xpath(//button[contains(., 'Save')])";
    await clickAndWaitForExtraction(page, generateSAVEButtonSelector, "Save", TIMEOUTS.LONG);

    logger.log('Waiting for 30 seconds after saving to DB...');
    await new Promise(resolve => setTimeout(resolve, 30000));

    const endTime = Date.now();
    const durationInMinutes = ((endTime - startTime) / 60000).toFixed(2);
    logger.success(`\n✅ Website B processing completed in ${durationInMinutes} minutes.`);
    await page.close();
    logger.log('--- Finished Website B ---');
    await new Promise(resolve => setTimeout(resolve, 2000));
}

(async () => {
    let browser;
    try {
        logger.init();
        const headlessMode = process.env.PUPPETEER_HEADLESS === 'true';
        logger.log(`Launching browser... (Headless Mode: ${headlessMode})`);
        browser = await puppeteer.launch({
            headless: headlessMode,
            slowMo: 10,
            protocolTimeout: 600000,
            args: [
                '--start-maximized',
                '--disable-dev-shm-usage',
                '--no-sandbox',
                '--js-flags=--max-old-space-size=16384'
            ]
        });


        const filesInDownloads = fs.readdirSync(DOWNLOAD_PATH);
        const pdfFiles = filesInDownloads.filter(file => file.toLowerCase().endsWith('.pdf'));

        if (pdfFiles.length === 0) {
            throw new Error(`No PDF files found in the '${DOWNLOAD_PATH}' directory.`);
        }

        logger.log(`Found ${pdfFiles.length} PDF file(s) to process: ${pdfFiles.join(', ')}`);

        let isFirstRun = true;
        for (const pdfFile of pdfFiles) {
            const pdfFilePath = path.join(DOWNLOAD_PATH, pdfFile);
            logger.log(`\n--- Starting workflow for: ${pdfFile} ---`);
            await processWebsiteB(browser, pdfFilePath, isFirstRun);
            isFirstRun = false;
            logger.success(`--- Finished workflow for: ${pdfFile} ---`);

            const oldFilesDir = path.join(DOWNLOAD_PATH, 'oldfiles');
            if (!fs.existsSync(oldFilesDir)) {
                fs.mkdirSync(oldFilesDir, { recursive: true });
            }
            const destinationPath = path.join(oldFilesDir, pdfFile);
            fs.renameSync(pdfFilePath, destinationPath);
            logger.log(`Moved processed file to: ${destinationPath}`);
        }

        logger.success('\n✅ All files processed successfully!');

    } catch (error) {
        logger.error(`❌ An error occurred during the automation workflow: ${error.stack}`);
    } finally {
        if (browser) {
            logger.log('Closing browser...');
            await browser.close();
        }
    }
})();
