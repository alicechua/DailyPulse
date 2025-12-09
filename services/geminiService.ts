import { GoogleGenAI, Modality } from "@google/genai";
import { NewsSource, GroundingChunk, FeedItem } from "../types";
import { fetchAndCurateFeed } from "./rssService";

// Initialize Gemini Client
// CRITICAL: process.env.API_KEY is injected by the environment.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Generates a news briefing using Curated RSS Feeds + Search Grounding
 */
export const generateNewsBriefing = async (
  topics: string[]
): Promise<{ text: string; sources: NewsSource[] }> => {
  
  // 1. Fetch & Curate Feeds (The "Intel Gathering" Phase)
  let feedContext = "";
  let rssSources: NewsSource[] = [];

  try {
    const curatedData = await fetchAndCurateFeed();
    
    // Flatten curated data based on user interest if possible, or give them everything relevant
    const relevantItems: FeedItem[] = [];
    
    // Always include World news as base
    if (curatedData.world) relevantItems.push(...curatedData.world);
    
    // Include AI if requested
    if (topics.some(t => t.toLowerCase().includes('ai') || t.toLowerCase().includes('tech') || t.toLowerCase().includes('intelligence'))) {
       if (curatedData.ai) relevantItems.push(...curatedData.ai);
    }

    // Include Business if requested
    if (topics.some(t => t.toLowerCase().includes('finance') || t.toLowerCase().includes('business') || t.toLowerCase().includes('market'))) {
       if (curatedData.business) relevantItems.push(...curatedData.business);
    }

    // Format for Prompt
    if (relevantItems.length > 0) {
      feedContext = "Here are the top curated headlines from trusted sources:\n";
      relevantItems.forEach(item => {
        feedContext += `- [${item.source}] ${item.title} (${item.published || 'Today'})\n`;
        rssSources.push({ title: item.title, uri: item.link });
      });
      feedContext += "\nUse these headlines as the primary source of truth for the briefing. You may use Google Search to expand on them or find breaking news not listed here.";
    } else {
      feedContext = "I was unable to fetch the RSS feeds directly. Please rely on Google Search to find the latest news for the requested topics.";
    }

  } catch (e) {
    console.error("RSS Fetch failed, falling back to pure Search", e);
    feedContext = "Please rely on Google Search to find the latest news.";
  }

  const topicString = topics.join(", ");
  const prompt = `
    You are a professional, articulate personal assistant. 
    It is currently ${new Date().toLocaleDateString()}.
    
    ${feedContext}

    Provide a comprehensive "Morning Briefing" covering the latest news and updates for the following topics: ${topicString}.
    
    Structure the response clearly with Markdown headers. 
    Focus on factual, up-to-date information.
    Keep the tone conversational but informative, like a radio news anchor.
    Do not include pre-ambles like "Here is your briefing", just start with the news.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const text = response.text || "I couldn't generate a briefing at this time.";
    
    // Extract sources from grounding metadata
    const searchSources: NewsSource[] = [];
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks as GroundingChunk[] | undefined;

    if (chunks) {
      chunks.forEach((chunk) => {
        if (chunk.web) {
          searchSources.push({
            title: chunk.web.title,
            uri: chunk.web.uri,
          });
        }
      });
    }

    // Combine RSS sources and Search sources
    // We prioritize Search sources for the UI if they are more specific, but we want to show both.
    // Let's merge them.
    const allSources = [...rssSources, ...searchSources];
    
    // Deduplicate sources based on URI
    const uniqueSources = allSources.filter((v, i, a) => a.findIndex(v2 => v2.uri === v.uri) === i);

    return { text, sources: uniqueSources };
  } catch (error) {
    console.error("Error generating briefing:", error);
    throw error;
  }
};

/**
 * Converts text to speech using Gemini TTS
 */
export const generateBriefingAudio = async (text: string): Promise<string> => {
  try {
    const speechPrompt = `Read the following news briefing clearly, with a warm and professional tone:\n\n${text}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: speechPrompt }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    
    if (!base64Audio) {
      throw new Error("No audio data received from model.");
    }

    return base64Audio;
  } catch (error) {
    console.error("Error generating audio:", error);
    throw error;
  }
};