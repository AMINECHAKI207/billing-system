import { AiToolRiskLevel } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '@utils/ApiError';
import type { AiTool, ToolContext, ToolPreview } from '../tools/toolTypes';

type WorkflowStepStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'WAITING_CONFIRMATION'
  | 'FAILED'
  | 'SKIPPED';

type WorkflowStep = {
  key: string;
  label: string;
  riskLevel: AiToolRiskLevel;
  status: WorkflowStepStatus;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
};

type WorkflowRun = {
  workflowId: string;
  name: string;
  status: 'PLANNED' | 'WAITING_CONFIRMATION' | 'EXECUTING' | 'COMPLETED' | 'FAILED';
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  steps: WorkflowStep[];
};

const contractInvoiceWorkflowInput = z.object({
  contractId: z.string().uuid(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
});

function nowIso() {
  return new Date().toISOString();
}

function createWorkflowRun(name: string, steps: WorkflowStep[]): WorkflowRun {
  return {
    workflowId: `wf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    name,
    status: 'PLANNED',
    startedAt: nowIso(),
    steps,
  };
}

function completeWorkflow(run: WorkflowRun, status: WorkflowRun['status']): WorkflowRun {
  const finishedAt = nowIso();
  return {
    ...run,
    status,
    finishedAt,
    durationMs: new Date(finishedAt).getTime() - new Date(run.startedAt).getTime(),
  };
}

function completeStep(step: WorkflowStep): WorkflowStep {
  return { ...step, status: 'COMPLETED', finishedAt: nowIso() };
}

function waitingStep(step: WorkflowStep): WorkflowStep {
  return { ...step, status: 'WAITING_CONFIRMATION', finishedAt: nowIso() };
}

function failStep(step: WorkflowStep, error: unknown): WorkflowStep {
  const message = error instanceof Error ? error.message : 'Workflow step failed';
  return { ...step, status: 'FAILED', finishedAt: nowIso(), error: message };
}

function requireTool(tools: Map<string, AiTool>, name: string): AiTool {
  const tool = tools.get(name);
  if (!tool) throw ApiError.badRequest(`The ERP workflow is missing the ${name} capability.`);
  return tool;
}

async function executeTool(tools: Map<string, AiTool>, name: string, input: Record<string, unknown>, context: ToolContext) {
  const tool = requireTool(tools, name);
  const parsed = tool.schema.parse(input);
  return tool.execute(parsed, context);
}

async function previewContractInvoiceWorkflow(
  tools: Map<string, AiTool>,
  input: z.infer<typeof contractInvoiceWorkflowInput>,
  context: ToolContext
): Promise<ToolPreview> {
  const run = createWorkflowRun('Contract to invoice workflow', [
    { key: 'find_contract', label: 'Find Contract', riskLevel: AiToolRiskLevel.READ_ONLY, status: 'COMPLETED', startedAt: nowIso() },
    { key: 'find_timesheets', label: 'Find Approved Timesheets', riskLevel: AiToolRiskLevel.READ_ONLY, status: 'COMPLETED', startedAt: nowIso() },
    { key: 'prepare_invoice', label: 'Prepare Invoice Preview', riskLevel: AiToolRiskLevel.READ_ONLY, status: 'COMPLETED', startedAt: nowIso() },
    { key: 'create_invoice', label: 'Create Invoice', riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED, status: 'WAITING_CONFIRMATION', startedAt: nowIso() },
    { key: 'generate_pdf', label: 'Prepare Invoice PDF', riskLevel: AiToolRiskLevel.READ_ONLY, status: 'NOT_STARTED', startedAt: nowIso() },
    { key: 'audit', label: 'Record Audit Trail', riskLevel: AiToolRiskLevel.READ_ONLY, status: 'NOT_STARTED', startedAt: nowIso() },
  ]);

  try {
    const [contract, readyTimesheets, invoicePreview] = await Promise.all([
      executeTool(tools, 'get_contract_details', { contractId: input.contractId }, context),
      executeTool(tools, 'list_ready_to_invoice', { contractId: input.contractId }, context),
      executeTool(tools, 'prepare_invoice_preview', input, context),
    ]);

    const contractRecord = contract && typeof contract === 'object' ? contract as Record<string, unknown> : {};
    const readyEntries = Array.isArray(readyTimesheets) ? readyTimesheets : [];
    const pricingType = typeof contractRecord.pricingType === 'string' ? contractRecord.pricingType : '';

    if ((pricingType === 'HOURLY' || pricingType === 'DAILY') && readyEntries.length === 0) {
      throw ApiError.badRequest('No approved uninvoiced entries for this billing period');
    }

    const steps = run.steps.map((step) => {
      if (step.key === 'create_invoice') return waitingStep(step);
      if (step.key === 'generate_pdf' || step.key === 'audit') return step;
      return completeStep(step);
    });
    const planned = completeWorkflow({ ...run, status: 'WAITING_CONFIRMATION', steps }, 'WAITING_CONFIRMATION');

    return {
      title: 'Contract invoice workflow',
      description: 'Create a draft invoice from approved billable timesheets, then prepare the PDF and audit trail.',
      summary: {
        workflow: planned,
        contract,
        readyTimesheets,
        invoicePreview,
      },
    };
} catch (error) {
  throw error;
}
}

export function createEnterpriseWorkflowTools(tools: Map<string, AiTool>): AiTool[] {
  return [
    {
      name: 'contract_invoice_workflow',
      description: 'Create an invoice FROM AN EXISTING CONTRACT\'s approved billable timesheets/schedule (takes only a contractId). This is the correct tool whenever the user asks to invoice/bill a contract, a client tied to a known contract, or "this contract" from conversation context — do not use create_invoice for these cases.',
      module: 'contracts',
      requiredPermission: 'contracts.billing.generate',
      riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
      schema: contractInvoiceWorkflowInput,
      preview: async (input, context) => previewContractInvoiceWorkflow(tools, input, context),
      execute: async (input, context) => {
        const run = createWorkflowRun('Contract to invoice workflow', [
          { key: 'validate', label: 'Validate Business Rules', riskLevel: AiToolRiskLevel.READ_ONLY, status: 'COMPLETED', startedAt: nowIso() },
          { key: 'create_invoice', label: 'Create Invoice', riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED, status: 'IN_PROGRESS', startedAt: nowIso() },
          { key: 'generate_pdf', label: 'Prepare Invoice PDF', riskLevel: AiToolRiskLevel.READ_ONLY, status: 'NOT_STARTED', startedAt: nowIso() },
          { key: 'audit', label: 'Record Audit Trail', riskLevel: AiToolRiskLevel.READ_ONLY, status: 'NOT_STARTED', startedAt: nowIso() },
        ]);

        let invoice: unknown;
        try {
          await executeTool(tools, 'prepare_invoice_preview', input, context);
          invoice = await executeTool(tools, 'generate_invoice_from_timesheets', input, context);
        } catch (error) {
          const failedRun = completeWorkflow({
            ...run,
            status: 'FAILED',
            steps: run.steps.map((step) => step.key === 'create_invoice' ? failStep(step, error) : step),
          }, 'FAILED');
          throw ApiError.badRequest(error instanceof Error ? error.message : 'The workflow could not be completed safely', [
            JSON.stringify({ workflow: failedRun }),
          ]);
        }

        // The invoice already exists at this point: a PDF failure must not be reported
        // as a total workflow failure, or the pending action would be marked FAILED while
        // hiding that the invoice was actually created.
        const invoiceRecord = invoice && typeof invoice === 'object' ? invoice as Record<string, unknown> : {};
        const invoiceId = typeof invoiceRecord.id === 'string' ? invoiceRecord.id : '';
        let pdf: unknown = null;
        let pdfError: string | undefined;
        let pdfStep = run.steps.find((step) => step.key === 'generate_pdf')!;
        try {
          pdf = invoiceId ? await executeTool(tools, 'generate_invoice_pdf', { invoiceId }, context) : null;
          pdfStep = completeStep(pdfStep);
        } catch (error) {
          pdfStep = failStep(pdfStep, error);
          pdfError = pdfStep.error;
        }

        const steps = run.steps.map((step) => {
          if (step.key === 'create_invoice') return completeStep(step);
          if (step.key === 'generate_pdf') return pdfStep;
          if (step.key === 'audit') return completeStep({ ...step, status: 'IN_PROGRESS' });
          return completeStep(step);
        });

        return {
          workflow: completeWorkflow({ ...run, status: 'COMPLETED', steps }, 'COMPLETED'),
          invoice,
          pdf,
          ...(pdfError ? { pdfError } : {}),
        };
      },
    },
  ];
}
