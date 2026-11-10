/** One local model call; synthetic public inputs only. No Wallet, key, or financial call. */
import { OllamaAgentRuntime } from '../services/issuer/src/ollama-agent-runtime.js';
const model = process.argv[2] ?? 'tinyllama:latest';
const cpu = process.argv.includes('--cpu');
const runtime = new OllamaAgentRuntime(model, process.env.VEREQO_OLLAMA_ENDPOINT ?? 'http://127.0.0.1:11434', async (input, init) => {
  const body = JSON.parse(String(init?.body));
  if (cpu) body.options = { ...body.options, num_gpu: 0 };
  return fetch(input, { ...init, body: JSON.stringify(body) });
});
const scenario = {
  dataClass: 'SYNTHETIC_REHEARSAL' as const, scenarioId: 'real-model-breakthrough',
  objective: 'Evaluate a conservative synthetic buy of one unit if the visible ask and all limits permit it. Decline if any constraint fails.',
  market: { label: 'SYNTH/QUOTE synthetic-only market', bestAsk: '2', visibleAskQuantity: '2' },
  limits: { priceTick: '0.01', quantityTick: '0.01', minNotional: '1', maxNotional: '3', maxTotalExposure: '3.01', maxFeeRate: '0.001', maxSlippageBps: 100 },
};
try {
  const proposal = await runtime.generateSyntheticProposal(scenario);
  console.log(JSON.stringify({ evidenceClass: 'LOCAL_MODEL_SYNTHETIC_INPUT', model, cpuRequested: cpu, proposal }));
} catch (error) {
  const code = error instanceof Error && /^AGENT_[A-Z0-9_]+$/.test(error.message) ? error.message : 'AGENT_PROBE_FAILED';
  console.log(JSON.stringify({ evidenceClass: 'LOCAL_MODEL_SYNTHETIC_INPUT', model, cpuRequested: cpu, error: code, authorized: false, execution: 'NOT_IMPLEMENTED' }));
  process.exitCode = 1;
}
