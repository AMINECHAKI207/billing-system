import assert from 'assert/strict';
import ExcelJS from 'exceljs';
import { renderInvoicesExcelBuffer } from '@modules/invoice/invoice.excel';
import { sanitizeExcelString } from '@utils/excel';

async function main() {
  assert.equal(sanitizeExcelString('=SUM(1,1)'), "'=SUM(1,1)");
  assert.equal(sanitizeExcelString('   =SUM(1,1)'), "'   =SUM(1,1)");
  assert.equal(sanitizeExcelString('   +cmd'), "'   +cmd");
  assert.equal(sanitizeExcelString('-10'), "'-10");
  assert.equal(sanitizeExcelString('@lookup'), "'@lookup");
  assert.equal(sanitizeExcelString('Safe value'), 'Safe value');

  const buffer = await renderInvoicesExcelBuffer([
    {
      invoiceNumber: '=INV-TEST',
      status: 'SENT',
      issueDate: new Date('2026-07-27'),
      dueDate: new Date('2026-08-27'),
      subtotal: 1000,
      taxRate: 20,
      taxAmount: 200,
      discount: 0,
      total: 1200,
      amountPaid: 0,
      balanceDue: 1200,
      currency: 'MAD',
      notes: '   =note',
      terms: '+terms',
      sourceDevis: { devisNumber: '-DEV-TEST' },
      customer: {
        name: '=Client',
        email: 'client@example.com',
        phone: '   -212600000000',
        company: '+Company',
        taxNumber: '@TAX',
        country: 'Morocco',
        countryCode: 'MA',
      },
      items: [
        {
          description: '=Service',
          unit: '@unit',
          quantity: 2,
          unitPrice: 500,
          taxRate: 20,
          total: 1200,
        },
      ],
    },
  ]);

  assert.ok(buffer.length > 0);

  const workbook = new ExcelJS.Workbook();
  const workbookBytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  await workbook.xlsx.load(workbookBytes as ArrayBuffer);
  const worksheet = workbook.getWorksheet('Invoices');
  assert.ok(worksheet);

  assert.equal(worksheet.getCell('A1').value, 'Invoices Export');
  assert.match(String(worksheet.getCell('F2').value), /Invoices/);
  assert.equal(worksheet.getCell('A5').value, 'Invoice Number');
  assert.ok(worksheet.autoFilter);
  assert.equal(worksheet.getCell('A6').value, "'=INV-TEST");
  assert.equal(worksheet.getCell('E6').value, "'=Client");
  assert.equal(worksheet.getCell('F6').value, "'+Company");
  assert.equal(worksheet.getCell('H6').value, "'   -212600000000");
  assert.equal(worksheet.getCell('I6').value, "'@TAX");
  assert.equal(worksheet.getCell('S6').value, "'-DEV-TEST");
  assert.match(String(worksheet.getCell('T6').value), /'=Service/);
  assert.match(String(worksheet.getCell('T6').value), /'@unit/);
  assert.equal(worksheet.getCell('U6').value, "'   =note");
  assert.equal(worksheet.getCell('V6').value, "'+terms");

  console.log('invoice excel export tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
