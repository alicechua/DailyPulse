import { Buffer } from 'node:buffer';
import { escapeHtml, retryWithBackoff } from './util.mjs';

// Azure OpenAI (Responses API, v1 endpoint) for text and Azure AI Speech for audio.
// Plain fetch: the REST surface we need is small, so no SDK dependency.

export const REQUIRED_ENV = ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_API_KEY', 'AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION'];

export const createClient = (env) => ({
  baseUrl: new URL('openai/v1/', env.AZURE_OPENAI_ENDPOINT),
  apiKey: env.AZURE_OPENAI_API_KEY,
  deployment: env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5-mini',
  speechUrl: `https://${env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`,
  speechKey: env.AZURE_SPEECH_KEY,
  voice: env.AZURE_SPEECH_VOICE || 'en-US-AvaMultilingualNeural',
});

export const describe = (client) => `${client.deployment} (text), ${client.voice} (speech)`;

function httpError(resp, detail) {
  const error = new Error(`HTTP ${resp.status}${detail ? `: ${detail}` : ''}`);
  error.status = resp.status;
  return error;
}

async function createResponse(client, body, label) {
  const resp = await retryWithBackoff(async () => {
    const r = await fetch(new URL('responses', client.baseUrl), {
      method: 'POST',
      headers: { 'api-key': client.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: client.deployment, ...body }),
      signal: AbortSignal.timeout(5 * 60 * 1000), // reasoning + web search can take a couple of minutes
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw httpError(r, data.error?.message);
    return data;
  }, { label });
  if (resp.status !== 'completed') {
    throw new Error(`${label}: response ${resp.status} (${resp.incomplete_details?.reason ?? resp.error?.message ?? 'no reason given'})`);
  }
  return resp;
}

/** Joins the output text, cutting out inline web-search citations like "([site](url))": the TTS would read them aloud. */
function outputText(resp) {
  return resp.output
    .filter(item => item.type === 'message')
    .flatMap(item => item.content)
    .filter(part => part.type === 'output_text')
    .map(({ text, annotations = [] }) => annotations
      .filter(a => a.type === 'url_citation')
      .sort((a, b) => b.start_index - a.start_index)
      .reduce((t, a) => t.slice(0, a.start_index).trimEnd() + t.slice(a.end_index), text))
    .join('');
}

/** Strict structured outputs require every object to be closed. */
function closeObjects(schema) {
  if (Array.isArray(schema)) return schema.map(closeObjects);
  if (!schema || typeof schema !== 'object') return schema;
  const closed = Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, closeObjects(value)]));
  if (closed.type === 'object') closed.additionalProperties = false;
  return closed;
}

/** Structured output: returns the parsed JSON matching `schema`. */
export async function generateJson(client, prompt, schema, { label = 'Azure OpenAI' } = {}) {
  const resp = await createResponse(client, {
    input: prompt,
    text: { format: { type: 'json_schema', name: 'result', schema: closeObjects(schema), strict: true } },
  }, label);
  return JSON.parse(outputText(resp));
}

/** Plain text, optionally grounded with web search. */
export async function generateText(client, prompt, { search = false, label = 'Azure OpenAI' } = {}) {
  const resp = await createResponse(client, { input: prompt, ...(search && { tools: [{ type: 'web_search' }] }) }, label);
  const text = outputText(resp);
  if (!text) throw new Error(`${label}: empty response`);
  return text;
}

/** Text-to-speech. Returns a WAV buffer (24kHz 16-bit mono, same as Gemini). */
export async function synthesizeSpeech(client, text) {
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="${client.voice}">${escapeHtml(text)}</voice></speak>`;
  return retryWithBackoff(async () => {
    const resp = await fetch(client.speechUrl, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': client.speechKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm',
        'User-Agent': 'DailyPulse',
      },
      body: ssml,
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
    if (!resp.ok) throw httpError(resp, (await resp.text().catch(() => '')).slice(0, 200));
    return Buffer.from(await resp.arrayBuffer());
  }, { label: 'Text-to-speech' });
}
