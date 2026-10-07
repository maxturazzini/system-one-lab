import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateWithCloudflare } from '../src/providers/cloudflare.mjs';
import { getProviderStatus } from '../src/providers/index.mjs';

test('Cloudflare adapter maps boolean questions to Noul and normalizes the answer', async () => {
  const previousAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  const previousToken = process.env.CLOUDFLARE_API_TOKEN;
  const previousProvider = process.env.JEV_PROVIDER;
  process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
  process.env.CLOUDFLARE_API_TOKEN = 'test-token';
  process.env.JEV_PROVIDER = 'cloudflare';

  const fetchMock = mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.input.questions.relevant.type, 'noul');
    return {
      ok: true,
      json: async () => ({
        success: true,
        result: {
          model: 'jev-1.13.0',
          answers: { relevant: { type: 'noul', noul: 0.82 } },
          usage: { input_tokens: 100, output_tokens: 2 },
        },
      }),
    };
  });

  try {
    assert.equal(getProviderStatus().id, 'cloudflare');
    const result = await evaluateWithCloudflare({
      state: 'Bando software',
      questions: {
        relevant: { type: 'boolean', instructions: 'Is this relevant?' },
      },
    });
    assert.deepEqual(result.answers.relevant, { type: 'boolean', probability: 0.82 });
    assert.equal(result.usage.inputTokens, 100);
  } finally {
    fetchMock.mock.restore();
    if (previousAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = previousAccount;
    if (previousToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = previousToken;
    if (previousProvider === undefined) delete process.env.JEV_PROVIDER;
    else process.env.JEV_PROVIDER = previousProvider;
  }
});
