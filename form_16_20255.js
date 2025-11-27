/*
NOTE: This script is updated to allow users to upload a PDF for analysis.
You will need to make the following changes to your HTML file:
1. Add a file input element for the PDF upload:
   <input type="file" id="pdfUpload" accept=".pdf">

2. The button with id="btnFetch" will now trigger the upload and analysis.
   You might want to change its text to "Upload & Analyze".

3. The button with id="btnShowOriginal" will now show the PDF you uploaded.
   You might want to change its text to "Show Uploaded PDF".

4. The <pre id="jsonOut"> element will now display a user-friendly table.
   It is recommended to use a <div> instead: <div id="jsonOut"></div>

This script also expects new backend API endpoints:
- POST /api/upload_and_extract : to upload a PDF and receive JSON data.
- POST /api/generate_from_json : to send extracted JSON and receive a summary PDF.
*/

const statusEl = document.getElementById('status');
const outputEl = document.getElementById('jsonOut'); // This will now hold a table
const pdfUploadEl = document.getElementById('pdfUpload'); // Add this to your HTML
const btnFetch = document.getElementById('btnFetch');
const btnGenerate = document.getElementById('btnGenerate');
const btnShowOriginal = document.getElementById('btnShowOriginal');
const btnDownloadPng = document.getElementById('btnDownloadPng');
const canvas = document.getElementById('pdfCanvas');
const ctx = canvas.getContext('2d');

let lastAnalysisData = null; // To store data from the last analysis
let lastUploadedFile = null; // To store the last uploaded file object

function setStatus(s) { statusEl.textContent = s; }

/**
 * Renders the extracted data as a user-friendly table.
 * @param {object} data - The JSON data extracted from the PDF.
 */
function renderAnalysisReport(data) {
  outputEl.innerHTML = ''; // Clear previous output
  if (!data || Object.keys(data).length === 0) {
    outputEl.textContent = 'No data was extracted from the document.';
    return;
  }

  const table = document.createElement('table');
  // Assuming you are using a CSS framework like Bootstrap for styling
  table.className = 'table table-bordered table-striped mt-3';

  const thead = table.createTHead();
  thead.innerHTML = '<tr><th>Field</th><th>Value</th></tr>';

  const tbody = table.createTBody();
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      const row = tbody.insertRow();
      const cellKey = row.insertCell();
      // Prettify the key for display
      cellKey.textContent = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      const cellValue = row.insertCell();
      cellValue.textContent = data[key];
    }
  }
  outputEl.appendChild(table);
}

/**
 * Uploads the selected PDF, sends it for analysis, and displays the result.
 */
async function uploadAndAnalyzePdf() {
  if (!pdfUploadEl || !pdfUploadEl.files[0]) {
    setStatus('Please select a PDF file to analyze.');
    return;
  }
  const file = pdfUploadEl.files[0];
  lastUploadedFile = file;
  setStatus('Uploading and analyzing PDF...');
  outputEl.innerHTML = ''; // Clear old report

  const formData = new FormData();
  formData.append('pdf_file', file);

  try {
    const res = await fetch('/api/upload_and_extract', {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error(`Analysis failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    lastAnalysisData = data;
    renderAnalysisReport(data);
    setStatus('Analysis complete. See the report below.');
    // Enable buttons that depend on analysis data
    btnGenerate.disabled = false;
    btnShowOriginal.disabled = false;
  } catch (err) {
    outputEl.textContent = String(err);
    setStatus(`Error: ${err.message}`);
    lastAnalysisData = null;
    btnGenerate.disabled = true;
  }
}

/**
 * Generates a summary PDF from the last analysis data and shows a preview.
 */
async function generatePdfAndPreview() {
  if (!lastAnalysisData) {
    setStatus('You must analyze a document first.');
    return;
  }
  setStatus('Generating summary PDF on the server...');
  try {
    const res = await fetch('/api/generate_from_json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lastAnalysisData),
    });
    if (!res.ok) throw new Error(`Failed to generate PDF: ${res.statusText}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    await renderPdfUrlToCanvas(url);
    setStatus('Generated PDF preview is ready.');
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
}

/**
 * Renders a given PDF URL to the canvas.
 * @param {string} url - The object URL of the PDF to render.
 */
async function renderPdfUrlToCanvas(url) {
  setStatus('Rendering PDF preview...');
  try {
    const loadingTask = pdfjsLib.getDocument({ url });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1.5 });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const renderContext = { canvasContext: ctx, viewport };
    await page.render(renderContext).promise;
    setStatus('Preview rendered.');
    btnDownloadPng.disabled = false;
  } catch (err) {
    setStatus('Error rendering PDF preview: ' + err.message);
    btnDownloadPng.disabled = true;
  }
}

/**
 * Shows a preview of the user-uploaded PDF file.
 */
async function showUploadedPdf() {
  if (!lastUploadedFile) {
    setStatus('Please upload a PDF file first.');
    return;
  }
  setStatus('Loading uploaded PDF...');
  try {
    const url = URL.createObjectURL(lastUploadedFile);
    await renderPdfUrlToCanvas(url);
    setStatus('Uploaded PDF is shown in the preview canvas.');
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
}

/**
 * Downloads the current canvas content as a PNG image.
 */
function downloadCanvasAsPng() {
  const png = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = png;
  a.download = 'form16_preview.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setStatus('PNG preview downloaded.');
}

// Attach events and set initial state
btnFetch.addEventListener('click', uploadAndAnalyzePdf); // Re-purposed
btnGenerate.addEventListener('click', generatePdfAndPreview);
btnShowOriginal.addEventListener('click', showUploadedPdf); // Re-purposed
btnDownloadPng.addEventListener('click', downloadCanvasAsPng);

// Set initial state of buttons on page load
btnGenerate.disabled = true;
btnDownloadPng.disabled = true;
