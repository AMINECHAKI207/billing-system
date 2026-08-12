import { Router } from "express";
import { authenticate } from "@middleware/authenticate";
import {
  telegramWebhook,
  generateTelegramLinkCode,
} from "./telegram.controller";

const router = Router();

// Telegram public webhook
router.post("/webhook", telegramWebhook);

// Logged-in ERP user only
router.post("/link-code", authenticate, generateTelegramLinkCode);

export default router;