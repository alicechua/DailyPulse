import process from 'node:process';
import * as azure from './azure.mjs';
import * as gemini from './gemini.mjs';

// LLM_PROVIDER picks the backend for trend tagging, the briefing and text-to-speech (default: gemini).
const PROVIDERS = { gemini, azure };

/**
 * The configured provider. `client` is null when its credentials are missing (listed in `missing`).
 * Read at call time, after .env is loaded.
 */
export function createLLM(env = process.env) {
  const name = (env.LLM_PROVIDER || 'gemini').trim().toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`Unknown LLM_PROVIDER "${name}" (expected one of: ${Object.keys(PROVIDERS).join(', ')})`);
  const missing = provider.REQUIRED_ENV.filter(key => !env[key]);
  const client = missing.length ? null : provider.createClient(env);
  return { name, provider, client, missing, models: client && provider.describe(client) };
}

export const generateJson = (llm, ...args) => llm.provider.generateJson(llm.client, ...args);
export const generateText = (llm, ...args) => llm.provider.generateText(llm.client, ...args);
export const synthesizeSpeech = (llm, ...args) => llm.provider.synthesizeSpeech(llm.client, ...args);
