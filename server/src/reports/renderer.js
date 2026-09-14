/** Report renderers.
 *
 * Render deterministic content (analysis results + grounded explanations) into
 * PDF, Excel and Word documents. Every result kind is supported; tables
 * paginate; grouped/ranked/time-series/distribution results get a bar chart.
 * The AI narrative never alters numeric results: numbers come straight from
 * `content.analyses[].results`.
 */
const fs = require('fs');

const COLORS = {
  ink: '#111827',
  muted: '#6b7280',
  faint: '#9ca3af',
  line: '#e5e7eb',
  headerBg: '#f3f4f6',
  zebra: '#fafafa',
  accent: '#4f46e5',
  accentSoft: '#c7d2fe',
  warn: '#b45309',
};

// ---------------------------------------------------------------------------
// Result -> table normalisation (shared by all formats)
// ---------------------------------------------------------------------------

function humanize(key) {
  return String(key).replace(/^_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCell(value, key) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (/share|change_pct|fill_rate/.test(key)) return `${(value * 100).toFixed(1)}%`;
    if (Number.isInteger(value)) return value.toLocaleString('en-US');
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Turn any result payload into { columns, rows, chart }.
 * chart = { label, value, series: [{label, value}] } when a bar chart makes sense.
 */
function tabulate(results) {
  if (!results || typeof results !== 'object') return { columns: [], rows: [], chart: null };
  const kind = results.kind;

  if (kind === 'scalar_aggregation') {
    const entries = Object.entries(results.results || {});
    return { columns: ['metric', 'value'], rows: entries.map(([k, v]) => ({ metric: humanize(k), value: v })), chart: null, kpis: entries };
  }
  if (kind === 'describe') {
    const profiles = (results.results && results.results.column_profiles) || [];
    return {
      columns: ['name', 'data_type', 'fill_rate', 'distinct'],
      rows: profiles.map((p) => ({ name: p.name, data_type: p.data_type, fill_rate: p.fill_rate, distinct: p.distinct })),
      chart: null,
    };
  }

  const rows = Array.isArray(results.results) ? results.results : [];
  const columns = (results.columns && results.columns.length ? results.columns : Object.keys(rows[0] || {}))
    .filter((c) => !String(c).startsWith('_'));

  let chart = null;
  if (rows.length) {
    if (kind === 'grouped_aggregation' || kind === 'top_n') {
      const label = (results.group_by || [])[0];
      const value = results.rank_metric || (results.metrics || [])[0];
      if (label && value) chart = { label, value, series: rows.slice(0, 25).map((r) => ({ label: String(r[label]), value: Number(r[value]) || 0 })) };
    } else if (kind === 'time_series') {
      const value = (results.metrics || [])[0];
      if (value) chart = { label: 'period', value, series: rows.slice(0, 60).map((r) => ({ label: r.period, value: Number(r[value]) || 0 })) };
    } else if (kind === 'distribution') {
      const label = results.mode === 'histogram' ? 'bucket' : 'value';
      chart = { label, value: 'count', series: rows.slice(0, 25).map((r) => ({ label: String(r[label]), value: Number(r.count) || 0 })) };
    } else if (kind === 'comparison') {
      const c = results.compare || {};
      const first = rows[0];
      if (first) chart = { label: c.column, value: first.metric, series: [{ label: String(c.left), value: Number(first.left) || 0 }, { label: String(c.right), value: Number(first.right) || 0 }] };
    }
  }
  return { columns, rows, chart };
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

function ensureSpace(doc, needed) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) doc.addPage();
}

function drawTable(doc, columns, rows, { maxRows = 200 } = {}) {
  if (!columns.length) return;
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = width / columns.length;
  const pad = 5;
  const rowH = 18;

  const header = () => {
    ensureSpace(doc, rowH * 2);
    const y = doc.y;
    doc.save().rect(left, y, width, rowH).fill(COLORS.headerBg).restore();
    doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.ink);
    columns.forEach((c, i) => {
      doc.text(humanize(c), left + i * colWidth + pad, y + 5, { width: colWidth - pad * 2, lineBreak: false, ellipsis: true });
    });
    doc.y = y + rowH;
  };

  header();
  doc.font('Helvetica').fontSize(8);
  const shown = rows.slice(0, maxRows);
  shown.forEach((row, idx) => {
    if (doc.y + rowH > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      header();
      doc.font('Helvetica').fontSize(8);
    }
    const y = doc.y;
    if (idx % 2 === 1) doc.save().rect(left, y, width, rowH).fill(COLORS.zebra).restore();
    columns.forEach((c, i) => {
      const v = formatCell(row[c], c);
      const numeric = typeof row[c] === 'number';
      doc.fillColor(COLORS.ink).text(v, left + i * colWidth + pad, y + 5, {
        width: colWidth - pad * 2, lineBreak: false, ellipsis: true, align: numeric ? 'right' : 'left',
      });
    });
    doc.save().moveTo(left, y + rowH).lineTo(left + width, y + rowH).lineWidth(0.5).strokeColor(COLORS.line).stroke().restore();
    doc.y = y + rowH;
  });
  if (rows.length > shown.length) {
    doc.moveDown(0.3).fontSize(8).fillColor(COLORS.muted).text(`… ${rows.length - shown.length} more rows not shown`);
  }
  doc.moveDown(0.6);
}

function drawBarChart(doc, chart) {
  if (!chart || !chart.series || !chart.series.length) return;
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const height = 150;
  const labelH = 26;
  ensureSpace(doc, height + labelH + 30);
  const top = doc.y + 6;

  const values = chart.series.map((s) => s.value);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const zeroY = top + (max / range) * height;

  doc.fontSize(8).fillColor(COLORS.muted).text(`${humanize(chart.value)} by ${humanize(chart.label)}`, left, doc.y);
  doc.save().moveTo(left, zeroY).lineTo(left + width, zeroY).lineWidth(0.5).strokeColor(COLORS.line).stroke().restore();

  const n = chart.series.length;
  const slot = width / n;
  const barW = Math.max(2, Math.min(slot * 0.7, 40));
  chart.series.forEach((s, i) => {
    const x = left + i * slot + (slot - barW) / 2;
    const h = (Math.abs(s.value) / range) * height;
    const y = s.value >= 0 ? zeroY - h : zeroY;
    doc.save().rect(x, y, barW, Math.max(h, 0.5)).fill(COLORS.accent).restore();
    if (n <= 30) {
      doc.save().fontSize(6.5).fillColor(COLORS.muted)
        .text(String(s.label).slice(0, 14), left + i * slot, top + height + 6, { width: slot, align: 'center', lineBreak: false, ellipsis: true })
        .restore();
    }
  });
  doc.save().fontSize(6.5).fillColor(COLORS.faint)
    .text(formatCell(max, chart.value), left, top - 2, { width, align: 'right', lineBreak: false })
    .restore();
  doc.y = top + height + labelH;
  doc.moveDown(0.4);
}

function drawKpis(doc, kpis) {
  if (!kpis || !kpis.length) return;
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const items = kpis.slice(0, 4);
  const gap = 8;
  const w = (width - gap * (items.length - 1)) / items.length;
  const h = 44;
  ensureSpace(doc, h + 10);
  const y = doc.y;
  items.forEach((k, i) => {
    const x = left + i * (w + gap);
    doc.save().roundedRect(x, y, w, h, 4).lineWidth(0.5).strokeColor(COLORS.line).stroke().restore();
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted).text(String(k.label).slice(0, 40), x + 8, y + 7, { width: w - 16, lineBreak: false, ellipsis: true });
    doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.ink).text(String(k.value).slice(0, 24), x + 8, y + 20, { width: w - 16, lineBreak: false, ellipsis: true });
  });
  doc.y = y + h;
  doc.moveDown(0.6);
}

async function renderPdf(storagePath, content, report) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: content.name || 'Business Analysis Report' } });
  const stream = fs.createWriteStream(storagePath);
  doc.pipe(stream);

  // Cover block.
  doc.font('Helvetica-Bold').fontSize(24).fillColor(COLORS.ink).text(content.name || 'Business Analysis Report');
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted)
    .text(`Version ${report.version} · Generated ${new Date().toISOString().slice(0, 10)} · ${content.analyses.length} analyses`);
  if (content.datasets && content.datasets.length) {
    doc.text(`Data sources: ${content.datasets.join(', ')}`);
  }
  doc.moveDown(0.8);
  doc.save().moveTo(48, doc.y).lineTo(doc.page.width - 48, doc.y).lineWidth(1).strokeColor(COLORS.accentSoft).stroke().restore();
  doc.moveDown(1);

  content.analyses.forEach((analysis, index) => {
    ensureSpace(doc, 120);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.accent).text(`ANALYSIS ${index + 1}`);
    doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.ink).text(analysis.question || 'Analysis');
    if (analysis.dataset_name) doc.font('Helvetica').fontSize(8).fillColor(COLORS.faint).text(`Dataset: ${analysis.dataset_name}`);
    doc.moveDown(0.5);

    const expl = analysis.explanation || {};
    if (expl.summary) {
      doc.font('Helvetica').fontSize(10.5).fillColor(COLORS.ink).text(expl.summary, { lineGap: 2 });
      doc.moveDown(0.6);
    }
    drawKpis(doc, expl.kpis);
    if (Array.isArray(expl.highlights) && expl.highlights.length) {
      doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.ink);
      expl.highlights.slice(0, 6).forEach((h) => {
        ensureSpace(doc, 16);
        doc.text(`•  ${h}`, { indent: 4, lineGap: 1 });
      });
      doc.moveDown(0.5);
    }

    const { columns, rows, chart } = tabulate(analysis.results || {});
    drawBarChart(doc, chart);
    if (rows.length) drawTable(doc, columns, rows);

    if (Array.isArray(expl.warnings) && expl.warnings.length) {
      doc.font('Helvetica-Oblique').fontSize(8).fillColor(COLORS.warn);
      expl.warnings.slice(0, 5).forEach((w) => {
        ensureSpace(doc, 14);
        doc.text(`Note: ${w}`);
      });
      doc.moveDown(0.4);
    }
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.faint).text(`Analysis ID ${analysis.id} · Computed deterministically; narrative generated by AI and verified against results.`);
    doc.moveDown(1.2);
  });

  // Footer with page numbers.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.faint)
      .text(`${content.name || 'Report'} · Page ${i - range.start + 1} of ${range.count}`, 48, doc.page.height - 34, { width: doc.page.width - 96, align: 'center', lineBreak: false });
  }

  doc.end();
  await new Promise((resolve, reject) => stream.on('finish', resolve).on('error', reject));
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

function sheetName(base, index, used) {
  let name = String(base || 'Analysis').replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 25) || 'Analysis';
  name = `${index + 1}. ${name}`.slice(0, 31);
  while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)}~${index}`;
  used.add(name.toLowerCase());
  return name;
}

async function renderXlsx(storagePath, content, report) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AI Business Analyst';
  const summary = wb.addWorksheet('Summary');
  summary.columns = [{ header: 'Field', key: 'field', width: 26 }, { header: 'Value', key: 'value', width: 90 }];
  summary.getRow(1).font = { bold: true };
  summary.addRow({ field: 'Report', value: content.name });
  summary.addRow({ field: 'Version', value: report.version });
  summary.addRow({ field: 'Generated', value: new Date().toISOString() });
  summary.addRow({ field: 'Analyses', value: content.analyses.length });
  summary.addRow({});
  summary.addRow({ field: '#', value: 'Question' }).font = { bold: true };
  content.analyses.forEach((a, i) => summary.addRow({ field: i + 1, value: a.question }));

  const used = new Set(['summary']);
  content.analyses.forEach((analysis, index) => {
    const ws = wb.addWorksheet(sheetName(analysis.question, index, used));
    const expl = analysis.explanation || {};
    ws.addRow(['Question', analysis.question]).font = { bold: true };
    if (expl.summary) ws.addRow(['Summary', expl.summary]);
    (expl.kpis || []).forEach((k) => ws.addRow([k.label, k.value]));
    (expl.warnings || []).forEach((w) => ws.addRow(['Note', w]));
    ws.addRow([]);

    const { columns, rows } = tabulate(analysis.results || {});
    if (columns.length) {
      const headerRow = ws.addRow(columns.map(humanize));
      headerRow.font = { bold: true };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      rows.forEach((r) => ws.addRow(columns.map((c) => (r[c] !== undefined ? r[c] : null))));
      columns.forEach((c, i) => {
        const col = ws.getColumn(i + 1);
        col.width = Math.max(14, Math.min(40, humanize(c).length + 4));
        if (/share|change_pct|fill_rate/.test(c)) col.numFmt = '0.0%';
        else if (rows.some((r) => typeof r[c] === 'number' && !Number.isInteger(r[c]))) col.numFmt = '#,##0.00';
        else if (rows.some((r) => typeof r[c] === 'number')) col.numFmt = '#,##0';
      });
      ws.getColumn(2).width = Math.max(ws.getColumn(2).width || 0, 40);
    }
  });

  await wb.xlsx.writeFile(storagePath);
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

async function renderDocx(storagePath, content, report) {
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle,
  } = require('docx');
  const children = [];
  children.push(new Paragraph({ text: content.name || 'Business Analysis Report', heading: HeadingLevel.TITLE }));
  children.push(new Paragraph({ children: [new TextRun({ text: `Version ${report.version} · ${new Date().toISOString().slice(0, 10)} · ${content.analyses.length} analyses`, color: '6B7280', size: 18 })] }));

  const border = { style: BorderStyle.SINGLE, size: 2, color: 'E5E7EB' };
  const borders = { top: border, bottom: border, left: border, right: border };

  content.analyses.forEach((analysis, index) => {
    children.push(new Paragraph({ text: `${index + 1}. ${analysis.question || 'Analysis'}`, heading: HeadingLevel.HEADING_1, spacing: { before: 360 } }));
    const expl = analysis.explanation || {};
    if (expl.summary) children.push(new Paragraph({ children: [new TextRun({ text: expl.summary, size: 22 })], spacing: { after: 120 } }));
    (expl.kpis || []).slice(0, 4).forEach((k) => {
      children.push(new Paragraph({ children: [new TextRun({ text: `${k.label}: `, bold: true, size: 20 }), new TextRun({ text: String(k.value), size: 20 })] }));
    });
    (expl.highlights || []).slice(0, 6).forEach((h) => children.push(new Paragraph({ text: h, bullet: { level: 0 } })));

    const { columns, rows } = tabulate(analysis.results || {});
    if (columns.length && rows.length) {
      const cell = (text, bold = false, right = false) => new TableCell({
        borders,
        children: [new Paragraph({ alignment: right ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text, bold, size: 18 })] })],
      });
      const tableRows = [new TableRow({ tableHeader: true, children: columns.map((c) => cell(humanize(c), true)) })];
      rows.slice(0, 200).forEach((r) => {
        tableRows.push(new TableRow({ children: columns.map((c) => cell(formatCell(r[c], c), false, typeof r[c] === 'number')) }));
      });
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: tableRows }));
      if (rows.length > 200) children.push(new Paragraph({ children: [new TextRun({ text: `… ${rows.length - 200} more rows not shown`, color: '6B7280', size: 16 })] }));
    }
    (expl.warnings || []).slice(0, 5).forEach((w) => {
      children.push(new Paragraph({ children: [new TextRun({ text: `Note: ${w}`, italics: true, color: 'B45309', size: 16 })] }));
    });
  });

  const doc = new Document({ creator: 'AI Business Analyst', title: content.name, sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  await fs.promises.writeFile(storagePath, buffer);
}

const PDF = { renderToFile: renderPdf };
const Xlsx = { renderToFile: renderXlsx };
const Docx = { renderToFile: renderDocx };

module.exports = { PDF, Xlsx, Docx, tabulate, formatCell, humanize };
