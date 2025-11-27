import re
import io
import os
from flask import Flask, render_template, jsonify, send_file, abort
import pdfplumber
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
import pandas as pd # Import pandas

# === CONFIG ===
FORM16_LOCAL_PATH = "/mnt/data/Form16_811534_PartB.pdf"  # from your session
GENERATED_PDF_PATH = "/mnt/data/form16_output.pdf"       # output location (overwritten)

app = Flask(__name__, static_folder="static", template_folder="templates")


# --- Utility parsers -------------------------------------------------------
PAN_RE = re.compile(r"\b([A-Z]{5}[0-9]{4}[A-Z])\b")
TAN_RE = re.compile(r"\b([A-Z]{4}[0-9]{5}[A-Z])\b")
AY_RE = re.compile(r"Assessment\s*Year[:\s]*([0-9]{4}[-–][0-9]{2,4})", re.I)
CURRENCY_RE = re.compile(r"([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?)")
NAME_EMPLOYER_RE = re.compile(r"Name and address of the Employer[\s\S]{0,200}", re.I)
NAME_EMPLOYEE_RE = re.compile(r"Name and address of the Employee[\s\S]{0,200}", re.I)

def normalize_text(text):
    return re.sub(r"\s+", " ", text).strip()

def extract_first(regex, text):
    m = regex.search(text)
    return m.group(0) if m else None

def extract_with_label(label_regex, text):
    m = label_regex.search(text)
    if not m:
        return None
    # extract after colon or newline
    s = m.group(0)
    # try to find next meaningful phrase (this heuristic works for many Form16)
    after = text[m.end(): m.end()+200]
    after = normalize_text(after)
    # take up to next 80 chars or before PAN/TAN
    stop_idx = min(len(after), 120)
    return after[:stop_idx].split("PAN")[0].split("TAN")[0].strip(",;: ")

def extract_currency_after(label, text):
    # find label then the next currency-like number
    idx = text.lower().find(label.lower())
    if idx == -1:
        return None
    snippet = text[idx: idx+200]
    m = CURRENCY_RE.search(snippet)
    return m.group(1) if m else None

# --- PDF reading & parsing -------------------------------------------------
def read_pdf_text(path):
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    text = ""
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text() or ""
            text += "\n" + page_text
    return text

def parse_form16_text(text):
    t = text
    out = {}
    out["raw_sample"] = t[:2000]
    # Employer / Employee blocks (simple heuristics)
    emp_block = NAME_EMPLOYER_RE.search(t)
    if emp_block:
        # try extracting lines after 'Name and address of the Employer'
        start = emp_block.end()
        out["employer_block"] = normalize_text(t[start:start+200])
        # first line often employer name
        out["employer"] = out["employer_block"].split(",")[0].strip()
    else:
        out["employer"] = None

    ee_block = NAME_EMPLOYEE_RE.search(t)
    if ee_block:
        start = ee_block.end()
        out["employee_block"] = normalize_text(t[start:start+240])
        out["employee"] = out["employee_block"].split("#")[0].strip()
    else:
        # fallback try 'Name of the Employee'
        m = re.search(r"Name\s+of\s+the\s+Employee[:\s]*(.+?)PAN", t, re.I | re.S)
        out["employee"] = m.group(1).strip() if m else None

    # PAN / TAN heuristics: first PAN likely Deductor or Employer then Employee
    pans = list({m.group(1) for m in PAN_RE.finditer(t)})
    out["pans_found"] = pans
    if len(pans) >= 1:
        out["employer_pan"] = pans[0]
    if len(pans) >= 2:
        out["employee_pan"] = pans[1]
    # Also attempt to find explicit labels
    tan_m = TAN_RE.search(t)
    out["tand_found"] = tan_m.group(1) if tan_m else None

    # AY
    ay_m = AY_RE.search(t)
    out["assessment_year"] = ay_m.group(1) if ay_m else None

    # Numeric fields
    out["gross_salary"] = extract_currency_after("Gross Salary", t) or extract_currency_after("Total", t)
    out["standard_deduction"] = extract_currency_after("Standard deduction", t) or extract_currency_after("Standard Deduction", t)
    out["net_taxable_income"] = extract_currency_after("Total taxable income", t) or extract_currency_after("Total taxable income (9-11)", t)
    out["total_tds"] = extract_currency_after("Total Tax Deducted", t) or extract_currency_after("Net tax payable", t) or extract_currency_after("Total TDS", t)
    out["total_deductions"] = extract_currency_after("Total of deductions under Chapter VI-A", t) or "Not found"

    # last fallback: find numbers nearest to keywords
    return out

# --- Utility to save to Excel ----------------------------------------------
def save_to_excel(data, output_excel_path):
    # Ensure data is a list of dictionaries for DataFrame creation
    if not isinstance(data, list):
        data = [data]
    df = pd.DataFrame(data)
    df.to_excel(output_excel_path, index=False)
    print(f"Data successfully saved to {output_excel_path}")

# --- ReportLab PDF generator -----------------------------------------------
def generate_summary_pdf(parsed, out_path=GENERATED_PDF_PATH):
    c = canvas.Canvas(out_path, pagesize=A4)
    width, height = A4
    margin_x = 40
    y_position = height - 60

    # Title
    c.setFont("Helvetica-Bold", 22)
    c.drawString(margin_x, y_position, "Form 16 — Detailed Analysis Report")
    y_position -= 30

    # Section: Employer Details
    c.setFont("Helvetica-Bold", 14)
    c.drawString(margin_x, y_position, "1. Employer Details")
    y_position -= 20

    c.setFont("Helvetica", 11)
    employer_name = parsed.get("employer") or parsed.get("employer_block", "Not found")
    c.drawString(margin_x + 10, y_position, f"Name: {employer_name}")
    y_position -= 15
    c.drawString(margin_x + 10, y_position, f"PAN: {parsed.get("employer_pan", "Not found")}")
    y_position -= 15
    c.drawString(margin_x + 10, y_position, f"TAN: {parsed.get("tand_found", "Not found")}")
    y_position -= 25

    # Section: Employee Details
    c.setFont("Helvetica-Bold", 14)
    c.drawString(margin_x, y_position, "2. Employee Details")
    y_position -= 20

    c.setFont("Helvetica", 11)
    employee_name = parsed.get("employee") or "Not found"
    c.drawString(margin_x + 10, y_position, f"Name: {employee_name}")
    y_position -= 15
    c.drawString(margin_x + 10, y_position, f"PAN: {parsed.get("employee_pan", "Not found")}")
    y_position -= 15
    c.drawString(margin_x + 10, y_position, f"Assessment Year: {parsed.get("assessment_year", "Not found")}")
    y_position -= 25

    # Section: Financial Summary
    c.setFont("Helvetica-Bold", 14)
    c.drawString(margin_x, y_position, "3. Financial Summary")
    y_position -= 20

    c.setFont("Helvetica", 11)
    financial_fields = [
        ("Gross Salary", "gross_salary"),
        ("Standard Deduction", "standard_deduction"),
        ("Net taxable income", "net_taxable_income"),
        ("Total TDS / Tax deducted", "total_tds"),
        ("Total Chapter VI-A Deductions", "total_deductions") # Assuming this key is added in parse_form16_text
    ]
    for label, key in financial_fields:
        val = parsed.get(key) or "Not found"
        c.drawString(margin_x + 10, y_position, f"{label}: {val}")
        y_position -= 15
    y_position -= 25

    # Raw Sample (for debugging/verification)
    if parsed.get("raw_sample"):
        c.setFont("Helvetica-Bold", 10)
        c.drawString(margin_x, y_position, "Raw Text Sample (First 2000 chars):")
        y_position -= 15
        c.setFont("Helvetica", 8)
        # Split raw_sample into lines to fit on page
        raw_sample_lines = parsed["raw_sample"].split('\n')
        for line in raw_sample_lines[:10]: # Display first 10 lines of raw sample
            if y_position < 50: # Check if close to bottom
                c.showPage()
                y_position = height - 40
                c.setFont("Helvetica", 8)
            c.drawString(margin_x + 10, y_position, line)
            y_position -= 10
        y_position -= 15

    # Footer / Note
    c.setFont("Helvetica-Oblique", 9)
    c.drawString(margin_x, 30, "Note: This report is auto-generated. Verify values against the official Form 16 document.")
    
    c.showPage()
    c.save()
    return out_path


# --- Flask routes ----------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/extract")
def api_extract():
    try:
        text = read_pdf_text(FORM16_LOCAL_PATH)
    except FileNotFoundError:
        return jsonify({"error": "Form16 file not found on server.", "path": FORM16_LOCAL_PATH}), 404

    parsed = parse_form16_text(text)
    return jsonify(parsed)

@app.route("/api/generate_pdf")
def api_generate_pdf():
    try:
        text = read_pdf_text(FORM16_LOCAL_PATH)
    except FileNotFoundError:
        return jsonify({"error": "Form16 file not found on server.", "path": FORM16_LOCAL_PATH}), 404

    parsed = parse_form16_text(text)
    out_path = generate_summary_pdf(parsed, GENERATED_PDF_PATH)
    if not os.path.exists(out_path):
        return jsonify({"error": "Failed to generate PDF."}), 500
    # send generated pdf back
    return send_file(out_path, as_attachment=True, download_name="form16_summary.pdf")

@app.route("/api/generate_excel")
def api_generate_excel():
    try:
        text = read_pdf_text(FORM16_LOCAL_PATH)
    except FileNotFoundError:
        return jsonify({"error": "Form16 file not found on server.", "path": FORM16_LOCAL_PATH}), 404

    parsed_data = parse_form16_text(text)
    if not parsed_data:
        return jsonify({"error": "No data extracted from Form 16."}), 500

    # Convert data for Excel export
    # For a flat structure, create a list of dictionaries with single dictionary
    excel_data = {
        "Field": list(parsed_data.keys()),
        "Value": list(parsed_data.values())
    }
    df = pd.DataFrame(excel_data)

    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
        df.to_excel(writer, index=False, sheet_name='Form16 Summary')
    output.seek(0)

    return send_file(output, as_attachment=True, download_name="form16_summary.xlsx",
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.route("/api/rawpdf")
def api_rawpdf():
    # Serve the original uploaded file so front-end can render it via pdf.js if needed
    if not os.path.exists(FORM16_LOCAL_PATH):
        return abort(404)
    return send_file(FORM16_LOCAL_PATH, as_attachment=False, download_name="Form16_Original.pdf")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
