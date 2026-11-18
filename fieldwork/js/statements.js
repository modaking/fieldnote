// Shared, dependency-free statement exports. Money values in this model are MAJOR units.
const encoder = new TextEncoder();
const xml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
export const PDF_TEXT_NOTE = 'PDF uses standard Latin fonts: accents are transliterated and unsupported characters appear as ?. Excel keeps the original text.';
export function pdfText(value) {
  return String(value ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—−]/g, '-').replace(/…/g, '...')
    .replace(/\u00a0/g, ' ').replace(/ß/g, 'ss').replace(/Æ/g, 'AE').replace(/æ/g, 'ae').replace(/Ø/g, 'O').replace(/ø/g, 'o')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e\n]/g, '?');
}
const currencyDigits = (currency) => { try { return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits; } catch { return 2; } };
const currencyOf = (column, row, report) => row[column.currencyKey] || column.currency || report.currency || 'KES';
export function cellText(column, row, report = {}) {
  const value = row[column.key];
  if (value == null || value === '') return '—';
  if (column.type === 'money' && Number.isFinite(Number(value))) return new Intl.NumberFormat('en', { style: 'currency', currency: currencyOf(column, row, report), currencyDisplay: 'code' }).format(Number(value));
  if (column.type === 'number' && Number.isFinite(Number(value))) return new Intl.NumberFormat('en', { maximumFractionDigits: 4 }).format(Number(value));
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}
function validate(report) {
  if (!report || !Array.isArray(report.sections) || !report.sections.length) throw new Error('There are no statement sections to export.');
  for (const section of report.sections) {
    if (!section.columns?.length || section.columns.length > 16384) throw new Error('Statement columns are invalid.');
    if (!Array.isArray(section.rows) || section.rows.length > 1048500) throw new Error('Too many statement rows. Choose a shorter period.');
  }
}
const totalColumns = (section) => section.columns.filter((column) => column.total || Object.hasOwn(section.totals || {}, column.key));
const totalValue = (section, column) => Object.hasOwn(section.totals || {}, column.key) ? section.totals[column.key]
  : section.rows.reduce((sum, row) => sum + (Number(row[column.key]) || 0), 0);
const letterhead = (report) => report.letterhead || {};
const timestamp = (report) => letterhead(report).generatedAt || new Date().toISOString();

/* ---------- PDF 1.4, paginated tables, standard Helvetica fonts ---------- */
const widths = Object.fromEntries([...`ABCDEFGHIJKLMNOPQRSTUVWXYZ`].map((c, i) => [c, [667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611][i]]));
Object.assign(widths, Object.fromEntries([...`abcdefghijklmnopqrstuvwxyz`].map((c, i) => [c, [556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500][i]])));
const measure = (text, size) => [...text].reduce((sum, c) => sum + (widths[c] || (/\d/.test(c) ? 556 : c === ' ' ? 278 : /[.,:;!|']/ .test(c) ? 278 : 556)), 0) * size / 1000 * 1.04;
function wrap(value, width, size) {
  const out = [];
  for (const paragraph of pdfText(value).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
      if (line && measure(`${line} ${word}`, size) <= width) { line += ` ${word}`; continue; }
      if (line) { out.push(line); line = ''; }
      let chunk = '';
      for (const c of word) { if (chunk && measure(chunk + c, size) > width) { out.push(chunk); chunk = ''; } chunk += c; }
      line = chunk;
    }
    out.push(line);
  }
  return out.length ? out : [''];
}
const pdfEscape = (value) => pdfText(value).replace(/([\\()])/g, '\\$1');
export function buildPdf(report) {
  validate(report);
  const landscape = report.sections.some((section) => section.columns.length > 5);
  const pageW = landscape ? 842 : 595, pageH = landscape ? 595 : 842, margin = 34, bottom = 42, area = pageW - margin * 2;
  const pages = []; let commands = [], y = 0;
  const text = (value, x, yy, size = 9, bold = false, color = '0.13 0.19 0.15') => commands.push(`${color} rg BT /${bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${yy.toFixed(2)} Tm (${pdfEscape(value)}) Tj ET`);
  const rule = (yy) => commands.push(`0.72 0.79 0.74 RG 0.5 w ${margin} ${yy} m ${pageW - margin} ${yy} l S`);
  function newPage() {
    if (commands.length) pages.push(commands);
    commands = []; y = pageH - margin;
    const h = letterhead(report);
    text(h.workspace || 'Farm statement', margin, y, 16, true); y -= 22;
    text(report.title || 'Statement', margin, y, 12, true); y -= 17;
    for (const line of wrap(`Farm: ${h.farm || 'All permitted farms'} | Period: ${h.period || 'All available records'}`, area, 8.5)) { text(line, margin, y, 8.5); y -= 11; }
    for (const line of wrap(`Generated by: ${h.generatedBy || 'Workspace member'} | ${timestamp(report)}`, area, 8)) { text(line, margin, y, 8); y -= 11; }
    if (h.address) for (const line of wrap(h.address, area, 8)) { text(line, margin, y, 8); y -= 10; }
    rule(y); y -= 19;
  }
  function columnWidths(section) {
    const weights = section.columns.map((column) => Number(column.width) || (['money','number','date'].includes(column.type) ? 16 : 28));
    const sum = weights.reduce((a, b) => a + b, 0);
    return weights.map((weight) => weight / sum * area);
  }
  function tableHead(section, sizes, continued = false) {
    const titleLines = wrap(`${section.title || 'Records'}${continued ? ' (continued)' : ''}`, area, 10);
    for (const line of titleLines) { text(line, margin, y, 10, true); y -= 13; }
    const lines = section.columns.map((column, i) => wrap(column.label, sizes[i] - 10, 8));
    const height = Math.max(...lines.map((part) => part.length)) * 11 + 10;
    commands.push(`0.16 0.35 0.25 rg ${margin} ${y - height + 4} ${area} ${height} re f`);
    let x = margin;
    lines.forEach((part, i) => { part.forEach((line, n) => text(line, x + 5, y - 8 - n * 11, 8, true, '1 1 1')); x += sizes[i]; });
    y -= height;
  }
  newPage();
  for (const section of report.sections) {
    const sizes = columnWidths(section);
    if (y < bottom + 95) newPage();
    tableHead(section, sizes);
    const totals = totalColumns(section), rows = [...section.rows];
    if (totals.length) { const row = { [section.columns[0].key]: section.totalLabel || 'Total' }; totals.forEach((column) => { row[column.key] = totalValue(section, column); }); rows.push({ ...row, __total: true }); }
    if (!rows.length) { text('No records match these filters.', margin + 5, y - 11, 9); y -= 25; }
    for (const [index, row] of rows.entries()) {
      const content = section.columns.map((column, i) => wrap(cellText(column, row, report), sizes[i] - 10, 8));
      const lineCount = Math.max(...content.map((part) => part.length)); let offset = 0;
      while (offset < lineCount) {
        if (y < bottom + 27) { newPage(); tableHead(section, sizes, true); }
        const count = Math.min(lineCount - offset, Math.max(1, Math.floor((y - bottom - 8) / 11)));
        const height = count * 11 + 8, fill = row.__total ? '0.88 0.93 0.88' : index % 2 ? '0.97 0.98 0.96' : '1 1 1';
        commands.push(`${fill} rg ${margin} ${y - height + 4} ${area} ${height} re f`);
        let x = margin;
        content.forEach((part, i) => {
          part.slice(offset, offset + count).forEach((line, n) => text(line, x + 5, y - 9 - n * 11, 8, Boolean(row.__total)));
          x += sizes[i];
        });
        y -= height; rule(y + 4); offset += count;
      }
    }
    y -= 16;
    for (const note of section.notes || []) for (const line of wrap(note, area, 8)) { if (y < bottom + 15) newPage(); text(line, margin, y, 8); y -= 11; }
  }
  for (const note of [...(report.notes || []), PDF_TEXT_NOTE]) {
    y -= 5;
    for (const line of wrap(note, area, 8)) { if (y < bottom + 15) newPage(); text(line, margin, y, 8); y -= 11; }
  }
  if (commands.length) pages.push(commands);
  pages.forEach((page, i) => {
    commands = page;
    rule(30);
    text('fieldnote. | End of page', margin, 18, 7);
    text(`Page ${i + 1} of ${pages.length}`, pageW - margin - 70, 18, 7);
  });
  const objects = [null, '<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'];
  const kids = [];
  for (const page of pages) {
    const pageId = objects.length, streamId = pageId + 1, stream = page.join('\n'); kids.push(`${pageId} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamId} 0 R >>`);
    objects.push(`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`);
  }
  objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
  const infoId = objects.length; objects.push(`<< /Title (${pdfEscape(report.title)}) /Author (${pdfEscape(letterhead(report).generatedBy)}) /Producer (fieldnote. statements) >>`);
  let output = '%PDF-1.4\n%fieldwork\n'; const offsets = [0];
  for (let i = 1; i < objects.length; i++) { offsets[i] = encoder.encode(output).length; output += `${i} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = encoder.encode(output).length;
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return encoder.encode(output);
}

/* ---------- Genuine OOXML .xlsx, stored ZIP with CRC32 ---------- */
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { let value = n; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); return value >>> 0; });
export const crc32 = (bytes) => { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; };
const join = (parts) => { const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes; };
function header(size, numbers) { const bytes = new Uint8Array(size), view = new DataView(bytes.buffer); for (const [offset, value, width] of numbers) width === 2 ? view.setUint16(offset, value, true) : view.setUint32(offset, value, true); return bytes; }
export function zipStore(entries) {
  const chunks = [], directory = []; let offset = 0;
  for (const [file, value] of entries) {
    const name = encoder.encode(file), data = typeof value === 'string' ? encoder.encode(value) : value, crc = crc32(data);
    const local = header(30, [[0,0x04034b50,4],[4,20,2],[6,0x800,2],[12,33,2],[14,crc,4],[18,data.length,4],[22,data.length,4],[26,name.length,2]]);
    chunks.push(local, name, data);
    directory.push(header(46, [[0,0x02014b50,4],[4,20,2],[6,20,2],[8,0x800,2],[14,33,2],[16,crc,4],[20,data.length,4],[24,data.length,4],[28,name.length,2],[42,offset,4]]), name);
    offset += local.length + name.length + data.length;
  }
  const central = join(directory), end = header(22, [[0,0x06054b50,4],[8,entries.length,2],[10,entries.length,2],[12,central.length,4],[16,offset,4]]);
  return join([...chunks, central, end]);
}
const colName = (index) => { let name = ''; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name; return name; };
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
export function buildXlsx(report) {
  validate(report);
  const used = new Set(), currencies = new Map(), currencyStyles = [];
  const moneyStyle = (currency, total = false) => {
    const code = /^[A-Z]{3}$/.test(currency) ? currency : 'KES';
    if (!currencies.has(code)) currencies.set(code, 166 + currencies.size);
    const key = `${code}:${total}`; let index = currencyStyles.findIndex((style) => style.key === key);
    if (index < 0) { index = currencyStyles.length; currencyStyles.push({ key, code, total }); }
    return 9 + index;
  };
  const sheets = report.sections.map((section, index) => {
    const raw = String(section.title || `Section ${index + 1}`).replace(/[\\/*?:\[\]]/g, ' ').replace(/^'+|'+$/g, '').trim() || `Section ${index + 1}`;
    let name = raw.slice(0, 31), n = 1; while (used.has(name.toLowerCase())) { const suffix = ` (${++n})`; name = raw.slice(0, 31 - suffix.length) + suffix; } used.add(name.toLowerCase());
    const h = letterhead(report), rows = [], count = section.columns.length, lastCol = colName(count - 1);
    const stringCell = (value, ref, style = 7) => `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    function valueCell(column, row, ref, total = false, formula) {
      const value = row[column.key];
      if (value == null || value === '') return stringCell('—', ref, total ? 4 : 7);
      if (['money','number'].includes(column.type) && Number.isFinite(Number(value))) {
        const style = column.type === 'money' ? moneyStyle(currencyOf(column, row, report), total) : total ? 8 : 6;
        return `<c r="${ref}" s="${style}">${formula ? `<f>${formula}</f>` : ''}<v>${Number(value)}</v></c>`;
      }
      if (column.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && Number.isFinite(Date.parse(value))) return `<c r="${ref}" s="5"><v>${Math.round((Date.parse(`${value}T00:00:00Z`) - Date.UTC(1899,11,30)) / 86400000)}</v></c>`;
      return stringCell(typeof value === 'boolean' ? value ? 'Yes' : 'No' : value, ref, total ? 4 : 7);
    }
    const top = [h.workspace || 'Farm statement', report.title || 'Statement', `Farm: ${h.farm || 'All permitted farms'}${h.address?` | ${h.address}`:''}`, `Period: ${h.period || 'All available records'}`, `Generated by: ${h.generatedBy || 'Workspace member'} | ${timestamp(report)}`, section.title || 'Records'];
    top.forEach((value, i) => rows.push(`<row r="${i + 1}" ht="${i < 2 ? 24 : 30}" customHeight="1">${stringCell(value, `A${i + 1}`, i < 2 ? 1 : 2)}</row>`));
    rows.push(`<row r="7" ht="30" customHeight="1">${section.columns.map((column, i) => stringCell(column.label, `${colName(i)}7`, 3)).join('')}</row>`);
    section.rows.forEach((row, i) => rows.push(`<row r="${i + 8}">${section.columns.map((column, c) => valueCell(column, row, `${colName(c)}${i + 8}`)).join('')}</row>`));
    let rowNumber = section.rows.length + 8;
    const totals = totalColumns(section);
    if (totals.length) {
      const totalRow = { [section.columns[0].key]: section.totalLabel || 'Total' };
      totals.forEach((column) => { totalRow[column.key] = totalValue(section, column); });
      rows.push(`<row r="${rowNumber}">${section.columns.map((column, i) => valueCell(column, totalRow, `${colName(i)}${rowNumber}`, true, totals.includes(column) && section.rows.length ? `SUM(${colName(i)}8:${colName(i)}${section.rows.length + 7})` : null)).join('')}</row>`); rowNumber++;
    }
    if (!section.rows.length) { rows.push(`<row r="${rowNumber}">${stringCell('No records match these filters.', `A${rowNumber}`, 2)}</row>`); rowNumber++; }
    const noteRows=[];
    for (const note of [...(section.notes || []), ...(report.notes || []), 'fieldnote. | End of statement']) { rowNumber++; noteRows.push(rowNumber); rows.push(`<row r="${rowNumber}" ht="42" customHeight="1">${stringCell(note, `A${rowNumber}`, 2)}</row>`); }
    const merge = count > 1 ? `<mergeCells count="${6+noteRows.length}">${[...top.map((_, i)=>i+1),...noteRows].map((n) => `<mergeCell ref="A${n}:${lastCol}${n}"/>`).join('')}</mergeCells>` : '';
    const sheet = `${declaration}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${lastCol}${rowNumber}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="7" topLeftCell="A8" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${section.columns.map((column, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(12, Math.min(55, Number(column.width) || 24))}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="A7:${lastCol}${Math.max(7, section.rows.length + 7)}"/>${merge}<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="${count > 5 ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>${xml('&Lfieldnote. &C' + name + '&RPage &P of &N')}</oddFooter></headerFooter></worksheet>`;
    return { name, xml: sheet, end: rowNumber };
  });
  const numberFormats = [`<numFmt numFmtId="164" formatCode="yyyy-mm-dd"/>`, `<numFmt numFmtId="165" formatCode="#,##0.####"/>`, ...[...currencies].map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${xml(`&quot;${code}&quot; #,##0${currencyDigits(code) ? '.' + '0'.repeat(currencyDigits(code)) : ''}`.replaceAll('&quot;', '"'))}"/>`)];
  const xf = (font, fill, num = 0, horizontal = 'left', wrap = true) => `<xf numFmtId="${num}" fontId="${font}" fillId="${fill}" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="${horizontal}" vertical="top" wrapText="${wrap ? 1 : 0}"/></xf>`;
  const formats = [xf(0,0),xf(1,0),xf(0,0),xf(2,2),xf(3,3),xf(0,0,164),xf(0,0,165,'right'),xf(0,0),xf(3,3,165,'right'),...currencyStyles.map((style) => xf(style.total ? 3 : 0, style.total ? 3 : 0, currencies.get(style.code), 'right'))];
  const styles = `${declaration}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="${numberFormats.length}">${numberFormats.join('')}</numFmts><fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="16"/><color rgb="FF285940"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF285940"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2EDE4"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFD7DED8"/></left><right style="thin"><color rgb="FFD7DED8"/></right><top style="thin"><color rgb="FFD7DED8"/></top><bottom style="thin"><color rgb="FFD7DED8"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${formats.length}">${formats.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const workbook = `${declaration}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><definedNames>${sheets.map((sheet, i) => `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${xml(`'${sheet.name.replaceAll("'", "''")}'!$1:$7`)}</definedName>`).join('')}</definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
  const relationships = `${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const types = `${declaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  return zipStore([['[Content_Types].xml',types],['_rels/.rels',`${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],['xl/workbook.xml',workbook],['xl/_rels/workbook.xml.rels',relationships],['xl/styles.xml',styles],...sheets.map((sheet, i) => [`xl/worksheets/sheet${i + 1}.xml`,sheet.xml])]);
}

export function downloadStatement(report, format) {
  const pdf = format === 'pdf', bytes = pdf ? buildPdf(report) : buildXlsx(report);
  const blob = new Blob([bytes], { type: pdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `${String(report.title || 'statement').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${timestamp(report).slice(0,10)}.${pdf ? 'pdf' : 'xlsx'}`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
