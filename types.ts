
export interface NewsSource {
  title: string;
  uri: string;
}

export interface GroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
}

export interface BriefingData {
  markdownText: string;
  sources: NewsSource[];
  timestamp: string;
}

export enum LoadingState {
  IDLE = 'IDLE',
  FETCHING_FEEDS = 'FETCHING_FEEDS',
  GENERATING_TEXT = 'GENERATING_TEXT',
  GENERATING_AUDIO = 'GENERATING_AUDIO',
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR'
}

export interface TopicOption {
  id: string;
  label: string;
  selected: boolean;
}

// Data model from Python script
export interface FeedItem {
  source: string;
  title: string;
  link: string;
  published?: string; // ISO string or original string
  score?: number; // Calculated rank score
  topic?: string; // Guessed topic
}

export interface CuratedFeeds {
  world: FeedItem[];
  ai: FeedItem[];
  business: FeedItem[];
  [key: string]: FeedItem[];
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  autoSend?: {
    enabled: boolean;
    time: string; // "HH:MM" 24h format
    lastSentDate?: string; // "YYYY-MM-DD"
  };
}