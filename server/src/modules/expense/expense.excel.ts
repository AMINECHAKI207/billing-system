import ExcelJS from 'exceljs';
import { ExpenseNoteStatus } from '@prisma/client';
import { sanitizeExcelString } from '@utils/excel';

type ExpenseExportRow = {
  id: string;
  status: ExpenseNoteStatus;
  expenseDate: Date;
  amountTTC: unknown;
  amountHT?: unknown | null;
  vatAmount: unknown;
  vatRate: unknown;
  currency: string;
  merchantName?: string | null;
  receiptNumber?: string | null;
  documentNumber?: string | null;
  comment?: string | null;
  source: string;
  category?: { name: string } | null;
  expenseType?: { name: string } | null;
  createdBy?: { name: string; email: string } | null;
  approvedBy?: { name: string; email: string } | null;
  approvedAt?: Date | null;
  attachments?: Array<{ originalName: string; mimeType: string }>;
};

const colors = {
  ink: 'FF0F172A',
  muted: 'FF64748B',
  blue: 'FF2563EB',
  border: 'FFD8E2F0',
  surface: 'FFF8FAFC',
  white: 'FFFFFFFF',
  green: 'FF047857',
  red: 'FFB91C1C',
};
const moneyFormat = '#,##0.00';
const dateFormat = 'yyyy-mm-dd';
const headerRowNumber = 5;

export async function renderExpenseNotesExcelBuffer(expenses: ExpenseExportRow[], title = 'Expense Notes Export'): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Billing System';
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet('Expense Notes', {
    properties: { tabColor: { argb: colors.blue } },
    views: [{ state: 'frozen', ySplit: headerRowNumber }],
    pageSetup: { fitToPage: true, fitToWidth: 1, orientation: 'landscape' },
  });

  worksheet.columns = [
    { header: 'Reference', key: 'reference', width: 22 },
    { header: 'Employee', key: 'employee', width: 24 },
    { header: 'Employee Email', key: 'employeeEmail', width: 30 },
    { header: 'Merchant', key: 'merchant', width: 28 },
    { header: 'Receipt Number', key: 'receiptNumber', width: 22 },
    { header: 'Expense Date', key: 'expenseDate', width: 16 },
    { header: 'Category', key: 'category', width: 20 },
    { header: 'Expense Type', key: 'expenseType', width: 22 },
    { header: 'Source', key: 'source', width: 14 },
    { header: 'Status', key: 'status', width: 18 },
    { header: 'Amount HT', key: 'amountHT', width: 14, style: { numFmt: moneyFormat } },
    { header: 'VAT Rate', key: 'vatRate', width: 12 },
    { header: 'VAT Amount', key: 'vatAmount', width: 14, style: { numFmt: moneyFormat } },
    { header: 'Amount TTC', key: 'amountTTC', width: 14, style: { numFmt: moneyFormat } },
    { header: 'Currency', key: 'currency', width: 12 },
    { header: 'Approved By', key: 'approvedBy', width: 24 },
    { header: 'Approved At', key: 'approvedAt', width: 18 },
    { header: 'Receipt Attachment', key: 'receiptAttachment', width: 34 },
    { header: 'Comment', key: 'comment', width: 42 },
  ];

  worksheet.spliceRows(1, 0, [], [], [], []);
  worksheet.mergeCells('A1:S1');
  worksheet.getCell('A1').value = sanitizeExcelString(title);
  worksheet.getCell('A1').font = { bold: true, size: 15, color: { argb: colors.white } };
  worksheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' };
  for (let columnIndex = 1; columnIndex <= worksheet.columnCount; columnIndex += 1) {
    worksheet.getRow(1).getCell(columnIndex).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.ink } };
  }

  const totalHT = expenses.reduce((sum, expense) => sum + numberValue(expense.amountHT), 0);
  const totalVat = expenses.reduce((sum, expense) => sum + numberValue(expense.vatAmount), 0);
  const totalTTC = expenses.reduce((sum, expense) => sum + numberValue(expense.amountTTC), 0);
  styleMergedCard(worksheet, 'A2:D3', `Generated\n${new Date().toISOString().slice(0, 10)}`);
  styleMergedCard(worksheet, 'E2:H3', `Expense notes\n${expenses.length}`);
  styleMergedCard(worksheet, 'I2:M3', `Total VAT\n${totalVat.toFixed(2)}`);
  styleMergedCard(worksheet, 'N2:S3', `Total TTC\n${totalTTC.toFixed(2)} | HT ${totalHT.toFixed(2)}`);

  worksheet.getRow(4).height = 8;
  const header = worksheet.getRow(headerRowNumber);
  header.height = 26;
  header.font = { bold: true, size: 10.5, color: { argb: colors.white } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.blue } };
  header.alignment = { vertical: 'middle', horizontal: 'center' };

  expenses.forEach((expense) => {
    const row = worksheet.addRow({
      reference: safe(expense.documentNumber ?? expense.receiptNumber ?? `EXP-${expense.id.slice(0, 8)}`),
      employee: safe(expense.createdBy?.name),
      employeeEmail: safe(expense.createdBy?.email),
      merchant: safe(expense.merchantName),
      receiptNumber: safe(expense.receiptNumber ?? expense.documentNumber),
      expenseDate: expense.expenseDate,
      category: safe(expense.category?.name),
      expenseType: safe(expense.expenseType?.name),
      source: safe(expense.source),
      status: safe(expense.status),
      amountHT: numberValue(expense.amountHT),
      vatRate: numberValue(expense.vatRate),
      vatAmount: numberValue(expense.vatAmount),
      amountTTC: numberValue(expense.amountTTC),
      currency: safe(expense.currency),
      approvedBy: safe(expense.approvedBy?.name),
      approvedAt: expense.approvedAt ?? null,
      receiptAttachment: safe(expense.attachments?.[0]?.originalName),
      comment: safe(expense.comment),
    });
    const isEven = row.number % 2 === 0;
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? colors.white : colors.surface } };
    row.getCell('reference').font = { bold: true, color: { argb: colors.blue } };
    row.getCell('amountTTC').font = { bold: true, color: { argb: colors.ink } };
    row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: getStatusFill(expense.status) } };
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
        vertical: rowNumber > headerRowNumber ? 'top' : 'middle',
        horizontal: rowNumber === headerRowNumber ? 'center' : undefined,
        wrapText: rowNumber > headerRowNumber,
      };
    });
  });

  worksheet.getColumn('expenseDate').numFmt = dateFormat;
  worksheet.getColumn('approvedAt').numFmt = dateFormat;
  ['amountHT', 'vatRate', 'vatAmount', 'amountTTC'].forEach((key) => {
    worksheet.getColumn(key).alignment = { horizontal: 'right', vertical: 'top' };
  });
  ['amountHT', 'vatAmount', 'amountTTC'].forEach((key) => {
    worksheet.getColumn(key).numFmt = moneyFormat;
  });
  worksheet.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber, column: worksheet.columnCount },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function styleMergedCard(worksheet: ExcelJS.Worksheet, range: string, value: string) {
  worksheet.mergeCells(range);
  const cell = worksheet.getCell(range.split(':')[0] ?? 'A1');
  cell.value = value;
  cell.font = { bold: true, size: 11, color: { argb: colors.ink } };
  cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.surface } };
  cell.border = {
    top: { style: 'thin', color: { argb: colors.border } },
    left: { style: 'thin', color: { argb: colors.border } },
    bottom: { style: 'thin', color: { argb: colors.border } },
    right: { style: 'thin', color: { argb: colors.border } },
  };
}

export function renderExpenseNotesCsv(expenses: ExpenseExportRow[]) {
  const headers = [
    'Reference',
    'Employee',
    'Merchant',
    'Expense Date',
    'Category',
    'Expense Type',
    'Amount HT',
    'VAT Rate',
    'VAT Amount',
    'Amount TTC',
    'Currency',
    'Status',
    'Source',
    'Comment',
  ];
  const rows = expenses.map((expense) => [
    expense.documentNumber ?? expense.receiptNumber ?? `EXP-${expense.id.slice(0, 8)}`,
    expense.createdBy?.name ?? '',
    expense.merchantName ?? '',
    expense.expenseDate.toISOString().slice(0, 10),
    expense.category?.name ?? '',
    expense.expenseType?.name ?? '',
    numberValue(expense.amountHT).toFixed(2),
    numberValue(expense.vatRate).toFixed(2),
    numberValue(expense.vatAmount).toFixed(2),
    numberValue(expense.amountTTC).toFixed(2),
    expense.currency,
    expense.status,
    expense.source,
    expense.comment ?? '',
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

function csvCell(value: string) {
  const sanitized = safe(value);
  return `"${sanitized.replace(/"/g, '""')}"`;
}

function safe(value?: string | null) {
  return sanitizeExcelString(value ?? '');
}

function numberValue(value: unknown) {
  return Number(value ?? 0);
}

function getStatusFill(status: string) {
  const colors: Record<string, string> = {
    DRAFT: 'FFF1F5F9',
    PROCESSING: 'FFE0F2FE',
    NEEDS_REVIEW: 'FFFFFBEB',
    SUBMITTED: 'FFEFF6FF',
    CHANGES_REQUESTED: 'FFFFEDD5',
    APPROVED: 'FFECFDF5',
    REJECTED: 'FFFFF1F2',
    PAID: 'FFF5F3FF',
  };
  return colors[status] ?? 'FFFFFFFF';
}
