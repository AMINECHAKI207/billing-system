import PDFDocument from 'pdfkit';
import { CompanySettings } from '@prisma/client';

type CreditNotePdf = {
  creditNoteNumber: string;
  issueDate: Date;
  reason: string;
  status: string;
  subtotal: unknown;
  taxAmount: unknown;
  total: unknown;
  currency: string;
  validatedAt?: Date | null;
  cancelledAt?: Date | null;
  refundedAt?: Date | null;
  refundedAmount?: unknown;
  reasonCodeSnapshot?: string | null;
  reasonNameSnapshot?: unknown;
  invoice: {
    invoiceNumber: string;
    total: unknown;
    issueDate: Date;
    dueDate?: Date | null;
    amountPaid?: unknown;
    balanceDue?: unknown;
  };
  customer: {
    name: string;
    email: string;
    phone: string | null;
    company: string | null;
    taxNumber: string | null;
    country: string;
    countryCode?: string | null;
  };
  createdBy?: { name: string; email: string } | null;
  validatedBy?: { name: string; email: string } | null;
  lines: Array<{
    description: string;
    quantity: unknown;
    unit: string | null;
    unitPrice: unknown;
    taxRate: unknown;
    lineTotal: unknown;
  }>;
};

type Labels = ReturnType<typeof dictionary>;

const PAGE = {
  margin: 36,
  width: 595.28,
  height: 841.89,
};

const COLORS = {
  ink: '#0f172a',
  muted: '#64748b',
  subtle: '#94a3b8',
  line: '#dbe3ef',
  panel: '#f8fafc',
  panelStrong: '#eef4fb',
  accent: '#2563eb',
  success: '#047857',
  danger: '#b91c1c',
  warning: '#b45309',
  white: '#ffffff',
};

export function renderCreditNotePdfBuffer(
  creditNote: CreditNotePdf,
  company: CompanySettings,
  language = 'fr'
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ bufferPages: true, compress: true, margin: PAGE.margin, size: 'A4', autoFirstPage: true });
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawCreditNote(doc, creditNote, company, language);
    doc.end();
  });
}

function drawCreditNote(doc: PDFKit.PDFDocument, creditNote: CreditNotePdf, company: CompanySettings, language: string) {
  const labels = dictionary(language);
  const rtl = normalizeLanguage(language) === 'ar';
  const left = PAGE.margin;
  const width = doc.page.width - PAGE.margin * 2;

  doc.info.Title = `${labels.title} ${creditNote.creditNoteNumber}`;
  doc.info.Author = company.name;
  doc.info.Subject = `${labels.sourceInvoice} ${creditNote.invoice.invoiceNumber}`;

  drawHeader(doc, creditNote, company, labels, rtl, left, width);
  drawParties(doc, creditNote, company, labels, rtl, left, width);
  drawReason(doc, creditNote, labels, language, rtl, left, width);
  drawLines(doc, creditNote, labels, rtl, left, width);
  drawTotals(doc, creditNote, labels, rtl, left, width);
  drawValidation(doc, creditNote, labels, rtl, left, width);
  drawFooter(doc, company, labels);
}

function drawHeader(
  doc: PDFKit.PDFDocument,
  creditNote: CreditNotePdf,
  company: CompanySettings,
  labels: Labels,
  rtl: boolean,
  left: number,
  width: number
) {
  doc.roundedRect(left, 30, width, 92, 10).fillAndStroke(COLORS.panel, COLORS.line);
  doc.rect(left, 30, 5, 92).fill(COLORS.accent);

  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.muted).text(labels.company, left + 18, 48, { width: 230, align: rtl ? 'right' : 'left' });
  doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.ink).text(company.name, left + 18, 65, { width: 250, align: rtl ? 'right' : 'left', ellipsis: true });
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text(
    [company.address, company.email, company.phone, company.taxNumber].filter(Boolean).join(' | '),
    left + 18,
    88,
    { width: 300, height: 22, align: rtl ? 'right' : 'left', ellipsis: true }
  );

  const titleX = left + width - 226;
  doc.font('Helvetica-Bold').fontSize(22).fillColor(COLORS.ink).text(labels.titleUpper, titleX, 48, { width: 208, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.accent).text(creditNote.creditNoteNumber, titleX, 77, { width: 208, align: 'right' });
  drawStatusBadge(doc, titleX + 78, 96, labels.statuses[creditNote.status] ?? creditNote.status, statusColor(creditNote.status));

  doc.y = 142;
}

function drawParties(
  doc: PDFKit.PDFDocument,
  creditNote: CreditNotePdf,
  company: CompanySettings,
  labels: Labels,
  rtl: boolean,
  left: number,
  width: number
) {
  const gap = 12;
  const boxWidth = (width - gap) / 2;
  const top = doc.y;

  drawInfoBox(doc, left, top, boxWidth, 98, labels.customer, [
    creditNote.customer.company ?? creditNote.customer.name,
    creditNote.customer.name,
    creditNote.customer.email,
    creditNote.customer.phone,
    creditNote.customer.taxNumber ? `${labels.taxId}: ${creditNote.customer.taxNumber}` : null,
    creditNote.customer.country,
  ], rtl);

  drawInfoBox(doc, left + boxWidth + gap, top, boxWidth, 98, labels.document, [
    `${labels.issueDate}: ${formatDate(creditNote.issueDate, labels.locale)}`,
    `${labels.sourceInvoice}: ${creditNote.invoice.invoiceNumber}`,
    `${labels.invoiceDate}: ${formatDate(creditNote.invoice.issueDate, labels.locale)}`,
    `${labels.originalTotal}: ${money(Number(creditNote.invoice.total), creditNote.currency, labels.locale)}`,
    `${labels.createdBy}: ${creditNote.createdBy?.name ?? company.name}`,
  ], rtl);

  doc.y = top + 114;
}

function drawReason(
  doc: PDFKit.PDFDocument,
  creditNote: CreditNotePdf,
  labels: Labels,
  language: string,
  rtl: boolean,
  left: number,
  width: number
) {
  const top = doc.y;
  doc.roundedRect(left, top, width, 62, 8).fillAndStroke(COLORS.white, COLORS.line);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.muted).text(labels.reason.toUpperCase(), left + 12, top + 10, { width: width - 24, align: rtl ? 'right' : 'left' });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.ink).text(getReasonName(creditNote, language), left + 12, top + 27, { width: 190, align: rtl ? 'right' : 'left', ellipsis: true });
  doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.muted).text(cleanText(creditNote.reason), left + 214, top + 27, { width: width - 226, height: 24, align: rtl ? 'right' : 'left', ellipsis: true });
  doc.y = top + 78;
}

function drawLines(
  doc: PDFKit.PDFDocument,
  creditNote: CreditNotePdf,
  labels: Labels,
  rtl: boolean,
  left: number,
  width: number
) {
  const maxRowsOnFirstPage = 14;
  const lines = creditNote.lines.length ? creditNote.lines : [{
    description: labels.noLines,
    quantity: 1,
    unit: null,
    unitPrice: creditNote.subtotal,
    taxRate: 0,
    lineTotal: creditNote.subtotal,
  }];
  const rowHeight = lines.length > maxRowsOnFirstPage ? 21 : 24;
  const columns = [width - 308, 48, 84, 58, 118];

  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.ink).text(labels.lines, left, doc.y, { width, align: rtl ? 'right' : 'left' });
  doc.y += 18;
  drawTableRow(doc, left, doc.y, columns, [labels.description, labels.qty, labels.unitPrice, labels.vat, labels.total], true, rtl, 22);
  doc.y += 22;

  lines.forEach((line, index) => {
    if (doc.y + rowHeight > 662) {
      doc.addPage();
      doc.y = 54;
      drawTableRow(doc, left, doc.y, columns, [labels.description, labels.qty, labels.unitPrice, labels.vat, labels.total], true, rtl, 22);
      doc.y += 22;
    }

    drawTableRow(doc, left, doc.y, columns, [
      cleanText(line.description),
      formatQuantity(Number(line.quantity), line.unit, labels.locale),
      money(Number(line.unitPrice), creditNote.currency, labels.locale),
      `${formatNumber(Number(line.taxRate), labels.locale)}%`,
      money(Number(line.lineTotal), creditNote.currency, labels.locale),
    ], false, rtl, rowHeight, index % 2 === 0);
    doc.y += rowHeight;
  });

  doc.y += 12;
}

function drawTotals(
  doc: PDFKit.PDFDocument,
  creditNote: CreditNotePdf,
  labels: Labels,
  rtl: boolean,
  left: number,
  width: number
) {
  const top = Math.max(doc.y, 608);
  const summaryWidth = 230;
  const summaryLeft = rtl ? left : left + width - summaryWidth;

  doc.roundedRect(summaryLeft, top, summaryWidth, 104, 8).fillAndStroke(COLORS.panel, COLORS.line);
  drawAmountLine(doc, summaryLeft + 14, top + 15, summaryWidth - 28, labels.subtotal, Number(creditNote.subtotal), creditNote.currency, labels.locale);
  drawAmountLine(doc, summaryLeft + 14, top + 40, summaryWidth - 28, labels.tax, Number(creditNote.taxAmount), creditNote.currency, labels.locale);
  doc.moveTo(summaryLeft + 14, top + 67).lineTo(summaryLeft + summaryWidth - 14, top + 67).strokeColor(COLORS.line).stroke();
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.ink).text(labels.total, summaryLeft + 14, top + 78, { width: 88, align: rtl ? 'right' : 'left' });
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.success).text(money(Number(creditNote.total), creditNote.currency, labels.locale), summaryLeft + 104, top + 76, { width: summaryWidth - 118, align: 'right' });

  const noteWidth = width - summaryWidth - 16;
  const noteLeft = rtl ? left + summaryWidth + 16 : left;
  doc.roundedRect(noteLeft, top, noteWidth, 104, 8).fillAndStroke(COLORS.white, COLORS.line);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.muted).text(labels.accountingImpact.toUpperCase(), noteLeft + 12, top + 14, { width: noteWidth - 24, align: rtl ? 'right' : 'left' });
  doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.muted).text(
    labels.accountingText
      .replace('{{invoice}}', creditNote.invoice.invoiceNumber)
      .replace('{{amount}}', money(Number(creditNote.total), creditNote.currency, labels.locale)),
    noteLeft + 12,
    top + 34,
    { width: noteWidth - 24, height: 46, align: rtl ? 'right' : 'left', ellipsis: true }
  );

  doc.y = top + 118;
}

function drawValidation(
  doc: PDFKit.PDFDocument,
  creditNote: CreditNotePdf,
  labels: Labels,
  rtl: boolean,
  left: number,
  width: number
) {
  const events = [
    creditNote.validatedAt ? `${labels.validated}: ${formatDate(creditNote.validatedAt, labels.locale)} - ${creditNote.validatedBy?.name ?? '-'}` : null,
    creditNote.refundedAt ? `${labels.refunded}: ${formatDate(creditNote.refundedAt, labels.locale)}` : null,
    creditNote.cancelledAt ? `${labels.cancelled}: ${formatDate(creditNote.cancelledAt, labels.locale)}` : null,
  ].filter(Boolean);
  if (!events.length) return;

  doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text(events.join('   |   '), left, doc.y, { width, align: rtl ? 'right' : 'left', ellipsis: true });
}

function drawFooter(doc: PDFKit.PDFDocument, company: CompanySettings, labels: Labels) {
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i += 1) {
    doc.switchToPage(i);
    const y = doc.page.height - 48;
    doc.moveTo(PAGE.margin, y - 10).lineTo(doc.page.width - PAGE.margin, y - 10).strokeColor(COLORS.line).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted).text(
      `${labels.generated} ${formatDate(new Date(), labels.locale)} - ${company.name}`,
      PAGE.margin,
      y,
      { width: 340 }
    );
    doc.text(`${labels.page} ${i + 1}/${pages.count}`, doc.page.width - 146, y, { width: 110, align: 'right' });
  }
}

function drawInfoBox(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, title: string, lines: Array<string | null | undefined>, rtl: boolean) {
  doc.roundedRect(x, y, w, h, 8).fillAndStroke(COLORS.white, COLORS.line);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.muted).text(title.toUpperCase(), x + 12, y + 12, { width: w - 24, align: rtl ? 'right' : 'left' });
  const cleanLines = lines.filter(Boolean).map((line) => cleanText(String(line))).join('\n');
  doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.ink).text(cleanLines, x + 12, y + 32, { width: w - 24, height: h - 40, align: rtl ? 'right' : 'left', lineGap: 1, ellipsis: true });
}

function drawStatusBadge(doc: PDFKit.PDFDocument, x: number, y: number, label: string, color: string) {
  doc.roundedRect(x, y, 130, 20, 10).fill(color);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.white).text(label, x + 8, y + 6, { width: 114, align: 'center', ellipsis: true });
}

function drawTableRow(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  widths: number[],
  values: string[],
  head: boolean,
  rtl: boolean,
  height: number,
  shaded = false
) {
  const tableWidth = widths.reduce((sum, value) => sum + value, 0);
  if (head || shaded) {
    doc.rect(x, y, tableWidth, height).fill(head ? COLORS.panelStrong : COLORS.panel);
  }
  let cursor = x;
  values.forEach((value, index) => {
    const align = index === 0 ? (rtl ? 'right' : 'left') : 'right';
    doc.font(head ? 'Helvetica-Bold' : 'Helvetica').fontSize(head ? 7.6 : 7.4).fillColor(head ? COLORS.ink : COLORS.ink);
    doc.text(value, cursor + 6, y + (head ? 7 : 6), { width: widths[index]! - 12, height: height - 7, align, ellipsis: true });
    cursor += widths[index]!;
  });
  doc.moveTo(x, y + height).lineTo(x + tableWidth, y + height).strokeColor(COLORS.line).stroke();
}

function drawAmountLine(doc: PDFKit.PDFDocument, x: number, y: number, w: number, label: string, amount: number, currency: string, locale: string) {
  doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.muted).text(label, x, y, { width: w / 2 });
  doc.font('Helvetica-Bold').fontSize(8.8).fillColor(COLORS.ink).text(money(amount, currency, locale), x + w / 2, y, { width: w / 2, align: 'right' });
}

function statusColor(status: string) {
  const colors: Record<string, string> = {
    DRAFT: COLORS.muted,
    VALIDATED: COLORS.success,
    CANCELLED: COLORS.danger,
    REFUNDED: COLORS.accent,
  };
  return colors[status] ?? COLORS.muted;
}

function money(amount: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2 }).format(Number.isFinite(amount) ? amount : 0);
}

function formatDate(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: '2-digit' }).format(new Date(date));
}

function formatQuantity(quantity: number, unit: string | null, locale: string) {
  return `${formatNumber(quantity, locale)}${unit ? ` ${unit}` : ''}`;
}

function formatNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0);
}

function cleanText(value: string) {
  return value.replace(/\s+/g, ' ').trim() || '-';
}

function normalizeLanguage(language: string) {
  if (language.startsWith('ar')) return 'ar';
  if (language.startsWith('en')) return 'en';
  return 'fr';
}

function dictionary(language: string) {
  const normalized = normalizeLanguage(language);
  if (normalized === 'en') {
    return {
      locale: 'en-US',
      title: 'Credit Note',
      titleUpper: 'CREDIT NOTE',
      company: 'Company',
      customer: 'Customer',
      document: 'Document',
      sourceInvoice: 'Original invoice',
      invoiceDate: 'Invoice date',
      issueDate: 'Issue date',
      status: 'Status',
      originalTotal: 'Original total',
      createdBy: 'Created by',
      reason: 'Reason',
      lines: 'Credit note lines',
      description: 'Description',
      qty: 'Qty',
      unitPrice: 'Unit price',
      vat: 'VAT',
      subtotal: 'Subtotal',
      tax: 'VAT amount',
      total: 'Total credit',
      validated: 'Validated',
      refunded: 'Refunded',
      cancelled: 'Cancelled',
      taxId: 'Tax ID',
      generated: 'Generated on',
      page: 'Page',
      noLines: 'Credit note adjustment',
      accountingImpact: 'Accounting impact',
      accountingText: 'This credit note reduces invoice {{invoice}} by {{amount}} and must be processed according to the current refund or allocation status.',
      statuses: { DRAFT: 'Draft', VALIDATED: 'Validated', CANCELLED: 'Cancelled', REFUNDED: 'Refunded' } as Record<string, string>,
    };
  }
  if (normalized === 'ar') {
    return {
      locale: 'ar-MA',
      title: 'إشعار دائن',
      titleUpper: 'إشعار دائن',
      company: 'الشركة',
      customer: 'العميل',
      document: 'المستند',
      sourceInvoice: 'الفاتورة الأصلية',
      invoiceDate: 'تاريخ الفاتورة',
      issueDate: 'تاريخ الإصدار',
      status: 'الحالة',
      originalTotal: 'المبلغ الأصلي',
      createdBy: 'أنشئ بواسطة',
      reason: 'السبب',
      lines: 'بنود الإشعار الدائن',
      description: 'الوصف',
      qty: 'الكمية',
      unitPrice: 'سعر الوحدة',
      vat: 'ضريبة',
      subtotal: 'المجموع الفرعي',
      tax: 'مبلغ الضريبة',
      total: 'إجمالي الإشعار',
      validated: 'تم التحقق',
      refunded: 'تم الاسترداد',
      cancelled: 'ملغى',
      taxId: 'الرقم الضريبي',
      generated: 'تم الإنشاء في',
      page: 'صفحة',
      noLines: 'تسوية إشعار دائن',
      accountingImpact: 'الأثر المحاسبي',
      accountingText: 'يخفض هذا الإشعار الدائن الفاتورة {{invoice}} بمبلغ {{amount}} ويجب معالجته حسب حالة الاسترداد أو التخصيص الحالية.',
      statuses: { DRAFT: 'مسودة', VALIDATED: 'تم التحقق', CANCELLED: 'ملغى', REFUNDED: 'مسترد' } as Record<string, string>,
    };
  }
  return {
    locale: 'fr-MA',
    title: 'Avoir',
    titleUpper: 'AVOIR',
    company: 'Société',
    customer: 'Client',
    document: 'Document',
    sourceInvoice: 'Facture originale',
    invoiceDate: 'Date facture',
    issueDate: 'Émission',
    status: 'Statut',
    originalTotal: 'Total facture',
    createdBy: 'Créé par',
    reason: 'Motif',
    lines: "Lignes d'avoir",
    description: 'Description',
    qty: 'Qté',
    unitPrice: 'PU HT',
    vat: 'TVA',
    subtotal: 'Sous-total HT',
    tax: 'TVA',
    total: 'Total avoir',
    validated: 'Validé',
    refunded: 'Remboursé',
    cancelled: 'Annulé',
    taxId: 'Identifiant fiscal',
    generated: 'Généré le',
    page: 'Page',
    noLines: "Ajustement d'avoir",
    accountingImpact: 'Impact comptable',
    accountingText: "Cet avoir réduit la facture {{invoice}} de {{amount}} et doit être traité selon l'état de remboursement ou d'imputation en cours.",
    statuses: { DRAFT: 'Brouillon', VALIDATED: 'Validé', CANCELLED: 'Annulé', REFUNDED: 'Remboursé' } as Record<string, string>,
  };
}

function getReasonName(creditNote: CreditNotePdf, language: string) {
  const snapshot = creditNote.reasonNameSnapshot;
  const normalized = normalizeLanguage(language);
  if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
    const names = snapshot as Record<string, unknown>;
    const value = names[normalized] ?? names.fr ?? names.en ?? names.ar;
    if (typeof value === 'string' && value.trim()) return value;
  }
  return creditNote.reasonCodeSnapshot || '-';
}
