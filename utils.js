const path = require('path');
const logger = require('./logger');
let nodemailer;
try {
    nodemailer = require('nodemailer');
} catch (e) {
   
}

const WEBSITE_B_URL = 'https://qa-pramaan.vercel.app/';

const WEBSITE_B_USERNAME = 'Abhi';
const WEBSITE_B_PASSWORD = 'Admin@2026';

const WEBSITE_B_USERNAME_SELECTOR = "::-p-xpath(//label[contains(., 'Username')]/following-sibling::div/input)";
const WEBSITE_B_PASSWORD_SELECTOR = "::-p-xpath(//label[contains(., 'Password')]/following-sibling::div/input)";
const WEBSITE_B_LOGIN_BUTTON_SELECTOR = 'button[type="submit"]';
const PDF_UPLOAD_SELECTOR = "::-p-xpath(//div[contains(@class, 'MuiPaper-root') and .//*[contains(., 'PDF')]]//input[@type='file'])";
const NEW_FILE_UPLOAD_SELECTOR_REVISED = "::-p-xpath(//label[normalize-space()='Upload New PDF']/..//input[@type='file'])";
const HTML_UPLOAD_SELECTOR_REVISED = "::-p-xpath(//label[normalize-space()='Upload HTML']/..//input[@type='file'])";
const SUBMIT_BUTTON_SELECTOR = '#submit-form-button';
const MAIN_LOADING_INDICATOR_SELECTOR = "::-p-xpath(//*[contains(@class, 'MuiCircularProgress-root')])";

const FULL_FILE_REVIEW_BUTTON_SELECTOR = "::-p-xpath(//a[contains(., 'Full File Review')] | //button[contains(., 'Full File Review')])";
const REVISED_FILE_REVIEW_BUTTON_SELECTOR = "::-p-xpath(//a[contains(., 'Revised File Review')] | //button[contains(., 'Revised File Review')])";
const VERIFY_SUBJECT_ADDRESS_BUTTON_SELECTOR = "::-p-xpath(//button[normalize-space()='Run Full Analysis'])";
const REVISED_PROCESS_BUTTON_SELECTOR = "::-p-xpath(//div[@class='MuiBox-root css-1sry562'])";
const CONFIRMATION_CHECKLIST_BUTTON_SELECTOR = "::-p-xpath(//button[normalize-space()='Confirmation Checklist'])";
const OLD_PDF_UPLOAD_SELECTOR = "::-p-xpath(//label[normalize-space()='Upload Old PDF']/..//input[@type='file'])";
const PIN_SIDEBAR_BUTTON_SELECTOR = "::-p-xpath(//button[@aria-label='Pin Sidebar']//*[name()='svg'])";
const DOWNLOAD_PATH = path.resolve(__dirname, 'downloads');

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
                try {
                    const pinButton = await page.waitForSelector(PIN_SIDEBAR_BUTTON_SELECTOR, { timeout: 2000, visible: true });
                    logger.log('Pinning the sidebar...');
                    await pinButton.click();
                    logger.success('Sidebar pinned.');
                } catch (e) {
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
                throw new Error(`Failed to find and click "${elementNameForLog}" after ${i + 1} attempts. Last error: ${error.message}`);
            }
        }
    }
}

async function processSidebarItem(page, sectionName, timeout) {
    logger.log(`--- Processing Sidebar Item: ${sectionName} (Timeout: ${timeout / 1000}s) ---`);
    const startTime = Date.now();

    const sidebarSelector = `::-p-xpath(//div[contains(@class, 'sidebar')]//a[.//span[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${sectionName.toLowerCase()}')]])`;
    await waitAndClick(page, sidebarSelector, `${sectionName} sidebar item`, 0);

    const spinnerSelector = `::-p-xpath(//div[contains(@class, 'sidebar')]//a[.//span[contains(text(), '${sectionName}')]]//*[contains(@class, 'MuiCircularProgress-root')])`;

    logger.log(`Waiting for ${sectionName} processing to begin...`);
    try {
        await page.waitForSelector(spinnerSelector, { visible: true, timeout: 5000 });
        logger.log(`Spinner for ${sectionName} appeared.`);
    } catch (e) {
        logger.warn(`Spinner for ${sectionName} did not appear. Clicking again to ensure extraction starts.`);
        await waitAndClick(page, sidebarSelector, `${sectionName} sidebar item (2nd attempt)`, 0);
    }

    logger.log(`Waiting for ${sectionName} processing to complete...`);
    await page.waitForSelector(spinnerSelector, { hidden: true, timeout: timeout });

    await page.waitForSelector(MAIN_LOADING_INDICATOR_SELECTOR, { hidden: true, timeout: timeout });

    const endTime = Date.now();
    const durationInSeconds = ((endTime - startTime) / 1000).toFixed(2);
    logger.success(`Extraction of ${sectionName} section completed in ${durationInSeconds}s.`);
}

async function sendEmail(subject, text, attachmentPath, recipients) {
    if (!nodemailer) {
        logger.warn('Nodemailer not found. Skipping email. Install with: npm install nodemailer');
        return;
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER || 'strdjrbservices@gmail.com',
            pass: process.env.EMAIL_PASS || 'ltcm rnyd bzch frxj'
        }
    });

    let attachments = [];
    if (attachmentPath) {
        if (Array.isArray(attachmentPath)) {
            attachments = attachmentPath.map(p => ({ path: p }));
        } else {
            attachments = [{ path: attachmentPath }];
        }
    }

    const mailOptions = {
        from: process.env.EMAIL_USER || 'strdjrbservices@gmail.com',
        to: recipients || process.env.EMAIL_TO || 'strdjrbservices2@gmail.com',
        subject: subject,
        text: text,
        attachments: attachments
    };

    try {
        logger.log(`Sending email to ${mailOptions.to}...`);
        await transporter.sendMail(mailOptions);
        logger.success('Email sent successfully.');
    } catch (error) {
        logger.error(`Failed to send email: ${error.message}`);
    }
}

async function clickAndWaitForExtraction(page, selector, elementNameForLog, timeout) {
    await waitAndClick(page, selector, elementNameForLog);
    logger.log(`Waiting for "${elementNameForLog}" extraction to complete...`);

    try {
        await page.waitForSelector(MAIN_LOADING_INDICATOR_SELECTOR, { visible: true, timeout: 5000 });
        logger.log(`Loading indicator appeared for "${elementNameForLog}".`);
    } catch (error) {
        logger.warn(`Loading indicator for "${elementNameForLog}" did not appear. Clicking again.`);
        await waitAndClick(page, selector, `${elementNameForLog} (2nd attempt)`);
        try {
            await page.waitForSelector(MAIN_LOADING_INDICATOR_SELECTOR, { visible: true, timeout: 5000 });
            logger.log(`Loading indicator appeared for "${elementNameForLog}" on 2nd attempt.`);
        } catch (error2) {
            logger.warn(`Loading indicator for "${elementNameForLog}" did not appear after 2nd attempt. The operation might have been too fast. Continuing to wait for it to be hidden.`);
        }
    }

    await page.waitForSelector(MAIN_LOADING_INDICATOR_SELECTOR, { hidden: true, timeout: timeout });
    logger.success(`"${elementNameForLog}" operation completed.`);
}

module.exports = {
    WEBSITE_B_URL,
    WEBSITE_B_USERNAME,
    WEBSITE_B_PASSWORD,
    WEBSITE_B_USERNAME_SELECTOR,
    WEBSITE_B_PASSWORD_SELECTOR,
    WEBSITE_B_LOGIN_BUTTON_SELECTOR,
    PDF_UPLOAD_SELECTOR,
    NEW_FILE_UPLOAD_SELECTOR_REVISED,
    HTML_UPLOAD_SELECTOR_REVISED,
    SUBMIT_BUTTON_SELECTOR,
    MAIN_LOADING_INDICATOR_SELECTOR,
    FULL_FILE_REVIEW_BUTTON_SELECTOR,
    REVISED_FILE_REVIEW_BUTTON_SELECTOR,
    VERIFY_SUBJECT_ADDRESS_BUTTON_SELECTOR,
    REVISED_PROCESS_BUTTON_SELECTOR,
    CONFIRMATION_CHECKLIST_BUTTON_SELECTOR,
    OLD_PDF_UPLOAD_SELECTOR,
    PIN_SIDEBAR_BUTTON_SELECTOR,
    DOWNLOAD_PATH,
    waitForDownload,
    waitAndClick,
    processSidebarItem,
    clickAndWaitForExtraction,
    sendEmail
};