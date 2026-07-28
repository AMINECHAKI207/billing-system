import PDFDocument from 'pdfkit';
import { CompanySettings, Devis } from '@prisma/client';
import fs from 'fs';
import { resolveCompanyAssetUrl } from '@modules/settings/companyAssetUpload';

type DevisWithPdfRelations = Devis & {
  customer: {
    name: string;
    email: string;
    phone: string | null;
    company: string | null;
    taxNumber: string | null;
    country: string;
    countryCode: string;
  };
  items: Array<{
    description: string;
    quantity: unknown;
    unit: string | null;
    unitPrice: unknown;
    discount: unknown;
    taxRate: unknown;
    lineTotal: unknown;
  }>;
  generatedInvoice?: {
    invoiceNumber: string;
  } | null;
  signedBy?: {
    name: string;
  } | null;
};

export function renderDevisPdf(
  devis: DevisWithPdfRelations,
  company: CompanySettings,
  output: NodeJS.WritableStream
) {
  const doc = new PDFDocument({ bufferPages: true, compress: false, margin: 42, size: 'A4' });
  doc.pipe(output);
  drawDevisPdf(doc, devis, company);
  doc.end();
}

function drawDevisPdf(doc: PDFKit.PDFDocument, devis: DevisWithPdfRelations, company: CompanySettings) {
  doc.info.Title = `Devis ${devis.devisNumber}`;
  doc.info.Author = company.name;
  doc.info.Subject = 'Devis professionnel';

  drawHeader(doc, devis, company);
  drawParties(doc, devis, company);
  drawItemsTable(doc, devis);
  drawTotals(doc, devis);
  drawNotes(doc, devis, company);
  if (devis.isSigned) drawSignatureBlock(doc, devis);
  drawPageFooters(doc, company);
}

function drawSignatureBlock(doc: PDFKit.PDFDocument, devis: DevisWithPdfRelations) {
  ensureSpace(doc, 140);
  const left = pageLeft(doc);
  const width = pageWidth(doc);
  const top = doc.y;
  drawCard(doc, left, top, width, 128, '#f0fdf4', '#86efac');

  doc.font('Helvetica-Bold').fontSize(10).fillColor('#15803d');
  doc.text('Devis signe et tamponne', left + 16, top + 12, { width: width - 32 });
  doc.font('Helvetica').fontSize(8.5).fillColor('#166534');
  doc.text(`Signe par: ${devis.signedBy?.name ?? 'Utilisateur'}`, left + 16, top + 30, { width: width - 32 });
  if (devis.signedAt) {
    doc.text(`Date de signature: ${formatPdfDateTime(devis.signedAt)}`, left + 16, top + 44, { width: width - 32 });
  }

  const signaturePath = resolveCompanyAssetUrl(devis.signatureUrl);
  const stampPath = resolveCompanyAssetUrl(devis.stampUrl);
  const columnGap = 18;
  const columnWidth = (width - 32 - columnGap) / 2;
  const imageTop = top + 68;
  const signatureLeft = left + 16;
  const stampLeft = signatureLeft + columnWidth + columnGap;

  doc.strokeColor('#bbf7d0').lineWidth(0.6);
  doc.moveTo(signatureLeft + columnWidth + columnGap / 2, imageTop - 8).lineTo(signatureLeft + columnWidth + columnGap / 2, top + 116).stroke();

  doc.font('Helvetica-Bold').fontSize(8).fillColor('#15803d');
  doc.text('SIGNATURE', signatureLeft, imageTop - 16, { width: columnWidth, align: 'center' });
  doc.text('TAMPON', stampLeft, imageTop - 16, { width: columnWidth, align: 'center' });

  if (signaturePath && fs.existsSync(signaturePath)) {
    drawPdfImageIfPresent(doc, signaturePath, signatureLeft, imageTop, columnWidth, 44);
  }
  if (stampPath && fs.existsSync(stampPath)) {
    drawPdfImageIfPresent(doc, stampPath, stampLeft, imageTop - 4, columnWidth, 52);
  }

  doc.y = top + 142;
}

function drawHeader(doc: PDFKit.PDFDocument, devis: DevisWithPdfRelations, company: CompanySettings) {
  const left = pageLeft(doc);
  const top = 36;
  const width = pageWidth(doc);

  doc.save();
  doc.rect(0, 0, doc.page.width, 112).fill('#0f172a');
  doc.rect(0, 84, doc.page.width, 28).fill('#1e40af');
  doc.restore();

  drawLogoOrInitials(doc, company, left, top, 48);
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#ffffff');
  doc.text(company.name, left + 62, top + 2, { width: 245, ellipsis: true });
  doc.font('Helvetica').fontSize(8.5).fillColor('#cbd5e1');
  doc.text(compactCompanyLine(company), left + 62, top + 26, { width: 250, lineGap: 2 });

  doc.font('Helvetica-Bold').fontSize(28).fillColor('#ffffff');
  doc.text('DEVIS', left + width - 205, top, { width: 205, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#bfdbfe');
  doc.text(devis.devisNumber, left + width - 205, top + 34, { width: 205, align: 'right' });
  drawBadge(doc, left + width - 130, top + 58, 130, 22, getStatusLabel(devis.status), statusColor(devis.status));

  doc.y = 132;
}

function drawParties(doc: PDFKit.PDFDocument, devis: DevisWithPdfRelations, company: CompanySettings) {
  const left = pageLeft(doc);
  const gap = 14;
  const cardWidth = (pageWidth(doc) - gap) / 2;
  const top = doc.y;
  const height = 108;

  drawInfoCard(doc, left, top, cardWidth, height, 'Emetteur', [
    company.name,
    company.address,
    company.email,
    company.phone,
    company.taxNumber ? `N fiscal: ${company.taxNumber}` : null,
  ]);

  drawInfoCard(doc, left + cardWidth + gap, top, cardWidth, height, 'Client', [
    devis.customer.company ?? devis.customer.name,
    devis.customer.name,
    devis.customer.email,
    devis.customer.phone,
    `${devis.customer.country} (${devis.customer.countryCode})`,
    devis.customer.taxNumber ? `N fiscal: ${devis.customer.taxNumber}` : null,
  ]);

  const metaTop = top + height + 10;
  const metaHeight = devis.generatedInvoice ? 78 : 46;
  drawCard(doc, left, metaTop, pageWidth(doc), metaHeight, '#f8fafc', '#e2e8f0');
  drawMetaItem(doc, left + 18, metaTop + 9, 'Emission', formatPdfDate(devis.issueDate));
  drawMetaItem(doc, left + 154, metaTop + 9, 'Valable jusqu au', formatPdfDate(devis.validUntil));
  drawMetaItem(doc, left + 302, metaTop + 9, 'Devise', devis.currency);
  drawMetaItem(doc, left + 408, metaTop + 9, 'Total', formatPdfCurrency(Number(devis.total), devis.currency));
  if (devis.generatedInvoice) {
    drawLinkedReference(doc, left + 18, metaTop + 48, pageWidth(doc) - 36, 'Facture liee', devis.generatedInvoice.invoiceNumber);
  }

  doc.y = metaTop + metaHeight + 16;
}

function drawItemsTable(doc: PDFKit.PDFDocument, devis: DevisWithPdfRelations) {
  ensureSpace(doc, 96);
  const left = pageLeft(doc);
  const width = pageWidth(doc);
  const columns = [
    { label: 'Description', width: 214, align: 'left' as const },
    { label: 'Qte', width: 42, align: 'right' as const },
    { label: 'PU HT', width: 74, align: 'right' as const },
    { label: 'Remise', width: 64, align: 'right' as const },
    { label: 'TVA', width: 48, align: 'right' as const },
    { label: 'Total', width: 65, align: 'right' as const },
  ];

  doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a');
  doc.text('Lignes de devis', left, doc.y, { width });
  doc.y += 20;
  drawTableHeader(doc, left, doc.y, columns);
  doc.y += 26;

  devis.items.forEach((item, index) => {
    const row = [
      item.description,
      formatQuantity(item.quantity, item.unit),
      formatPdfCurrency(Number(item.unitPrice), devis.currency),
      formatPdfCurrency(Number(item.discount), devis.currency),
      `${formatRate(Number(item.taxRate))}%`,
      formatPdfCurrency(Number(item.lineTotal), devis.currency),
    ];
    const rowHeight = Math.max(34, doc.heightOfString(row[0] ?? '', { width: columns[0]!.width - 14 }) + 18);
    ensureSpace(doc, rowHeight + 16);
    drawTableRow(doc, left, doc.y, columns, row, index % 2 === 0);
    doc.y += rowHeight;
  });

  doc.moveTo(left, doc.y + 4).lineTo(left + width, doc.y + 4).strokeColor('#cbd5e1').stroke();
  doc.y += 18;
}

function drawTotals(doc: PDFKit.PDFDocument, devis: DevisWithPdfRelations) {
  ensureSpace(doc, 126);
  const left = pageLeft(doc);
  const summaryWidth = 224;
  const summaryLeft = pageRight(doc) - summaryWidth;
  const top = doc.y;

  drawCard(doc, summaryLeft, top, summaryWidth, 112, '#ffffff', '#cbd5e1');
  let y = top + 12;
  y = drawSummaryLine(doc, summaryLeft + 14, y, summaryWidth - 28, 'Sous-total HT', Number(devis.subtotal), devis.currency);
  y = drawSummaryLine(doc, summaryLeft + 14, y, summaryWidth - 28, `TVA ${formatRate(Number(devis.taxRate))}%`, Number(devis.taxAmount), devis.currency);
  if (Number(devis.discount) > 0) {
    y = drawSummaryLine(doc, summaryLeft + 14, y, summaryWidth - 28, 'Remise globale', -Number(devis.discount), devis.currency);
  }
  drawSummaryDivider(doc, summaryLeft + 14, y + 4, summaryWidth - 28);
  y += 14;
  drawSummaryLine(doc, summaryLeft + 14, y, summaryWidth - 28, 'Total TTC', Number(devis.total), devis.currency, true);
  doc.y = top + 126;
  if (doc.x < left) doc.x = left;
}

function drawNotes(doc: PDFKit.PDFDocument, devis: DevisWithPdfRelations, company: CompanySettings) {
  const sections = [
    { title: 'Conditions et notes', value: [devis.terms, devis.notes].filter(Boolean).join('\n') },
    { title: 'Coordonnees bancaires', value: company.bankDetails ?? '' },
  ].filter((section) => section.value.trim().length > 0);

  sections.forEach((section) => {
    const left = pageLeft(doc);
    const width = pageWidth(doc);
    const textHeight = doc.heightOfString(section.value, { width: width - 32 });
    const height = Math.max(72, textHeight + 46);
    ensureSpace(doc, height + 12);
    const top = doc.y;
    drawTextCard(doc, left, top, width, height, section.title, section.value);
    doc.y = top + height + 12;
  });
}

function drawInfoCard(doc: PDFKit.PDFDocument, x: number, y: number, width: number, height: number, title: string, lines: Array<string | null | undefined>) {
  drawCard(doc, x, y, width, height, '#ffffff', '#dbeafe');
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#2563eb');
  doc.text(title.toUpperCase(), x + 14, y + 14, { width: width - 28 });
  const cleanLines = lines.filter((line): line is string => Boolean(line?.trim()));
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a');
  doc.text(cleanLines[0] ?? '-', x + 14, y + 34, { width: width - 28, ellipsis: true });
  doc.font('Helvetica').fontSize(8.5).fillColor('#475569');
  cleanLines.slice(1).forEach((line, index) => {
    doc.text(line, x + 14, y + 50 + index * 12, { width: width - 28, ellipsis: true });
  });
}

function drawTextCard(doc: PDFKit.PDFDocument, x: number, y: number, width: number, height: number, title: string, value: string) {
  drawCard(doc, x, y, width, height, '#ffffff', '#e2e8f0');
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a');
  doc.text(title, x + 14, y + 12, { width: width - 28 });
  doc.font('Helvetica').fontSize(8.6).fillColor('#475569');
  doc.text(value, x + 14, y + 31, { width: width - 28, lineGap: 1.5 });
}

function drawMetaItem(doc: PDFKit.PDFDocument, x: number, y: number, label: string, value: string) {
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#64748b');
  doc.text(label.toUpperCase(), x, y, { width: 128 });
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a');
  doc.text(value, x, y + 16, { width: 128, ellipsis: true });
}

function drawLinkedReference(doc: PDFKit.PDFDocument, x: number, y: number, width: number, label: string, value: string) {
  doc.moveTo(x, y - 9).lineTo(x + width, y - 9).strokeColor('#e2e8f0').lineWidth(0.6).stroke();
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#64748b');
  doc.text(label.toUpperCase(), x, y, { width: 145, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a');
  doc.text(value, x + 150, y - 1, { width: width - 150, ellipsis: true });
}

function drawTableHeader(doc: PDFKit.PDFDocument, x: number, y: number, columns: Array<{ label: string; width: number; align: 'left' | 'right' }>) {
  const width = columns.reduce((total, column) => total + column.width, 0);
  doc.roundedRect(x, y, width, 24, 6).fill('#0f172a');
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
  let currentX = x;
  columns.forEach((column) => {
    doc.text(column.label, currentX + 7, y + 8, { width: column.width - 14, align: column.align });
    currentX += column.width;
  });
}

function drawTableRow(doc: PDFKit.PDFDocument, x: number, y: number, columns: Array<{ label: string; width: number; align: 'left' | 'right' }>, cells: string[], shaded: boolean) {
  const width = columns.reduce((total, column) => total + column.width, 0);
  const rowHeight = Math.max(34, doc.heightOfString(cells[0] ?? '', { width: columns[0]!.width - 14 }) + 18);
  doc.roundedRect(x, y, width, rowHeight, 4).fill(shaded ? '#f8fafc' : '#ffffff');
  doc.strokeColor('#e2e8f0').lineWidth(0.5).roundedRect(x, y, width, rowHeight, 4).stroke();
  doc.font('Helvetica').fontSize(8.5).fillColor('#334155');
  let currentX = x;
  cells.forEach((cell, index) => {
    const column = columns[index];
    if (!column) return;
    doc.text(cell, currentX + 7, y + 10, { width: column.width - 14, align: column.align, lineGap: 1 });
    currentX += column.width;
  });
}

function drawSummaryLine(doc: PDFKit.PDFDocument, x: number, y: number, width: number, label: string, amount: number, currency: string, bold = false) {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10.5 : 8.8).fillColor(bold ? '#0f172a' : '#475569');
  doc.text(label, x, y, { width: width * 0.48 });
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor('#0f172a');
  doc.text(formatPdfCurrency(amount, currency), x + width * 0.48, y, { width: width * 0.52, align: 'right' });
  return y + (bold ? 20 : 17);
}

function drawSummaryDivider(doc: PDFKit.PDFDocument, x: number, y: number, width: number) {
  doc.moveTo(x, y).lineTo(x + width, y).strokeColor('#cbd5e1').lineWidth(0.8).stroke();
}

function drawLogoOrInitials(doc: PDFKit.PDFDocument, company: CompanySettings, x: number, y: number, size: number) {
  const logoPath = resolveCompanyAssetUrl(company.logoUrl);
  if (logoPath && fs.existsSync(logoPath)) {
    doc.roundedRect(x, y, size, size, 10).fill('#ffffff');
    doc.image(logoPath, x + 5, y + 5, { fit: [size - 10, size - 10], align: 'center', valign: 'center' });
    return;
  }
  doc.roundedRect(x, y, size, size, 10).fill('#2563eb');
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#ffffff');
  doc.text(initials(company.name), x, y + 15, { width: size, align: 'center' });
}

function drawPdfImageIfPresent(doc: PDFKit.PDFDocument, imagePath: string, x: number, y: number, width: number, height: number) {
  try {
    doc.image(imagePath, x, y, { fit: [width, height], align: 'center', valign: 'center' });
  } catch {
    // Ignore invalid or missing image data so PDF generation remains reliable.
  }
}

function drawBadge(doc: PDFKit.PDFDocument, x: number, y: number, width: number, height: number, label: string, colors: { background: string; foreground: string }) {
  doc.roundedRect(x, y, width, height, height / 2).fill(colors.background);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(colors.foreground);
  doc.text(label.toUpperCase(), x + 10, y + 8, { width: width - 20, align: 'center' });
}

function drawCard(doc: PDFKit.PDFDocument, x: number, y: number, width: number, height: number, fill: string, stroke: string) {
  doc.roundedRect(x, y, width, height, 8).fill(fill);
  doc.strokeColor(stroke).lineWidth(0.8).roundedRect(x, y, width, height, 8).stroke();
}

function ensureSpace(doc: PDFKit.PDFDocument, requiredHeight: number) {
  if (doc.y + requiredHeight <= pageBottom(doc)) return;
  doc.addPage();
  doc.y = 54;
}

function drawPageFooters(doc: PDFKit.PDFDocument, company: CompanySettings) {
  const range = doc.bufferedPageRange();
  for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
    doc.switchToPage(pageIndex);
    const left = pageLeft(doc);
    const y = doc.page.height - doc.page.margins.bottom - 14;
    doc.moveTo(left, y - 10).lineTo(pageRight(doc), y - 10).strokeColor('#e2e8f0').lineWidth(0.6).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor('#64748b');
    doc.text(company.email ?? company.name, left, y, { width: 260, lineBreak: false });
    doc.text(`Page ${pageIndex - range.start + 1} / ${range.count}`, pageRight(doc) - 90, y, {
      width: 90,
      align: 'right',
      lineBreak: false,
    });
  }
}

function pageLeft(doc: PDFKit.PDFDocument) {
  return doc.page.margins.left;
}

function pageRight(doc: PDFKit.PDFDocument) {
  return doc.page.width - doc.page.margins.right;
}

function pageWidth(doc: PDFKit.PDFDocument) {
  return pageRight(doc) - pageLeft(doc);
}

function pageBottom(doc: PDFKit.PDFDocument) {
  return doc.page.height - doc.page.margins.bottom - 28;
}

function compactCompanyLine(company: CompanySettings) {
  return [company.address, company.phone, company.email, company.taxNumber ? `N fiscal: ${company.taxNumber}` : null]
    .filter(Boolean)
    .join(' | ');
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function getStatusLabel(status: string) {
  const labels: Record<string, string> = {
    DRAFT: 'Brouillon',
    SENT: 'Envoye',
    APPROVED: 'Approuve',
    REJECTED: 'Rejete',
    EXPIRED: 'Expire',
    CONVERTED: 'Converti',
  };
  return labels[status] ?? status;
}

function statusColor(status: string) {
  const colors: Record<string, { background: string; foreground: string }> = {
    DRAFT: { background: '#e2e8f0', foreground: '#334155' },
    SENT: { background: '#dbeafe', foreground: '#1d4ed8' },
    APPROVED: { background: '#dcfce7', foreground: '#15803d' },
    REJECTED: { background: '#fee2e2', foreground: '#b91c1c' },
    EXPIRED: { background: '#fef3c7', foreground: '#b45309' },
    CONVERTED: { background: '#ede9fe', foreground: '#6d28d9' },
  };
  return colors[status] ?? { background: '#e2e8f0', foreground: '#334155' };
}

function formatQuantity(quantity: unknown, unit: string | null) {
  const value = Number(quantity);
  const formatted = Number.isInteger(value) ? value.toString() : value.toFixed(2);
  return unit ? `${formatted} ${unit}` : formatted;
}

function formatRate(rate: number) {
  return Number.isInteger(rate) ? rate.toString() : rate.toFixed(2);
}

function formatPdfCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('fr-MA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatPdfDate(date: Date) {
  return new Intl.DateTimeFormat('fr-MA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatPdfDateTime(date: Date) {
  return new Intl.DateTimeFormat('fr-MA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
