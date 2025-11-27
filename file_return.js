/*
NOTE: This script is updated to display extracted data in a user-friendly table.
It is recommended that the HTML element with id="output" is a <div>,
to better accommodate the table structure.
*/
document.getElementById("pdfFile").addEventListener("change", async function () {
    const file = this.files[0];
    if (!file) return;

    const outputEl = document.getElementById("output");
    outputEl.innerHTML = ''; // Clear previous results
    document.getElementById("loader").classList.remove("hidden");
    document.getElementById("result").classList.add("hidden");

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = "";

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item) => item.str).join(" ");
            fullText += pageText + "\n";
        }

        const extracted = extractDetails(fullText);
        displayReport(extracted);

    } catch (error) {
        console.error("Error processing PDF:", error);
        outputEl.textContent = "An error occurred while processing the PDF file. Please ensure it is a valid document.";
    } finally {
        document.getElementById("loader").classList.add("hidden");
        document.getElementById("result").classList.remove("hidden");
    }
});

/**
 * Renders the extracted data as a sorted, user-friendly table with sections.
 * @param {object} data - The data object from extractDetails.
 */
function displayReport(data) {
    const outputEl = document.getElementById("output");
    outputEl.innerHTML = ""; // Clear again just in case

    const table = document.createElement("table");
    table.className = "table table-bordered table-striped mt-3";

    const thead = table.createTHead();
    thead.innerHTML = "<tr><th>Field</th><th>Value</th></tr>";
    const tbody = table.createTBody();

    // Define the order, labels, and sections for the report
    const reportFields = [
        { type: 'header', label: 'Personal & Employer Information' },
        { key: 'employeeName', label: 'Employee Name' },
        { key: 'employeePAN', label: 'Employee PAN' },
        { key: 'employerName', label: 'Employer Name' },
        { key: 'employerPAN', label: 'Employer PAN' },
        { key: 'TAN', label: 'TAN' },
        { key: 'assessmentYear', label: 'Assessment Year' },
        { type: 'header', label: 'Income & Deductions' },
        { key: 'grossSalary', label: 'Gross Salary' },
        { key: 'standardDeduction', label: 'Standard Deduction u/s 16(ia)' },
        { key: 'professionalTax', label: 'Professional Tax u/s 16(iii)' },
        { key: 'incomeChargeable', label: 'Income Chargeable under Salaries' },
        { key: 'totalDeductionsVIA', label: 'Deductions under Chapter VI-A' },
        { key: 'totalTaxableIncome', label: 'Total Taxable Income' },
        { type: 'header', label: 'Tax Calculation' },
        { key: 'taxOnTotalIncome', label: 'Tax on Total Income' },
        { key: 'cess', label: 'Health & Education Cess' },
        { key: 'totalTDS', label: 'Total Tax Deducted (TDS)' },
    ];

    reportFields.forEach(field => {
        if (field.type === 'header') {
            const row = tbody.insertRow();
            const cell = row.insertCell();
            cell.colSpan = 2;
            cell.innerHTML = `<strong>${field.label}</strong>`;
            row.className = 'table-light'; // Use a light background for headers
        } else {
            const row = tbody.insertRow();
            const cellKey = row.insertCell();
            const cellValue = row.insertCell();
            cellKey.textContent = field.label;
            cellValue.textContent = data[field.key] || "Not Found";
        }
    });

    outputEl.appendChild(table);
}

/**
 * Extracts a comprehensive set of details from the PDF text.
 * This version is updated to be more flexible with different Form 16 formats.
 * @param {string} text - The full text content of the PDF.
 * @returns {object} An object containing the extracted data.
 */
function extractDetails(text) {
    // This helper function now cleans the extracted value more thoroughly.
    const extract = (regex) => {
        const match = text.match(regex);
        // It trims whitespace, and removes leading non-alphanumeric chars (like brackets or colons)
        // that might be captured accidentally.
        return match && match[1] ? match[1].trim().replace(/^[^a-zA-Z0-9]+/, '').trim() : "Not Found";
    };

    // A more specific regex to find currency values.
    const currencyRegex = /([\d,]+\.\d{2})/;

    return {
        // Personal & Employer Information
        // Made "of the" optional to match more PDF formats.
        employerName: extract(/Name\s*of\s*(?:the\s*)?Employer[\s\S]*?TAN/i),
        TAN: extract(/TAN\s*[:\-]?\s*([A-Z0-9]{10})/i),
        employerPAN: extract(/PAN\s*of\s*(?:the\s*)?Deductor\s*[:\-]?\s*([A-Z0-9]{10})/i),
        employeeName: extract(/Name\s*of\s*(?:the\s*)?Employee[\s\S]*?PAN/i),
        employeePAN: extract(/PAN\s*of\s*(?:the\s*)?Employee\s*[:\-]?\s*([A-Z0-9]{10})/i),
        assessmentYear: extract(/Assessment\s*Year\s*[:\-]?\s*(\d{4}-\d{2,4})/i),

        // Income & Deductions
        // Regex patterns are now more specific to avoid capturing wrong numbers.
        grossSalary: extract(new RegExp("Gross\\s*Salary[\\s\\S]*?" + currencyRegex.source, "i")),
        standardDeduction: extract(new RegExp("Standard\\s*Deduction.*?u/s\\s*16\\(ia\\)[\\s\\S]*?" + currencyRegex.source, "i")),
        professionalTax: extract(new RegExp("(?:Tax\\s*on\\s*employment|Professional\\s*Tax).*?u/s\\s*16\\(iii\\)[\\s\\S]*?" + currencyRegex.source, "i")),
        incomeChargeable: extract(new RegExp("Income\\s*chargeable\\s*under\\s*the\\s*head\\s*'Salaries'[\\s\\S]*?" + currencyRegex.source, "i")),
        totalDeductionsVIA: extract(new RegExp("Aggregate\\s*of\\s*deductible\\s*amount\\s*under\\s*Chapter\\s*VI-A[\\s\\S]*?" + currencyRegex.source, "i")),
        totalTaxableIncome: extract(new RegExp("Total\\s*Taxable\\s*Income[\\s\\S]*?" + currencyRegex.source, "i")),
        
        // Tax Calculation
        taxOnTotalIncome: extract(new RegExp("Tax\\s*on\\s*total\\s*income[\\s\\S]*?" + currencyRegex.source, "i")),
        cess: extract(new RegExp("Health\\s*and\\s*Education\\s*Cess[\\s\\S]*?" + currencyRegex.source, "i")),
        totalTDS: extract(new RegExp("Total\\s*Tax\\s*Deducted(?:\\s*at\\s*Source)?[\\s\\S]*?" + currencyRegex.source, "i")),
    };
}
