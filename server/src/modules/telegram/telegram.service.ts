import crypto from "crypto";
import { prisma } from "@config/database";
import { settingsService } from "@modules/settings/settings.service";
import { aiAssistantService } from '@modules/ai-assistant/aiAssistant.service';
import type { AssistantUser } from "@modules/ai-assistant/tools/toolTypes";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function sendTelegramMessage(
  chatId: string | number,
  text: string
) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Telegram API error: ${response.status}`);
  }
}

async function getTelegramAssistantUser(
  telegramUserId: string
): Promise<AssistantUser | null>  {
  const account = await prisma.telegramAccount.findUnique({
    where: {
      telegramUserId,
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

  if (!account || !account.user.isActive) {
    return null;
  }


return {
  id: account.user.id,
  name: account.user.name,
  email: account.user.email,
  role: account.user.role,

  permissions:
    account.user.rbacRole?.permissions.map(
      ({ permission }) => permission.key
    ) ?? [],

  permissionScopes: Object.fromEntries(
    account.user.rbacRole?.permissions.map(
      ({ permission, scope }) => [permission.key, scope]
    ) ?? []
  ),
};
}

type TelegramPendingForm = {
  toolName: string;
  conversationId: string;
  values: Record<string, unknown>;
  missingFields: string[];
  fields: any[];
  language: "fr" | "en" | "ar";
};

const telegramPendingForms = new Map<string, TelegramPendingForm>();
const telegramAwaitingEmail = new Set<string>();

export async function handleTelegramUpdate(update: any) {
  const message = update?.message;

  if (!message) {
    return {
      handled: false,
      reason: "No message found",
    };
  }

  const chatId = message.chat?.id;
  const telegramUserId = message.from?.id;
  const text = message.text?.trim();

  if (!chatId || !telegramUserId || !text) {
    return {
      handled: false,
      reason: "Invalid Telegram message",
    };
  }

  // /start
  if (text === "/start") {
    await sendTelegramMessage(
      chatId,
      "Welcome to ERP AI Assistant.\n\nTo connect your ERP account, generate a linking code from ERP Settings and send:\n/link YOUR_CODE"
    );

    return {
      handled: true,
      action: "start",
    };
  }

  // /code -> ask for ERP email
if (text === "/code") {
  telegramAwaitingEmail.add(String(chatId));

  await sendTelegramMessage(
    chatId,
    "📧 Send me the email address of your ERP account."
  );

  return {
    handled: true,
    action: "awaiting_email",
  };
}

// User is entering ERP email after /code
if (telegramAwaitingEmail.has(String(chatId))) {
  telegramAwaitingEmail.delete(String(chatId));

  const email = text.trim().toLowerCase();

  const genericReply =
    "📧 If this email belongs to an active ERP account, a Telegram linking code has been sent to it.";

  try {
    const user = await prisma.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: "insensitive",
        },
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
        {
          name: user.name,
          email: user.email,
        },
        link.code,
        link.expiresAt
      );
    }
  } catch (error) {
    console.error("Telegram email link-code error:", error);
  }

  await sendTelegramMessage(chatId, genericReply);

  return {
    handled: true,
    action: "link_code_email_requested",
  };
}

  // /link TG-XXXXXXXX
  if (text.startsWith("/link ")) {
    const code = text.slice(6).trim().toUpperCase();

    const linkCode = await prisma.telegramLinkCode.findUnique({
      where: {
        code,
      },
    });

    if (!linkCode) {
      await sendTelegramMessage(
        chatId,
        "Invalid linking code. Generate a new code from ERP Settings."
      );

      return {
        handled: true,
        action: "link_failed",
        reason: "invalid_code",
      };
    }

    if (linkCode.usedAt) {
      await sendTelegramMessage(
        chatId,
        "This linking code has already been used."
      );

      return {
        handled: true,
        action: "link_failed",
        reason: "already_used",
      };
    }

    if (linkCode.expiresAt.getTime() < Date.now()) {
      await sendTelegramMessage(
        chatId,
        "This linking code has expired. Generate a new code from ERP Settings."
      );

      return {
        handled: true,
        action: "link_failed",
        reason: "expired",
      };
    }

    await prisma.$transaction(async (tx) => {
      await tx.telegramAccount.upsert({
        where: {
          userId: linkCode.userId,
        },
        create: {
          userId: linkCode.userId,
          telegramUserId: String(telegramUserId),
          telegramChatId: String(chatId),
        },
        update: {
          telegramUserId: String(telegramUserId),
          telegramChatId: String(chatId),
          linkedAt: new Date(),
        },
      });

      await tx.telegramLinkCode.update({
        where: {
          id: linkCode.id,
        },
        data: {
          usedAt: new Date(),
        },
      });
    });

    await sendTelegramMessage(
      chatId,
      "✅ Your Telegram account is now securely connected to your ERP account."
    );

    return {
      handled: true,
      action: "linked",
      userId: linkCode.userId,
    };
  }
  // /confirm ACTION_ID
if (text.startsWith("/confirm ")) {
  const actionId = text.slice(9).trim();

  const assistantUser = await getTelegramAssistantUser(
    String(telegramUserId)
  );

  if (!assistantUser) {
    await sendTelegramMessage(
      chatId,
      "Your Telegram account is not linked to an active ERP account."
    );

    return {
      handled: true,
      action: "not_linked",
    };
  }

  try {
    const result = await aiAssistantService.confirmAction(
      assistantUser,
      actionId
    );

    await sendTelegramMessage(
      chatId,
      "✅ Action confirmed and executed successfully."
    );

    return {
      handled: true,
      action: "confirmed",
      result,
    };
  } catch (error) {
    console.error("Telegram confirm action error:", error);

    await sendTelegramMessage(
      chatId,
      "❌ I could not confirm this action. It may be expired, invalid, or not allowed."
    );

    return {
      handled: true,
      action: "confirm_failed",
    };
  }
}



const assistantUser = await getTelegramAssistantUser(
  String(telegramUserId)
);

if (!assistantUser) {
  await sendTelegramMessage(
    chatId,
    "Your Telegram account is not linked to an active ERP account."
  );

  return {
    handled: true,
    action: "not_linked",
  };
}

const conversationTitle = `Telegram ${chatId}`;

let conversation = await prisma.aiConversation.findFirst({
  where: {
    userId: assistantUser.id,
    title: conversationTitle,
    status: "ACTIVE",
  },
  orderBy: {
    updatedAt: "desc",
  },
});

if (!conversation) {
  conversation = await aiAssistantService.createConversation(
    assistantUser,
    {
      title: conversationTitle,
      language: "fr",
    }
  );
}
const pendingForm = telegramPendingForms.get(String(chatId));

if (pendingForm) {
  try {
    const formResult = await aiAssistantService.continueStructuredForm(
      assistantUser,
      {
        toolName: pendingForm.toolName,
        conversationId: pendingForm.conversationId,
        currentValues: pendingForm.values,
        missingFields: pendingForm.missingFields,
        fields: pendingForm.fields,
        message: text,
        language: pendingForm.language,
      }
    );

    const result = formResult as any;

    // Mazal chi champs na9sin
    if (
      result?.type === "structured_form" &&
      result?.form
    ) {
      const form = result.form;

      telegramPendingForms.set(String(chatId), {
        toolName: result.toolName || form.toolName,
        conversationId: pendingForm.conversationId,
        values: form.values ?? {},
        missingFields: Array.isArray(form.missingFields)
          ? form.missingFields
          : [],
        fields: Array.isArray(form.fields)
          ? form.fields
          : [],
        language: form.language ?? pendingForm.language,
      });

      let reply = `📝 ${form.title || "Formulaire"}\n`;

      if (form.description) {
        reply += `\n${form.description}\n`;
      }

      const missingFields = Array.isArray(form.missingFields)
        ? form.missingFields
        : [];

      if (missingFields.length > 0) {
        reply += `\nChamps manquants:\n`;

        missingFields.forEach((field: string, index: number) => {
          reply += `${index + 1}. ${field}\n`;
        });

        reply +=
          `\nEnvoyez-moi les informations manquantes dans votre prochain message.`;
      }

      await sendTelegramMessage(chatId, reply);

      return {
        handled: true,
        action: "form_continuation",
      };
    }

    // Form kamla -> pending action
    if (
      result?.type === "pending_action" &&
      result?.action?.id
    ) {
      telegramPendingForms.delete(String(chatId));

      await sendTelegramMessage(
        chatId,
        `✅ Informations complètes.\n\n⚠️ Confirmation required.\nTo execute this action, send:\n/confirm ${result.action.id}`
      );

      return {
        handled: true,
        action: "pending_confirmation",
        actionId: result.action.id,
      };
    }

    // Ila tool salat bla form/pending action
    telegramPendingForms.delete(String(chatId));

    await sendTelegramMessage(
      chatId,
      "✅ Action processed successfully."
    );

    return {
      handled: true,
      action: "form_completed",
    };
  } catch (error) {
    console.error("Telegram form continuation error:", error);

    await sendTelegramMessage(
      chatId,
      "❌ I could not process those form details. Please try again with the missing information."
    );

    return {
      handled: true,
      action: "form_continuation_failed",
    };
  }
}

const aiResult = await aiAssistantService.sendMessage(
  assistantUser,
  conversation.id,
  {
    content: text,
    language: "fr",
  }
);

let telegramReply = aiResult.message.content;

const executionResult = aiResult.executionResult as any;

// Structured form -> show missing fields directly in Telegram
if (
  executionResult?.type === "structured_form" &&
  executionResult?.form
) {
  const form = executionResult.form;
  telegramPendingForms.set(String(chatId), {
  toolName: executionResult.toolName || form.toolName,
  conversationId: conversation.id,
  values: form.values ?? {},
  missingFields: Array.isArray(form.missingFields)
    ? form.missingFields
    : [],
  fields: Array.isArray(form.fields)
    ? form.fields
    : [],
  language: form.language ?? "fr",
});

  const missingFields = Array.isArray(form.missingFields)
    ? form.missingFields
    : [];

  telegramReply = `📝 ${form.title || "Formulaire"}\n`;

  if (form.description) {
    telegramReply += `\n${form.description}\n`;
  }

  if (missingFields.length > 0) {
    telegramReply += `\nChamps manquants:\n`;

    missingFields.forEach((field: string, index: number) => {
      telegramReply += `${index + 1}. ${field}\n`;
    });

    telegramReply +=
      `\nEnvoyez-moi les informations manquantes dans votre prochain message.`;
  }
}

// Pending action -> confirmation from Telegram
if (
  executionResult?.type === "pending_action" &&
  executionResult?.action?.id
) {
  telegramReply +=
    `\n\n⚠️ Confirmation required.` +
    `\nTo execute this action, send:` +
    `\n/confirm ${executionResult.action.id}`;
}

await sendTelegramMessage(
  chatId,
  telegramReply
);

return {
  handled: true,
  action: "ai_response",
  conversationId: conversation.id,
};
}

let pollingStarted = false;

export async function startTelegramPolling() {
  if (pollingStarted) return;
  pollingStarted = true;

  if (!TELEGRAM_BOT_TOKEN) {
    console.warn("Telegram polling disabled: TELEGRAM_BOT_TOKEN is missing");
    return;
  }

  console.log("Telegram long polling started");

  let offset = 0;

  while (pollingStarted) {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?timeout=30&offset=${offset}`
      );

      if (!response.ok) {
        throw new Error(`Telegram getUpdates error: ${response.status}`);
      }

      const data = (await response.json()) as {
        ok: boolean;
        result: Array<{
          update_id: number;
          message?: unknown;
        }>;
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
      expiresInMinutes: Math.ceil(
        (existingCode.expiresAt.getTime() - Date.now()) / 60000
      ),
    };
  }

  await prisma.telegramLinkCode.deleteMany({
    where: {
      userId,
      usedAt: null,
    },
  });

  const randomPart = crypto.randomBytes(4)
    .toString("hex")
    .toUpperCase();

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