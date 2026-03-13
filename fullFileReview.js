const { processFileReview } = require('./baseFileReview');

const FULL_FILE_REVIEW_CONFIG = {
    reviewType: 'Full File Review',
    formType: '1004',
    sidebarSections: [
        'Subject', 'Contract', 'Neighborhood', 'Site', 'Improvements',
        'Sales Comparison Approach', 'Sales GRID Section', 'Sales History',
        'Reconciliation_Section', 'Cost Approach', 'Income Approach',
        'PUD Information', 'Market Conditions', 'CONDO/CO-OP', 'Certification'
    ],
    optionalSections: [
        'Comparable Rent Schedule', 'Rent Schedule Reconciliation'
    ]
};

async function processFullFileReview(browser, pdfFilePath, isFirstRun = false) {
    return processFileReview(browser, pdfFilePath, isFirstRun, FULL_FILE_REVIEW_CONFIG);
}
module.exports = { processFullFileReview };