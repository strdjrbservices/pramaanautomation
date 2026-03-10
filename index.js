const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');
const { DOWNLOAD_PATH, checkPauseState } = require('./utils');
const { processFullFileReview } = require('./fullFileReview');
const { processForm1025FileReview } = require('./form1025FileReview');
const { processForm1073FileReview } = require('./form1073FileReview');
const { processRevisedFileReview } = require('./revisedFileReview');

const PROCESSED_FILES_LOG = path.join(__dirname, 'processed_files.log');
(async () => {
    let browser;
    try {
        logger.init();
        const launchBrowser = async () => {
            const headlessMode = process.env.PUPPETEER_HEADLESS === 'true';
            logger.log(`Launching browser... (Headless Mode: ${headlessMode})`);
            return await puppeteer.launch({
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
        };

        browser = await launchBrowser();

        const automationMode = process.env.AUTOMATION_MODE || 'full';
        let sourceDir = DOWNLOAD_PATH;
        if (automationMode === 'revised') {
            sourceDir = path.join(DOWNLOAD_PATH, 'old_files_revised');

            const newFilesDir = path.join(DOWNLOAD_PATH, 'new_files_revised');
            if (!fs.existsSync(newFilesDir)) {
                fs.mkdirSync(newFilesDir, { recursive: true });
            }
            const newFiles = fs.readdirSync(newFilesDir).filter(file => file.toLowerCase().endsWith('.pdf'));
            if (newFiles.length === 0) {
                throw new Error(`No PDF files found in '${newFilesDir}'. Please ensure New Files (Revised Input) are uploaded.`);
            }
        }

        if (!fs.existsSync(sourceDir)) {
            fs.mkdirSync(sourceDir, { recursive: true });
        }

        const filesInSource = fs.readdirSync(sourceDir);
        const pdfFiles = filesInSource.filter(file => file.toLowerCase().endsWith('.pdf'));

        if (pdfFiles.length === 0) {
            throw new Error(`No PDF files found in the '${sourceDir}' directory.`);
        }

        let processedFiles = new Set();
        if (fs.existsSync(PROCESSED_FILES_LOG)) {
            const processedFilesArray = fs.readFileSync(PROCESSED_FILES_LOG, 'utf8').split('\n').filter(Boolean);
            processedFiles = new Set(processedFilesArray);
            logger.log(`Found ${processedFiles.size} processed files in log.`);
        }

        const logProcessedFile = (pdfFile) => {
            fs.appendFileSync(PROCESSED_FILES_LOG, pdfFile + '\n');
        };

        logger.log(`Found ${pdfFiles.length} PDF file(s) to process in '${sourceDir}': ${pdfFiles.join(', ')}`);

        let isFirstRun = true;
        for (const pdfFile of pdfFiles) {
            const pdfFilePath = path.join(sourceDir, pdfFile);
            logger.log(`\n--- Starting workflow for: ${pdfFile} ---`);

            if (processedFiles.has(pdfFile)) {
                logger.log(`Skipping already processed file: ${pdfFile}`);
                continue;
            }

            await checkPauseState();
            try {
                if (!browser || !browser.isConnected()) {
                    logger.warn('Browser disconnected. Relaunching...');
                    browser = await launchBrowser();
                    isFirstRun = true;
                }

                if (automationMode === 'revised') {
                    await processRevisedFileReview(browser, pdfFilePath, isFirstRun);
                } else if (automationMode === 'form1025') {
                    await processForm1025FileReview(browser, pdfFilePath, isFirstRun);
                } else if (automationMode === 'form1073') {
                    await processForm1073FileReview(browser, pdfFilePath, isFirstRun);
                } else {
                    await processFullFileReview(browser, pdfFilePath, isFirstRun);
                }
                
                isFirstRun = false;
                logger.success(`--- Finished workflow for: ${pdfFile} ---`);

                const oldFilesDir = path.join(DOWNLOAD_PATH, 'oldfiles');
                if (!fs.existsSync(oldFilesDir)) {
                    fs.mkdirSync(oldFilesDir, { recursive: true });
                }
                const destinationPath = path.join(oldFilesDir, pdfFile);
                fs.renameSync(pdfFilePath, destinationPath);
                logger.log(`Moved processed file to: ${destinationPath}`);

                if (automationMode === 'revised') {
                    const htmlFileName = path.basename(pdfFile).replace(/\.pdf$/i, '.html');
                    const htmlSourcePath = path.join(DOWNLOAD_PATH, 'HTMLFiles', htmlFileName);
                    if (fs.existsSync(htmlSourcePath)) {
                        const htmlDestinationPath = path.join(oldFilesDir, htmlFileName);
                        fs.renameSync(htmlSourcePath, htmlDestinationPath);
                        logger.log(`Moved processed HTML file to: ${htmlDestinationPath}`);
                    }
                }
                logProcessedFile(pdfFile);
            } catch (fileError) {
                logger.error(`❌ Error processing file ${pdfFile}: ${fileError.message}`);
                // Force a re-login check on the next iteration to ensure session stability
                isFirstRun = true;
            }
        }
        logger.success('\n✅ Batch processing completed.');

    } catch (error) {
        logger.error(`❌ An error occurred during the automation workflow: ${error.stack}`);
    } finally {
        if (browser) {
            logger.log('Closing browser...');
            await browser.close();
            logger.log('Browser closed.');
        }
        logger.log('Automation script finished.');
    }
})();
