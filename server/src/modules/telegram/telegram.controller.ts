import { Request, Response } from "express";
import { handleTelegramUpdate } from "./telegram.service";
import { createTelegramLinkCode } from "./telegram.service";

export async function telegramWebhook(req: Request, res: Response) {
  try {
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

    const receivedSecret = req.get(
      "X-Telegram-Bot-Api-Secret-Token"
    );

    if (!expectedSecret) {
      console.error("TELEGRAM_WEBHOOK_SECRET is not configured");

      return res.status(500).json({
        success: false,
        message: "Telegram webhook is not configured",
      });
    }

    if (receivedSecret !== expectedSecret) {
      console.warn("Rejected Telegram webhook: invalid secret");

      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    await handleTelegramUpdate(req.body);

    return res.sendStatus(200);
  } catch (error) {
    console.error("Telegram webhook error:", error);

    return res.sendStatus(200);
  }
}

export async function generateTelegramLinkCode(req: Request, res: Response) {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const result = await createTelegramLinkCode(userId);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Generate Telegram link code error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to generate Telegram link code",
    });
  }
}
