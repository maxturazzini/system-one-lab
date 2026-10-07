// SemIf gira nel sidecar Python accanto al server del lab: il browser chiede, il server inoltra.
// Lo state non esce dal computer.

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Errore HTTP ${response.status}`);
  return payload;
}

export function fetchSemifStatus() {
  return request('/api/semif/status');
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createSemifEngine({ onProgress } = {}) {
  let models = {};
  let loadedModelId = null;

  function sync(status) {
    if (status?.models) models = status.models;
    const current = status?.status;
    loadedModelId = current?.phase === 'ready' ? current.model : null;
    return status;
  }

  return {
    get models() {
      return models;
    },
    get model() {
      return loadedModelId ? { id: loadedModelId, ...models[loadedModelId] } : null;
    },
    async refresh() {
      return sync(await fetchSemifStatus());
    },
    // Il caricamento può durare minuti (download del GGUF): si avvia e poi si segue lo stato.
    async load(modelId) {
      loadedModelId = null;
      await request('/api/semif/load', { method: 'POST', body: JSON.stringify({ modelId }) });
      for (;;) {
        const status = sync(await fetchSemifStatus());
        const current = status.status ?? {};
        if (current.model !== modelId) throw new Error('Il sidecar SemIf ha cambiato modello durante il caricamento.');
        if (current.phase === 'error') throw new Error(current.error || 'Caricamento non riuscito.');
        if (current.phase === 'ready') return { modelId, loadMs: (current.load_seconds ?? 0) * 1000 };
        onProgress?.(current);
        await wait(500);
      }
    },
    evaluate({ state, questions, recordId }) {
      return request('/api/semif/evaluate', { method: 'POST', body: JSON.stringify({ state, questions, recordId }) });
    },
  };
}
