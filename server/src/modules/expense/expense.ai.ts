import fs from 'fs';
import path from 'path';
import { env } from '@config/env';
import { ApiError } from '@utils/ApiError';
import { AIExtractionInput, aiExtractionSchema } from './expense.schema';

export interface ExpenseCategoryPromptItem {
  id: string;
  name: string;
  expenseTypes: Array<{ id: string; name: string }>;
}

export interface ValidatedExtraction {
  data: AIExtractionInput;
  attempts: number;
  rawResponse: unknown;
  validationErrors: string[];
  requiresManualReview: false;
}

export interface ManualReviewExtraction {
  data: null;
  attempts: number;
  rawResponse: unknown;
  validationErrors: string[];
  requiresManualReview: true;
}

export type ExpenseExtractionResult = ValidatedExtraction | ManualReviewExtraction;

const MAX_AI_ATTEMPTS = 3;

export async function analyzeReceiptWithOpenAI(params: {
  filePath: string;
  mimeType: string;
  categories: ExpenseCategoryPromptItem[];
}): Promise<ExpenseExtractionResult> {
  if (!env.OPENAI_API_KEY) {
    throw ApiError.badRequest('OpenAI API key is not configured on the backend.');
  }

  let previousResponse: unknown = null;
  let validationErrors: string[] = [];

  for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt += 1) {
    const rawText = await callOpenAIReceiptExtraction({
      ...params,
      previousResponse,
      validationErrors,
    });
    const parsed = parseStrictJson(rawText);
    const validated = validateExtraction(parsed, params.categories);

    if (validated.success) {
      return {
        data: validated.data,
        attempts: attempt,
        rawResponse: parsed,
        validationErrors: [],
        requiresManualReview: false,
      };
    }

    previousResponse = parsed ?? rawText;
    validationErrors = validated.errors;
  }

  return {
    data: null,
    attempts: MAX_AI_ATTEMPTS,
    rawResponse: previousResponse,
    validationErrors,
    requiresManualReview: true,
  };
}

function validateExtraction(value: unknown, categories: ExpenseCategoryPromptItem[]) {
  const parsed = aiExtractionSchema.safeParse(value);
  if (!parsed.success) {
    return { success: false as const, errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) };
  }

  const category = categories.find((item) => item.id === parsed.data.categoryId);
  if (!category) {
    return { success: false as const, errors: ['categoryId: Category does not exist or is inactive'] };
  }

  const type = category.expenseTypes.find((item) => item.id === parsed.data.expenseTypeId);
  if (!type) {
    return { success: false as const, errors: ['expenseTypeId: Expense type does not belong to the selected category or is inactive'] };
  }

  return { success: true as const, data: parsed.data };
}

async function callOpenAIReceiptExtraction(params: {
  filePath: string;
  mimeType: string;
  categories: ExpenseCategoryPromptItem[];
  previousResponse: unknown;
  validationErrors: string[];
}) {
  const fileBuffer = await fs.promises.readFile(params.filePath);
  const base64 = fileBuffer.toString('base64');
  const categoryJson = JSON.stringify({ categories: params.categories });
  const prompt = [
    'Extract expense data from this receipt. Return strict JSON only. Do not include markdown.',
    'Use only categoryId and expenseTypeId values from the provided JSON. Never invent IDs.',
    'If a field is not visible, return null for optional text fields and add a warning. Never invent amounts, VAT, dates, merchant, currency, or numbers.',
    `Allowed categories and types: ${categoryJson}`,
    params.validationErrors.length
      ? `Previous response was invalid. Correct only invalid fields. Validation errors: ${JSON.stringify(params.validationErrors)}. Previous response: ${JSON.stringify(params.previousResponse)}`
      : '',
    'Required JSON shape: {"expenseDate":"YYYY-MM-DD","amountTTC":0,"amountHT":0,"vatAmount":0,"vatRate":20,"categoryId":"uuid","expenseTypeId":"uuid","merchantName":"string|null","documentNumber":"string|null","currency":"MAD","comment":"short comment","confidence":{"expenseDate":0.95,"amountTTC":0.98,"vat":0.91,"category":0.90,"expenseType":0.89},"warnings":[]}',
  ].filter(Boolean).join('\n');

  const fileContent = params.mimeType === 'application/pdf'
    ? { type: 'input_file', filename: path.basename(params.filePath), file_data: `data:${params.mimeType};base64,${base64}` }
    : { type: 'input_image', image_url: `data:${params.mimeType};base64,${base64}` };

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
    
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            fileContent,
          ],
        },
      ],
    }),
  });

  const json = await response.json() as OpenAIResponse;
  if (!response.ok) {
    const message = json.error?.message ?? 'OpenAI receipt analysis failed.';
    throw ApiError.badRequest(message);
  }

  const outputText = extractResponseText(json);
  if (!outputText) {
    throw ApiError.badRequest('OpenAI returned an empty receipt analysis.');
  }

  return outputText;
}

function parseStrictJson(rawText: string) {
  try {
    return JSON.parse(rawText);
  } catch {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) return rawText;
    try {
      return JSON.parse(match[0]);
    } catch {
      return rawText;
    }
  }
}

function extractResponseText(response: OpenAIResponse) {
  if (typeof response.output_text === 'string') {
    return response.output_text.trim();
  }

  const fragments: string[] = [];
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && typeof content.text === 'string') {
        fragments.push(content.text);
      }
    }
  }
  return fragments.join('\n').trim();
}

interface OpenAIResponse {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  error?: { message?: string };
}
