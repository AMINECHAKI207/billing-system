import ExcelJS from 'exceljs';
import { sanitizeExcelString } from '@utils/excel';

type InvoiceExportRow = {
  invoiceNumber: string;
  status: string;
  issueDate: Date;
  dueDate: Date;
  subtotal: unknown;
  taxRate: unknown;
  taxAmount: unknown;
  discount: unknown;
  total: unknown;
  amountPaid: unknown;
  balanceDue: unknown;
  currency: string;
  notes?: string | null;
  terms?: string | null;
  sourceDevis?: { devisNumber: string } | null;
  customer?: {
    name: string;
    email: string;
    phone?: string | null;
    company?: string | null;
    taxNumber?: string | null;
    country?: string | null;
    countryCode?: string | null;
  } | null;
  items?: Array<{
    description: string;
    unit?: string | null;
    quantity: unknown;
    unitPrice: unknown;
    taxRate: unknown;
    total: unknown;
  }>;
};

const moneyFormat = '#,##0.00';
const dateFormat = 'yyyy-mm-dd';
const headerRowNumber = 5;
const firstDataRowNumber = headerRowNumber + 1;
const lastColumnLetter = 'V';
const colors = {
  ink: 'FF0F172A',
  muted: 'FF64748B',
  blue: 'FF2563EB',
  blueSoft: 'FFEFF6FF',
  border: 'FFD8E2F0',
  surface: 'FFF8FAFC',
  white: 'FFFFFFFF',
  green: 'FF047857',
  red: 'FFB91C1C',
};

function numberValue(value: unknown) {
  return Number(value ?? 0);
}

function safe(value?: string | null) {
  return sanitizeExcelString(value ?? '');
}

function formatItems(items: InvoiceExportRow['items']) {
  return (items ?? [])
    .map((item) => {
      const unit = item.unit ? ` ${safe(item.unit)}` : '';
      return `${safe(item.description)} (${numberValue(item.quantity)}${unit} x ${numberValue(item.unitPrice)})`;
    })
    .join('\n');
}

function getStatusFill(status: string) {
  const colors: Record<string, string> = {
    DRAFT: 'FFF1F5F9',
    SENT: 'FFEFF6FF',
    PAID: 'FFECFDF5',
    PARTIALLY_PAID: 'FFFFFBEB',
    OVERDUE: 'FFFFF1F2',
    CANCELLED: 'FFF4F4F5',
  };

  return colors[status] ?? 'FFFFFFFF';
}

function styleMergedCard(worksheet: ExcelJS.Worksheet, range: string, value: string, accentColor: string) {
  worksheet.mergeCells(range);
  const cell = worksheet.getCell(range.split(':')[0] ?? 'A1');
  cell.value = value;
  cell.font = { bold: true, size: 12, color: { argb: colors.ink } };
  cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: colors.surface },
  };
  cell.border = {
    top: { style: 'thin', color: { argb: accentColor } },
    left: { style: 'thin', color: { argb: accentColor } },
    bottom: { style: 'thin', color: { argb: accentColor } },
    right: { style: 'thin', color: { argb: accentColor } },
  };
}

export async function renderInvoicesExcelBuffer(invoices: InvoiceExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Billing System';
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet('Invoices', {
    properties: { tabColor: { argb: colors.blue } },
    views: [{ state: 'frozen', ySplit: headerRowNumber }],
    pageSetup: { fitToPage: true, fitToWidth: 1, orientation: 'landscape' },
  });

  worksheet.columns = [
    { header: 'Invoice Number', key: 'invoiceNumber', width: 22 },
    { header: 'Status', key: 'status', width: 18 },
    { header: 'Issue Date', key: 'issueDate', width: 16 },
    { header: 'Due Date', key: 'dueDate', width: 16 },
    { header: 'Client Name', key: 'clientName', width: 28 },
    { header: 'Client Company', key: 'clientCompany', width: 28 },
    { header: 'Client Email', key: 'clientEmail', width: 30 },
    { header: 'Client Phone', key: 'clientPhone', width: 18 },
    { header: 'Client Tax Number', key: 'clientTaxNumber', width: 22 },
    { header: 'Client Country', key: 'clientCountry', width: 20 },
    { header: 'Subtotal', key: 'subtotal', width: 14, style: { numFmt: moneyFormat } },
    { header: 'Tax Rate', key: 'taxRate', width: 12 },
    { header: 'Tax Amount', key: 'taxAmount', width: 14, style: { numFmt: moneyFormat } },
    { header: 'Discount', key: 'discount', width: 14, style: { numFmt: moneyFormat } },
    { header: 'Total', key: 'total', width: 14, style: { numFmt: moneyFormat } },
    { header: 'Amount Paid', key: 'amountPaid', width: 16, style: { numFmt: moneyFormat } },
    { header: 'Balance Due', key: 'balanceDue', width: 16, style: { numFmt: moneyFormat } },
    { header: 'Currency', key: 'currency', width: 12 },
    { header: 'Source Devis', key: 'sourceDevis', width: 20 },
    { header: 'Items', key: 'items', width: 48 },
    { header: 'Notes', key: 'notes', width: 36 },
    { header: 'Terms', key: 'terms', width: 36 },
  ];

  worksheet.spliceRows(1, 0, [], [], [], []);

  worksheet.mergeCells(`A1:${lastColumnLetter}1`);

  const totalAmount = invoices.reduce((sum, invoice) => sum + numberValue(invoice.total), 0);
  const amountPaid = invoices.reduce((sum, invoice) => sum + numberValue(invoice.amountPaid), 0);
  const balanceDue = invoices.reduce((sum, invoice) => sum + numberValue(invoice.balanceDue), 0);
  worksheet.getCell('A1').value = 'Invoices Export';

  styleMergedCard(worksheet, 'A2:E3', `Generated\n${new Date().toISOString().slice(0, 10)}`, colors.border);
  styleMergedCard(worksheet, 'F2:J3', `Invoices\n${invoices.length}`, 'FFBFDBFE');
  styleMergedCard(worksheet, 'K2:O3', `Total amount\n${totalAmount.toFixed(2)}`, 'FFC7D2FE');
  styleMergedCard(worksheet, 'P2:V3', `Balance due\n${balanceDue.toFixed(2)} | Paid ${amountPaid.toFixed(2)}`, balanceDue > 0 ? 'FFFECACA' : 'FFA7F3D0');

  worksheet.getRow(1).height = 26;
  worksheet.getRow(2).height = 20;
  worksheet.getRow(3).height = 20;
  worksheet.getRow(4).height = 8;
  worksheet.getCell('A1').font = { bold: true, size: 16, color: { argb: colors.white } };
  worksheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' };
  for (let columnIndex = 1; columnIndex <= worksheet.columnCount; columnIndex += 1) {
    worksheet.getRow(1).getCell(columnIndex).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: colors.ink },
    };
  }

  worksheet.getRow(headerRowNumber).height = 28;
  worksheet.getRow(headerRowNumber).font = { bold: true, size: 11, color: { argb: colors.white } };
  worksheet.getRow(headerRowNumber).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: colors.blue },
  };
  worksheet.getRow(headerRowNumber).alignment = { vertical: 'middle', horizontal: 'center' };

  invoices.forEach((invoice) => {
    const row = worksheet.addRow({
      invoiceNumber: safe(invoice.invoiceNumber),
      status: safe(invoice.status),
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      clientName: safe(invoice.customer?.name),
      clientCompany: safe(invoice.customer?.company),
      clientEmail: safe(invoice.customer?.email),
      clientPhone: safe(invoice.customer?.phone),
      clientTaxNumber: safe(invoice.customer?.taxNumber),
      clientCountry: safe(invoice.customer?.country ?? invoice.customer?.countryCode),
      subtotal: numberValue(invoice.subtotal),
      taxRate: numberValue(invoice.taxRate),
      taxAmount: numberValue(invoice.taxAmount),
      discount: numberValue(invoice.discount),
      total: numberValue(invoice.total),
      amountPaid: numberValue(invoice.amountPaid),
      balanceDue: numberValue(invoice.balanceDue),
      currency: safe(invoice.currency),
      sourceDevis: safe(invoice.sourceDevis?.devisNumber),
      items: formatItems(invoice.items),
      notes: safe(invoice.notes),
      terms: safe(invoice.terms),
    });

    const isEvenRow = row.number % 2 === 0;
    row.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: isEvenRow ? colors.white : colors.surface },
    };
    row.getCell('status').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: getStatusFill(invoice.status) },
    };
    row.getCell('status').font = { bold: true, color: { argb: colors.ink } };
    row.getCell('invoiceNumber').font = { bold: true, color: { argb: colors.blue } };
    row.getCell('total').font = { bold: true, color: { argb: colors.ink } };
    row.getCell('balanceDue').font = { bold: true, color: { argb: numberValue(invoice.balanceDue) > 0 ? colors.red : colors.green } };
  });

  worksheet.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: colors.border } },
        left: { style: 'thin', color: { argb: colors.border } },
        bottom: { style: 'thin', color: { argb: colors.border } },
        right: { style: 'thin', color: { argb: colors.border } },
      };
      cell.alignment = {
        vertical: rowNumber >= firstDataRowNumber ? 'top' : 'middle',
        horizontal: rowNumber === headerRowNumber ? 'center' : undefined,
        wrapText: rowNumber >= firstDataRowNumber,
      };
    });
  });

  for (let rowNumber = firstDataRowNumber; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    worksheet.getRow(rowNumber).height = 26;
  }

  worksheet.getColumn('issueDate').numFmt = dateFormat;
  worksheet.getColumn('dueDate').numFmt = dateFormat;
  ['subtotal', 'taxAmount', 'discount', 'total', 'amountPaid', 'balanceDue'].forEach((key) => {
    worksheet.getColumn(key).numFmt = moneyFormat;
  });
  ['subtotal', 'taxRate', 'taxAmount', 'discount', 'total', 'amountPaid', 'balanceDue'].forEach((key) => {
    worksheet.getColumn(key).alignment = { horizontal: 'right', vertical: 'top' };
  });
  worksheet.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber, column: worksheet.columnCount },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
