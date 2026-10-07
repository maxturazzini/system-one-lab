import { experimental_evaluate as evaluate } from 'ai';
import { config as loadEnv } from 'dotenv';

function refreshLocalKey() {
  if (!process.env.AI_GATEWAY_API_KEY) {
    loadEnv({ quiet: true, override: true });
  }
}

export function getVercelProviderStatus() {
  refreshLocalKey();
  return {
    id: 'vercel',
    label: 'Vercel AI Gateway',
    configured: Boolean(process.env.AI_GATEWAY_API_KEY),
    model: process.env.JEV_MODEL || 'typesafe-ai/jev',
    zeroDataRetention: process.env.JEV_ZERO_DATA_RETENTION !== 'false',
  };
}

export async function evaluateWithVercel({ state, questions }) {
  const status = getVercelProviderStatus();
  if (!status.configured) {
    const error = new Error('AI_GATEWAY_API_KEY non configurata. Copiate .env.example in .env e inserite la chiave.');
    error.statusCode = 503;
    throw error;
  }

  const startedAt = performance.now();
  const result = await evaluate({
    model: status.model,
    state,
    questions,
    providerOptions: {
      gateway: {
        zeroDataRetention: status.zeroDataRetention,
      },
    },
  });

  return {
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    answers: result.answers,
    usage: result.usage ?? null,
    providerMetadata: result.providerMetadata ?? null,
  };
}
