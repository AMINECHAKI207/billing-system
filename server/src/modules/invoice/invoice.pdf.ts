import PDFDocument from 'pdfkit';
import { CompanySettings, Invoice } from '@prisma/client';
import fs from 'fs';
import { resolveCompanyAssetUrl } from '@modules/settings/companyAssetUpload';

type InvoiceWithPdfRelations = Invoice & {
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
    taxRate: unknown;
    total: unknown;
  }>;
  signedBy?: {
    name: string;
    email: string;
  } | null;
};

export function renderInvoicePdf(
  invoice: InvoiceWithPdfRelations,
  company: CompanySettings,
  output: NodeJS.WritableStream
) {
  const doc = new PDFDocument({ bufferPages: true, compress: false, margin: 42, size: 'A4' });
  doc.pipe(output);
  drawInvoicePdf(doc, invoice, company);
  doc.end();
}

export function renderInvoicePdfBuffer(
  invoice: InvoiceWithPdfRelations,
  company: CompanySettings
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ bufferPages: true, compress: false, margin: 42, size: 'A4' });

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawInvoicePdf(doc, invoice, company);
    doc.end();
  });
}

function drawInvoicePdf(
  doc: PDFKit.PDFDocument,
  invoice: InvoiceWithPdfRelations,
  company: CompanySettings
) {
  doc.info.Title = `Facture ${invoice.invoiceNumber}`;
  doc.info.Author = company.name;
  doc.info.Subject = 'Facture professionnelle';

  drawHeader(doc, invoice, company);
  drawParties(doc, invoice, company);
  drawInvoiceTable(doc, invoice);
  drawTotalsAndPayment(doc, invoice);
  drawNotesAndBankDetails(doc, invoice, company);

  if (invoice.isSigned) drawSignatureBlock(doc, invoice);

  drawPageFooters(doc, company);
}

function drawSignatureBlock(doc: PDFKit.PDFDocument, invoice: InvoiceWithPdfRelations) {
  const blockHeight = 118;
  ensureSpace(doc, blockHeight + 14);

  const left = pageLeft(doc);
  const width = pageWidth(doc);
  const top = doc.y + 8;
  drawCard(doc, left, top, width, blockHeight, '#f0fdf4', '#bbf7d0');

  doc.font('Helvetica-Bold').fontSize(11).fillColor('#065f46');
  doc.text('Facture signee et tamponnee electroniquement', left + 16, top + 14, {
    width: width - 32,
  });

  doc.font('Helvetica').fontSize(9).fillColor('#047857');
  doc.text(`Signee par: ${invoice.signedBy?.name ?? 'Utilisateur'}`, left + 16, top + 34, {
    width: 250,
  });
  if (invoice.signedAt) {
    doc.text(`Date de signature: ${formatPdfDateTime(invoice.signedAt)}`, left + 16, top + 48, {
      width: 250,
    });
  }

  const imageTop = top + 58;
  const signaturePath = resolveCompanyAssetUrl(invoice.signatureUrl);
  const stampPath = resolveCompanyAssetUrl(invoice.stampUrl);

  doc.font('Helvetica-Bold').fontSize(9).fillColor('#334155');
  doc.text('Signature', left + 16, imageTop, { width: 190 });
  doc.text('Tampon', left + width - 206, imageTop, { width: 190, align: 'right' });

  drawPdfImageIfPresent(doc, signaturePath, left + 16, imageTop + 14, 170, 40);
  drawPdfImageIfPresent(doc, stampPath, left + width - 156, imageTop + 8, 140, 48);

  doc.y = top + blockHeight + 8;
}

function drawPdfImageIfPresent(
  doc: PDFKit.PDFDocument,
  imagePath: string | null,
  x: number,
  y: number,
  width: number,
  height: number
) {
  if (!imagePath || !fs.existsSync(imagePath)) return;

  doc.image(imagePath, x, y, {
    fit: [width, height],
    align: 'center',
    valign: 'center',
  });
}

function drawHeader(
  doc: PDFKit.PDFDocument,
  invoice: InvoiceWithPdfRelations,
  company: CompanySettings
) {
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
  doc.text(compactCompanyLine(company), left + 62, top + 26, {
    width: 250,
    lineGap: 2,
  });

  doc.font('Helvetica-Bold').fontSize(28).fillColor('#ffffff');
  doc.text('FACTURE', left + width - 205, top, { width: 205, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#bfdbfe');
  doc.text(invoice.invoiceNumber, left + width - 205, top + 34, { width: 205, align: 'right' });

  drawBadge(doc, left + width - 130, top + 58, 130, 22, getStatusLabel(invoice.status), statusColor(invoice.status));

  doc.y = 132;
}

function drawParties(
  doc: PDFKit.PDFDocument,
  invoice: InvoiceWithPdfRelations,
  company: CompanySettings
) {
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
    invoice.customer.company ?? invoice.customer.name,
    invoice.customer.name,
    invoice.customer.email,
    invoice.customer.phone,
    `${invoice.customer.country} (${invoice.customer.countryCode})`,
    invoice.customer.taxNumber ? `N fiscal: ${invoice.customer.taxNumber}` : null,
  ]);

  const metaTop = top + height + 10;
  const metaHeight = 46;
  drawCard(doc, left, metaTop, pageWidth(doc), metaHeight, '#f8fafc', '#e2e8f0');
  drawMetaItem(doc, left + 18, metaTop + 9, 'Emission', formatPdfDate(invoice.issueDate));
  drawMetaItem(doc, left + 154, metaTop + 9, 'Echeance', formatPdfDate(invoice.dueDate));
  drawMetaItem(doc, left + 290, metaTop + 9, 'Devise', invoice.currency);
  drawMetaItem(doc, left + 408, metaTop + 9, 'Solde', formatPdfCurrency(Number(invoice.balanceDue), invoice.currency));

  doc.y = metaTop + metaHeight + 16;
}

function drawInvoiceTable(doc: PDFKit.PDFDocument, invoice: InvoiceWithPdfRelations) {
  ensureSpace(doc, 96);

  const left = pageLeft(doc);
  const width = pageWidth(doc);
  const columns = [
    { label: 'Description', width: 230, align: 'left' as const },
    { label: 'Qte', width: 42, align: 'right' as const },
    { label: 'PU HT', width: 78, align: 'right' as const },
    { label: 'TVA', width: 58, align: 'right' as const },
    { label: 'Total TTC', width: 99, align: 'right' as const },
  ];

  doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a');
  doc.text('Lignes de facture', left, doc.y, { width });
  doc.y += 20;

  drawTableHeader(doc, left, doc.y, columns);
  doc.y += 26;

  invoice.items.forEach((item, index) => {
    const row = [
      item.description,
      formatQuantity(item.quantity, item.unit),
      formatPdfCurrency(Number(item.unitPrice), invoice.currency),
      `${formatRate(Number(item.taxRate))}%`,
      formatPdfCurrency(Number(item.total), invoice.currency),
    ];
    const firstColumn = columns[0]!;
    const descriptionHeight = doc.heightOfString(row[0] ?? '', { width: firstColumn.width - 14 });
    const rowHeight = Math.max(34, descriptionHeight + 18);
    ensureSpace(doc, rowHeight + 16);

    if (doc.y < 90) {
      drawTableHeader(doc, left, doc.y, columns);
      doc.y += 26;
    }

    drawTableRow(doc, left, doc.y, columns, row, index % 2 === 0);
    doc.y += rowHeight;
  });

  doc.moveTo(left, doc.y + 4).lineTo(left + width, doc.y + 4).strokeColor('#cbd5e1').stroke();
  doc.y += 18;
}

function drawTotalsAndPayment(doc: PDFKit.PDFDocument, invoice: InvoiceWithPdfRelations) {
  ensureSpace(doc, 154);

  const left = pageLeft(doc);
  const width = pageWidth(doc);
  const summaryWidth = 224;
  const summaryLeft = left + width - summaryWidth;
  const top = doc.y;

  drawCard(doc, left, top, width - summaryWidth - 18, 96, '#eff6ff', '#bfdbfe');
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#1e3a8a');
  doc.text('Resume paiement', left + 16, top + 16);
  drawPaymentMetric(doc, left + 16, top + 38, 'Montant paye', Number(invoice.amountPaid), invoice.currency);
  drawPaymentMetric(doc, left + 16, top + 62, 'Reste a payer', Number(invoice.balanceDue), invoice.currency);

  drawCard(doc, summaryLeft, top, summaryWidth, 126, '#ffffff', '#cbd5e1');
  let y = top + 12;
  y = drawSummaryLine(doc, summaryLeft + 14, y, summaryWidth - 28, 'Sous-total HT', Number(invoice.subtotal), invoice.currency);
  y = drawSummaryLine(doc, summaryLeft + 14, y, summaryWidth - 28, `TVA ${formatRate(Number(invoice.taxRate))}%`, Number(invoice.taxAmount), invoice.currency);
  if (Number(invoice.discount) > 0) {
    y = drawSummaryLine(doc, summaryLeft + 14, y, summaryWidth - 28, 'Remise', -Number(invoice.discount), invoice.currency);
  }
  drawSummaryDivider(doc, summaryLeft + 14, y + 4, summaryWidth - 28);
  y += 14;
  y = drawSummaryLine(doc, summaryLeft + 14, y, summaryWidth - 28, 'Total TTC', Number(invoice.total), invoice.currency, true);
  y = drawSummaryLine(doc, summaryLeft + 14, y + 2, summaryWidth - 28, 'Solde', Number(invoice.balanceDue), invoice.currency, true, '#be123c');

  doc.y = top + 140;
}

function drawNotesAndBankDetails(
  doc: PDFKit.PDFDocument,
  invoice: InvoiceWithPdfRelations,
  company: CompanySettings
) {
  const sections = [
    { title: 'Conditions et notes', value: [invoice.terms, invoice.notes].filter(Boolean).join('\n') },
    { title: 'Coordonnees bancaires', value: company.bankDetails ?? '' },
  ].filter((section) => section.value.trim().length > 0);

  if (!sections.length) return;

  if (sections.length === 2) {
    const left = pageLeft(doc);
    const gap = 14;
    const width = (pageWidth(doc) - gap) / 2;
    const heights = sections.map((section) =>
      Math.max(70, doc.heightOfString(section.value, { width: width - 28 }) + 42)
    );
    const height = Math.max(...heights);
    ensureSpace(doc, height + 12);

    const top = doc.y;
    sections.forEach((section, index) => {
      const x = left + index * (width + gap);
      drawTextCard(doc, x, top, width, height, section.title, section.value);
    });
    doc.y = top + height + 12;
    return;
  }

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

function drawTextCard(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
  value: string
) {
  drawCard(doc, x, y, width, height, '#ffffff', '#e2e8f0');
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a');
  doc.text(title, x + 14, y + 12, { width: width - 28 });
  doc.font('Helvetica').fontSize(8.6).fillColor('#475569');
  doc.text(value, x + 14, y + 31, { width: width - 28, lineGap: 1.5 });
}

function drawInfoCard(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
  lines: Array<string | null | undefined>
) {
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

function drawMetaItem(doc: PDFKit.PDFDocument, x: number, y: number, label: string, value: string) {
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#64748b');
  doc.text(label.toUpperCase(), x, y, { width: 112 });
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a');
  doc.text(value, x, y + 16, { width: 112, ellipsis: true });
}

function drawTableHeader(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  columns: Array<{ label: string; width: number; align: 'left' | 'right' }>
) {
  const width = columns.reduce((total, column) => total + column.width, 0);
  doc.roundedRect(x, y, width, 24, 6).fill('#0f172a');
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');

  let currentX = x;
  columns.forEach((column) => {
    doc.text(column.label, currentX + 7, y + 8, {
      width: column.width - 14,
      align: column.align,
    });
    currentX += column.width;
  });
}

function drawTableRow(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  columns: Array<{ label: string; width: number; align: 'left' | 'right' }>,
  cells: string[],
  shaded: boolean
) {
  const width = columns.reduce((total, column) => total + column.width, 0);
  const firstColumn = columns[0]!;
  const rowHeight = Math.max(34, doc.heightOfString(cells[0] ?? '', { width: firstColumn.width - 14 }) + 18);

  doc.roundedRect(x, y, width, rowHeight, 4).fill(shaded ? '#f8fafc' : '#ffffff');
  doc.strokeColor('#e2e8f0').lineWidth(0.5).roundedRect(x, y, width, rowHeight, 4).stroke();
  doc.font('Helvetica').fontSize(8.5).fillColor('#334155');

  let currentX = x;
  cells.forEach((cell, index) => {
    const column = columns[index];
    if (!column) return;

    doc.text(cell, currentX + 7, y + 10, {
      width: column.width - 14,
      align: column.align,
      lineGap: 1,
    });
    currentX += column.width;
  });
}

function drawPaymentMetric(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  label: string,
  amount: number,
  currency: string
) {
  doc.font('Helvetica').fontSize(8).fillColor('#64748b');
  doc.text(label, x, y, { width: 118 });
  doc.font('Helvetica-Bold').fontSize(12).fillColor(amount > 0 ? '#0f172a' : '#64748b');
  doc.text(formatPdfCurrency(amount, currency), x + 118, y - 2, { width: 110, align: 'right' });
}

function drawSummaryLine(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  label: string,
  amount: number,
  currency: string,
  bold = false,
  color = '#0f172a'
) {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10.5 : 8.8).fillColor(bold ? color : '#475569');
  doc.text(label, x, y, { width: width * 0.46 });
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(color);
  doc.text(formatPdfCurrency(amount, currency), x + width * 0.46, y, {
    width: width * 0.54,
    align: 'right',
  });

  return y + (bold ? 20 : 17);
}

function drawSummaryDivider(doc: PDFKit.PDFDocument, x: number, y: number, width: number) {
  doc.moveTo(x, y).lineTo(x + width, y).strokeColor('#cbd5e1').lineWidth(0.8).stroke();
}

function drawLogoOrInitials(
  doc: PDFKit.PDFDocument,
  company: CompanySettings,
  x: number,
  y: number,
  size: number
) {
  const logoPath = resolveCompanyAssetUrl(company.logoUrl);
  if (logoPath && fs.existsSync(logoPath)) {
    doc.roundedRect(x, y, size, size, 10).fill('#ffffff');
    drawPdfImageIfPresent(doc, logoPath, x + 5, y + 5, size - 10, size - 10);
    return;
  }

  doc.roundedRect(x, y, size, size, 10).fill('#2563eb');
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#ffffff');
  doc.text(initials(company.name), x, y + 15, { width: size, align: 'center' });
}

function drawBadge(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  colors: { background: string; foreground: string }
) {
  doc.roundedRect(x, y, width, height, height / 2).fill(colors.background);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(colors.foreground);
  doc.text(label.toUpperCase(), x + 10, y + 8, { width: width - 20, align: 'center' });
}

function drawCard(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  stroke: string
) {
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
    SENT: 'Envoyee',
    PAID: 'Payee',
    PARTIAL: 'Partielle',
    OVERDUE: 'En retard',
    CANCELLED: 'Annulee',
  };

  return labels[status] ?? status;
}

function statusColor(status: string) {
  const colors: Record<string, { background: string; foreground: string }> = {
    DRAFT: { background: '#e2e8f0', foreground: '#334155' },
    SENT: { background: '#dbeafe', foreground: '#1d4ed8' },
    PAID: { background: '#dcfce7', foreground: '#15803d' },
    PARTIAL: { background: '#fef3c7', foreground: '#b45309' },
    OVERDUE: { background: '#fee2e2', foreground: '#b91c1c' },
    CANCELLED: { background: '#f1f5f9', foreground: '#64748b' },
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
