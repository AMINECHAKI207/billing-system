import assert from "assert/strict";
import { AiActionStatus, AiToolRiskLevel, Role } from "@prisma/client";
import { prisma } from "@config/database";
import { settingsService } from "@modules/settings/settings.service";
import { aiAssistantService } from "@modules/ai-assistant/aiAssistant.service";
import { contractService } from "@modules/contract/contract.service";
import { creditNoteService } from "@modules/credit-note/creditNote.service";
import { expenseService } from "@modules/expense/expense.service";
import { devisService } from "@modules/devis/devis.service";
import { createTelegramLinkCode, handleTelegramUpdate } from "@modules/telegram/telegram.service";

const runId = Date.now();
const activeEmail = `telegram-active-${runId}@example.com`;
const disabledEmail = `telegram-disabled-${runId}@example.com`;

type MockTelegramMessage = {
  text?: string;
  chatId?: string;
  telegramUserId?: string;
  languageCode?: string;
  voice?: {
    fileId: string;
    fileSize?: number;
    mimeType?: string;
  };
  audio?: {
    fileId: string;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
  };
};

const sentMessages: Array<{ chatId: string; text: string }> = [];
const editedMessages: Array<{ chatId: string; messageId: number; text: string }> = [];
const answeredCallbacks: Array<{ id: string; text: string }> = [];
const sentDocuments: Array<{ chatId: string; fileName: string; caption: string }> = [];
const sentEmails: Array<{ name: string; email: string; code: string; expiresAt: Date }> = [];
const confirmCalls: string[] = [];
const createdConversationIds: string[] = [];
const transcriptRequests: string[] = [];
const telegramFileRequests: string[] = [];
const transcriptionModels: string[] = [];
const transcriptionPrompts: string[] = [];
const transcriptionLanguageParams: Array<string | null> = [];

const originalFetch = global.fetch;
const originalSendTelegramLinkCodeEmail = settingsService.sendTelegramLinkCodeEmail.bind(settingsService);
const originalCreateConversation = aiAssistantService.createConversation.bind(aiAssistantService);
const originalSendMessage = aiAssistantService.sendMessage.bind(aiAssistantService);
const originalPreviewMessagePlan = aiAssistantService.previewMessagePlan.bind(aiAssistantService);
const originalPreviewStructuredFormContinuation = aiAssistantService.previewStructuredFormContinuation.bind(aiAssistantService);
const originalContinueStructuredForm = aiAssistantService.continueStructuredForm.bind(aiAssistantService);
const originalConfirmAction = aiAssistantService.confirmAction.bind(aiAssistantService);
const originalContractDownloadPdf = contractService.downloadPdf.bind(contractService);
const originalContractSendByEmail = contractService.sendByEmail.bind(contractService);
const originalCreditNotePdfBuffer = creditNoteService.pdfBuffer.bind(creditNoteService);
const originalCreditNoteSendEmail = creditNoteService.sendEmail.bind(creditNoteService);
const originalExpenseRenderNotePdf = expenseService.renderNotePdf.bind(expenseService);
const originalExpenseSendNoteEmail = expenseService.sendNoteEmail.bind(expenseService);
const originalDevisSendDevisEmail = devisService.sendDevisEmail.bind(devisService);
const continueStructuredFormCalls: Array<{ toolName: string; message: string }> = [];

function buildUpdate({
  text,
  chatId = "7001",
  telegramUserId = "9001",
  languageCode = "fr",
  voice,
  audio,
}: MockTelegramMessage) {
  return {
    message: {
      chat: { id: chatId },
      from: { id: telegramUserId, language_code: languageCode },
      ...(typeof text === "string" ? { text } : {}),
      ...(voice
        ? {
            voice: {
              file_id: voice.fileId,
              file_size: voice.fileSize ?? 1024,
              mime_type: voice.mimeType ?? "audio/ogg",
            },
          }
        : {}),
      ...(audio
        ? {
            audio: {
              file_id: audio.fileId,
              file_size: audio.fileSize ?? 2048,
              mime_type: audio.mimeType ?? "audio/mpeg",
              file_name: audio.fileName ?? "telegram-audio.mp3",
            },
          }
        : {}),
    },
  };
}

function buildCallbackUpdate({
  data,
  chatId = "7001",
  telegramUserId = "9001",
  languageCode = "fr",
  messageId = 501,
}: {
  data: string;
  chatId?: string;
  telegramUserId?: string;
  languageCode?: string;
  messageId?: number;
}) {
  return {
    callback_query: {
      id: `callback-${messageId}`,
      data,
      from: { id: telegramUserId, language_code: languageCode },
      message: {
        message_id: messageId,
        chat: { id: chatId },
      },
    },
  };
}

async function main() {
  (global as typeof globalThis).fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);

    if (url.includes("/sendMessage")) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      sentMessages.push({
        chatId: String(body.chat_id ?? ""),
        text: String(body.text ?? ""),
      });

      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: [] }),
      } as Response;
    }

    if (url.includes("/editMessageText")) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      editedMessages.push({
        chatId: String(body.chat_id ?? ""),
        messageId: Number(body.message_id ?? 0),
        text: String(body.text ?? ""),
      });

      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: [] }),
      } as Response;
    }

    if (url.includes("/answerCallbackQuery")) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      answeredCallbacks.push({
        id: String(body.callback_query_id ?? ""),
        text: String(body.text ?? ""),
      });

      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: true }),
      } as Response;
    }

    if (url.includes("/sendDocument")) {
      const formData = init?.body as FormData;
      const document = formData.get("document");
      sentDocuments.push({
        chatId: String(formData.get("chat_id") ?? ""),
        fileName: document && typeof document === "object" && "name" in document ? String((document as File).name) : "",
        caption: String(formData.get("caption") ?? ""),
      });

      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: [] }),
      } as Response;
    }

    if (url.includes("/getFile")) {
      const fileId = new URL(url).searchParams.get("file_id") ?? "";
      telegramFileRequests.push(fileId);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: {
            file_path: `${fileId}.bin`,
          },
        }),
      } as Response;
    }

    if (url.includes("/file/bot")) {
      const filePath = url.split("/file/bot").at(-1) ?? "";
      const fileName = filePath.split("/").at(-1) ?? "";
      if (fileName.includes("download-fail")) {
        return {
          ok: false,
          status: 502,
          json: async () => ({ ok: false }),
          arrayBuffer: async () => new Uint8Array().buffer,
        } as Response;
      }

      const payload = Buffer.from(fileName, "utf8");
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
        arrayBuffer: async () => payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
      } as Response;
    }

    if (url.includes("api.openai.com/v1/audio/transcriptions")) {
      const formData = init?.body as FormData;
      const file = formData.get("file");
      const audioText = file && typeof file === "object" && "text" in file ? await (file as File).text() : "";
      transcriptionModels.push(String(formData.get("model") ?? ""));
      transcriptionPrompts.push(String(formData.get("prompt") ?? ""));
      transcriptionLanguageParams.push(formData.has("language") ? String(formData.get("language")) : null);
      transcriptRequests.push(audioText);

      if (audioText.includes("voice-transcription-fail")) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: { message: "mock transcription failure" } }),
        } as Response;
      }

      if (audioText.includes("voice-empty-transcript")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ text: "" }),
        } as Response;
      }

      if (audioText.includes("voice-create-invoice-fr")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ text: "Crée une facture pour Test AI Client", language: "french" }),
        } as Response;
      }

      if (audioText.includes("voice-create-contract-fr")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ text: "Créer un contrat", language: "french" }),
        } as Response;
      }

      if (audioText.includes("voice-create-contract-en")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ text: "Create a contract for Manual Test Client", language: "en" }),
        } as Response;
      }

      if (audioText.includes("voice-create-contract-ar")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ text: "إنشاء عقد للعميل Manual Test Client", language: "arabic" }),
        } as Response;
      }

      if (audioText.includes("voice-ambiguous-transcript")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ text: "قم بخلق مقاعدة لتسجيل المعلومات", language: "arabic" }),
        } as Response;
      }

      if (audioText.includes("voice-create-invoice-ar")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ text: "أنشئ فاتورة للعميل Test AI Client", language: "arabic" }),
        } as Response;
      }

      if (audioText.includes("voice-create-invoice")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ text: "Create invoice for Telegram Client", language: "en" }),
        } as Response;
      }

      if (audioText.includes("voice-form-complete-fr")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ text: "Date d’échéance 20 août 2026, site web, quantité un, 3000 dirhams, TVA 20%", language: "french" }),
        } as Response;
      }

      if (audioText.includes("voice-form-complete")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ text: "Issue date 2026-08-12 due date 2026-08-30 line Website development 1 x 1000 VAT 20", language: "en" }),
        } as Response;
      }

      if (audioText.includes("audio-create-invoice")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ text: "Create invoice for Telegram Client", language: "en" }),
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ text: "Create invoice for Telegram Client", language: "en" }),
      } as Response;
    }

    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;

  settingsService.sendTelegramLinkCodeEmail = (async (user, code, expiresAt) => {
    sentEmails.push({ ...user, code, expiresAt });
    return {
      to: user.email,
      delivery: { mode: "mock" },
    } as any;
  }) as typeof settingsService.sendTelegramLinkCodeEmail;

  aiAssistantService.createConversation = (async (user, input) => {
    const conversation = await prisma.aiConversation.create({
      data: {
        userId: user.id,
        title: input.title ?? `Telegram ${runId}`,
        language: input.language ?? "fr",
      },
    });
    createdConversationIds.push(conversation.id);
    return conversation;
  }) as typeof aiAssistantService.createConversation;

  aiAssistantService.sendMessage = (async (_user, conversationId, input) => {
    const normalizedContent = input.content.toLowerCase();
    if (
      normalizedContent.includes("invoice") ||
      normalizedContent.includes("facture") ||
      input.content.includes("ÙØ§ØªÙˆØ±Ø©") || input.content.includes("فاتورة")
    ) {
      return {
        message: {
          id: `assistant-structured-${conversationId}`,
          content: "J'ai retrouve le client. Completez le formulaire facture.",
        },
        executionResult: {
          type: "structured_form",
          toolName: "create_invoice",
          form: {
            toolName: "create_invoice",
            title: input.language === "en" ? "Invoice form" : input.language === "ar" ? "Ù†Ù…ÙˆØ°Ø¬ Ø§Ù„ÙØ§ØªÙˆØ±Ø©" : "Formulaire facture",
            description: input.language === "en" ? "Fill the required fields." : input.language === "ar" ? "Ø£ÙƒÙ…Ù„ Ø§Ù„Ø­Ù‚ÙˆÙ„ Ø§Ù„Ù…Ø·Ù„ÙˆØ¨Ø©." : "Renseignez les champs requis.",
            values: {
              customerName: "Telegram Client",
            },
            missingFields: ["issueDate", "dueDate", "items"],
            fields: [
              { path: "issueDate", label: input.language === "en" ? "Issue date" : input.language === "ar" ? "ØªØ§Ø±ÙŠØ® Ø§Ù„Ø¥ØµØ¯Ø§Ø±" : "Date d'emission", type: "date" },
              { path: "dueDate", label: input.language === "en" ? "Due date" : input.language === "ar" ? "ØªØ§Ø±ÙŠØ® Ø§Ù„Ø§Ø³ØªØ­Ù‚Ø§Ù‚" : "Date d'echeance", type: "date" },
              {
                path: "items",
                label: input.language === "en" ? "Invoice lines" : input.language === "ar" ? "Ø³Ø·ÙˆØ± Ø§Ù„ÙØ§ØªÙˆØ±Ø©" : "Lignes de facture",
                type: "array",
                itemFields: [
                  { path: "description", label: input.language === "en" ? "Description" : input.language === "ar" ? "Ø§Ù„ÙˆØµÙ" : "Description", type: "text" },
                  { path: "quantity", label: input.language === "en" ? "Quantity" : input.language === "ar" ? "Ø§Ù„ÙƒÙ…ÙŠØ©" : "Quantite", type: "number" },
                  { path: "unitPrice", label: input.language === "en" ? "Unit price" : input.language === "ar" ? "Ø³Ø¹Ø± Ø§Ù„ÙˆØ­Ø¯Ø©" : "Prix unitaire", type: "number" },
                  { path: "taxRate", label: input.language === "en" ? "VAT" : input.language === "ar" ? "Ø§Ù„Ø¶Ø±ÙŠØ¨Ø©" : "TVA", type: "number" },
                ],
              },
            ],
            language: input.language as "fr" | "en" | "ar",
          },
        },
      } as any;
    }

    return {
      message: {
        id: `assistant-generic-${conversationId}`,
        content: input.language === "en" ? "Ready." : input.language === "ar" ? "Ø¬Ø§Ù‡Ø²." : "Pret.",
      },
      executionResult: null,
    } as any;
  }) as typeof aiAssistantService.sendMessage;

  aiAssistantService.continueStructuredForm = (async (_user, input) => {
    return {
      type: "pending_action",
      toolName: input.toolName,
      action: {
        id: "ai-pending-telegram-001",
        previewPayload: {
          summary: {
            customer: "Telegram Client",
            total: "1,200.00 MAD",
            status: "DRAFT",
          },
        },
      },
    } as any;
  }) as typeof aiAssistantService.continueStructuredForm;

  aiAssistantService.confirmAction = (async (_user, actionId) => {
    confirmCalls.push(actionId);
    if (confirmCalls.filter((id) => id === actionId).length > 1) {
      throw new Error("duplicate confirmation blocked");
    }
    return {
      action: { id: actionId, status: "EXECUTED" },
      result: {
        invoiceNumber: "INV-TG-0001",
        customerName: "Telegram Client",
        total: "1,200.00 MAD",
        status: "DRAFT",
      },
    } as any;
  }) as typeof aiAssistantService.confirmAction;

  contractService.downloadPdf = ((async () => ({
    buffer: Buffer.from("contract-pdf", "utf8"),
    fileName: "CTR-TG-0001.pdf",
  })) as unknown) as typeof contractService.downloadPdf;

  contractService.sendByEmail = ((async () => ({
    contract: { contractNumber: "CTR-TG-0001" },
    signatureUrl: "https://example.test/signature",
  })) as unknown) as typeof contractService.sendByEmail;

  creditNoteService.pdfBuffer = ((async () => ({
    fileName: "AV-TG-0001.pdf",
    buffer: Buffer.from("credit-note-pdf", "utf8"),
  })) as unknown) as typeof creditNoteService.pdfBuffer;

  creditNoteService.sendEmail = ((async () => ({
    email: {
      to: "credit-note@example.com",
      subject: "Avoir AV-TG-0001",
    },
  })) as unknown) as typeof creditNoteService.sendEmail;

  expenseService.renderNotePdf = ((async () => ({
    buffer: Buffer.from("expense-pdf", "utf8"),
    fileName: "EXP-TG-0001.pdf",
    note: { expenseNumber: "EXP-TG-0001" },
  })) as unknown) as typeof expenseService.renderNotePdf;

  expenseService.sendNoteEmail = ((async () => ({
    emailLog: { status: "SENT" },
    expenseNote: { expenseNumber: "EXP-TG-0001" },
    delivery: { mode: "mock" },
  })) as unknown) as typeof expenseService.sendNoteEmail;

  const buildStructuredForm = (
    conversationId: string,
    language: "fr" | "en" | "ar",
    toolName: string,
    title: string,
    content: string,
    fields: Array<Record<string, unknown>>,
    values: Record<string, unknown> = {}
  ) => ({
    message: {
      id: `assistant-structured-${conversationId}-${toolName}`,
      content,
    },
    executionResult: {
      type: "structured_form",
      toolName,
      form: {
        toolName,
        title,
        description: language === "en" ? "Fill the required fields." : language === "ar" ? "Ã˜Â£Ã™Æ’Ã™â€¦Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â­Ã™â€šÃ™Ë†Ã™â€ž Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â·Ã™â€žÃ™Ë†Ã˜Â¨Ã˜Â©." : "Renseignez les champs requis.",
        values,
        missingFields: fields.map((field) => String(field.path ?? "")),
        fields,
        language,
      },
    },
  });

  aiAssistantService.sendMessage = (async (_user, conversationId, input) => {
    const normalizedContent = input.content.toLowerCase();
    const language = input.language as "fr" | "en" | "ar";

    if (normalizedContent.includes("show unpaid invoices")) {
      return {
        message: {
          id: `assistant-read-${conversationId}`,
          content: "I am analyzing overdue invoices, collection exposure and follow-up priorities.",
        },
        executionResult: {
          type: "tool_result",
          toolName: "analyze_revenue_intelligence",
          result: {
            overdueCount: 6,
            overdueAmount: 7700,
            readyToInvoiceCount: 1,
            readyToInvoiceRevenue: 1200,
            currency: "MAD",
            topOverdue: [
              {
                invoiceNumber: "INV-2026-0042",
                client: "Atlas",
                balanceDue: 3600,
                dueDate: "2026-08-19T00:00:00.000Z",
                currency: "MAD",
              },
              {
                invoiceNumber: "INV-2026-0041",
                client: "Cafe Rabat",
                balanceDue: 1100,
                dueDate: "2026-08-17T00:00:00.000Z",
                currency: "MAD",
              },
              {
                invoiceNumber: "INV-2026-0039",
                client: "Acme",
                balanceDue: 900,
                dueDate: "2026-08-15T00:00:00.000Z",
                currency: "MAD",
              },
              {
                invoiceNumber: "INV-2026-0038",
                client: "Globex",
                balanceDue: 800,
                dueDate: "2026-08-14T00:00:00.000Z",
                currency: "MAD",
              },
              {
                invoiceNumber: "INV-2026-0037",
                client: "Orion",
                balanceDue: 700,
                dueDate: "2026-08-13T00:00:00.000Z",
                currency: "MAD",
              },
              {
                invoiceNumber: "INV-2026-0036",
                client: "Should stay hidden",
                balanceDue: 600,
                dueDate: "2026-08-12T00:00:00.000Z",
                currency: "MAD",
              },
            ],
          },
        },
      } as any;
    }

    if (normalizedContent.includes("show invoices")) {
      return {
        message: {
          id: `assistant-invoices-${conversationId}`,
          content: "I am searching invoices.",
        },
        executionResult: {
          type: "tool_result",
          toolName: "search_invoices",
          result: {
            data: [
              {
                invoiceNumber: "INV-2026-0042",
                customerName: "Atlas",
                total: 3600,
                dueDate: "2026-08-19T00:00:00.000Z",
                status: "SENT",
                currency: "MAD",
              },
            ],
            meta: { total: 1 },
          },
        },
      } as any;
    }

    if (normalizedContent.includes("show invoice inv-") || normalizedContent.includes("show invoice inv_")) {
      return {
        message: {
          id: `assistant-invoice-detail-${conversationId}`,
          content: "I am showing the invoice details.",
        },
        executionResult: {
          type: "tool_result",
          toolName: "get_invoice_details",
          result: {
            invoiceId: "invoice-1",
            invoiceNumber: "INV-2026-0003",
            customer: "Atlas",
            total: 1200,
            balanceDue: 1200,
            status: "SENT",
            issueDate: "2026-08-18T00:00:00.000Z",
            dueDate: "2026-08-25T00:00:00.000Z",
            currency: "MAD",
          },
        },
      } as any;
    }

    if (normalizedContent.includes("show my contracts")) {
      return {
        message: {
          id: `assistant-contracts-${conversationId}`,
          content: "I am searching contracts.",
        },
        executionResult: {
          type: "tool_result",
          toolName: "search_contracts",
          result: [
            {
              id: "contract-1",
              contractNumber: "CTR-2026-0042",
              title: "Support annuel",
              client: "Atlas",
              status: "ACTIVE",
            },
          ],
        },
      } as any;
    }

    if (normalizedContent.includes("show contract ctr-")) {
      return {
        message: {
          id: `assistant-contract-detail-${conversationId}`,
          content: "I am showing the contract details.",
        },
        executionResult: {
          type: "tool_result",
          toolName: "get_contract_details",
          result: {
            contract: {
              id: "contract-1",
              contractNumber: "CTR-2026-0588",
              title: "Support annuel",
              client: "Atlas",
              status: "ACTIVE",
              endDate: "2026-09-30T00:00:00.000Z",
              amount: 4200,
              currency: "MAD",
            },
          },
        },
      } as any;
    }

    if (normalizedContent.includes("show quote dev-")) {
      return {
        message: {
          id: `assistant-quote-detail-${conversationId}`,
          content: "I am showing the quote details.",
        },
        executionResult: {
          type: "tool_result",
          toolName: "get_quote_details",
          result: {
            id: "quote-1",
            devisNumber: "DEV-2026-0233",
            status: "SENT",
            customerName: "Atlas",
            total: 1800,
            validUntil: "2026-08-29T00:00:00.000Z",
            currency: "MAD",
          },
        },
      } as any;
    }

    if (
      normalizedContent.includes("invoice") ||
      normalizedContent.includes("facture") ||
      input.content.includes("Ã™ÂÃ˜Â§Ã˜ÂªÃ™Ë†Ã˜Â±Ã˜Â©") ||
      input.content.includes("ÙØ§ØªÙˆØ±Ø©") || input.content.includes("فاتورة")
    ) {
      return buildStructuredForm(
        conversationId,
        language,
        "create_invoice",
        language === "en" ? "Invoice form" : language === "ar" ? "Invoice form" : "Formulaire facture",
        "J'ai retrouve le client. Completez le formulaire facture.",
        [
          { path: "issueDate", label: language === "en" ? "Issue date" : language === "ar" ? "Ã˜ÂªÃ˜Â§Ã˜Â±Ã™Å Ã˜Â® Ã˜Â§Ã™â€žÃ˜Â¥Ã˜ÂµÃ˜Â¯Ã˜Â§Ã˜Â±" : "Date d'emission", type: "date" },
          { path: "dueDate", label: language === "en" ? "Due date" : language === "ar" ? "Ã˜ÂªÃ˜Â§Ã˜Â±Ã™Å Ã˜Â® Ã˜Â§Ã™â€žÃ˜Â§Ã˜Â³Ã˜ÂªÃ˜Â­Ã™â€šÃ˜Â§Ã™â€š" : "Date d'echeance", type: "date" },
          {
            path: "items",
            label: language === "en" ? "Invoice lines" : language === "ar" ? "Ã˜Â³Ã˜Â·Ã™Ë†Ã˜Â± Ã˜Â§Ã™â€žÃ™ÂÃ˜Â§Ã˜ÂªÃ™Ë†Ã˜Â±Ã˜Â©" : "Lignes de facture",
            type: "array",
            itemFields: [
              { path: "description", label: language === "en" ? "Description" : language === "ar" ? "Ã˜Â§Ã™â€žÃ™Ë†Ã˜ÂµÃ™Â" : "Description", type: "text" },
              { path: "quantity", label: language === "en" ? "Quantity" : language === "ar" ? "Ã˜Â§Ã™â€žÃ™Æ’Ã™â€¦Ã™Å Ã˜Â©" : "Quantite", type: "number" },
              { path: "unitPrice", label: language === "en" ? "Unit price" : language === "ar" ? "Ã˜Â³Ã˜Â¹Ã˜Â± Ã˜Â§Ã™â€žÃ™Ë†Ã˜Â­Ã˜Â¯Ã˜Â©" : "Prix unitaire", type: "number" },
              { path: "taxRate", label: language === "en" ? "VAT" : language === "ar" ? "Ã˜Â§Ã™â€žÃ˜Â¶Ã˜Â±Ã™Å Ã˜Â¨Ã˜Â©" : "TVA", type: "number" },
            ],
          },
        ],
        { customerName: "Telegram Client" }
      ) as any;
    }

    if (normalizedContent.includes("contrat") || normalizedContent.includes("contract") || input.content.includes("عقد")) {
      return buildStructuredForm(
        conversationId,
        language,
        "create_contract",
        language === "en" ? "Contract form" : language === "ar" ? "Ã™â€ Ã™â€¦Ã™Ë†Ã˜Â°Ã˜Â¬ Ã˜Â§Ã™â€žÃ˜Â¹Ã™â€šÃ˜Â¯" : "Formulaire contrat",
        "J'ai compris la creation du contrat. Completez le formulaire.",
        [
          { path: "title", label: language === "en" ? "Title" : language === "ar" ? "Ã˜Â§Ã™â€žÃ˜Â¹Ã™â€ Ã™Ë†Ã˜Â§Ã™â€ " : "Titre", type: "text" },
          { path: "clientId", label: language === "en" ? "Customer" : language === "ar" ? "Ã˜Â§Ã™â€žÃ˜Â¹Ã™â€¦Ã™Å Ã™â€ž" : "Client", type: "entity" },
        ]
      ) as any;
    }

    if (normalizedContent.includes("note de frais") || normalizedContent.includes("expense") || input.content.includes("مصروف")) {
      return buildStructuredForm(
        conversationId,
        language,
        "create_expense",
        language === "en" ? "Expense form" : language === "ar" ? "Ã™â€ Ã™â€¦Ã™Ë†Ã˜Â°Ã˜Â¬ Ã˜Â§Ã™â€žÃ™â€¦Ã˜ÂµÃ˜Â±Ã™Ë†Ã™Â" : "Formulaire note de frais",
        "J'ai compris la creation de la note de frais. Completez le formulaire.",
        [
          { path: "expenseDate", label: language === "en" ? "Expense date" : language === "ar" ? "Ã˜ÂªÃ˜Â§Ã˜Â±Ã™Å Ã˜Â® Ã˜Â§Ã™â€žÃ™â€¦Ã˜ÂµÃ˜Â±Ã™Ë†Ã™Â" : "Date de frais", type: "date" },
          { path: "amountTTC", label: language === "en" ? "Amount TTC" : language === "ar" ? "Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â¨Ã™â€žÃ˜Âº Ã˜Â§Ã™â€žÃ˜Â¥Ã˜Â¬Ã™â€¦Ã˜Â§Ã™â€žÃ™Å " : "Montant TTC", type: "number" },
        ]
      ) as any;
    }

    if (normalizedContent.includes("devis") || normalizedContent.includes("quote") || input.content.includes("عرض سعر")) {
      return buildStructuredForm(
        conversationId,
        language,
        "create_quote",
        language === "en" ? "Quote form" : language === "ar" ? "Ã™â€ Ã™â€¦Ã™Ë†Ã˜Â°Ã˜Â¬ Ã˜Â¹Ã˜Â±Ã˜Â¶ Ã˜Â§Ã™â€žÃ˜Â³Ã˜Â¹Ã˜Â±" : "Formulaire devis",
        "J'ai compris la creation du devis. Completez le formulaire.",
        [
          { path: "customerId", label: language === "en" ? "Customer" : language === "ar" ? "Ã˜Â§Ã™â€žÃ˜Â¹Ã™â€¦Ã™Å Ã™â€ž" : "Client", type: "entity" },
          { path: "issueDate", label: language === "en" ? "Issue date" : language === "ar" ? "Ã˜ÂªÃ˜Â§Ã˜Â±Ã™Å Ã˜Â® Ã˜Â§Ã™â€žÃ˜Â¥Ã˜ÂµÃ˜Â¯Ã˜Â§Ã˜Â±" : "Date d'emission", type: "date" },
        ]
      ) as any;
    }

    if ((normalizedContent.includes("client") && !normalizedContent.includes("invoice") && !normalizedContent.includes("facture")) || normalizedContent.includes("customer") || input.content.includes("عميل")) {
      return buildStructuredForm(
        conversationId,
        language,
        "create_customer",
        language === "en" ? "Customer form" : language === "ar" ? "Ã™â€ Ã™â€¦Ã™Ë†Ã˜Â°Ã˜Â¬ Ã˜Â§Ã™â€žÃ˜Â¹Ã™â€¦Ã™Å Ã™â€ž" : "Formulaire client",
        "J'ai compris la creation du client. Completez le formulaire.",
        [
          { path: "name", label: language === "en" ? "Name" : language === "ar" ? "Ã˜Â§Ã™â€žÃ˜Â§Ã˜Â³Ã™â€¦" : "Nom", type: "text" },
          { path: "email", label: language === "en" ? "Email" : language === "ar" ? "Ã˜Â§Ã™â€žÃ˜Â¨Ã˜Â±Ã™Å Ã˜Â¯ Ã˜Â§Ã™â€žÃ˜Â¥Ã™â€žÃ™Æ’Ã˜ÂªÃ˜Â±Ã™Ë†Ã™â€ Ã™Å " : "Email", type: "text" },
        ]
      ) as any;
    }

    if (normalizedContent.includes("produit") || normalizedContent.includes("product") || input.content.includes("منتج")) {
      return buildStructuredForm(
        conversationId,
        language,
        "create_product",
        language === "en" ? "Product form" : language === "ar" ? "Ã™â€ Ã™â€¦Ã™Ë†Ã˜Â°Ã˜Â¬ Ã˜Â§Ã™â€žÃ™â€¦Ã™â€ Ã˜ÂªÃ˜Â¬" : "Formulaire produit",
        "J'ai compris la creation du produit. Completez le formulaire.",
        [{ path: "name", label: language === "en" ? "Name" : language === "ar" ? "Ã˜Â§Ã™â€žÃ˜Â§Ã˜Â³Ã™â€¦" : "Nom", type: "text" }]
      ) as any;
    }

    return {
      message: {
        id: `assistant-generic-${conversationId}`,
        content: language === "en" ? "Ready." : language === "ar" ? "Ã˜Â¬Ã˜Â§Ã™â€¡Ã˜Â²." : "Pret.",
      },
      executionResult: null,
    } as any;
  }) as typeof aiAssistantService.sendMessage;

  aiAssistantService.previewMessagePlan = (async (_user, _conversationId, input) => {
    const normalizedContent = input.content.toLowerCase();
    if (
      normalizedContent.includes("invoice") ||
      normalizedContent.includes("facture") ||
      input.content.includes("Ã™ÂÃ˜Â§Ã˜ÂªÃ™Ë†Ã˜Â±Ã˜Â©") ||
      input.content.includes("ÙØ§ØªÙˆØ±Ø©") || input.content.includes("فاتورة")
    ) {
      return { intent: "create_invoice_form", toolName: "create_invoice", toolInput: {}, semanticIntent: null, isWrite: true };
    }
    if (normalizedContent.includes("contrat") || normalizedContent.includes("contract") || input.content.includes("عقد")) {
      return { intent: "create_contract_form", toolName: "create_contract", toolInput: {}, semanticIntent: null, isWrite: true };
    }
    if (normalizedContent.includes("note de frais") || normalizedContent.includes("expense") || input.content.includes("مصروف")) {
      return { intent: "create_expense_form", toolName: "create_expense", toolInput: {}, semanticIntent: null, isWrite: true };
    }
    if (normalizedContent.includes("devis") || normalizedContent.includes("quote") || input.content.includes("عرض سعر")) {
      return { intent: "create_quote_form", toolName: "create_quote", toolInput: {}, semanticIntent: null, isWrite: true };
    }
    if ((normalizedContent.includes("client") && !normalizedContent.includes("invoice") && !normalizedContent.includes("facture")) || normalizedContent.includes("customer") || input.content.includes("عميل")) {
      return { intent: "create_customer_form", toolName: "create_customer", toolInput: {}, semanticIntent: null, isWrite: true };
    }
    if (normalizedContent.includes("produit") || normalizedContent.includes("product") || input.content.includes("منتج")) {
      return { intent: "create_product_form", toolName: "create_product", toolInput: {}, semanticIntent: null, isWrite: true };
    }
    if (normalizedContent.includes("feuille de temps") || normalizedContent.includes("timesheet")) {
      return { intent: "create_timesheet_form", toolName: "create_timesheet", toolInput: {}, semanticIntent: null, isWrite: true };
    }
    return { intent: null, toolName: null, toolInput: null, semanticIntent: null, isWrite: false };
  }) as typeof aiAssistantService.previewMessagePlan;

  aiAssistantService.previewStructuredFormContinuation = (async (input) => {
    const message = input.message.toLowerCase();
    const hasInvoiceFieldValues =
      message.includes("2026-08-12")
      || message.includes("2026-08-30")
      || message.includes("website development")
      || message.includes("1000")
      || message.includes("vat 20")
      || message.includes("20 ao")
      || message.includes("3000")
      || message.includes("tva 20");

    if (hasInvoiceFieldValues) {
      return {
        extracted: { issueDate: "2026-08-12" },
        matchedMissingFields: ["issueDate"],
        hasMeaningfulValues: true,
      };
    }

    return {
      extracted: {},
      matchedMissingFields: [],
      hasMeaningfulValues: false,
    };
  }) as typeof aiAssistantService.previewStructuredFormContinuation;

  aiAssistantService.continueStructuredForm = (async (_user, input) => {
    continueStructuredFormCalls.push({ toolName: input.toolName, message: input.message });
    return {
      type: "pending_action",
      toolName: input.toolName,
      action: {
        id: "ai-pending-telegram-001",
        previewPayload: {
          summary: {
            customer: "Telegram Client",
            total: "1,200.00 MAD",
            status: "DRAFT",
          },
        },
      },
    } as any;
  }) as typeof aiAssistantService.continueStructuredForm;

  const activeUser = await prisma.user.create({
    data: {
      name: "Telegram Active User",
      email: activeEmail,
      passwordHash: "not-used",
      role: Role.ADMIN,
    },
  });

  const disabledUser = await prisma.user.create({
    data: {
      name: "Telegram Disabled User",
      email: disabledEmail,
      passwordHash: "not-used",
      role: Role.EMPLOYEE,
      isActive: false,
    },
  });

  const documentCustomer = await prisma.customer.create({
    data: {
      createdById: activeUser.id,
      name: "Telegram Document Client",
      email: `telegram-doc-${runId}@example.com`,
      company: "Telegram Document Client SARL",
      country: "Morocco",
      countryCode: "MA",
    },
  });

  const invoiceDocument = await prisma.invoice.create({
    data: {
      customerId: documentCustomer.id,
      createdById: activeUser.id,
      invoiceNumber: `INV-TG-DOC-${runId}`,
      status: "DRAFT",
      issueDate: new Date("2026-08-19"),
      dueDate: new Date("2026-08-30"),
      subtotal: 1000,
      taxRate: 20,
      taxAmount: 200,
      customerCountry: "Morocco",
      customerCountryCode: "MA",
      discount: 0,
      total: 1200,
      amountPaid: 0,
      balanceDue: 1200,
      currency: "MAD",
      items: {
        create: [
          {
            description: "Telegram invoice line",
            quantity: 1,
            unitPrice: 1000,
            taxRate: 20,
            total: 1200,
            sortOrder: 1,
          },
        ],
      },
    },
  });

  const devisDocument = await prisma.devis.create({
    data: {
      devisNumber: `DEV-TG-DOC-${runId}`,
      companyId: 1,
      customerId: documentCustomer.id,
      createdById: activeUser.id,
      status: "DRAFT",
      issueDate: new Date("2026-08-19"),
      validUntil: new Date("2026-08-30"),
      subtotal: 1000,
      taxRate: 20,
      taxAmount: 200,
      customerCountry: "Morocco",
      customerCountryCode: "MA",
      discount: 0,
      total: 1200,
      currency: "MAD",
      items: {
        create: [
          {
            description: "Telegram quote line",
            quantity: 1,
            unitPrice: 1000,
            discount: 0,
            taxRate: 20,
            lineTotal: 1200,
            sortOrder: 1,
          },
        ],
      },
    },
  });

  try {
    const firstCode = await createTelegramLinkCode(activeUser.id);
    const reusedCode = await createTelegramLinkCode(activeUser.id);
    assert.equal(reusedCode.code, firstCode.code);

    await prisma.telegramLinkCode.update({
      where: { code: firstCode.code },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const replacedCode = await createTelegramLinkCode(activeUser.id);
    assert.notEqual(replacedCode.code, firstCode.code);

    sentMessages.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: "/code", languageCode: "en" }));
    assert.match(sentMessages.at(-1)?.text ?? "", /email address of your ERP account/i);

    await handleTelegramUpdate(buildUpdate({ text: activeEmail, languageCode: "en" }));
    assert.equal(sentEmails.length, 1);
    assert.match(sentMessages.at(-1)?.text ?? "", /If this email belongs to an active ERP account/i);

    await handleTelegramUpdate(buildUpdate({ text: "/code", chatId: "7002", telegramUserId: "9002", languageCode: "fr" }));
    await handleTelegramUpdate(buildUpdate({ text: "unknown-user@example.com", chatId: "7002", telegramUserId: "9002", languageCode: "fr" }));
    assert.equal(sentEmails.length, 1);
    assert.match(sentMessages.at(-1)?.text ?? "", /Si cet e-mail correspond/i);

    sentMessages.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: "/link TG-INVALID", chatId: "7003", telegramUserId: "9003", languageCode: "fr" }));
    assert.match(sentMessages.at(-1)?.text ?? "", /Code de liaison invalide/i);

    const disabledCode = await createTelegramLinkCode(disabledUser.id);
    sentMessages.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: `/link ${disabledCode.code}`, chatId: "7004", telegramUserId: "9004", languageCode: "fr" }));
    assert.match(sentMessages.at(-1)?.text ?? "", /n.?est plus actif/i);

    sentMessages.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: `/link ${replacedCode.code}`, languageCode: "en" }));
    assert.match(sentMessages.at(-1)?.text ?? "", /securely linked/i);

    const account = await prisma.telegramAccount.findFirstOrThrow({
      where: { userId: activeUser.id },
    });
    assert.equal(account.telegramUserId, "9001");
    assert.equal(account.telegramChatId, "7001");

    const usedCode = await prisma.telegramLinkCode.findUniqueOrThrow({ where: { code: replacedCode.code } });
    assert.ok(usedCode.usedAt);

    sentMessages.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: "Create invoice for Telegram Client", languageCode: "en" }));
    const structuredReply = sentMessages.at(-1)?.text ?? "";
    assert.match(structuredReply, /Invoice form/i);
    assert.match(structuredReply, /Issue date/i);
    assert.match(structuredReply, /Description, Quantity, Unit price, VAT/i);

    const storedSession = await prisma.telegramSession.findUniqueOrThrow({ where: { telegramChatId: "7001" } });
    assert.equal(storedSession.pendingToolName, "create_invoice");
    assert.equal(storedSession.language, "en");
    assert.ok(storedSession.conversationId);

    sentMessages.length = 0;
    continueStructuredFormCalls.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: "Issue date 2026-08-12 due date 2026-08-30 line Website development 1 x 1000 VAT 20", languageCode: "en" }));
    const previewReply = sentMessages.at(-1)?.text ?? "";
    assert.equal(continueStructuredFormCalls.length, 1);
    assert.equal(continueStructuredFormCalls[0]?.toolName, "create_invoice");
    assert.match(previewReply, /Preview ready/i);
    assert.match(previewReply, /\/confirm ai-pending-telegram-001/i);

    const clearedAfterPending = await prisma.telegramSession.findUniqueOrThrow({ where: { telegramChatId: "7001" } });
    assert.equal(clearedAfterPending.pendingToolName, null);

    sentMessages.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: "Show unpaid invoices", languageCode: "en" }));
    const unpaidReply = sentMessages.at(-1)?.text ?? "";
    assert.match(unpaidReply, /Unpaid invoices/i);
    assert.match(unpaidReply, /6 invoice\(s\)|6 facture\(s\)/i);
    assert.match(unpaidReply, /Showing 1–5 of 6|Affichage 1–5 sur 6/i);
    assert.match(unpaidReply, /INV-2026-0042/);
    assert.match(unpaidReply, /Atlas/);
    assert.match(unpaidReply, /3[\s\u202f]600,00 MAD/);
    assert.match(unpaidReply, /19\/08\/2026/);
    assert.match(unpaidReply, /Overdue|En retard/);
    assert.match(unpaidReply, /7[\s\u202f]700,00 MAD/);
    assert.match(unpaidReply, /Total outstanding/i);
    assert.doesNotMatch(unpaidReply, /INV-2026-0036/);

    sentMessages.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: "Show invoices", languageCode: "en" }));
    const invoicesReply = sentMessages.at(-1)?.text ?? "";
    assert.match(invoicesReply, /Invoices/i);
    assert.match(invoicesReply, /1 invoice\(s\)|1 facture\(s\)/i);
    assert.match(invoicesReply, /INV-2026-0042/);
    assert.match(invoicesReply, /3[\s\u202f]600,00 MAD/);
    assert.match(invoicesReply, /19\/08\/2026/);
    assert.match(invoicesReply, /Status: Sent|Statut: Envoyée|Statut : Envoyée|Status : Sent/i);
    assert.doesNotMatch(invoicesReply, /\bSENT\b/);

    sentMessages.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: "Show my contracts", languageCode: "en" }));
    const contractsReply = sentMessages.at(-1)?.text ?? "";
    assert.match(contractsReply, /Contracts/i);
    assert.match(contractsReply, /1 contract\(s\)|1 contrat\(s\)/i);
    assert.match(contractsReply, /CTR-2026-0042/);
    assert.match(contractsReply, /Status: Active|Statut: Actif|Statut : Actif/i);
    assert.doesNotMatch(contractsReply, /\bACTIVE\b/);

    sentMessages.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: "Show invoice INV_2026_0003", languageCode: "en" }));
    const invoiceDetailReply = sentMessages.at(-1)?.text ?? "";
    assert.match(invoiceDetailReply, /INV-2026-0003/);
    assert.match(invoiceDetailReply, /Atlas/);
    assert.match(invoiceDetailReply, /1[\s\u202f]200,00 MAD/);

    sentMessages.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: "Show contract CTR-2026-0588", languageCode: "en" }));
    const contractDetailReply = sentMessages.at(-1)?.text ?? "";
    assert.match(contractDetailReply, /CTR-2026-0588/);
    assert.match(contractDetailReply, /Atlas/);
    assert.match(contractDetailReply, /Actif|Active/i);

    sentMessages.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: "Show quote DEV-2026-0233", languageCode: "en" }));
    const quoteDetailReply = sentMessages.at(-1)?.text ?? "";
    assert.match(quoteDetailReply, /DEV-2026-0233/);
    assert.match(quoteDetailReply, /Atlas/);
    assert.match(quoteDetailReply, /1[\s\u202f]800,00 MAD/);

    sentMessages.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: "Create invoice for Telegram Client", languageCode: "en" }));
    assert.match(sentMessages.at(-1)?.text ?? "", /Invoice form/i);

    sentMessages.length = 0;
    continueStructuredFormCalls.length = 0;
    await handleTelegramUpdate(
      buildUpdate({
        voice: {
          fileId: "voice-ambiguous-transcript",
          fileSize: 1024,
          mimeType: "audio/ogg",
        },
        languageCode: "fr",
      })
    );
    assert.equal(continueStructuredFormCalls.length, 0);
    assert.match(sentMessages.at(-1)?.text ?? "", /continuer le formulaire en cours|start a new action/i);
    const ambiguousPendingSession = await prisma.telegramSession.findUniqueOrThrow({ where: { telegramChatId: "7001" } });
    assert.equal(ambiguousPendingSession.pendingToolName, "create_invoice");

    sentMessages.length = 0;
    continueStructuredFormCalls.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: "Créer un contrat", languageCode: "en" }));
    assert.equal(continueStructuredFormCalls.length, 0);
    assert.match(sentMessages.at(-1)?.text ?? "", /Contract form|Formulaire contrat/i);
    const contractOverrideSession = await prisma.telegramSession.findUniqueOrThrow({ where: { telegramChatId: "7001" } });
    assert.equal(contractOverrideSession.pendingToolName, "create_contract");

    sentMessages.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: "Create invoice for Telegram Client", languageCode: "en" }));
    assert.match(sentMessages.at(-1)?.text ?? "", /Invoice form/i);

    sentMessages.length = 0;
    continueStructuredFormCalls.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: "Créer une note de frais", languageCode: "en" }));
    assert.equal(continueStructuredFormCalls.length, 0);
    assert.match(sentMessages.at(-1)?.text ?? "", /Expense form|Formulaire note de frais/i);
    const expenseOverrideSession = await prisma.telegramSession.findUniqueOrThrow({ where: { telegramChatId: "7001" } });
    assert.equal(expenseOverrideSession.pendingToolName, "create_expense");

    sentMessages.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: "Créer un contrat", languageCode: "en" }));
    assert.match(sentMessages.at(-1)?.text ?? "", /Contract form|Formulaire contrat/i);

    sentMessages.length = 0;
    continueStructuredFormCalls.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: "Créer une facture", languageCode: "en" }));
    assert.equal(continueStructuredFormCalls.length, 0);
    assert.match(sentMessages.at(-1)?.text ?? "", /Invoice form|Formulaire facture/i);
    const invoiceOverrideSession = await prisma.telegramSession.findUniqueOrThrow({ where: { telegramChatId: "7001" } });
    assert.equal(invoiceOverrideSession.pendingToolName, "create_invoice");

    sentMessages.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: "/cancel", languageCode: "en" }));
    assert.match(sentMessages.at(-1)?.text ?? "", /pending form has been cancelled|formulaire en attente.*annul/i);
    const cancelledSession = await prisma.telegramSession.findUniqueOrThrow({ where: { telegramChatId: "7001" } });
    assert.equal(cancelledSession.pendingToolName, null);

    sentMessages.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: "Create invoice for Telegram Client", languageCode: "en" }));
    assert.match(sentMessages.at(-1)?.text ?? "", /Invoice form/i);

    sentMessages.length = 0;
    transcriptRequests.length = 0;
    transcriptionModels.length = 0;
    transcriptionPrompts.length = 0;
    transcriptionLanguageParams.length = 0;
    await handleTelegramUpdate(
      buildUpdate({
        voice: {
          fileId: "voice-form-complete",
          fileSize: 1024,
          mimeType: "audio/ogg",
        },
        languageCode: "en",
      })
    );
    assert.equal(transcriptRequests.at(-1), "voice-form-complete.bin");
    assert.equal(transcriptionModels.at(-1), "whisper-1");
    assert.equal(transcriptionLanguageParams.at(-1), null);
    assert.match(transcriptionPrompts.at(-1) ?? "", /Transcribe the audio exactly as spoken/i);
    assert.match(transcriptionPrompts.at(-1) ?? "", /Créer une facture, Créer un contrat, Créer une note de frais/i);
    assert.match(transcriptionPrompts.at(-1) ?? "", /Create an invoice, Create a contract, Create an expense/i);
    assert.match(transcriptionPrompts.at(-1) ?? "", /إنشاء فاتورة، إنشاء عقد، إنشاء مصروف|ÙØ§ØªÙˆØ±Ø©/);
    assert.match(sentMessages[0]?.text ?? "", /Voice message received\. Transcribing/i);
    assert.match(sentMessages[1]?.text ?? "", /I understood: Issue date 2026-08-12 due date 2026-08-30/i);
    assert.match(sentMessages.at(-1)?.text ?? "", /Preview ready/i);
    assert.match(sentMessages.at(-1)?.text ?? "", /\/confirm ai-pending-telegram-001/i);

    sentMessages.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: "/confirm ai-pending-telegram-001", languageCode: "en" }));
    const confirmReply = sentMessages.at(-1)?.text ?? "";
    assert.equal(confirmCalls.length, 1);
    assert.match(confirmReply, /INV-TG-0001/);
    assert.match(confirmReply, /Telegram Client/);

    sentMessages.length = 0;
    editedMessages.length = 0;
    answeredCallbacks.length = 0;
    await handleTelegramUpdate(buildCallbackUpdate({ data: "ai:confirm:ai-pending-telegram-002", languageCode: "en", messageId: 777 }));
    assert.equal(confirmCalls.length, 2);
    assert.equal(answeredCallbacks.at(-1)?.id, "callback-777");
    assert.match(sentMessages.at(-1)?.text ?? "", /INV-TG-0001/);

    sentDocuments.length = 0;
    answeredCallbacks.length = 0;
    await handleTelegramUpdate(buildCallbackUpdate({ data: `doc:pdf:invoice:${invoiceDocument.id}`, languageCode: "en", messageId: 779 }));
    assert.equal(answeredCallbacks.at(-1)?.id, "callback-779");
    assert.equal(sentDocuments.at(-1)?.fileName, `${invoiceDocument.invoiceNumber}.pdf`);

    sentDocuments.length = 0;
    answeredCallbacks.length = 0;
    await handleTelegramUpdate(buildCallbackUpdate({ data: `doc:pdf:quote:${devisDocument.id}`, languageCode: "fr", messageId: 780 }));
    assert.equal(answeredCallbacks.at(-1)?.id, "callback-780");
    assert.equal(sentDocuments.at(-1)?.fileName, `${devisDocument.devisNumber}.pdf`);

    sentDocuments.length = 0;
    answeredCallbacks.length = 0;
    await handleTelegramUpdate(buildCallbackUpdate({ data: "doc:pdf:contract:contract-doc-001", languageCode: "en", messageId: 781 }));
    assert.equal(answeredCallbacks.at(-1)?.id, "callback-781");
    assert.equal(sentDocuments.at(-1)?.fileName, "CTR-TG-0001.pdf");

    sentDocuments.length = 0;
    answeredCallbacks.length = 0;
    await handleTelegramUpdate(buildCallbackUpdate({ data: "doc:pdf:credit_note:credit-doc-001", languageCode: "en", messageId: 782 }));
    assert.equal(answeredCallbacks.at(-1)?.id, "callback-782");
    assert.equal(sentDocuments.at(-1)?.fileName, "AV-TG-0001.pdf");

    sentDocuments.length = 0;
    answeredCallbacks.length = 0;
    await handleTelegramUpdate(buildCallbackUpdate({ data: "doc:pdf:expense:expense-doc-001", languageCode: "en", messageId: 783 }));
    assert.equal(answeredCallbacks.at(-1)?.id, "callback-783");
    assert.equal(sentDocuments.at(-1)?.fileName, "EXP-TG-0001.pdf");

    sentMessages.length = 0;
    answeredCallbacks.length = 0;
    await handleTelegramUpdate(buildCallbackUpdate({ data: `doc:email:invoice:${invoiceDocument.id}`, languageCode: "en", messageId: 784 }));
    assert.equal(answeredCallbacks.at(-1)?.id, "callback-784");
    assert.match(sentMessages.at(-1)?.text ?? "", /email/i);
    assert.match(sentMessages.at(-1)?.text ?? "", new RegExp(invoiceDocument.invoiceNumber));

    sentMessages.length = 0;
    answeredCallbacks.length = 0;
    await handleTelegramUpdate(buildCallbackUpdate({ data: `doc:email:quote:${devisDocument.id}`, languageCode: "fr", messageId: 785 }));
    assert.equal(answeredCallbacks.at(-1)?.id, "callback-785");
    assert.match(sentMessages.at(-1)?.text ?? "", /e-mail|email/i);
    assert.match(sentMessages.at(-1)?.text ?? "", new RegExp(devisDocument.devisNumber));

    const quoteEmailAction = await prisma.aiPendingAction.findFirstOrThrow({
      where: { toolName: "send_quote_email", userId: activeUser.id },
      orderBy: { createdAt: "desc" },
    });
    const originalConfirmActionForFailure = aiAssistantService.confirmAction.bind(aiAssistantService);
    aiAssistantService.confirmAction = (async (_user, actionId) => {
      if (actionId === quoteEmailAction.id) {
        throw new Error("forced quote email failure");
      }
      return originalConfirmActionForFailure(_user, actionId);
    }) as typeof aiAssistantService.confirmAction;
    sentMessages.length = 0;
    answeredCallbacks.length = 0;
    await handleTelegramUpdate(buildCallbackUpdate({ data: `ai:confirm:${quoteEmailAction.id}`, languageCode: "fr", messageId: 786 }));
    assert.equal(answeredCallbacks.at(-1)?.id, "callback-786");
    assert.match(sentMessages.at(-1)?.text ?? "", /impossible|could not|n.?ai pas pu traiter/i);
    aiAssistantService.confirmAction = originalConfirmActionForFailure;

    const callbackSession = await prisma.telegramSession.findUniqueOrThrow({ where: { telegramChatId: "7001" } });
    const pendingCallbackAction = await prisma.aiPendingAction.create({
      data: {
        userId: activeUser.id,
        conversationId: callbackSession.conversationId!,
        toolName: "create_invoice",
        inputPayload: {
          customerId: "customer-telegram",
          issueDate: "2026-08-19",
          dueDate: "2026-09-19",
          currency: "MAD",
          items: [{ description: "Website development", quantity: 1, unitPrice: 1000, taxRate: 20 }],
        } as any,
        previewPayload: {
          title: "Create invoice",
          summary: { customer: "Telegram Client", total: "1,200.00 MAD" },
        } as any,
        riskLevel: AiToolRiskLevel.CONFIRMATION_REQUIRED,
        requiredPermission: "invoices.create",
        idempotencyKey: `telegram-cancel-${runId}`,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
    sentMessages.length = 0;
    editedMessages.length = 0;
    answeredCallbacks.length = 0;
    await handleTelegramUpdate(buildCallbackUpdate({ data: `ai:cancel:${pendingCallbackAction.id}`, languageCode: "en", messageId: 778 }));
    const cancelledAction = await prisma.aiPendingAction.findUniqueOrThrow({ where: { id: pendingCallbackAction.id } });
    assert.equal(cancelledAction.status, AiActionStatus.CANCELLED);
    assert.equal(answeredCallbacks.at(-1)?.id, "callback-778");

    sentMessages.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: "/unlink", languageCode: "en" }));
    assert.match(sentMessages.at(-1)?.text ?? "", /unlinked/i);
    const accountAfterUnlink = await prisma.telegramAccount.findFirst({ where: { userId: activeUser.id } });
    assert.equal(accountAfterUnlink, null);

    sentMessages.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: "Create invoice again", languageCode: "en" }));
    assert.match(sentMessages.at(-1)?.text ?? "", /not linked/i);

    const secondLinkCode = await createTelegramLinkCode(activeUser.id);
    sentMessages.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: `/link ${secondLinkCode.code}`, chatId: "7005", telegramUserId: "9005", languageCode: "ar" }));
    sentMessages.length = 0;
    transcriptRequests.length = 0;
    await handleTelegramUpdate(
      buildUpdate({
        voice: {
          fileId: "voice-create-invoice-ar",
          fileSize: 1024,
          mimeType: "audio/ogg",
        },
        chatId: "7005",
        telegramUserId: "9005",
        languageCode: "ar",
      })
    );
    const arabicSession = await prisma.telegramSession.findUniqueOrThrow({ where: { telegramChatId: "7005" } });
    assert.equal(arabicSession.language, "ar");
    assert.equal(transcriptRequests.at(-1), "voice-create-invoice-ar.bin");
    assert.match(sentMessages[1]?.text ?? "", /فهمت:|ÙÙ‡Ù…Øª:/);
    assert.match(sentMessages[1]?.text ?? "", /Test AI Client/);
    assert.match(sentMessages.at(-1)?.text ?? "", /نموذج الفاتورة|تاريخ الإصدار|Ù†Ù…ÙˆØ°Ø¬ Ø§Ù„ÙØ§ØªÙˆØ±Ø©|ØªØ§Ø±ÙŠØ® Ø§Ù„Ø¥ØµØ¯Ø§Ø±|Invoice form|Formulaire facture/);

    const frenchLinkCode = await createTelegramLinkCode(activeUser.id);
    sentMessages.length = 0;
    transcriptRequests.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: `/link ${frenchLinkCode.code}`, chatId: "7007", telegramUserId: "9007", languageCode: "fr" }));
    sentMessages.length = 0;
    await handleTelegramUpdate(
      buildUpdate({
        voice: {
          fileId: "voice-create-invoice-fr",
          fileSize: 1024,
          mimeType: "audio/ogg",
        },
        chatId: "7007",
        telegramUserId: "9007",
        languageCode: "fr",
      })
    );
    assert.equal(transcriptRequests.at(-1), "voice-create-invoice-fr.bin");
    assert.match(sentMessages[1]?.text ?? "", /facture pour Test AI Client/);
    assert.match(sentMessages.at(-1)?.text ?? "", /Formulaire facture|Invoice form/);

    sentMessages.length = 0;
    sentMessages.length = 0;
    continueStructuredFormCalls.length = 0;
    await handleTelegramUpdate(
      buildUpdate({
        voice: {
          fileId: "voice-create-contract-fr",
          fileSize: 1024,
          mimeType: "audio/ogg",
        },
        chatId: "7007",
        telegramUserId: "9007",
        languageCode: "fr",
      })
    );
    assert.equal(continueStructuredFormCalls.length, 0);
    assert.match(sentMessages[1]?.text ?? "", /Cr.{0,6}er un contrat|create a contract|contract/i);
    assert.match(sentMessages.at(-1)?.text ?? "", /Formulaire contrat|Contract form/i);
    const voiceOverrideSession = await prisma.telegramSession.findUniqueOrThrow({ where: { telegramChatId: "7007" } });
    assert.equal(voiceOverrideSession.pendingToolName, "create_contract");

    const englishContractLinkCode = await createTelegramLinkCode(activeUser.id);
    sentMessages.length = 0;
    transcriptRequests.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: `/link ${englishContractLinkCode.code}`, chatId: "7008", telegramUserId: "9008", languageCode: "en" }));
    sentMessages.length = 0;
    await handleTelegramUpdate(
      buildUpdate({
        voice: {
          fileId: "voice-create-contract-en",
          fileSize: 1024,
          mimeType: "audio/ogg",
        },
        chatId: "7008",
        telegramUserId: "9008",
        languageCode: "en",
      })
    );
    assert.equal(transcriptRequests.at(-1), "voice-create-contract-en.bin");
    assert.match(sentMessages.at(-1)?.text ?? "", /Contract form|Formulaire contrat/i);
    const englishContractSession = await prisma.telegramSession.findUniqueOrThrow({ where: { telegramChatId: "7008" } });
    assert.equal(englishContractSession.pendingToolName, "create_contract");

    const arabicContractLinkCode = await createTelegramLinkCode(activeUser.id);
    sentMessages.length = 0;
    transcriptRequests.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: `/link ${arabicContractLinkCode.code}`, chatId: "7009", telegramUserId: "9009", languageCode: "ar" }));
    sentMessages.length = 0;
    await handleTelegramUpdate(
      buildUpdate({
        voice: {
          fileId: "voice-create-contract-ar",
          fileSize: 1024,
          mimeType: "audio/ogg",
        },
        chatId: "7009",
        telegramUserId: "9009",
        languageCode: "ar",
      })
    );
    assert.equal(transcriptRequests.at(-1), "voice-create-contract-ar.bin");
    assert.match(sentMessages.at(-1)?.text ?? "", /creation du contrat|Contract form|Formulaire contrat|عقد/i);
    const arabicContractSession = await prisma.telegramSession.findUniqueOrThrow({ where: { telegramChatId: "7009" } });
    assert.equal(arabicContractSession.pendingToolName, "create_contract");

    const thirdLinkCode = await createTelegramLinkCode(activeUser.id);
    sentMessages.length = 0;
    transcriptRequests.length = 0;
    telegramFileRequests.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: `/link ${thirdLinkCode.code}`, chatId: "7006", telegramUserId: "9006", languageCode: "en" }));
    sentMessages.length = 0;
    await handleTelegramUpdate(
      buildUpdate({
        audio: {
          fileId: "audio-create-invoice",
          fileName: "telegram-audio.mp3",
          fileSize: 2048,
          mimeType: "audio/mpeg",
        },
        chatId: "7006",
        telegramUserId: "9006",
        languageCode: "en",
      })
    );
    assert.equal(telegramFileRequests.at(-1), "audio-create-invoice");
    assert.equal(transcriptRequests.at(-1), "audio-create-invoice.bin");
    assert.match(sentMessages[1]?.text ?? "", /I understood: Create invoice for Telegram Client/i);
    assert.match(sentMessages.at(-1)?.text ?? "", /Invoice form/i);

    const frenchContinuationLinkCode = await createTelegramLinkCode(activeUser.id);
    sentMessages.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: `/link ${frenchContinuationLinkCode.code}`, chatId: "7007", telegramUserId: "9007", languageCode: "fr" }));
    sentMessages.length = 0;
    await handleTelegramUpdate(buildUpdate({ text: "Create invoice for Telegram Client", chatId: "7007", telegramUserId: "9007", languageCode: "fr" }));
    assert.match(sentMessages.at(-1)?.text ?? "", /Formulaire facture|Invoice form/);

    sentMessages.length = 0;
    transcriptRequests.length = 0;
    await handleTelegramUpdate(
      buildUpdate({
        voice: {
          fileId: "voice-form-complete-fr",
          fileSize: 1024,
          mimeType: "audio/ogg",
        },
        chatId: "7007",
        telegramUserId: "9007",
        languageCode: "fr",
      })
    );
    assert.equal(transcriptRequests.at(-1), "voice-form-complete-fr.bin");
    assert.match(sentMessages[1]?.text ?? "", /J.?ai compris.*Date d.?[ée]ch[ée]ance 20 ao.?t 2026/i);
    assert.match(sentMessages.at(-1)?.text ?? "", /Prévisualisation prête|PrÃ©visualisation prÃªte|Preview ready/i);
    assert.match(sentMessages.at(-1)?.text ?? "", /\/confirm ai-pending-telegram-001/i);

    sentMessages.length = 0;
    await handleTelegramUpdate(
      buildUpdate({
        voice: {
          fileId: "voice-transcription-fail",
          fileSize: 1024,
          mimeType: "audio/ogg",
        },
        chatId: "7007",
        telegramUserId: "9007",
        languageCode: "en",
      })
    );
    assert.match(sentMessages.at(-1)?.text ?? "", /could not process this audio message|n.?ai pas pu traiter ce message audio/i);

    sentMessages.length = 0;
    await handleTelegramUpdate(
      buildUpdate({
        voice: {
          fileId: "voice-empty-transcript",
          fileSize: 1024,
          mimeType: "audio/ogg",
        },
        chatId: "7007",
        telegramUserId: "9007",
        languageCode: "en",
      })
    );
    assert.match(sentMessages.at(-1)?.text ?? "", /could not detect usable speech|n.?ai pas compris de texte exploitable/i);

    sentMessages.length = 0;
    await handleTelegramUpdate(
      buildUpdate({
        voice: {
          fileId: "voice-too-large",
          fileSize: 11 * 1024 * 1024,
          mimeType: "audio/ogg",
        },
        chatId: "7007",
        telegramUserId: "9007",
        languageCode: "en",
      })
    );
    assert.match(sentMessages.at(-1)?.text ?? "", /audio file exceeds the allowed limit|fichier audio d.passe la limite|fichier audio dépasse la limite/i);

    sentMessages.length = 0;
    await handleTelegramUpdate(
      buildUpdate({
        voice: {
          fileId: "voice-unsupported",
          fileSize: 1024,
          mimeType: "audio/flac",
        },
        chatId: "7007",
        telegramUserId: "9007",
        languageCode: "en",
      })
    );
    assert.match(sentMessages.at(-1)?.text ?? "", /format is not supported|format n.?est pas pris en charge/i);

    sentMessages.length = 0;
    await handleTelegramUpdate(
      buildUpdate({
        voice: {
          fileId: "voice-unlinked",
          fileSize: 1024,
          mimeType: "audio/ogg",
        },
        chatId: "7010",
        telegramUserId: "9010",
        languageCode: "en",
      })
    );
    assert.match(sentMessages.at(-1)?.text ?? "", /not linked to an active ERP account|n.?est pas li.? à un compte ERP actif|n.?est pas lie.? a un compte ERP actif/i);

    console.log("Telegram integration tests passed");
  } finally {
    settingsService.sendTelegramLinkCodeEmail = originalSendTelegramLinkCodeEmail;
    aiAssistantService.createConversation = originalCreateConversation;
    aiAssistantService.sendMessage = originalSendMessage;
    aiAssistantService.previewMessagePlan = originalPreviewMessagePlan;
    aiAssistantService.previewStructuredFormContinuation = originalPreviewStructuredFormContinuation;
    aiAssistantService.continueStructuredForm = originalContinueStructuredForm;
    aiAssistantService.confirmAction = originalConfirmAction;
    contractService.downloadPdf = originalContractDownloadPdf;
    contractService.sendByEmail = originalContractSendByEmail;
    creditNoteService.pdfBuffer = originalCreditNotePdfBuffer;
    creditNoteService.sendEmail = originalCreditNoteSendEmail;
    expenseService.renderNotePdf = originalExpenseRenderNotePdf;
    expenseService.sendNoteEmail = originalExpenseSendNoteEmail;
    devisService.sendDevisEmail = originalDevisSendDevisEmail;
    global.fetch = originalFetch;

    await prisma.telegramSession.deleteMany({
      where: {
        OR: [
          { telegramChatId: { in: ["7001", "7002", "7003", "7004", "7005", "7006", "7007", "7008", "7009", "7010"] } },
          { telegramUserId: { in: ["9001", "9002", "9003", "9004", "9005", "9006", "9007", "9008", "9009", "9010"] } },
          { userId: { in: [activeUser.id, disabledUser.id] } },
        ],
      },
    });
    await prisma.telegramAccount.deleteMany({ where: { userId: { in: [activeUser.id, disabledUser.id] } } });
    await prisma.telegramLinkCode.deleteMany({ where: { userId: { in: [activeUser.id, disabledUser.id] } } });
    await prisma.aiPendingAction.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
    await prisma.aiMessage.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
    await prisma.aiConversation.deleteMany({ where: { id: { in: createdConversationIds } } });
    await prisma.invoiceItem.deleteMany({ where: { invoiceId: invoiceDocument.id } });
    await prisma.invoice.deleteMany({ where: { id: invoiceDocument.id } });
    await prisma.devisItem.deleteMany({ where: { devisId: devisDocument.id } });
    await prisma.devis.deleteMany({ where: { id: devisDocument.id } });
    await prisma.customer.deleteMany({ where: { id: documentCustomer.id } });
    await prisma.user.deleteMany({ where: { id: { in: [activeUser.id, disabledUser.id] } } });
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  settingsService.sendTelegramLinkCodeEmail = originalSendTelegramLinkCodeEmail;
  aiAssistantService.createConversation = originalCreateConversation;
  aiAssistantService.sendMessage = originalSendMessage;
  aiAssistantService.previewMessagePlan = originalPreviewMessagePlan;
  aiAssistantService.previewStructuredFormContinuation = originalPreviewStructuredFormContinuation;
  aiAssistantService.continueStructuredForm = originalContinueStructuredForm;
  aiAssistantService.confirmAction = originalConfirmAction;
  contractService.downloadPdf = originalContractDownloadPdf;
  contractService.sendByEmail = originalContractSendByEmail;
  creditNoteService.pdfBuffer = originalCreditNotePdfBuffer;
  creditNoteService.sendEmail = originalCreditNoteSendEmail;
  expenseService.renderNotePdf = originalExpenseRenderNotePdf;
  expenseService.sendNoteEmail = originalExpenseSendNoteEmail;
  devisService.sendDevisEmail = originalDevisSendDevisEmail;
  global.fetch = originalFetch;
  await prisma.$disconnect();
  process.exit(1);
});

