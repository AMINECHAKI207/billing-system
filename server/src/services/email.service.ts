import nodemailer from 'nodemailer';
import fs from 'fs/promises';
import path from 'path';
import { env } from '@config/env';

type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

type EmailDeliveryResult = {
  mode: 'smtp' | 'local';
  messageId?: string;
  filePath?: string;
};

export async function sendEmail(message: {
  to: string;
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  attachments?: EmailAttachment[];
}): Promise<EmailDeliveryResult> {
  if (shouldUseLocalEmailFallback()) {
    return writeLocalEmail(message);
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });

  const result = await transporter.sendMail({
    from: {
      name: env.SMTP_FROM_NAME,
      address: env.SMTP_FROM_EMAIL,
    },
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    subject: message.subject,
    text: message.text,
    attachments: message.attachments,
  });

  return {
    mode: 'smtp',
    messageId: result.messageId,
  };
}

export function getEmailDeliveryStatus() {
  const isLocalFallback = shouldUseLocalEmailFallback();

  return {
    mode: isLocalFallback ? 'local' : 'smtp',
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: maskEmail(env.SMTP_USER),
    fromEmail: env.SMTP_FROM_EMAIL,
    fromName: env.SMTP_FROM_NAME,
    localOutputDir: isLocalFallback ? getEmailOutputDir() : undefined,
    warning: isLocalFallback
      ? 'SMTP utilise des valeurs de demo. Les emails sont generes localement en developpement.'
      : undefined,
  };
}

function shouldUseLocalEmailFallback() {
  return (
    env.NODE_ENV !== 'production' &&
    (env.SMTP_PASS === 'replace_with_smtp_password' ||
      env.SMTP_USER === 'demo@example.com' ||
      env.SMTP_FROM_EMAIL === 'demo@example.com')
  );
}

async function writeLocalEmail(message: {
  to: string;
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  attachments?: EmailAttachment[];
}): Promise<EmailDeliveryResult> {
  const emailDir = getEmailOutputDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = sanitizeFileName(message.subject).slice(0, 80) || 'email';
  const baseName = `${stamp}-${slug}`;

  await fs.mkdir(emailDir, { recursive: true });

  const emailPath = path.join(emailDir, `${baseName}.txt`);
  const attachmentLines: string[] = [];

  for (const attachment of message.attachments ?? []) {
    const attachmentName = `${baseName}-${sanitizeFileName(attachment.filename)}`;
    const attachmentPath = path.join(emailDir, attachmentName);
    await fs.writeFile(attachmentPath, attachment.content);
    attachmentLines.push(`${attachment.filename}: ${attachmentPath}`);
  }

  await fs.writeFile(
    emailPath,
    [
      `To: ${message.to}`,
      `Cc: ${message.cc?.join(', ') ?? ''}`,
      `Bcc: ${message.bcc?.join(', ') ?? ''}`,
      `Subject: ${message.subject}`,
      `Mode: local development fallback`,
      '',
      message.text,
      '',
      'Attachments:',
      attachmentLines.length ? attachmentLines.join('\n') : '-',
      '',
    ].join('\n'),
    'utf8'
  );

  return {
    mode: 'local',
    filePath: emailPath,
  };
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-z0-9_.-]+/gi, '-').replace(/^-+|-+$/g, '');
}

function getEmailOutputDir() {
  return path.resolve(process.cwd(), env.UPLOADS_DIR, 'emails');
}

function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  if (!name || !domain) return '***';
  return `${name.slice(0, 2)}***@${domain}`;
}
