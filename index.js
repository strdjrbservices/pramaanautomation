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
            // Default to headless mode, which is required for server environments like Render.com.
            // Allow overriding for local development by setting PUPPETEER_HEADLESS=false.
            const headlessMode = process.env.PUPPETEER_HEADLESS !== 'false';
            logger.log(`Launching browser... (Headless Mode: ${headlessMode})`);
            return await puppeteer.launch({
                headless: headlessMode,
                slowMo: 10,
                protocolTimeout: 600000,
                args: [
                    '--start-maximized',
                    '--disable-dev-shm-usage',
                    '--no-sandbox',
                    '--disable-gpu',
                    '--js-flags=--max-old-space-size=16384'
                ]
            });
        };

        logger.log('Service started. Monitoring for files...');

        while (true) {
            try {
                await checkPauseState();
                const automationMode = process.env.AUTOMATION_MODE || 'full';
                let sourceDir = DOWNLOAD_PATH;
                if (automationMode === 'revised') {
                    sourceDir = path.join(DOWNLOAD_PATH, 'old_files_revised');

                    const newFilesDir = path.join(DOWNLOAD_PATH, 'new_files_revised');
                    if (!fs.existsSync(newFilesDir)) {
                        fs.mkdirSync(newFilesDir, { recursive: true });
                    }
                    // In watch mode, we don't throw if new files are missing, we just wait/skip until they arrive or log a warning in loop
                }

                if (!fs.existsSync(sourceDir)) {
                    fs.mkdirSync(sourceDir, { recursive: true });
                }

                const filesInSource = fs.readdirSync(sourceDir);
                const pdfFiles = filesInSource.filter(file => file.toLowerCase().endsWith('.pdf'));

                if (pdfFiles.length === 0) {
                    if (browser) {
                        logger.log('Queue empty. Closing browser to save resources.');
                        await browser.close();
                        browser = null;
                    }
                    // Wait 5 seconds before checking again
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    continue;
                }

                // Files found, ensure browser is open
                if (!browser || !browser.isConnected()) {
                    browser = await launchBrowser();
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
                    
                    // Double check existence in case it was removed during processing of previous file
                    if (!fs.existsSync(pdfFilePath)) continue;

                    logger.log(`\n--- Starting workflow for: ${pdfFile} ---`);

                    if (processedFiles.has(pdfFile)) {
                        logger.log(`Skipping already processed file: ${pdfFile}`);
                        // Move processed files out of source to prevent infinite loop in watcher
                        const oldFilesDir = path.join(DOWNLOAD_PATH, 'oldfiles');
                        if (!fs.existsSync(oldFilesDir)) fs.mkdirSync(oldFilesDir, { recursive: true });
                        try {
                            const destPath = path.join(oldFilesDir, pdfFile);
                            if (fs.existsSync(destPath)) {
                                fs.renameSync(pdfFilePath, path.join(oldFilesDir, `${path.basename(pdfFile, '.pdf')}_${Date.now()}.pdf`));
                            } else {
                                fs.renameSync(pdfFilePath, destPath);
                            }
                            logger.log(`Moved previously processed file to oldfiles.`);
                        } catch(e) {}
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
                        
                        // Handle overwrite if exists by renaming new file
                        if (fs.existsSync(destinationPath)) {
                            const uniqueName = `${path.basename(pdfFile, '.pdf')}_${Date.now()}.pdf`;
                            fs.renameSync(pdfFilePath, path.join(oldFilesDir, uniqueName));
                            logger.log(`Moved processed file to: ${path.join(oldFilesDir, uniqueName)}`);
                        } else {
                            fs.renameSync(pdfFilePath, destinationPath);
                            logger.log(`Moved processed file to: ${destinationPath}`);
                        }

                        if (automationMode === 'revised') {
                            const htmlFileName = path.basename(pdfFile).replace(/\.pdf$/i, '.html');
                            const htmlSourcePath = path.join(DOWNLOAD_PATH, 'HTMLFiles', htmlFileName);
                            if (fs.existsSync(htmlSourcePath)) {
                                const htmlDestinationPath = path.join(oldFilesDir, htmlFileName);
                                if (fs.existsSync(htmlDestinationPath)) {
                                    fs.renameSync(htmlSourcePath, path.join(oldFilesDir, `${path.basename(htmlFileName, '.html')}_${Date.now()}.html`));
                                } else {
                                    fs.renameSync(htmlSourcePath, htmlDestinationPath);
                                }
                                logger.log(`Moved processed HTML file to: ${oldFilesDir}`);
                            }
                        }
                        logProcessedFile(pdfFile);
                    } catch (fileError) {
                        logger.error(`❌ Error processing file ${pdfFile}: ${fileError.message}`);
                        // Force a re-login check on the next iteration to ensure session stability
                        isFirstRun = true;

                        // Move failed file to error folder to prevent infinite loop
                        const errorFilesDir = path.join(DOWNLOAD_PATH, 'error_files');
                        if (!fs.existsSync(errorFilesDir)) fs.mkdirSync(errorFilesDir, { recursive: true });
                        const errorDestPath = path.join(errorFilesDir, pdfFile);
                        try {
                            if (fs.existsSync(errorDestPath)) {
                                fs.renameSync(pdfFilePath, path.join(errorFilesDir, `${path.basename(pdfFile, '.pdf')}_${Date.now()}.pdf`));
                            } else {
                                fs.renameSync(pdfFilePath, errorDestPath);
                            }
                            logger.warn(`Moved failed file to: ${errorFilesDir}`);
                        } catch(e) {
                            logger.error(`Failed to move error file: ${e.message}`);
                        }
                    }
                }
                logger.success('\n✅ Batch processing completed. Checking for new files...');
            } catch (cycleError) {
                logger.error(`❌ Cycle Error: ${cycleError.message}`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

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
