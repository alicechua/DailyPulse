import { TelegramConfig } from '../types';
import { decodeBase64, createWavBlob } from '../utils/audioUtils';

/**
 * Sends the audio briefing to a Telegram user/channel/group via Bot API.
 */
export const sendVoiceToTelegram = async (
  base64Audio: string,
  caption: string,
  config: TelegramConfig
): Promise<void> => {
  const { botToken, chatId } = config;

  if (!botToken || !chatId) {
    throw new Error("Missing Telegram Configuration");
  }

  // Sanitize inputs
  const cleanToken = botToken.trim();
  const cleanChatId = chatId.trim();

  // 1. Prepare Audio Blob (Convert Raw PCM -> WAV)
  const pcmData = decodeBase64(base64Audio);
  const wavBlob = createWavBlob(pcmData, 24000, 1); // Gemini 2.5 TTS default is 24kHz Mono

  // 2. Prepare Form Data
  const formData = new FormData();
  formData.append('chat_id', cleanChatId);
  formData.append('caption', caption.substring(0, 1024)); // Telegram caption limit
  // 'audio' is usually for music files, 'voice' is for voice notes.
  // 'sendAudio' allows titles and is more robust for general audio files.
  formData.append('audio', wavBlob, `daily_briefing_${new Date().toISOString().split('T')[0]}.wav`);
  formData.append('title', `Daily Briefing - ${new Date().toLocaleDateString()}`);
  formData.append('performer', 'Daily Pulse AI');

  // 3. Send Request
  const url = `https://api.telegram.org/bot${cleanToken}/sendAudio`;
  
  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  const result = await response.json();

  if (!result.ok) {
    throw new Error(result.description || "Failed to send audio to Telegram");
  }
};