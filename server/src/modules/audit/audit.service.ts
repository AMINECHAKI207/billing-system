import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { Prisma } from '@prisma/client';
import { prisma } from '@config/database';
import { ApiResponse } from '@utils/ApiResponse';
import { sanitizeExcelString } from '@utils/excel';
import { getAuditContext } from './audit.context';
import { sanitizeAuditObject } from './audit.utils';
import type { AuditExportQuery, AuditListQuery } from './audit.schema';

export class AuditService {
  async list(query: AuditListQuery) {
    const where = this.where(query);
    const orderBy = { [query.sortBy]: query.sortOrder } as Prisma.AuditLogOrderByWithRelationInput;
    const skip = (query.page - 1) * query.limit;
    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take: query.limit,
        orderBy,
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);
    return { data, meta: ApiResponse.buildPaginationMeta(query.page, query.limit, total) };
  }

  async timeline(entity: string, entityId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where = { entity, entityId };
    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);
    return { data, meta: ApiResponse.buildPaginationMeta(page, limit, total) };
  }

  async export(query: AuditExportQuery) {
    const rows = await prisma.auditLog.findMany({
      where: this.where(query),
      take: 5000,
      orderBy: { [query.sortBy]: query.sortOrder } as Prisma.AuditLogOrderByWithRelationInput,
      include: { user: { select: { name: true, email: true, role: true } } },
    });
    if (query.format === 'excel') {
      return {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileName: `audit-logs-${Date.now()}.xlsx`,
        buffer: await this.exportExcel(rows),
      };
    }
    if (query.format === 'pdf') {
      return {
        contentType: 'application/pdf',
        fileName: `audit-logs-${Date.now()}.pdf`,
        buffer: await this.exportPdf(rows),
      };
    }
    return {
      contentType: 'text/csv; charset=utf-8',
      fileName: `audit-logs-${Date.now()}.csv`,
      buffer: Buffer.from(this.exportCsv(rows), 'utf8'),
    };
  }

  async logBusinessAction(input: {
    module: string;
    entity: string;
    entityId?: string | null;
    action: string;
    success?: boolean;
    metadata?: Record<string, unknown>;
    oldValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
    userId?: string | null;
  }) {
    const context = getAuditContext();
    await prisma.auditLog.create({
      data: {
        userId: input.userId ?? context?.userId,
        module: input.module,
        entity: input.entity,
        entityId: input.entityId,
        action: input.action,
        oldValues: sanitizeAuditObject(input.oldValues),
        newValues: sanitizeAuditObject(input.newValues),
        metadata: sanitizeAuditObject({ ...(input.metadata ?? {}), userRole: context?.userRole }),
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        browser: context?.browser,
        operatingSystem: context?.operatingSystem,
        device: context?.device,
        requestId: context?.requestId,
        sessionId: context?.sessionId,
        httpMethod: context?.httpMethod,
        route: context?.route,
        statusCode: context?.statusCode,
        success: input.success ?? context?.success ?? true,
        executionTime: context?.executionTime,
      },
    });
  }

  private where(query: AuditListQuery | AuditExportQuery): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {};
    if (query.search) {
      where.OR = [
        { module: { contains: query.search, mode: 'insensitive' } },
        { entity: { contains: query.search, mode: 'insensitive' } },
        { entityId: { contains: query.search, mode: 'insensitive' } },
        { action: { contains: query.search, mode: 'insensitive' } },
        { route: { contains: query.search, mode: 'insensitive' } },
        { user: { name: { contains: query.search, mode: 'insensitive' } } },
        { user: { email: { contains: query.search, mode: 'insensitive' } } },
      ];
    }
    if (query.userId) where.userId = query.userId;
    if (query.module) where.module = query.module;
    if (query.entity) where.entity = query.entity;
    if (query.entityId) where.entityId = query.entityId;
    if (query.action) where.action = query.action;
    if (query.success) where.success = query.success === 'true';
    if (query.startDate || query.endDate) {
      where.createdAt = {
        ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
        ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
      };
    }
    return where;
  }

  private exportCsv(rows: AuditRow[]) {
    const header = ['Created At', 'User', 'Role', 'Module', 'Entity', 'Entity ID', 'Action', 'Success', 'Route', 'IP', 'Request ID'];
    const lines = rows.map((row) => [
      row.createdAt.toISOString(),
      row.user?.email ?? '',
      row.user?.role ?? '',
      row.module,
      row.entity,
      row.entityId ?? '',
      row.action,
      String(row.success),
      row.route ?? '',
      row.ipAddress ?? '',
      row.requestId ?? '',
    ].map((value) => `"${sanitizeExcelString(String(value)).replace(/"/g, '""')}"`).join(','));
    return [header.join(','), ...lines].join('\n');
  }

  private async exportExcel(rows: AuditRow[]) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Billing ERP';
    const sheet = workbook.addWorksheet('Audit Logs', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      { header: 'Created At', key: 'createdAt', width: 22 },
      { header: 'User', key: 'user', width: 28 },
      { header: 'Role', key: 'role', width: 14 },
      { header: 'Module', key: 'module', width: 18 },
      { header: 'Entity', key: 'entity', width: 22 },
      { header: 'Entity ID', key: 'entityId', width: 36 },
      { header: 'Action', key: 'action', width: 22 },
      { header: 'Success', key: 'success', width: 10 },
      { header: 'Route', key: 'route', width: 45 },
      { header: 'IP', key: 'ip', width: 18 },
    ];
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    rows.forEach((row) => {
      sheet.addRow({
        createdAt: row.createdAt.toISOString(),
        user: sanitizeExcelString(row.user?.email ?? ''),
        role: row.user?.role ?? '',
        module: sanitizeExcelString(row.module),
        entity: sanitizeExcelString(row.entity),
        entityId: sanitizeExcelString(row.entityId ?? ''),
        action: sanitizeExcelString(row.action),
        success: row.success ? 'TRUE' : 'FALSE',
        route: sanitizeExcelString(row.route ?? ''),
        ip: sanitizeExcelString(row.ipAddress ?? ''),
      });
    });
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private exportPdf(rows: AuditRow[]) {
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true });
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.font('Helvetica-Bold').fontSize(18).text('Enterprise Audit Logs');
      doc.moveDown(0.5).font('Helvetica').fontSize(8).fillColor('#64748b').text(`Generated ${new Date().toISOString()}`);
      doc.moveDown();
      rows.slice(0, 300).forEach((row) => {
        if (doc.y > 760) doc.addPage();
        doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8.5).text(`${row.action} - ${row.module}/${row.entity}`, { continued: false });
        doc.fillColor('#64748b').font('Helvetica').fontSize(7.5).text(`${row.createdAt.toISOString()} | ${row.user?.email ?? 'system'} | ${row.route ?? '-'}`);
        doc.moveDown(0.35);
      });
      doc.end();
    });
  }
}

type AuditRow = Awaited<ReturnType<typeof prisma.auditLog.findMany>>[number] & {
  user?: { name: string; email: string; role: string } | null;
};

export const auditService = new AuditService();
