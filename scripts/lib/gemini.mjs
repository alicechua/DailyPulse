import { GoogleGenAI } from '@google/genai';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { retryWithBackoff } from './util.mjs';

// Override via env when Google retires a model (the 2.5 models were restricted in Sept 2026)
export const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash';
export const TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts';
export const TTS_VOICE = process.env.GEMINI_TTS_VOICE || 'Kore';

export const REQUIRED_ENV = ['GEMINI_API_KEY'];

export const createClient = (env) => new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

export const describe = () => `${TEXT_MODEL} (text), ${TTS_MODEL} (speech)`;

/** Structured output: returns the parsed JSON matching `schema`. */
export async function generateJson(ai, prompt, schema, { label = 'Gemini' } = {}) {
  const resp = await retryWithBackoff(() => ai.models.generateContent({
    model: TEXT_MODEL,
    contents: prompt,
    config: { responseMimeType: 'application/json', responseJsonSchema: schema },
  }), { label });
  return JSON.parse(resp.text);
}

/** Plain text, optionally grounded with Google Search. */
export async function generateText(ai, prompt, { search = false, label = 'Gemini' } = {}) {
  const resp = await retryWithBackoff(() => ai.models.generateContent({
    model: TEXT_MODEL,
    contents: prompt,
    config: search ? { tools: [{ googleSearch: {} }] } : {},
  }), { label });
  if (!resp.text) throw new Error(`${label}: empty response (finish reason: ${resp.candidates?.[0]?.finishReason})`);
  return resp.text;
}

/**
 * Creates a WAV header for raw PCM data
 */
function createWavBuffer(pcmData, sampleRate = 24000, numChannels = 1) {
  const header = Buffer.alloc(44);
  const bitDepth = 16;

  header.write('RIFF', 0);
  header.writeUInt32LE(pcmData.length + 36, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size
  header.writeUInt16LE(1, 20); // AudioFormat (1=PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * numChannels * (bitDepth / 8), 28); // ByteRate
  header.writeUInt16LE(numChannels * (bitDepth / 8), 32); // BlockAlign
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmData.length, 40);

  return Buffer.concat([header, pcmData]);
}

/** Text-to-speech. Returns a WAV buffer. */
export async function synthesizeSpeech(ai, text) {
  const resp = await retryWithBackoff(() => ai.models.generateContent({
    model: TTS_MODEL,
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } } },
    },
  }), { label: 'Text-to-speech' });

  const base64Audio = resp.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
  if (!base64Audio) throw new Error(`No audio generated (finish reason: ${resp.candidates?.[0]?.finishReason})`);

  // Older TTS models return raw 24kHz PCM; newer ones may already return a WAV file
  const audio = Buffer.from(base64Audio, 'base64');
  return audio.subarray(0, 4).toString() === 'RIFF' ? audio : createWavBuffer(audio);
}
