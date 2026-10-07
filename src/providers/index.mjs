import { getCloudflareProviderStatus, evaluateWithCloudflare } from './cloudflare.mjs';
import { getVercelProviderStatus, evaluateWithVercel } from './vercel.mjs';

export function getProviderStatus() {
  const requested = String(process.env.JEV_PROVIDER || 'auto').toLowerCase();
  const cloudflare = getCloudflareProviderStatus();
  const vercel = getVercelProviderStatus();

  let active;
  if (requested === 'cloudflare') active = cloudflare;
  else if (requested === 'vercel') active = vercel;
  else if (vercel.configured) active = vercel;
  else active = cloudflare;

  return {
    ...active,
    requested,
    available: [cloudflare, vercel].map(provider => ({
      id: provider.id,
      label: provider.label,
      configured: provider.configured,
      model: provider.model,
    })),
  };
}

export async function evaluateWithActiveProvider(payload) {
  const status = getProviderStatus();
  if (status.id === 'cloudflare') return evaluateWithCloudflare(payload);
  return evaluateWithVercel(payload);
}
