const { processFileReview } = require('./baseFileReview');

const FORM_1025_CONFIG = {
    reviewType: 'Form 1025 File Review',
    formType: '1025',
    sidebarSections: [
        'Subject', 'Contract', 'Neighborhood', 'Site', 'Improvements',
        'COMPARABLE RENTAL DATA', 'SUBJECT RENT SCHEDULE',
        'Sales Comparison Approach', 'Sales GRID Section', 'Sales History',
        'Prior Sale History', 'Reconciliation_Section', 'Cost Approach',
        'Income Approach', 'PUD Information', 'Market Conditions',
        'CONDO/CO-OP', 'Certification'
    ],
    optionalSections: []
};

async function processForm1025FileReview(browser, pdfFilePath, isFirstRun = false) {
    return processFileReview(browser, pdfFilePath, isFirstRun, FORM_1025_CONFIG);
}

module.exports = { processForm1025FileReview };