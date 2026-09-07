import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { env } from "@config/env";
import { prisma } from "@config/database";
import { settingsService } from "@modules/settings/settings.service";
import { aiAssistantService } from "@modules/ai-assistant/aiAssistant.service";
import { permissionScope } from "@modules/rbac/accessScope";
import { invoiceService } from "@modules/invoice/invoice.service";
import { renderInvoicePdfBuffer } from "@modules/invoice/invoice.pdf";
import { contractService } from "@modules/contract/contract.service";
import { creditNoteService } from "@modules/credit-note/creditNote.service";
import { expenseService } from "@modules/expense/expense.service";
import { devisService } from "@modules/devis/devis.service";
import { renderDevisPdfBuffer } from "@modules/devis/devis.pdf";
import type { AssistantUser } from "@modules/ai-assistant/tools/toolTypes";
import { ApiError } from "@utils/ApiError";

type SupportedLanguage = "fr" | "en" | "ar";

type TelegramStructuredField = {
  path?: string;
  label?: string;
  type?: string;
  itemFields?: TelegramStructuredField[];
};

type TelegramPendingForm = {
  toolName: string;
  conversationId: string;
  values: Record<string, unknown>;
  missingFields: string[];
  fields: TelegramStructuredField[];
  language: SupportedLanguage;
  replaceActionId?: string;
};

type TelegramExecutionResult = {
  type?: string;
  toolName?: string;
  replaceActionId?: string;
  form?: {
    toolName?: string;
    title?: string;
    description?: string;
    values?: Record<string, unknown>;
    missingFields?: string[];
    fields?: TelegramStructuredField[];
    language?: SupportedLanguage;
  };
  action?: {
    id: string;
    toolName?: string;
    previewPayload?: Record<string, unknown> | null;
  };
  result?: unknown;
};

type TelegramVoicePayload = {
  file_id?: string;
  file_size?: number;
  mime_type?: string;
  duration?: number;
};

type TelegramAudioPayload = {
  file_id?: string;
  file_size?: number;
  mime_type?: string;
  file_name?: string;
  duration?: number;
};

type TelegramMediaDescriptor = {
  kind: "voice" | "audio";
  fileId: string;
  fileSize: number;
  mimeType: string;
  fileName: string;
};

type DownloadedTelegramAudio = {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  fileSize: number;
};

type OpenAiTranscriptionResponse = {
  text?: string;
  language?: string;
  error?: { message?: string };
};

type TelegramInlineKeyboardButton = {
  text: string;
  callback_data: string;
};

type TelegramMessageOptions = {
  replyMarkup?: {
    inline_keyboard: TelegramInlineKeyboardButton[][];
  };
};

type TelegramEntityKind = "invoice" | "quote" | "contract" | "credit_note" | "expense";

type TelegramEntityReference = {
  kind: TelegramEntityKind;
  id: string;
  number?: string | null;
};

const AWAITING_EMAIL_TTL_MS = 10 * 60 * 1000;
const PENDING_FORM_TTL_MS = 12 * 60 * 60 * 1000;
const LINK_CODE_RATE_LIMIT_MS = 60 * 1000;
const TELEGRAM_AUDIO_SIZE_LIMIT_BYTES = env.MAX_FILE_SIZE_MB * 1024 * 1024;
const TELEGRAM_TRANSCRIPTION_MODEL = "whisper-1" ;
const TELEGRAM_TRANSCRIPTION_PROMPT = [
  "Transcribe the audio exactly as spoken.",
  "Do not translate.",
  "Do not summarize.",
  "Keep the original spoken language.",
  "",
  "ERP billing assistant vocabulary:",
  "Créer une facture, Créer un contrat, Créer une note de frais, Créer un devis, Créer un client, Créer un produit, Créer une feuille de temps.",
  "Create an invoice, Create a contract, Create an expense, Create a quote, Create a customer, Create a product, Create a timesheet.",
  "إنشاء فاتورة، إنشاء عقد، إنشاء مصروف، إنشاء عرض سعر، إنشاء عميل، إنشاء منتج، إنشاء ورقة أوقات.",
  "",
  "ERP nouns:",
  "facture, devis, client, contrat, paiement, produit, TVA, échéance, quantité, prix unitaire.",
  "invoice, quote, customer, contract, payment, product, VAT, due date, quantity, unit price.",
  "فاتورة، عرض سعر، عميل، عقد، دفعة، منتج، ضريبة، تاريخ الاستحقاق، الكمية، سعر الوحدة.",
].join("\n");


const TELEGRAM_SUPPORTED_AUDIO_MIME_TYPES = new Set([
  "audio/ogg",
  "audio/opus",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
]);

let pollingStarted = false;

function localized(language: SupportedLanguage, values: { fr: string; en: string; ar: string }) {
  if (language === "ar") return values.ar;
  if (language === "en") return values.en;
  return values.fr;
}

function normalizeLanguage(value?: string | null): SupportedLanguage {
  if (!value) return "fr";
  const normalized = value.toLowerCase();
  if (normalized.startsWith("ar")) return "ar";
  if (normalized.startsWith("en")) return "en";
  return "fr";
}

function getTelegramBotToken() {
  return env.TELEGRAM_BOT_TOKEN;
}

function telegramApiUrl(method: string) {
  const token = getTelegramBotToken();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function callTelegramJsonApi<T = unknown>(method: string, body: Record<string, unknown>) {
  const response = await fetch(telegramApiUrl(method), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(async () => ({ ok: false, description: await response.text().catch(() => "") }))) as {
    ok?: boolean;
    result?: T;
    description?: string;
  };

  if (!response.ok || !payload.ok) {
    throw new Error(payload.description || `Telegram API ${method} failed with status ${response.status}`);
  }

  return payload.result as T;
}

export function isTelegramEnabled() {
  return env.TELEGRAM_MODE !== "disabled" && Boolean(getTelegramBotToken());
}

function sessionExpiryDate(ttlMs: number) {
  return new Date(Date.now() + ttlMs);
}

function toNullableJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value == null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function sendTelegramMessage(chatId: string | number, text: string, options: TelegramMessageOptions = {}) {
  return callTelegramJsonApi("sendMessage", {
    chat_id: chatId,
    text,
    ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
  });
}

async function editTelegramMessage(chatId: string | number, messageId: number, text: string, options: TelegramMessageOptions = {}) {
  return callTelegramJsonApi("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
  });
}

async function answerTelegramCallbackQuery(callbackQueryId: string, text?: string) {
  return callTelegramJsonApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}

function sanitizeTelegramFileName(fileName: string) {
  return fileName.replace(/[^\w.\-]+/g, "-");
}

async function sendTelegramDocumentBuffer(chatId: string | number, buffer: Buffer, fileName: string, caption?: string) {
  const formData = new FormData();
  formData.set("chat_id", String(chatId));
  formData.set("document", new Blob([buffer], { type: "application/pdf" }), sanitizeTelegramFileName(fileName));
  if (caption) {
    formData.set("caption", caption);
  }

  const response = await fetch(telegramApiUrl("sendDocument"), {
    method: "POST",
    body: formData,
  });

  const payload = (await response.json().catch(async () => ({ ok: false, description: await response.text().catch(() => "") }))) as {
    ok?: boolean;
    description?: string;
  };

  if (!response.ok || !payload.ok) {
    throw new Error(payload.description || `Telegram API sendDocument failed with status ${response.status}`);
  }
}

function buildInlineKeyboard(rows: Array<Array<{ text: string; callbackData: string }>>) {
  return {
    inline_keyboard: rows.map((row) =>
      row.map((button) => ({
        text: button.text,
        callback_data: button.callbackData,
      }))
    ),
  };
}

function pendingActionKeyboard(actionId: string, language: SupportedLanguage) {
  return buildInlineKeyboard([
    [
      {
        text: localized(language, { fr: "✅ Confirmer", en: "✅ Confirm", ar: "✅ تأكيد" }),
        callbackData: `ai:confirm:${actionId}`,
      },
      {
        text: localized(language, { fr: "✏️ Modifier", en: "✏️ Edit", ar: "✏️ تعديل" }),
        callbackData: `ai:edit:${actionId}`,
      },
    ],
    [
      {
        text: localized(language, { fr: "❌ Annuler", en: "❌ Cancel", ar: "❌ إلغاء" }),
        callbackData: `ai:cancel:${actionId}`,
      },
    ],
  ]);
}

function documentActionKeyboard(reference: TelegramEntityReference, language: SupportedLanguage) {
  const rows: Array<Array<{ text: string; callbackData: string }>> = [[
    {
      text: localized(language, { fr: "📄 PDF", en: "📄 PDF", ar: "📄 PDF" }),
      callbackData: `doc:pdf:${reference.kind}:${reference.id}`,
    },
  ]];

  if (reference.kind === "invoice" || reference.kind === "contract" || reference.kind === "credit_note" || reference.kind === "expense" || reference.kind === "quote") {
    rows[0]!.push({
      text: localized(language, { fr: "📧 Email", en: "📧 Email", ar: "📧 بريد" }),
      callbackData: `doc:email:${reference.kind}:${reference.id}`,
    });
  }

  return buildInlineKeyboard(rows);
}

function resolveTelegramMedia(message: { voice?: TelegramVoicePayload; audio?: TelegramAudioPayload }): TelegramMediaDescriptor | null {
  if (message.voice?.file_id) {
    const mimeType = message.voice.mime_type?.trim().toLowerCase() || "audio/ogg";
    return {
      kind: "voice",
      fileId: message.voice.file_id,
      fileSize: message.voice.file_size ?? 0,
      mimeType,
      fileName: "telegram-voice.ogg",
    };
  }

  if (message.audio?.file_id) {
    const fileName = message.audio.file_name?.trim() || "telegram-audio";
    const mimeType = message.audio.mime_type?.trim().toLowerCase() || inferAudioMimeType(fileName);
    return {
      kind: "audio",
      fileId: message.audio.file_id,
      fileSize: message.audio.file_size ?? 0,
      mimeType,
      fileName,
    };
  }

  return null;
}

function inferAudioMimeType(fileName: string) {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith(".mp3")) return "audio/mpeg";
  if (normalized.endsWith(".m4a")) return "audio/m4a";
  if (normalized.endsWith(".mp4")) return "audio/mp4";
  if (normalized.endsWith(".wav")) return "audio/wav";
  if (normalized.endsWith(".webm")) return "audio/webm";
  if (normalized.endsWith(".ogg") || normalized.endsWith(".oga")) return "audio/ogg";
  return "application/octet-stream";
}

function isSupportedAudioMimeType(mimeType: string) {
  return TELEGRAM_SUPPORTED_AUDIO_MIME_TYPES.has(mimeType.toLowerCase());
}

function buildAudioValidationMessage(
  language: SupportedLanguage,
  reason: "unsupported" | "oversized" | "missing_openai"
) {
  switch (reason) {
    case "unsupported":
      return localized(language, {
        fr: "Je peux traiter les notes vocales et fichiers audio OGG, MP3, M4A, WAV ou WEBM. Ce format n’est pas pris en charge.",
        en: "I can process OGG, MP3, M4A, WAV, and WEBM voice or audio files. This format is not supported.",
        ar: "يمكنني معالجة الملاحظات الصوتية وملفات OGG وMP3 وM4A وWAV وWEBM. هذا التنسيق غير مدعوم.",
      });
    case "oversized":
      return localized(language, {
        fr: `Le fichier audio dépasse la limite autorisée de ${env.MAX_FILE_SIZE_MB} Mo.`,
        en: `The audio file exceeds the allowed limit of ${env.MAX_FILE_SIZE_MB} MB.`,
        ar: `يتجاوز الملف الصوتي الحد المسموح وهو ${env.MAX_FILE_SIZE_MB} ميغابايت.`,
      });
    case "missing_openai":
      return localized(language, {
        fr: "La transcription vocale n’est pas disponible car la clé OpenAI n’est pas configurée sur le backend.",
        en: "Voice transcription is unavailable because the OpenAI key is not configured on the backend.",
        ar: "التفريغ الصوتي غير متاح لأن مفتاح OpenAI غير مهيأ على الخادم.",
      });
  }
}

async function fetchTelegramFilePath(fileId: string) {
  const token = getTelegramBotToken();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
  if (!response.ok) {
    throw new Error(`Telegram getFile error: ${response.status}`);
  }

  const payload = (await response.json()) as { ok?: boolean; result?: { file_path?: string }; description?: string };
  if (!payload.ok || !payload.result?.file_path) {
    throw new Error(payload.description || "Telegram getFile returned no file path");
  }

  return payload.result.file_path;
}

async function downloadTelegramAudio(media: TelegramMediaDescriptor): Promise<DownloadedTelegramAudio> {
  const token = getTelegramBotToken();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }

  if (!isSupportedAudioMimeType(media.mimeType)) {
    throw ApiError.badRequest("unsupported_telegram_audio");
  }

  if (media.fileSize > TELEGRAM_AUDIO_SIZE_LIMIT_BYTES) {
    throw ApiError.badRequest("oversized_telegram_audio");
  }

  const filePath = await fetchTelegramFilePath(media.fileId);
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!response.ok) {
    throw new Error(`Telegram file download error: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.byteLength > TELEGRAM_AUDIO_SIZE_LIMIT_BYTES) {
    throw ApiError.badRequest("oversized_telegram_audio");
  }

  const fileName = media.kind === "voice" ? "telegram-voice.ogg" : media.fileName;
  return {
    buffer,
    mimeType: media.mimeType,
    fileName,
    fileSize: buffer.byteLength,
  };
}

async function transcribeTelegramAudio(audio: DownloadedTelegramAudio) {
  if (!env.OPENAI_API_KEY) {
    throw ApiError.badRequest("missing_openai_transcription");
  }

  const formData = new FormData();
  formData.set("model", TELEGRAM_TRANSCRIPTION_MODEL);
  formData.set("prompt", TELEGRAM_TRANSCRIPTION_PROMPT);
  formData.set( 
    "file",
    new Blob([audio.buffer], { type: audio.mimeType }),
    audio.fileName
  );

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: formData,
  });

  const payload = (await response.json()) as OpenAiTranscriptionResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message || "OpenAI transcription failed");
  }

  const transcript = payload.text?.trim();
  if (!transcript) {
    throw ApiError.badRequest("empty_telegram_transcript");
  }

  return {
    transcript,
    detectedLanguage: normalizeLanguage(payload.language),
    model: TELEGRAM_TRANSCRIPTION_MODEL,
  };
}

function buildVoiceAcknowledgement(language: SupportedLanguage) {
  return localized(language, {
    fr: "🎤 Message vocal reçu. Transcription en cours...",
    en: "🎤 Voice message received. Transcribing...",
    ar: "🎤 تم استلام الرسالة الصوتية. جارٍ التفريغ...",
  });
}

function buildTranscriptAcknowledgement(language: SupportedLanguage, transcript: string) {
  const preview = transcript.length > 220 ? `${transcript.slice(0, 217)}...` : transcript;
  return localized(language, {
    fr: `📝 J’ai compris : ${preview}`,
    en: `📝 I understood: ${preview}`,
    ar: `📝 فهمت: ${preview}`,
  });
}

async function getTelegramAssistantUser(
  telegramUserId: string,
  telegramChatId: string
): Promise<AssistantUser | null> {
  let account = await prisma.telegramAccount.findFirst({
    where: {
      OR: [{ telegramUserId }, { telegramChatId }],
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
          role: true,
          rbacRole: {
            select: {
              permissions: {
                select: {
                  scope: true,
                  permission: {
                    select: {
                      key: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!account) {
    return null;
  }

  if (!account.user.rbacRole) {
    const legacyRoleName = String(account.user.role).toUpperCase();
    if (legacyRoleName === "ADMIN" || legacyRoleName === "EMPLOYEE") {
      await prisma.user.update({
        where: { id: account.user.id },
        data: { rbacRole: { connect: { name: legacyRoleName } } },
      });
      account = await prisma.telegramAccount.findFirst({
        where: {
          OR: [{ telegramUserId }, { telegramChatId }],
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              isActive: true,
              role: true,
              rbacRole: {
                select: {
                  permissions: {
                    select: {
                      scope: true,
                      permission: {
                        select: {
                          key: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
    }
  }

  if (!account || !account.user.isActive) {
    return null;
  }

  return {
    id: account.user.id,
    name: account.user.name,
    email: account.user.email,
    role: account.user.role,
    permissions: account.user.rbacRole?.permissions.map(({ permission }) => permission.key) ?? [],
    permissionScopes: Object.fromEntries(
      account.user.rbacRole?.permissions.map(({ permission, scope }) => [permission.key, scope]) ?? []
    ),
  };
}

async function getOrCreateTelegramSession(chatId: string, telegramUserId: string, language: SupportedLanguage) {
  const existing = await prisma.telegramSession.findUnique({
    where: { telegramChatId: chatId },
  });

  const now = new Date();

  if (!existing) {
    return prisma.telegramSession.create({
      data: {
        telegramChatId: chatId,
        telegramUserId,
        language,
        lastInteractionAt: now,
      },
    });
  }

  const expiredState = existing.stateExpiresAt && existing.stateExpiresAt.getTime() < Date.now();

  return prisma.telegramSession.update({
    where: { id: existing.id },
    data: {
      telegramUserId,
      language: language || existing.language,
      lastInteractionAt: now,
      ...(expiredState
        ? {
            awaitingEmail: false,
            pendingToolName: null,
            pendingFormValues: Prisma.JsonNull,
            pendingMissingFields: Prisma.JsonNull,
            pendingFields: Prisma.JsonNull,
            stateExpiresAt: null,
          }
        : {}),
    },
  });
}

function parsePendingForm(session: Awaited<ReturnType<typeof getOrCreateTelegramSession>>): TelegramPendingForm | null {
  if (!session.pendingToolName || !session.conversationId) return null;
  const missingFields = Array.isArray(session.pendingMissingFields) ? session.pendingMissingFields : [];
  const fields = Array.isArray(session.pendingFields) ? session.pendingFields : [];
  const rawValues =
    typeof session.pendingFormValues === "object" && session.pendingFormValues && !Array.isArray(session.pendingFormValues)
      ? (session.pendingFormValues as Record<string, unknown>)
      : {};
  const replaceActionId = typeof rawValues.__replaceActionId === "string" ? rawValues.__replaceActionId : undefined;
  const values = { ...rawValues };
  delete values.__replaceActionId;

  return {
    toolName: session.pendingToolName,
    conversationId: session.conversationId,
    values,
    missingFields: missingFields.filter((field: unknown): field is string => typeof field === "string"),
    fields: fields as TelegramStructuredField[],
    language: normalizeLanguage(session.language),
    replaceActionId,
  };
}

async function updateSessionLanguageAndUser(sessionId: string, language: SupportedLanguage, userId?: string | null) {
  return prisma.telegramSession.update({
    where: { id: sessionId },
    data: {
      language,
      userId: userId ?? undefined,
      lastInteractionAt: new Date(),
    },
  });
}

async function setAwaitingEmail(sessionId: string, awaitingEmail: boolean) {
  return prisma.telegramSession.update({
    where: { id: sessionId },
    data: {
      awaitingEmail,
      stateExpiresAt: awaitingEmail ? sessionExpiryDate(AWAITING_EMAIL_TTL_MS) : null,
      lastInteractionAt: new Date(),
    },
  });
}

async function storePendingForm(sessionId: string, pendingForm: TelegramPendingForm, userId?: string | null) {
  const storedValues = {
    ...pendingForm.values,
    ...(pendingForm.replaceActionId ? { __replaceActionId: pendingForm.replaceActionId } : {}),
  };
  return prisma.telegramSession.update({
    where: { id: sessionId },
    data: {
      userId: userId ?? undefined,
      conversationId: pendingForm.conversationId,
      language: pendingForm.language,
      awaitingEmail: false,
      pendingToolName: pendingForm.toolName,
      pendingFormValues: toNullableJson(storedValues),
      pendingMissingFields: toNullableJson(pendingForm.missingFields),
      pendingFields: toNullableJson(pendingForm.fields),
      stateExpiresAt: sessionExpiryDate(PENDING_FORM_TTL_MS),
      lastInteractionAt: new Date(),
    },
  });
}

async function clearTransientSessionState(sessionId: string, options?: { keepConversation?: boolean; keepLanguage?: boolean; clearUser?: boolean }) {
  return prisma.telegramSession.update({
    where: { id: sessionId },
    data: {
      ...(options?.keepConversation ? {} : { conversationId: null }),
      ...(options?.keepLanguage ? {} : { language: "fr" }),
      ...(options?.clearUser ? { userId: null } : {}),
      awaitingEmail: false,
      pendingToolName: null,
      pendingFormValues: Prisma.JsonNull,
      pendingMissingFields: Prisma.JsonNull,
      pendingFields: Prisma.JsonNull,
      stateExpiresAt: null,
      lastInteractionAt: new Date(),
    },
  });
}

async function linkTelegramAccount(sessionId: string, telegramUserId: string, telegramChatId: string, userId: string, language: SupportedLanguage) {
  const session = await prisma.telegramSession.findUnique({ where: { id: sessionId } });

  await prisma.$transaction(async (tx) => {
    await tx.telegramAccount.deleteMany({
      where: {
        OR: [{ userId }, { telegramUserId }, { telegramChatId }],
      },
    });

    await tx.telegramAccount.create({
      data: {
        userId,
        telegramUserId,
        telegramChatId,
      },
    });

    await tx.telegramSession.update({
      where: { id: sessionId },
      data: {
        userId,
        language,
        awaitingEmail: false,
        pendingToolName: null,
        pendingFormValues: Prisma.JsonNull,
        pendingMissingFields: Prisma.JsonNull,
        pendingFields: Prisma.JsonNull,
        stateExpiresAt: null,
        conversationId: session?.userId === userId ? session.conversationId : null,
        lastInteractionAt: new Date(),
      },
    });
  });
}

async function findOrCreateTelegramConversation(
  assistantUser: AssistantUser,
  chatId: string,
  session: Awaited<ReturnType<typeof getOrCreateTelegramSession>>,
  language: SupportedLanguage
) {
  if (session.conversationId) {
    const existing = await prisma.aiConversation.findFirst({
      where: {
        id: session.conversationId,
        userId: assistantUser.id,
        status: "ACTIVE",
      },
    });

    if (existing) {
      if (existing.language !== language) {
        await prisma.aiConversation.update({
          where: { id: existing.id },
          data: { language },
        });
      }
      return existing;
    }
  }

  const conversationTitle = `Telegram ${chatId}`;
  const existingConversation = await prisma.aiConversation.findFirst({
    where: {
      userId: assistantUser.id,
      title: conversationTitle,
      status: "ACTIVE",
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  if (existingConversation) {
    await prisma.telegramSession.update({
      where: { id: session.id },
      data: {
        userId: assistantUser.id,
        conversationId: existingConversation.id,
        language,
        lastInteractionAt: new Date(),
      },
    });

    if (existingConversation.language !== language) {
      return prisma.aiConversation.update({
        where: { id: existingConversation.id },
        data: { language },
      });
    }

    return existingConversation;
  }

  const conversation = await aiAssistantService.createConversation(assistantUser, {
    title: conversationTitle,
    language,
  });

  await prisma.telegramSession.update({
    where: { id: session.id },
    data: {
      userId: assistantUser.id,
      conversationId: conversation.id,
      language,
      lastInteractionAt: new Date(),
    },
  });

  return conversation;
}

function findFieldDefinition(fields: TelegramStructuredField[], path: string): TelegramStructuredField | null {
  for (const field of fields) {
    if (field.path === path) return field;
    if (field.type === "array" && Array.isArray(field.itemFields)) {
      const nested = findFieldDefinition(field.itemFields, path);
      if (nested) return nested;
    }
  }
  return null;
}

function formatMissingFields(fields: TelegramStructuredField[], missingFields: string[], language: SupportedLanguage) {
  if (missingFields.length === 0) return "";

  const lines = missingFields.map((path, index) => {
    const field = findFieldDefinition(fields, path);
    if (field?.type === "array" && Array.isArray(field.itemFields) && field.itemFields.length > 0) {
      const itemLabels = field.itemFields.map((itemField) => itemField.label ?? itemField.path ?? "").filter(Boolean);
      return `${index + 1}. ${field.label ?? path}: ${itemLabels.join(", ")}`;
    }
    return `${index + 1}. ${field?.label ?? path}`;
  });

  return [
    localized(language, {
      fr: "Champs manquants :",
      en: "Missing fields:",
      ar: "الحقول الناقصة:",
    }),
    ...lines,
  ].join("\n");
}

function formatStructuredFormMessage(form: NonNullable<TelegramExecutionResult["form"]>, language: SupportedLanguage) {
  const lines: string[] = [];
  lines.push(`📝 ${form.title ?? localized(language, { fr: "Formulaire", en: "Form", ar: "نموذج" })}`);

  if (form.description) {
    lines.push("");
    lines.push(form.description);
  }

  const missingFields = Array.isArray(form.missingFields) ? form.missingFields : [];
  const fields = Array.isArray(form.fields) ? form.fields : [];
  const missingBlock = formatMissingFields(fields, missingFields, language);

  if (missingBlock) {
    lines.push("");
    lines.push(missingBlock);
  }

  lines.push("");
  lines.push(
    localized(language, {
      fr: "Envoyez-moi simplement les informations manquantes dans votre prochain message.",
      en: "Reply with the missing information in your next message.",
        ar: "أرسل لي فقط المعلومات الناقصة في رسالتك التالية.",
    })
  );

  return lines.join("\n");
}

function formatValue(value: unknown) {
  if (value == null) return "—";
  if (typeof value === "number") return value.toString();
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return JSON.stringify(value);
}

const TELEGRAM_RESULT_PAGE_SIZE = 5;

function localeForLanguage(language: SupportedLanguage) {
  switch (language) {
    case "ar":
      return "ar-MA";
    case "en":
      return "en-GB";
    case "fr":
    default:
      return "fr-FR";
  }
}

function humanizeIdentifier(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function localizeStatus(status: unknown, language: SupportedLanguage) {
  if (typeof status !== "string" || !status.trim()) return "—";
  const normalized = status.trim().toUpperCase();
  const statusMap: Record<string, { fr: string; en: string; ar: string }> = {
    DRAFT: { fr: "Brouillon", en: "Draft", ar: "مسودة" },
    SENT: { fr: "Envoyée", en: "Sent", ar: "مرسلة" },
    PAID: { fr: "Payée", en: "Paid", ar: "مدفوعة" },
    OVERDUE: { fr: "En retard", en: "Overdue", ar: "متأخرة" },
    CANCELLED: { fr: "Annulée", en: "Cancelled", ar: "ملغاة" },
    ACTIVE: { fr: "Actif", en: "Active", ar: "نشط" },
    INACTIVE: { fr: "Inactif", en: "Inactive", ar: "غير نشط" },
    APPROVED: { fr: "Approuvée", en: "Approved", ar: "معتمدة" },
    REJECTED: { fr: "Rejetée", en: "Rejected", ar: "مرفوضة" },
    SUBMITTED: { fr: "Soumise", en: "Submitted", ar: "مقدمة" },
    PENDING: { fr: "En attente", en: "Pending", ar: "قيد الانتظار" },
    PARTIALLY_PAID: { fr: "Partiellement payée", en: "Partially paid", ar: "مدفوعة جزئياً" },
    EXPIRED: { fr: "Expiré", en: "Expired", ar: "منتهي الصلاحية" },
    SIGNED: { fr: "Signé", en: "Signed", ar: "موقع" },
    VIEWED: { fr: "Consulté", en: "Viewed", ar: "تمت المشاهدة" },
    CONVERTED: { fr: "Converti", en: "Converted", ar: "تم التحويل" },
    COMPLETED: { fr: "Terminé", en: "Completed", ar: "مكتمل" },
    INVOICED: { fr: "Facturé", en: "Invoiced", ar: "مفوترة" },
  };
  const localizedStatus = statusMap[normalized];
  return localizedStatus ? localized(language, localizedStatus) : humanizeIdentifier(status);
}

function formatTelegramCurrency(amount: unknown, currency?: unknown) {
  const numeric = typeof amount === "number" ? amount : typeof amount === "string" ? Number(amount) : NaN;
  const currencyCode = typeof currency === "string" && currency.trim() ? currency.trim() : "";
  if (Number.isNaN(numeric)) return currencyCode ? `${formatValue(amount)} ${currencyCode}` : formatValue(amount);
  const formatted = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
  return currencyCode ? `${formatted} ${currencyCode}` : formatted;
}

function formatTelegramDate(value: unknown, language: SupportedLanguage) {
  if (value == null || value === "") return "—";
  const date = value instanceof Date ? value : typeof value === "string" || typeof value === "number" ? new Date(value) : null;
  if (!date) return formatValue(value);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : String(value);
  return new Intl.DateTimeFormat(localeForLanguage(language), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatEntityReference(
  entityType:
    | "invoice"
    | "quote"
    | "contract"
    | "credit_note"
    | "expense"
    | "payment"
    | "timesheet"
    | "recurring"
    | "product"
    | "customer",
  entity: unknown,
  options?: { allowFallbackId?: boolean }
) {
  const record = asRecord(entity);
  if (!record) return "—";

  const priorities: Record<string, string[]> = {
    invoice: ["invoiceNumber", "number", "reference"],
    quote: ["devisNumber", "quoteNumber", "number", "reference"],
    contract: ["contractNumber", "reference", "number"],
    credit_note: ["creditNoteNumber", "number", "reference"],
    expense: ["expenseNumber", "number", "reference"],
    payment: ["paymentNumber", "reference", "number", "invoiceNumber"],
    timesheet: ["timesheetNumber", "reference", "number"],
    recurring: ["planNumber", "reference", "name"],
    product: ["sku", "code", "reference", "name"],
    customer: ["company", "name", "email"],
  };

  for (const key of priorities[entityType] ?? []) {
    const candidate = asString(record[key]);
    if (candidate) return candidate;
  }

  if (options?.allowFallbackId === false) return null;
  const fallbackId = asString(record.id);
  return fallbackId ?? "—";
}

function formatRangeSummary(total: number, shown: number, language: SupportedLanguage) {
  return localized(language, {
    fr: `Affichage 1–${shown} sur ${total}`,
    en: `Showing 1–${shown} of ${total}`,
    ar: `عرض 1–${shown} من ${total}`,
  });
}

function formatSectionDivider() {
  return "━━━━━━━━━━━━━━";
}

function asResultRecord(value: unknown) {
  return asRecord(value);
}

function formatRevenueIntelligenceResult(result: Record<string, unknown>, language: SupportedLanguage) {
  const overdueCount = typeof result.overdueCount === "number" ? result.overdueCount : 0;
  const currency = typeof result.currency === "string" ? result.currency : "MAD";
  const overdueAmount = result.overdueAmount;
  const readyToInvoiceCount = typeof result.readyToInvoiceCount === "number" ? result.readyToInvoiceCount : 0;
  const readyToInvoiceRevenue = result.readyToInvoiceRevenue;
  const topOverdue = Array.isArray(result.topOverdue) ? result.topOverdue.slice(0, TELEGRAM_RESULT_PAGE_SIZE) : [];

  if (overdueCount <= 0) {
    return localized(language, {
      fr: "Aucune facture impayée trouvée.",
      en: "No unpaid invoices found.",
      ar: "لم يتم العثور على فواتير غير مدفوعة.",
    });
  }

  const heading = localized(language, {
    fr: "📌 Factures impayées",
    en: "📌 Unpaid invoices",
    ar: "📌 الفواتير غير المدفوعة",
  });

  const lines = topOverdue.flatMap((invoice, index) => {
    const row = asResultRecord(invoice);
    if (!row) return [];
    const invoiceNumber = formatEntityReference("invoice", row);
    const client = asString(row.client) ?? "—";
    const balance = formatTelegramCurrency(row.balanceDue, row.currency ?? currency);
    const dueDate = formatTelegramDate(row.dueDate, language);
    return [
      `${index + 1}. ${invoiceNumber}`,
      `👤 ${localized(language, { fr: "Client", en: "Client", ar: "العميل" })}: ${client}`,
      `💰 ${localized(language, { fr: "Montant", en: "Amount", ar: "المبلغ" })}: ${balance}`,
      `📅 ${localized(language, { fr: "Échéance", en: "Due", ar: "الاستحقاق" })}: ${dueDate}`,
      `🔴 ${localized(language, { fr: "Statut", en: "Status", ar: "الحالة" })}: ${localized(language, { fr: "En retard", en: "Overdue", ar: "متأخرة" })}`,
      "",
    ];
  });

  return [
    heading,
    localized(language, {
      fr: `${overdueCount} facture(s)`,
      en: `${overdueCount} invoice(s)`,
      ar: `${overdueCount} فاتورة`,
    }),
    formatRangeSummary(overdueCount, Math.min(overdueCount, topOverdue.length), language),
    "",
    ...lines,
    formatSectionDivider(),
    `${localized(language, {
      fr: "Total en souffrance",
      en: "Total outstanding",
      ar: "إجمالي المتأخر",
    })}: ${formatTelegramCurrency(overdueAmount, currency)}`,
    ...(readyToInvoiceCount > 0
      ? [
      `${localized(language, {
        fr: "Prêt à facturer",
        en: "Ready to invoice",
        ar: "جاهز للفوترة",
      })}: ${readyToInvoiceCount} — ${formatTelegramCurrency(readyToInvoiceRevenue, currency)}`
    ]
      : []),
  ].join("\n");
}

function formatInvoiceSearchResult(result: Record<string, unknown>, language: SupportedLanguage) {
  const rows = Array.isArray(result.data) ? result.data : [];
  if (rows.length === 0) {
    return localized(language, {
      fr: "Aucune facture trouvée.",
      en: "No invoices found.",
      ar: "لم يتم العثور على فواتير.",
    });
  }

  const total = asRecord(result.meta)?.total;
  const totalCount = typeof total === "number" ? total : rows.length;
  const visibleRows = rows.slice(0, TELEGRAM_RESULT_PAGE_SIZE);
  const heading = localized(language, {
    fr: "🧾 Factures",
    en: "🧾 Invoices",
    ar: "🧾 الفواتير",
  });

  const lines = visibleRows.flatMap((row, index) => {
    const invoice = asResultRecord(row);
    if (!invoice) return [];
    const number = formatEntityReference("invoice", invoice);
    const client = asString(invoice.customerName)
      ?? asString(invoice.clientName)
      ?? asString(invoice.customer)
      ?? "—";
    const total = formatTelegramCurrency(invoice.total, invoice.currency);
    const dueDate = formatTelegramDate(invoice.dueDate, language);
    const status = localizeStatus(invoice.status, language);
    return [
      `${index + 1}. ${number}`,
      `👤 ${localized(language, { fr: "Client", en: "Client", ar: "العميل" })}: ${client}`,
      `💰 ${localized(language, { fr: "Montant", en: "Amount", ar: "المبلغ" })}: ${total}`,
      `📅 ${localized(language, { fr: "Échéance", en: "Due", ar: "الاستحقاق" })}: ${dueDate}`,
      `📌 ${localized(language, { fr: "Statut", en: "Status", ar: "الحالة" })}: ${status}`,
      "",
    ];
  });

  return [
    heading,
    localized(language, {
      fr: `${totalCount} facture(s)`,
      en: `${totalCount} invoice(s)`,
      ar: `${totalCount} فاتورة`,
    }),
    formatRangeSummary(totalCount, visibleRows.length, language),
    "",
    ...lines,
  ].join("\n");
}

function formatContractSearchResult(result: unknown, language: SupportedLanguage) {
  const rows = Array.isArray(result) ? result : [];
  if (rows.length === 0) {
    return localized(language, {
      fr: "Aucun contrat trouvé.",
      en: "No contracts found.",
      ar: "لم يتم العثور على عقود.",
    });
  }

  const visibleRows = rows.slice(0, TELEGRAM_RESULT_PAGE_SIZE);
  const heading = localized(language, {
    fr: "📑 Contrats",
    en: "📑 Contracts",
    ar: "📑 العقود",
  });
  const lines = visibleRows.flatMap((row, index) => {
    const contract = asResultRecord(row);
    if (!contract) return [];
    const number = formatEntityReference("contract", contract);
    const title = asString(contract.title) ?? "—";
    const client = asString(contract.client) ?? "—";
    const status = localizeStatus(contract.status, language);
    return [
      `${index + 1}. ${number}`,
      `👤 ${localized(language, { fr: "Client", en: "Client", ar: "العميل" })}: ${client}`,
      `📝 ${localized(language, { fr: "Titre", en: "Title", ar: "العنوان" })}: ${title}`,
      `📌 ${localized(language, { fr: "Statut", en: "Status", ar: "الحالة" })}: ${status}`,
      "",
    ];
  });
  return [
    heading,
    localized(language, {
      fr: `${rows.length} contrat(s)`,
      en: `${rows.length} contract(s)`,
      ar: `${rows.length} عقد`,
    }),
    formatRangeSummary(rows.length, visibleRows.length, language),
    "",
    ...lines,
  ].join("\n");
}

function formatTimesheetListResult(result: unknown, language: SupportedLanguage, readyOnly = false) {
  const rows = Array.isArray(result) ? result : [];
  if (rows.length === 0) {
    return localized(language, {
      fr: readyOnly ? "Aucune feuille de temps prête à facturer." : "Aucune feuille de temps trouvée.",
      en: readyOnly ? "No timesheets are ready to invoice." : "No timesheets found.",
      ar: readyOnly ? "لا توجد سجلات وقت جاهزة للفوترة." : "لم يتم العثور على سجلات وقت.",
    });
  }
  const visibleRows = rows.slice(0, TELEGRAM_RESULT_PAGE_SIZE);
  const heading = localized(language, {
    fr: readyOnly ? "⏱ Temps prêts à facturer" : "⏱ Feuilles de temps",
    en: readyOnly ? "⏱ Timesheets ready to invoice" : "⏱ Timesheets",
    ar: readyOnly ? "⏱ سجلات الوقت الجاهزة للفوترة" : "⏱ سجلات الوقت",
  });
  const lines = visibleRows.flatMap((row, index) => {
    const entry = asResultRecord(row);
    if (!entry) return [];
    const workDate = formatTelegramDate(entry.workDate, language);
    const reference = formatEntityReference("timesheet", entry);
    const activity = asString(entry.activityType)
      ?? asString(entry.description)
      ?? reference;
    const amount = formatTelegramCurrency(entry.calculatedAmount ?? entry.amount, entry.currency);
    const status = localizeStatus(entry.status, language);
    return [
      `${index + 1}. ${activity}`,
      `📅 ${localized(language, { fr: "Date", en: "Date", ar: "التاريخ" })}: ${workDate}`,
      `💰 ${localized(language, { fr: "Montant", en: "Amount", ar: "المبلغ" })}: ${amount}`,
      `📌 ${localized(language, { fr: "Statut", en: "Status", ar: "الحالة" })}: ${status}`,
      "",
    ];
  });
  return [
    heading,
    localized(language, {
      fr: `${rows.length} élément(s)`,
      en: `${rows.length} item(s)`,
      ar: `${rows.length} عنصر`,
    }),
    formatRangeSummary(rows.length, visibleRows.length, language),
    "",
    ...lines,
  ].join("\n");
}

function formatContractConsumptionResult(result: Record<string, unknown>, language: SupportedLanguage) {
  const contract = asResultRecord(result.contract);
  const contractLabel = formatEntityReference("contract", contract);
  const currency = typeof result.currency === "string" ? result.currency : "MAD";
  return [
    `📑 ${localized(language, {
      fr: `Contrat ${contractLabel}`,
      en: `Contract ${contractLabel}`,
      ar: `العقد ${contractLabel}`,
    })}`,
    `• ${localized(language, { fr: "Approuvé", en: "Approved", ar: "معتمد" })}: ${String(result.approvedCount ?? 0)} — ${formatTelegramCurrency(result.approvedAmount, currency)}`,
    `• ${localized(language, { fr: "Facturé", en: "Invoiced", ar: "مفوترة" })}: ${String(result.invoicedCount ?? 0)} — ${formatTelegramCurrency(result.invoicedAmount, currency)}`,
  ].join("\n");
}

function formatContractDetailsResult(result: Record<string, unknown>, language: SupportedLanguage) {
  const contract = asResultRecord(result.contract) ?? result;
  const contractReference = formatEntityReference("contract", contract);
  const client = asString(contract.client)
    ?? asString(contract.customer)
    ?? asString(contract.customerName)
    ?? "—";
  return [
    `📑 ${localized(language, { fr: "Contrat", en: "Contract", ar: "العقد" })} ${contractReference}`,
    `${localized(language, { fr: "Client", en: "Client", ar: "العميل" })}: ${client}`,
    `${localized(language, { fr: "Titre", en: "Title", ar: "العنوان" })}: ${asString(contract.title) ?? "—"}`,
    `${localized(language, { fr: "Montant", en: "Amount", ar: "المبلغ" })}: ${formatTelegramCurrency(contract.amount ?? contract.totalAmount, contract.currency)}`,
    `${localized(language, { fr: "Fin", en: "End date", ar: "تاريخ الانتهاء" })}: ${formatTelegramDate(contract.endDate, language)}`,
    `${localized(language, { fr: "Statut", en: "Status", ar: "الحالة" })}: ${localizeStatus(contract.status, language)}`,
  ].join("\n");
}

function formatInvoiceDetailsResult(result: Record<string, unknown>, language: SupportedLanguage) {
  const invoiceReference = formatEntityReference("invoice", result);
  return [
    `🧾 ${localized(language, { fr: "Facture", en: "Invoice", ar: "فاتورة" })} ${invoiceReference}`,
    `${localized(language, { fr: "Client", en: "Client", ar: "العميل" })}: ${asString(result.customer) ?? "—"}`,
    `${localized(language, { fr: "Total", en: "Total", ar: "الإجمالي" })}: ${formatTelegramCurrency(result.total, result.currency)}`,
    `${localized(language, { fr: "Reste dû", en: "Balance due", ar: "المتبقي" })}: ${formatTelegramCurrency(result.balanceDue, result.currency)}`,
    `${localized(language, { fr: "Échéance", en: "Due", ar: "الاستحقاق" })}: ${formatTelegramDate(result.dueDate, language)}`,
    `${localized(language, { fr: "Statut", en: "Status", ar: "الحالة" })}: ${localizeStatus(result.status, language)}`,
  ].join("\n");
}

function formatQuoteDetailsResult(result: Record<string, unknown>, language: SupportedLanguage) {
  const quoteReference = formatEntityReference("quote", result);
  return [
    `📋 ${localized(language, { fr: "Devis", en: "Quote", ar: "عرض سعر" })} ${quoteReference}`,
    `${localized(language, { fr: "Client", en: "Client", ar: "العميل" })}: ${asString(result.customer) ?? asString(result.customerName) ?? "—"}`,
    `${localized(language, { fr: "Total", en: "Total", ar: "الإجمالي" })}: ${formatTelegramCurrency(result.total, result.currency)}`,
    `${localized(language, { fr: "Valable jusqu'au", en: "Valid until", ar: "صالح حتى" })}: ${formatTelegramDate(result.validUntil, language)}`,
    `${localized(language, { fr: "Statut", en: "Status", ar: "الحالة" })}: ${localizeStatus(result.status, language)}`,
  ].join("\n");
}

function formatClientSearchResult(result: unknown, language: SupportedLanguage) {
  const rows = Array.isArray(result) ? result : [];
  if (rows.length === 0) {
    return localized(language, {
      fr: "Aucun client trouvé.",
      en: "No clients found.",
      ar: "لم يتم العثور على عملاء.",
    });
  }
  const visibleRows = rows.slice(0, TELEGRAM_RESULT_PAGE_SIZE);
  const heading = localized(language, {
    fr: "👥 Clients",
    en: "👥 Customers",
    ar: "👥 العملاء",
  });
  const lines = visibleRows.flatMap((row, index) => {
    const client = asResultRecord(row);
    if (!client) return [];
    const name = formatEntityReference("customer", client);
    const email = asString(client.email) ?? "—";
    const country = asString(client.country) ?? "—";
    return [
      `${index + 1}. ${name}`,
      `✉️ Email: ${email}`,
      `🌍 ${localized(language, { fr: "Pays", en: "Country", ar: "البلد" })}: ${country}`,
      "",
    ];
  });
  return [
    heading,
    localized(language, {
      fr: `${rows.length} client(s)`,
      en: `${rows.length} customer(s)`,
      ar: `${rows.length} عميل`,
    }),
    formatRangeSummary(rows.length, visibleRows.length, language),
    "",
    ...lines,
  ].join("\n");
}

function formatTelegramToolResultMessage(executionResult: TelegramExecutionResult | undefined, language: SupportedLanguage) {
  if (executionResult?.type !== "tool_result") return null;
  const toolName = executionResult.toolName;
  const resultRecord = asResultRecord(executionResult.result);

  switch (toolName) {
    case "analyze_revenue_intelligence":
      return resultRecord ? formatRevenueIntelligenceResult(resultRecord, language) : null;
    case "search_invoices":
      return resultRecord ? formatInvoiceSearchResult(resultRecord, language) : null;
    case "search_contracts":
      return formatContractSearchResult(executionResult.result, language);
    case "list_timesheets":
      return formatTimesheetListResult(executionResult.result, language, false);
    case "list_ready_to_invoice":
      return formatTimesheetListResult(executionResult.result, language, true);
    case "get_contract_consumption":
      return resultRecord ? formatContractConsumptionResult(resultRecord, language) : null;
    case "get_contract_details":
      return resultRecord ? formatContractDetailsResult(resultRecord, language) : null;
    case "get_invoice_details":
      return resultRecord ? formatInvoiceDetailsResult(resultRecord, language) : null;
    case "get_quote_details":
      return resultRecord ? formatQuoteDetailsResult(resultRecord, language) : null;
    case "search_clients":
    case "search_customers":
      return formatClientSearchResult(executionResult.result, language);
    default:
      return null;
  }
}

function formatPreviewSummary(action: TelegramExecutionResult["action"], language: SupportedLanguage) {
  const previewSummary =
    action?.previewPayload && typeof action.previewPayload === "object"
      ? (action.previewPayload.summary as Record<string, unknown> | undefined)
      : undefined;

  if (!previewSummary || Object.keys(previewSummary).length === 0) {
    return localized(language, {
      fr: "Prévisualisation prête.",
      en: "Preview ready.",
      ar: "المعاينة جاهزة.",
    });
  }

  const lines = Object.entries(previewSummary)
    .slice(0, 6)
    .map(([key, value]) => `• ${key}: ${formatValue(value)}`);

  return [
    localized(language, {
      fr: "Prévisualisation prête :",
      en: "Preview ready:",
      ar: "المعاينة جاهزة:",
    }),
    ...lines,
  ].join("\n");
}

function formatConfirmationResult(result: unknown, language: SupportedLanguage) {
  const record = result && typeof result === "object" ? (result as Record<string, unknown>) : null;
  const invoiceNumber = record ? formatEntityReference("invoice", record, { allowFallbackId: false }) : null;
  const quoteNumber = record ? formatEntityReference("quote", record, { allowFallbackId: false }) : null;
  const contractNumber = record ? formatEntityReference("contract", record, { allowFallbackId: false }) : null;
  const creditNoteNumber = record ? formatEntityReference("credit_note", record, { allowFallbackId: false }) : null;
  const expenseNumber = record ? formatEntityReference("expense", record, { allowFallbackId: false }) : null;
  const customerName =
    asString(record?.customerName)
      ?? asString(record?.clientName)
      ?? asString(record?.customer)
      ?? null;
  const currency = asString(record?.currency);
  const total = record && (typeof record.total === "number" || typeof record.total === "string") ? formatTelegramCurrency(record.total, currency) : null;
  const status = typeof record?.status === "string" ? record.status : null;
  const name = asString(record?.name);

  const headline = localized(language, {
    fr: "✅ Action confirmée et exécutée.",
    en: "✅ Action confirmed and executed.",
    ar: "✅ تم تأكيد العملية وتنفيذها.",
  });

  const details = [invoiceNumber, customerName, total, status, name].filter(Boolean);
  if (details.length === 0) return headline;

  const lines = [headline];
  if (invoiceNumber && invoiceNumber !== "—") lines.push(`• ${localized(language, { fr: "Facture", en: "Invoice", ar: "الفاتورة" })}: ${invoiceNumber}`);
  else if (quoteNumber && quoteNumber !== "—") lines.push(`• ${localized(language, { fr: "Devis", en: "Quote", ar: "عرض السعر" })}: ${quoteNumber}`);
  else if (contractNumber && contractNumber !== "—") lines.push(`• ${localized(language, { fr: "Contrat", en: "Contract", ar: "العقد" })}: ${contractNumber}`);
  else if (creditNoteNumber && creditNoteNumber !== "—") lines.push(`• ${localized(language, { fr: "Avoir", en: "Credit note", ar: "الإشعار الدائن" })}: ${creditNoteNumber}`);
  else if (expenseNumber && expenseNumber !== "—") lines.push(`• ${localized(language, { fr: "Note de frais", en: "Expense note", ar: "مذكرة المصروف" })}: ${expenseNumber}`);
  if (customerName) lines.push(`• ${localized(language, { fr: "Client", en: "Customer", ar: "العميل" })}: ${customerName}`);
  if (total) lines.push(`• ${localized(language, { fr: "Total", en: "Total", ar: "الإجمالي" })}: ${total}`);
  if (status) lines.push(`• ${localized(language, { fr: "Statut", en: "Status", ar: "الحالة" })}: ${localizeStatus(status, language)}`);
  if (!invoiceNumber && name) lines.push(`• ${localized(language, { fr: "Résultat", en: "Result", ar: "النتيجة" })}: ${name}`);

  return lines.join("\n");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractTelegramEntityReference(value: unknown): TelegramEntityReference | null {
  const record = asRecord(value);
  if (!record) return null;

  if (typeof record.invoiceId === "string") {
    return {
      kind: "invoice",
      id: record.invoiceId,
      number: typeof record.invoiceNumber === "string" ? record.invoiceNumber : null,
    };
  }

  if (typeof record.contractId === "string") {
    return {
      kind: "contract",
      id: record.contractId,
      number: typeof record.contractNumber === "string" ? record.contractNumber : null,
    };
  }

  if (typeof record.creditNoteId === "string") {
    return {
      kind: "credit_note",
      id: record.creditNoteId,
      number: typeof record.creditNoteNumber === "string" ? record.creditNoteNumber : null,
    };
  }

  if (typeof record.expenseId === "string") {
    return {
      kind: "expense",
      id: record.expenseId,
      number: typeof record.expenseNumber === "string" ? record.expenseNumber : null,
    };
  }

  if (typeof record.id === "string") {
    if (typeof record.invoiceNumber === "string") {
      return { kind: "invoice", id: record.id, number: record.invoiceNumber };
    }
    if (typeof record.devisNumber === "string") {
      return { kind: "quote", id: record.id, number: record.devisNumber };
    }
    if (typeof record.contractNumber === "string") {
      return { kind: "contract", id: record.id, number: record.contractNumber };
    }
    if (typeof record.creditNoteNumber === "string") {
      return { kind: "credit_note", id: record.id, number: record.creditNoteNumber };
    }
  }

  return null;
}

async function sendTelegramEntityPdf(chatId: string | number, user: AssistantUser, reference: TelegramEntityReference, language: SupportedLanguage) {
  if (reference.kind === "invoice") {
    const invoice = await invoiceService.getInvoiceById(reference.id, user.id, permissionScope(user.permissionScopes, "invoices.view"));
    const company = await settingsService.getCompanySettings();
    const buffer = await renderInvoicePdfBuffer(invoice as never, company);
    await sendTelegramDocumentBuffer(
      chatId,
      buffer,
      `${invoice.invoiceNumber}.pdf`,
      localized(language, {
        fr: `PDF de la facture ${invoice.invoiceNumber}`,
        en: `Invoice PDF ${invoice.invoiceNumber}`,
        ar: `ملف PDF للفاتورة ${invoice.invoiceNumber}`,
      })
    );
    return;
  }

  if (reference.kind === "contract") {
    const result = await contractService.downloadPdf(reference.id, user.id, permissionScope(user.permissionScopes, "contracts.pdf.download"), language);
    await sendTelegramDocumentBuffer(chatId, result.buffer, result.fileName);
    return;
  }

  if (reference.kind === "credit_note") {
    const result = await creditNoteService.pdfBuffer(reference.id, user.id, permissionScope(user.permissionScopes, "credit_notes.pdf.download"), language);
    await sendTelegramDocumentBuffer(chatId, result.buffer, result.fileName);
    return;
  }

  if (reference.kind === "expense") {
    const result = await expenseService.renderNotePdf(
      { ...user, name: user.name, email: user.email } as never,
      reference.id,
      "expense_notes.pdf.download",
      "PDF_DOWNLOADED" as never,
      language
    );
    await sendTelegramDocumentBuffer(chatId, result.buffer, result.fileName);
    return;
  }

  if (reference.kind === "quote") {
    const devis = await devisService.getDevisById(reference.id, user.id, permissionScope(user.permissionScopes, "devis.download"));
    const company = await settingsService.getCompanySettings();
    const buffer = await renderDevisPdfBuffer(devis as never, company);
    await sendTelegramDocumentBuffer(chatId, buffer, `${devis.devisNumber}.pdf`);
  }
}

async function executeTelegramEntityEmail(user: AssistantUser, reference: TelegramEntityReference, language: SupportedLanguage) {
  if (reference.kind === "invoice") {
    return invoiceService.sendInvoiceEmail(reference.id, user.id, permissionScope(user.permissionScopes, "invoices.send"), {
      pdfLanguage: language,
    } as never);
  }

  if (reference.kind === "contract") {
    return contractService.sendByEmail(reference.id, user as never, permissionScope(user.permissionScopes, "contracts.email.send"), {
      pdfLanguage: language,
    } as never, env.CLIENT_URL);
  }

  if (reference.kind === "credit_note") {
    return creditNoteService.sendEmail(reference.id, user.id, permissionScope(user.permissionScopes, "credit_notes.email.send"), {
      pdfLanguage: language,
    } as never);
  }

  if (reference.kind === "expense") {
    return expenseService.sendNoteEmail(user as never, reference.id, { pdfLanguage: language } as never);
  }

  if (reference.kind === "quote") {
    return devisService.sendDevisEmail(reference.id, user.id, permissionScope(user.permissionScopes, "devis.send"), {
      pdfLanguage: language,
    });
  }

  throw ApiError.badRequest("This document cannot be emailed from Telegram yet.");
}

function buildExecutionResultButtons(result: unknown, language: SupportedLanguage) {
  const reference = extractTelegramEntityReference(result);
  if (!reference) return undefined;
  return documentActionKeyboard(reference, language);
}

function buildUnknownEmailReply(language: SupportedLanguage) {
  return localized(language, {
    fr: "📧 Si cet e-mail correspond à un compte ERP actif, un code de liaison Telegram vient d’être envoyé.",
    en: "📧 If this email belongs to an active ERP account, a Telegram linking code has been sent.",
    ar: "📧 إذا كان هذا البريد الإلكتروني مرتبطا بحساب ERP نشط، فقد تم إرسال رمز ربط تيليجرام إليه.",
  });
}

async function processTelegramAssistantInput(params: {
  chatId: string | number;
  chatKey: string;
  telegramUserKey: string;
  session: Awaited<ReturnType<typeof getOrCreateTelegramSession>>;
  language: SupportedLanguage;
  text: string;
}) {
  const { chatId, chatKey, telegramUserKey, text } = params;
  let { session, language } = params;

  const assistantUser = await getTelegramAssistantUser(telegramUserKey, chatKey);
  if (!assistantUser) {
    await sendTelegramMessage(
      chatId,
      localized(language, {
        fr: "Votre compte Telegram n’est pas lié à un compte ERP actif. Utilisez /code puis /link pour vous connecter.",
        en: "Your Telegram account is not linked to an active ERP account. Use /code then /link to connect.",
        ar: "حساب تيليجرام هذا غير مرتبط بحساب ERP نشط. استخدم /code ثم /link للاتصال.",
      })
    );
    return { handled: true, action: "not_linked" } as const;
  }

  session = await updateSessionLanguageAndUser(session.id, language, assistantUser.id);
  const conversation = await findOrCreateTelegramConversation(assistantUser, chatKey, session, language);
  const pendingForm = parsePendingForm(session);

  if (pendingForm) {
    try {
      const [continuationPreview, messagePlan] = await Promise.all([
        aiAssistantService.previewStructuredFormContinuation({
          currentValues: pendingForm.values,
          missingFields: pendingForm.missingFields,
          fields: pendingForm.fields,
          message: text,
          language: pendingForm.language,
        }),
        aiAssistantService.previewMessagePlan(assistantUser, pendingForm.conversationId, {
          content: text,
          language,
        }),
      ]);

      const hasMeaningfulContinuation = Boolean(continuationPreview?.hasMeaningfulValues);
      const nextToolName = typeof messagePlan?.toolName === "string" ? messagePlan.toolName : null;
      const switchesToNewAction = Boolean(nextToolName && nextToolName !== pendingForm.toolName);

      if (!hasMeaningfulContinuation && !switchesToNewAction) {
        await sendTelegramMessage(
          chatId,
          localized(language, {
            fr: "Je n’ai pas reconnu de réponse exploitable. Merci de continuer le formulaire en cours ou de démarrer une nouvelle action explicite.",
            en: "I could not detect usable values. Please continue the current form or start a new action.",
            ar: "لم أتعرف على قيم صالحة. يرجى متابعة النموذج الحالي أو بدء إجراء جديد بشكل واضح.",
          })
        );
        return { handled: true, action: "pending_form_needs_clarification" } as const;
      }

      if (switchesToNewAction && !hasMeaningfulContinuation) {
        await clearTransientSessionState(session.id, { keepConversation: true, keepLanguage: true });
        return processTelegramAssistantInput({
          chatId,
          chatKey,
          telegramUserKey,
          session: await getOrCreateTelegramSession(chatKey, telegramUserKey, language),
          language,
          text,
        });
      }

      const formResult = (await aiAssistantService.continueStructuredForm(assistantUser, {
        toolName: pendingForm.toolName,
        conversationId: pendingForm.conversationId,
        currentValues: pendingForm.values,
        missingFields: pendingForm.missingFields,
        fields: pendingForm.fields,
        message: text,
        language: pendingForm.language,
        replaceActionId: pendingForm.replaceActionId,
      })) as TelegramExecutionResult;

      if (formResult?.type === "structured_form" && formResult.form) {
        const form = formResult.form;
        const nextLanguage = normalizeLanguage(form.language ?? pendingForm.language);
        await storePendingForm(
          session.id,
          {
            toolName: formResult.toolName || form.toolName || pendingForm.toolName,
            conversationId: pendingForm.conversationId,
            values: form.values ?? {},
            missingFields: Array.isArray(form.missingFields) ? form.missingFields : [],
            fields: Array.isArray(form.fields) ? form.fields : [],
            language: nextLanguage,
            replaceActionId: typeof formResult.replaceActionId === "string" ? formResult.replaceActionId : pendingForm.replaceActionId,
          },
          assistantUser.id
        );

        await sendTelegramMessage(chatId, formatStructuredFormMessage(form, nextLanguage));
        return { handled: true, action: "form_continuation" } as const;
      }

      await clearTransientSessionState(session.id, { keepConversation: true, keepLanguage: true });

      if (formResult?.type === "pending_action" && formResult?.action?.id) {
        const responseLines = [
          formatPreviewSummary(formResult.action, language),
          "",
          localized(language, {
            fr: "⚠️ Confirmation requise.",
            en: "⚠️ Confirmation required.",
            ar: "⚠️ التأكيد مطلوب.",
          }),
          `/confirm ${formResult.action.id}`,
        ];
        await sendTelegramMessage(chatId, responseLines.join("\n"), {
          replyMarkup: pendingActionKeyboard(formResult.action.id, language),
        });
        return { handled: true, action: "pending_confirmation", actionId: formResult.action.id } as const;
      }

      await sendTelegramMessage(
        chatId,
        localized(language, {
          fr: "✅ Action traitée avec succès.",
          en: "✅ Action processed successfully.",
          ar: "✅ تمت معالجة العملية بنجاح.",
        })
      );
      return { handled: true, action: "form_completed" } as const;
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : localized(language, {
              fr: "Je n’ai pas pu traiter ces informations. Merci de réessayer avec les champs manquants.",
              en: "I could not process those details. Please try again with the missing fields.",
              ar: "تعذر عليّ معالجة هذه المعلومات. يرجى المحاولة مرة أخرى مع الحقول الناقصة.",
            });
      await sendTelegramMessage(chatId, `❌ ${message}`);
      return { handled: true, action: "form_continuation_failed" } as const;
    }
  }

  const aiResult = await aiAssistantService.sendMessage(assistantUser, conversation.id, {
    content: text,
    language,
  });

  const executionResult = aiResult.executionResult as TelegramExecutionResult | undefined;
  let telegramReply = formatTelegramToolResultMessage(executionResult, language) ?? aiResult.message.content;

  if (executionResult?.type === "structured_form" && executionResult.form) {
    const form = executionResult.form;
    const nextLanguage = normalizeLanguage(form.language ?? language);
    await storePendingForm(
      session.id,
      {
        toolName: executionResult.toolName || form.toolName || "unknown",
        conversationId: conversation.id,
        values: form.values ?? {},
        missingFields: Array.isArray(form.missingFields) ? form.missingFields : [],
        fields: Array.isArray(form.fields) ? form.fields : [],
        language: nextLanguage,
        replaceActionId: typeof executionResult.replaceActionId === "string" ? executionResult.replaceActionId : undefined,
      },
      assistantUser.id
    );

    telegramReply = [aiResult.message.content, "", formatStructuredFormMessage(form, nextLanguage)]
      .filter(Boolean)
      .join("\n");
  } else if (executionResult?.type === "pending_action" && executionResult.action?.id) {
    await clearTransientSessionState(session.id, { keepConversation: true, keepLanguage: true });
    telegramReply = [
      aiResult.message.content,
      "",
      formatPreviewSummary(executionResult.action, language),
      "",
      localized(language, {
        fr: "⚠️ Confirmation requise :",
        en: "⚠️ Confirmation required:",
        ar: "⚠️ التأكيد مطلوب:",
      }),
      `/confirm ${executionResult.action.id}`,
    ]
      .filter(Boolean)
      .join("\n");
    await sendTelegramMessage(chatId, telegramReply, {
      replyMarkup: pendingActionKeyboard(executionResult.action.id, language),
    });
    return {
      handled: true,
      action: "ai_response",
      conversationId: conversation.id,
    } as const;
  } else if (executionResult?.type === "tool_result") {
    if (
      executionResult.toolName === "generate_invoice_pdf"
      || executionResult.toolName === "generate_quote_pdf"
      || executionResult.toolName === "generate_contract_pdf"
      || executionResult.toolName === "generate_credit_note_pdf"
      || executionResult.toolName === "generate_expense_pdf"
    ) {
      const reference = extractTelegramEntityReference(executionResult.result);
      if (reference) {
        await sendTelegramEntityPdf(chatId, assistantUser, reference, language);
      }
    }
  }

  await sendTelegramMessage(chatId, telegramReply, {
    replyMarkup: buildExecutionResultButtons(executionResult?.result, language),
  });

  return {
    handled: true,
    action: "ai_response",
    conversationId: conversation.id,
  } as const;
}

async function openTelegramPendingActionForm(params: {
  assistantUser: AssistantUser;
  sessionId: string;
  chatId: string | number;
  actionId: string;
  language: SupportedLanguage;
}) {
  const action = await prisma.aiPendingAction.findUniqueOrThrow({ where: { id: params.actionId } });
  const reopened = await aiAssistantService.reopenPendingActionForm(params.assistantUser, params.actionId, params.language) as TelegramExecutionResult;
  if (reopened.type !== "structured_form" || !reopened.form) {
    throw ApiError.badRequest("This AI action cannot be edited.");
  }

  const nextLanguage = normalizeLanguage(reopened.form.language ?? params.language);
  await storePendingForm(
    params.sessionId,
    {
      toolName: reopened.toolName || reopened.form.toolName || "unknown",
      conversationId: action.conversationId,
      values: reopened.form.values ?? {},
      missingFields: Array.isArray(reopened.form.missingFields) ? reopened.form.missingFields : [],
      fields: Array.isArray(reopened.form.fields) ? reopened.form.fields : [],
      language: nextLanguage,
      replaceActionId: typeof reopened.replaceActionId === "string" ? reopened.replaceActionId : params.actionId,
    },
    params.assistantUser.id
  );

  await sendTelegramMessage(params.chatId, formatStructuredFormMessage(reopened.form, nextLanguage));
}

async function prepareTelegramEmailAction(params: {
  assistantUser: AssistantUser;
  chatId: string | number;
  language: SupportedLanguage;
  reference: TelegramEntityReference;
  conversationId?: string | null;
}) {
  const toolByKind: Record<TelegramEntityKind, { toolName: string; input: Record<string, unknown> }> = {
    invoice: { toolName: "send_invoice_email", input: { invoiceId: params.reference.id } },
    contract: { toolName: "send_contract_email", input: { id: params.reference.id } },
    credit_note: { toolName: "send_credit_note_email", input: { id: params.reference.id } },
    expense: { toolName: "send_expense_email", input: { id: params.reference.id } },
    quote: { toolName: "send_quote_email", input: { id: params.reference.id } },
  };

  const configured = toolByKind[params.reference.kind];
  const execution = await aiAssistantService.executeTool(params.assistantUser, {
    toolName: configured.toolName,
    input: configured.input,
    conversationId: params.conversationId ?? undefined,
    language: params.language,
  }) as TelegramExecutionResult;

  if (execution.type !== "pending_action" || !execution.action?.id) {
    throw ApiError.badRequest("Unable to prepare the email action.");
  }

  const message = [
    localized(params.language, {
      fr: "Préparation de l’envoi par e-mail.",
      en: "Preparing email delivery.",
      ar: "جارٍ تجهيز الإرسال بالبريد الإلكتروني.",
    }),
    "",
    formatPreviewSummary(execution.action, params.language),
    "",
    localized(params.language, {
      fr: "⚠️ Confirmation requise :",
      en: "⚠️ Confirmation required:",
      ar: "⚠️ التأكيد مطلوب:",
    }),
    `/confirm ${execution.action.id}`,
  ].join("\n");

  await sendTelegramMessage(params.chatId, message, {
    replyMarkup: pendingActionKeyboard(execution.action.id, params.language),
  });
}

async function handleTelegramCallbackQuery(update: any) {
  const callbackQuery = update?.callback_query;
  if (!callbackQuery?.id || !callbackQuery?.data) {
    return { handled: false, reason: "No callback query found" };
  }

  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;
  const telegramUserId = callbackQuery.from?.id;
  if (!chatId || !messageId || !telegramUserId) {
    await answerTelegramCallbackQuery(String(callbackQuery.id), "Invalid callback.");
    return { handled: true, action: "invalid_callback" };
  }

  const chatKey = String(chatId);
  const telegramUserKey = String(telegramUserId);
  const session = await getOrCreateTelegramSession(chatKey, telegramUserKey, normalizeLanguage(callbackQuery.from?.language_code));
  const language = normalizeLanguage(session.language || callbackQuery.from?.language_code);
  const assistantUser = await getTelegramAssistantUser(telegramUserKey, chatKey);

  if (!assistantUser) {
    await answerTelegramCallbackQuery(String(callbackQuery.id));
    await sendTelegramMessage(chatId, localized(language, {
      fr: "Votre compte Telegram n’est pas lié à un compte ERP actif.",
      en: "Your Telegram account is not linked to an active ERP account.",
      ar: "حساب تيليجرام هذا غير مرتبط بحساب ERP نشط.",
    }));
    return { handled: true, action: "not_linked" };
  }

  const data = String(callbackQuery.data);

  try {
    if (data.startsWith("ai:confirm:")) {
      const actionId = data.slice("ai:confirm:".length);
      const result = await aiAssistantService.confirmAction(assistantUser, actionId);
      await clearTransientSessionState(session.id, { keepConversation: true, keepLanguage: true });
      await answerTelegramCallbackQuery(String(callbackQuery.id), localized(language, {
        fr: "Action confirmée.",
        en: "Action confirmed.",
        ar: "تم تأكيد العملية.",
      }));
      await editTelegramMessage(chatId, messageId, localized(language, {
        fr: "✅ Action confirmée et exécutée.",
        en: "✅ Action confirmed and executed.",
        ar: "✅ تم تأكيد العملية وتنفيذها.",
      }));
      await sendTelegramMessage(chatId, formatConfirmationResult(result.result, language), {
        replyMarkup: buildExecutionResultButtons(result.result, language),
      });
      return { handled: true, action: "confirmed_callback" };
    }

    if (data.startsWith("ai:cancel:")) {
      const actionId = data.slice("ai:cancel:".length);
      await aiAssistantService.cancelAction(assistantUser, actionId);
      await clearTransientSessionState(session.id, { keepConversation: true, keepLanguage: true });
      await answerTelegramCallbackQuery(String(callbackQuery.id), localized(language, {
        fr: "Action annulée.",
        en: "Action cancelled.",
        ar: "تم إلغاء العملية.",
      }));
      await editTelegramMessage(chatId, messageId, localized(language, {
        fr: "❌ Action annulée.",
        en: "❌ Action cancelled.",
        ar: "❌ تم إلغاء العملية.",
      }));
      return { handled: true, action: "cancelled_callback" };
    }

    if (data.startsWith("ai:edit:")) {
      const actionId = data.slice("ai:edit:".length);
      await answerTelegramCallbackQuery(String(callbackQuery.id), localized(language, {
        fr: "Ouverture de l’édition…",
        en: "Opening editor…",
        ar: "جارٍ فتح التعديل…",
      }));
      await openTelegramPendingActionForm({
        assistantUser,
        sessionId: session.id,
        chatId,
        actionId,
        language,
      });
      return { handled: true, action: "edit_callback" };
    }

    if (data.startsWith("doc:pdf:") || data.startsWith("doc:email:")) {
      const [, operation, kind, ...rest] = data.split(":");
      const id = rest.join(":");
      const reference = { kind: kind as TelegramEntityKind, id } as TelegramEntityReference;
      await answerTelegramCallbackQuery(String(callbackQuery.id));
      if (operation === "pdf") {
        await sendTelegramEntityPdf(chatId, assistantUser, reference, language);
        return { handled: true, action: "document_pdf_callback" };
      }
      if (operation === "email") {
        await prepareTelegramEmailAction({
          assistantUser,
          chatId,
          language,
          reference,
          conversationId: session.conversationId,
        });
        return { handled: true, action: "document_email_callback" };
      }
    }
  } catch (error) {
    const message =
      error instanceof ApiError
        ? error.message
        : localized(language, {
            fr: "Je n’ai pas pu traiter cette action Telegram.",
            en: "I could not process this Telegram action.",
            ar: "تعذر عليّ معالجة هذا الإجراء في تيليجرام.",
          });
    await answerTelegramCallbackQuery(String(callbackQuery.id), message.slice(0, 180));
    await sendTelegramMessage(chatId, `❌ ${message}`);
    return { handled: true, action: "callback_failed" };
  }

  await answerTelegramCallbackQuery(String(callbackQuery.id), localized(language, {
    fr: "Action Telegram inconnue.",
    en: "Unknown Telegram action.",
    ar: "إجراء تيليجرام غير معروف.",
  }));
  return { handled: true, action: "unknown_callback" };
}

export async function handleTelegramUpdate(update: any) {
  if (update?.callback_query) {
    return handleTelegramCallbackQuery(update);
  }

  const message = update?.message;
  if (!message) {
    return { handled: false, reason: "No message found" };
  }

  const chatId = message.chat?.id;
  const telegramUserId = message.from?.id;
  const text = typeof message.text === "string" ? message.text.trim() : "";
  const media = resolveTelegramMedia(message);

  if (!chatId || !telegramUserId || (!text && !media)) {
    return { handled: false, reason: "Invalid Telegram message" };
  }

  const chatKey = String(chatId);
  const telegramUserKey = String(telegramUserId);
  const initialLanguage = normalizeLanguage(message.from?.language_code);
  let session = await getOrCreateTelegramSession(chatKey, telegramUserKey, initialLanguage);
  let language = normalizeLanguage(session.language || initialLanguage);


  if (text === "/start") {
    await updateSessionLanguageAndUser(session.id, language, session.userId);
    await sendTelegramMessage(
      chatId,
      localized(language, {
        fr: "Bienvenue dans l’assistant IA ERP.\n\n1. Envoyez /code pour recevoir un code de liaison par e-mail.\n2. Envoyez /link VOTRE_CODE pour connecter Telegram à votre compte ERP.\n3. Une fois lié, vous pourrez utiliser l’assistant ERP directement ici.",
        en: "Welcome to the ERP AI Assistant.\n\n1. Send /code to receive a linking code by email.\n2. Send /link YOUR_CODE to connect Telegram to your ERP account.\n3. Once linked, you can use the ERP assistant directly here.",
        ar: "مرحباً بك في مساعد ERP الذكي.\n\n1. أرسل /code لتلقي رمز الربط عبر البريد الإلكتروني.\n2. أرسل /link YOUR_CODE لربط تيليجرام بحساب ERP الخاص بك.\n3. بعد الربط، يمكنك استخدام المساعد مباشرة من هنا.",
      })
    );

    return { handled: true, action: "start" };
  }

  if (text === "/code") {
    session = await setAwaitingEmail(session.id, true);
    await sendTelegramMessage(
      chatId,
      localized(language, {
        fr: "📧 Envoyez-moi l’adresse e-mail de votre compte ERP.",
        en: "📧 Send me the email address of your ERP account.",
        ar: "📧 أرسل لي عنوان البريد الإلكتروني لحساب ERP الخاص بك.",
      })
    );
    return { handled: true, action: "awaiting_email" };
  }

  if (text === "/unlink") {
    const linkedAccount = await prisma.telegramAccount.findFirst({
      where: {
        OR: [{ telegramUserId: telegramUserKey }, { telegramChatId: chatKey }],
      },
    });

    if (!linkedAccount) {
      await clearTransientSessionState(session.id, { keepConversation: false, keepLanguage: true, clearUser: true });
      await sendTelegramMessage(
        chatId,
        localized(language, {
          fr: "Votre compte Telegram n’est actuellement lié à aucun compte ERP.",
          en: "Your Telegram account is not currently linked to any ERP account.",
          ar: "حساب تيليجرام هذا غير مرتبط حالياً بأي حساب ERP.",
        })
      );
      return { handled: true, action: "unlink_not_linked" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.telegramAccount.deleteMany({
        where: {
          OR: [{ telegramUserId: telegramUserKey }, { telegramChatId: chatKey }],
        },
      });
      await tx.telegramSession.update({
        where: { id: session.id },
        data: {
          userId: null,
          conversationId: null,
          awaitingEmail: false,
          pendingToolName: null,
          pendingFormValues: Prisma.JsonNull,
          pendingMissingFields: Prisma.JsonNull,
          pendingFields: Prisma.JsonNull,
          stateExpiresAt: null,
          lastInteractionAt: new Date(),
        },
      });
    });

    await sendTelegramMessage(
      chatId,
      localized(language, {
        fr: "✅ Le lien Telegram a été supprimé. Les commandes ERP IA sont maintenant désactivées jusqu’à une nouvelle liaison.",
        en: "✅ Telegram has been unlinked. ERP AI commands are now disabled until you link again.",
        ar: "✅ تم إلغاء ربط تيليجرام. أوامر ERP الذكية معطلة الآن حتى تعيد الربط.",
      })
    );

    return { handled: true, action: "unlinked" };
  }

  if (text === "/cancel") {
    await clearTransientSessionState(session.id, { keepConversation: true, keepLanguage: true });
    await sendTelegramMessage(
      chatId,
      localized(language, {
        fr: "🛑 Le formulaire en attente a été annulé.",
        en: "🛑 The pending form has been cancelled.",
        ar: "🛑 تم إلغاء النموذج المعلق.",
      })
    );
    return { handled: true, action: "cancel_form" };
  }

  if (session.awaitingEmail) {
    if (!text) {
      await sendTelegramMessage(
        chatId,
        localized(language, {
          fr: "Merci d’envoyer l’adresse e-mail de votre compte ERP sous forme de texte pour recevoir le code de liaison.",
          en: "Please send your ERP account email address as text to receive the linking code.",
          ar: "يرجى إرسال عنوان البريد الإلكتروني لحساب ERP كنص لتلقي رمز الربط.",
        })
      );
      return { handled: true, action: "awaiting_email_text" };
    }

    await setAwaitingEmail(session.id, false);

    const email = text.trim().toLowerCase();
    const genericReply = buildUnknownEmailReply(language);
    const lastCodeRequestedAt = session.lastCodeRequestedAt?.getTime() ?? 0;
    const rateLimited = Date.now() - lastCodeRequestedAt < LINK_CODE_RATE_LIMIT_MS;

    try {
      if (!rateLimited) {
        const user = await prisma.user.findFirst({
          where: {
            email: { equals: email, mode: "insensitive" },
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            email: true,
          },
        });

        if (user) {
          const link = await createTelegramLinkCode(user.id);
          await settingsService.sendTelegramLinkCodeEmail(
            { name: user.name, email: user.email },
            link.code,
            link.expiresAt
          );

          await prisma.telegramSession.update({
            where: { id: session.id },
            data: {
              userId: user.id,
              lastCodeRequestedAt: new Date(),
              lastInteractionAt: new Date(),
            },
          });
        } else {
          await prisma.telegramSession.update({
            where: { id: session.id },
            data: {
              lastCodeRequestedAt: new Date(),
              lastInteractionAt: new Date(),
            },
          });
        }
      }
    } catch {
      // Preserve generic response to avoid leaking account existence or email delivery details.
    }

    await sendTelegramMessage(chatId, genericReply);
    return { handled: true, action: "link_code_email_requested" };
  }

  if (text.startsWith("/link ")) {
    const code = text.slice(6).trim().toUpperCase();
    const linkCode = await prisma.telegramLinkCode.findUnique({
      where: { code },
      include: {
        user: {
          select: {
            id: true,
            isActive: true,
          },
        },
      },
    });

    if (!linkCode) {
      await sendTelegramMessage(
        chatId,
        localized(language, {
          fr: "Code de liaison invalide. Générez un nouveau code depuis les paramètres ERP.",
          en: "Invalid linking code. Generate a new code from ERP Settings.",
          ar: "رمز الربط غير صالح. أنشئ رمزاً جديداً من إعدادات ERP.",
        })
      );
      return { handled: true, action: "link_failed", reason: "invalid_code" };
    }

    if (linkCode.usedAt) {
      await sendTelegramMessage(
        chatId,
        localized(language, {
          fr: "Ce code de liaison a déjà été utilisé.",
          en: "This linking code has already been used.",
          ar: "تم استخدام رمز الربط هذا بالفعل.",
        })
      );
      return { handled: true, action: "link_failed", reason: "already_used" };
    }

    if (linkCode.expiresAt.getTime() < Date.now()) {
      await sendTelegramMessage(
        chatId,
        localized(language, {
          fr: "Ce code de liaison a expiré. Générez-en un nouveau depuis les paramètres ERP.",
          en: "This linking code has expired. Generate a new one from ERP Settings.",
          ar: "انتهت صلاحية رمز الربط هذا. أنشئ رمزاً جديداً من إعدادات ERP.",
        })
      );
      return { handled: true, action: "link_failed", reason: "expired" };
    }

    if (!linkCode.user.isActive) {
      await sendTelegramMessage(
        chatId,
        localized(language, {
          fr: "Ce compte ERP n’est plus actif. Impossible de finaliser la liaison.",
          en: "This ERP account is no longer active. Linking cannot be completed.",
          ar: "حساب ERP هذا لم يعد نشطاً. لا يمكن إكمال الربط.",
        })
      );
      return { handled: true, action: "link_failed", reason: "user_inactive" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.telegramLinkCode.update({
        where: { id: linkCode.id },
        data: { usedAt: new Date() },
      });
    });

    await linkTelegramAccount(session.id, telegramUserKey, chatKey, linkCode.userId, language);

    await sendTelegramMessage(
      chatId,
      localized(language, {
        fr: "✅ Votre compte Telegram est maintenant connecté en toute sécurité à votre compte ERP.",
        en: "✅ Your Telegram account is now securely linked to your ERP account.",
        ar: "✅ تم ربط حساب تيليجرام الخاص بك بأمان بحساب ERP الخاص بك.",
      })
    );

    return { handled: true, action: "linked", userId: linkCode.userId };
  }

  if (text.startsWith("/confirm ")) {
    const actionId = text.slice(9).trim();
    const assistantUser = await getTelegramAssistantUser(telegramUserKey, chatKey);

    if (!assistantUser) {
      await clearTransientSessionState(session.id, { keepConversation: false, keepLanguage: true, clearUser: true });
      await sendTelegramMessage(
        chatId,
        localized(language, {
          fr: "Votre compte Telegram n’est pas lié à un compte ERP actif.",
          en: "Your Telegram account is not linked to an active ERP account.",
          ar: "حساب تيليجرام هذا غير مرتبط بحساب ERP نشط.",
        })
      );
      return { handled: true, action: "not_linked" };
    }

    try {
      const result = await aiAssistantService.confirmAction(assistantUser, actionId);
      await sendTelegramMessage(chatId, formatConfirmationResult(result.result, language));
      return { handled: true, action: "confirmed", result };
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : localized(language, {
              fr: "Je n’ai pas pu confirmer cette action. Elle est peut-être expirée, invalide ou non autorisée.",
              en: "I could not confirm this action. It may be expired, invalid, or not allowed.",
              ar: "تعذر عليّ تأكيد هذه العملية. قد تكون منتهية الصلاحية أو غير صالحة أو غير مسموح بها.",
            });

      await sendTelegramMessage(chatId, `❌ ${message}`);
      return { handled: true, action: "confirm_failed" };
    }
  }

  if (media) {
    const linkedAssistantUser = await getTelegramAssistantUser(telegramUserKey, chatKey);
    if (!linkedAssistantUser) {
      await sendTelegramMessage(
        chatId,
        localized(language, {
          fr: "Votre compte Telegram n’est pas lié à un compte ERP actif. Utilisez /code puis /link pour vous connecter.",
          en: "Your Telegram account is not linked to an active ERP account. Use /code then /link to connect.",
          ar: "حساب تيليجرام هذا غير مرتبط بحساب ERP نشط. استخدم /code ثم /link للاتصال.",
        })
      );
      return { handled: true, action: "not_linked" };
    }

    if (!isSupportedAudioMimeType(media.mimeType)) {
      await sendTelegramMessage(chatId, `❌ ${buildAudioValidationMessage(language, "unsupported")}`);
      return { handled: true, action: "audio_unsupported" };
    }

    if ((media.fileSize || 0) > TELEGRAM_AUDIO_SIZE_LIMIT_BYTES) {
      await sendTelegramMessage(chatId, `❌ ${buildAudioValidationMessage(language, "oversized")}`);
      return { handled: true, action: "audio_oversized" };
    }

    if (!env.OPENAI_API_KEY) {
      await sendTelegramMessage(chatId, `❌ ${buildAudioValidationMessage(language, "missing_openai")}`);
      return { handled: true, action: "audio_unavailable" };
    }

    await sendTelegramMessage(chatId, buildVoiceAcknowledgement(language));

    try {
      const audio = await downloadTelegramAudio(media);
      const transcription = await transcribeTelegramAudio(audio);
      language = normalizeLanguage(session.language || transcription.detectedLanguage || language);
      await sendTelegramMessage(chatId, buildTranscriptAcknowledgement(language, transcription.transcript));
      return processTelegramAssistantInput({
        chatId,
        chatKey,
        telegramUserKey,
        session,
        language,
        text: transcription.transcript,
      });
    } catch (error) {
      let messageText = localized(language, {
        fr: "Je n’ai pas pu traiter ce message audio. Merci de réessayer avec un fichier audio pris en charge ou un message texte.",
        en: "I could not process this audio message. Please try again with a supported audio file or a text message.",
        ar: "تعذر عليّ معالجة هذه الرسالة الصوتية. يرجى إعادة المحاولة بملف صوتي مدعوم أو رسالة نصية.",
      });

      if (error instanceof ApiError) {
        if (error.message === "unsupported_telegram_audio") {
          messageText = buildAudioValidationMessage(language, "unsupported");
        } else if (error.message === "oversized_telegram_audio") {
          messageText = buildAudioValidationMessage(language, "oversized");
        } else if (error.message === "missing_openai_transcription") {
          messageText = buildAudioValidationMessage(language, "missing_openai");
        } else if (error.message === "empty_telegram_transcript") {
          messageText = localized(language, {
            fr: "Je n’ai pas compris de texte exploitable dans ce message vocal. Merci de réessayer plus clairement.",
            en: "I could not detect usable speech in this voice message. Please try again more clearly.",
            ar: "لم أتمكن من استخراج كلام قابل للاستخدام من هذه الرسالة الصوتية. يرجى المحاولة مرة أخرى بوضوح أكبر.",
          });
        }
      }

      await sendTelegramMessage(chatId, `❌ ${messageText}`);
      return { handled: true, action: "audio_processing_failed" };
    }
  }

  if (!text) {
    return { handled: false, reason: "Unsupported Telegram message" };
  }

  return processTelegramAssistantInput({
    chatId,
    chatKey,
    telegramUserKey,
    session,
    language,
    text,
  });
}
export async function startTelegramPolling() {
  if (pollingStarted) return;

  if (env.TELEGRAM_MODE !== "polling") {
    return;
  }

  const token = getTelegramBotToken();
  if (!token) {
    console.warn("Telegram polling disabled: TELEGRAM_BOT_TOKEN is missing");
    return;
  }

  pollingStarted = true;
  console.log("Telegram long polling started");

  let offset = 0;

  while (pollingStarted) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=30&offset=${offset}`);
      if (!response.ok) {
        throw new Error(`Telegram getUpdates error: ${response.status}`);
      }

      const data = (await response.json()) as {
        ok: boolean;
        result: Array<{ update_id: number; message?: unknown }>;
      };

      if (!data.ok) {
        throw new Error("Telegram getUpdates returned ok=false");
      }

      for (const update of data.result) {
        offset = update.update_id + 1;
        try {
          await handleTelegramUpdate(update);
        } catch (error) {
          console.error("Telegram update processing error:", error);
        }
      }
    } catch (error) {
      console.error("Telegram polling error:", error);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

export function stopTelegramPolling() {
  pollingStarted = false;
}

export async function createTelegramLinkCode(userId: string) {
  const existingCode = await prisma.telegramLinkCode.findFirst({
    where: {
      userId,
      usedAt: null,
      expiresAt: {
        gt: new Date(),
      },
    },
    orderBy: {
      expiresAt: "desc",
    },
  });

  if (existingCode) {
    return {
      code: existingCode.code,
      expiresAt: existingCode.expiresAt,
      expiresInMinutes: Math.ceil((existingCode.expiresAt.getTime() - Date.now()) / 60000),
    };
  }

  await prisma.telegramLinkCode.deleteMany({
    where: {
      userId,
      usedAt: null,
    },
  });

  const randomPart = crypto.randomBytes(4).toString("hex").toUpperCase();
  const code = `TG-${randomPart}`;
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  const linkCode = await prisma.telegramLinkCode.create({
    data: {
      code,
      userId,
      expiresAt,
    },
  });

  return {
    code: linkCode.code,
    expiresAt: linkCode.expiresAt,
    expiresInMinutes: 15,
  };
}
