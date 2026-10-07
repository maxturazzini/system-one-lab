import { config as loadEnv } from 'dotenv';

function refreshLocalCredentials() {
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
    loadEnv({ quiet: true, override: true });
  }
}

export function getCloudflareProviderStatus() {
  refreshLocalCredentials();
  return {
    id: 'cloudflare',
    label: 'Cloudflare Workers AI',
    configured: Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID),
    model: process.env.CLOUDFLARE_JEV_MODEL || 'typesafe/jev',
    zeroDataRetention: null,
    privacyLabel: 'No training · no storage unless enabled separately',
    billingNote: 'Jev è third-party e richiede saldo AI Gateway o BYOK; i neuroni gratuiti non si applicano.',
  };
}

function toCloudflareQuestions(questions) {
  return Object.fromEntries(Object.entries(questions).map(([id, question]) => [
    id,
    question.type === 'boolean' ? { ...question, type: 'noul' } : question,
  ]));
}

function normalizeAnswers(answers = {}) {
  return Object.fromEntries(Object.entries(answers).map(([id, answer]) => {
    if (answer.type === 'noul' || answer.noul !== undefined) {
      return [id, { type: 'boolean', probability: Number(answer.noul) }];
    }
    return [id, answer];
  }));
}

export async function evaluateWithCloudflare({ state, questions }) {
  const status = getCloudflareProviderStatus();
  if (!status.configured) {
    const error = new Error('CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_API_TOKEN non configurati nel file .env.');
    error.statusCode = 503;
    throw error;
  }

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID)}/ai/run`;
  const startedAt = performance.now();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: status.model,
      input: {
        state,
        questions: toCloudflareQuestions(questions),
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const detail = payload.errors?.map(item => item.message).filter(Boolean).join('; ') || payload.message || `HTTP ${response.status}`;
    const billingHint = /insufficient balance|add money|byok/i.test(detail)
      ? ' Jev è third-party: i neuroni gratuiti Workers AI non si applicano. Serve credito/BYOK oppure un modello locale come SemIf.'
      : '';
    const error = new Error(`Cloudflare Workers AI: ${detail}.${billingHint}`);
    error.statusCode = response.status || 502;
    throw error;
  }

  const result = payload.result ?? payload;
  return {
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    answers: normalizeAnswers(result.answers),
    usage: result.usage ? {
      inputTokens: result.usage.input_tokens ?? null,
      outputTokens: result.usage.output_tokens ?? null,
    } : null,
    providerMetadata: {
      cloudflare: {
        model: result.model ?? status.model,
        success: payload.success ?? true,
      },
    },
  };
}
