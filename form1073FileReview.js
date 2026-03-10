const { processFileReview } = require('./baseFileReview');

const FORM_1073_CONFIG = {
    reviewType: 'Form 1073 File Review',
    formType: '1073',
    sidebarSections: [
        'Subject', 'Contract', 'Neighborhood', 'Site', 'Improvements',
        'Sales Comparison Approach', 'Sales GRID Section', 'Sales History',
        'Reconciliation_Section', 'Cost Approach', 'Income Approach',
        'PUD Information', 'Market Conditions', 'CONDO/CO-OP', 'Certification'
    ],
    optionalSections: []
};

async function processForm1073FileReview(browser, pdfFilePath, isFirstRun = false) {
    return processFileReview(browser, pdfFilePath, isFirstRun, FORM_1073_CONFIG);
}

module.exports = { processForm1073FileReview };