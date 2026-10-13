# Daily Pulse | Personal AI News Assistant

Daily Pulse is a personalized news assistant that keeps you updated on the world and, above all, on what's new and trending in AI. It gathers news, papers, models, repos and discussions, detects names that are suddenly showing up everywhere, synthesizes a concise "radio-style" briefing using Google Gemini, converts it to lifelike speech, and delivers it to your Telegram with a digest of links.

![Project Status](https://img.shields.io/badge/Status-Active-success)
![Gemini API](https://img.shields.io/badge/Powered%20by-Gemini%203.8-4285F4)

## ✨ Key Features

*   **Smart Curation**: Aggregates and ranks world news, AI labs, newsletters, Hacker News, rising GitHub repos, Hugging Face trending models and community-upvoted papers.
*   **🔥 Trend Detection**: Tags every AI item with the models, methods and products it mentions, remembers what it has seen, and flags names that are **new or spiking** *and* confirmed by **2+ independent sources** (e.g. a launch on Hacker News + repos built on it on GitHub).
*   **AI Synthesis**: Uses **Gemini 3.8 Flash** with **Search Grounding** to write a professional, factual morning briefing script.
*   **High-Quality TTS**: Converts text to speech using **Gemini 3.8 Flash TTS** (Voice: Kore).
*   **Telegram Integration**: Sends the audio briefing plus a text digest with links to everything mentioned.
*   **No repeats**: Items already sent on a previous day are skipped.
*   **Dual Modes**:
    1.  **Web App**: Interactive dashboard to select topics (World, AI, Tech, Finance) and generate on-demand.
    2.  **Auto-Pilot (GitHub Actions)**: Runs automatically every morning in the cloud (Serverless) to send you a briefing without you lifting a finger.

---

## 🚀 "Auto-Pilot" Setup (GitHub Actions)

You can run this project entirely for free using GitHub Actions to trigger the briefing every morning.

### 1. Fork/Clone the Repository
Fork this repository to your own GitHub account.

### 2. Get Your Credentials
*   **Gemini API Key**: Get it from [Google AI Studio](https://aistudio.google.com/).
*   **Telegram Bot**:
    1.  Message [@BotFather](https://t.me/BotFather) on Telegram to create a new bot. Copy the **HTTP API Token**.
    2.  **IMPORTANT**: Open your new bot in Telegram and click **Start**.
    3.  Message [@userinfobot](https://t.me/userinfobot) to get your numerical **ID** (Chat ID).

### 3. Configure GitHub Secrets
1.  Go to your repository's **Settings** tab.
2.  Select **Secrets and variables** > **Actions**.
3.  Click **New repository secret** and add the following:
    *   `GEMINI_API_KEY`: Your Google API Key.
    *   `TELEGRAM_BOT_TOKEN`: Your Bot Token from BotFather.
    *   `TELEGRAM_CHAT_ID`: Your numerical User ID.

### 4. Schedule
The workflow is defined in `.github/workflows/daily-briefing.yml`.
By default, it runs at **08:00 UTC**.
```yaml
on:
  schedule:
    - cron: '0 8 * * *' # Change this to your preferred time (UTC)
```

Each run commits `data/trend-history.json` back to the repo (that's how trend detection remembers yesterday). This also keeps the repo active, so GitHub doesn't auto-disable the schedule after 60 days without commits. If it ever does get disabled, re-enable it from the **Actions** tab.

To test without sending anything, run the workflow manually from the **Actions** tab with **Dry run** ticked. The script, digest and audio are uploaded as a run artifact.

### 5. Models
Defaults are `gemini-3.8-flash` (text) and `gemini-3.8-flash-tts` (speech). When Google retires a model, override it without code changes by adding repository **variables** or env vars: `GEMINI_TEXT_MODEL`, `GEMINI_TTS_MODEL`, `GEMINI_TTS_VOICE`.

### 6. Using Azure instead of Gemini (optional)
Set the repository variable `LLM_PROVIDER=azure` to run trend tagging and the briefing on an Azure OpenAI deployment (Responses API, with web search) and the audio on Azure AI Speech. Works on an Azure for Students subscription: `gpt-5-mini` has quota there, and Speech's free F0 tier (500K characters/month) covers a daily briefing.

| Name | Kind | Example |
|---|---|---|
| `AZURE_OPENAI_ENDPOINT` | variable | `https://<resource>.openai.azure.com/` |
| `AZURE_OPENAI_API_KEY` | secret | `az cognitiveservices account keys list -g <rg> -n <resource>` |
| `AZURE_SPEECH_KEY` | secret | same command, on the Speech resource |
| `AZURE_SPEECH_REGION` | variable | `northcentralus` |
| `AZURE_OPENAI_DEPLOYMENT` | variable, optional | deployment name, default `gpt-5-mini` |
| `AZURE_SPEECH_VOICE` | variable, optional | default `en-US-AvaMultilingualNeural` |

Switch back any time by deleting `LLM_PROVIDER` (or setting it to `gemini`).

---

## 💻 Local Development (Web App)

If you want to run the interactive dashboard locally:

### Headless briefing (same as GitHub Actions)

```bash
npm install
echo 'GEMINI_API_KEY=your_key' > .env   # gitignored; add TELEGRAM_* too to send for real (or the AZURE_* vars + LLM_PROVIDER=azure)
npm run briefing:dry                    # writes out/briefing.txt, digest.html, briefing.wav, trends.json
node scripts/daily-briefing.mjs --dry-run --no-audio   # skip text-to-speech while iterating
npm run briefing                        # full run: sends to Telegram
```

Without a Gemini key, a dry run still fetches every source and builds the link digest.

### Web App

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Setup
Ensure your environment injects `process.env.API_KEY`. 
*(If using a bundler like Vite/Parcel locally, create a `.env` file and update the code to use `import.meta.env` or your bundler's specific env var syntax, or simply export the variable in your terminal session)*.

```bash
export API_KEY="your_google_api_key"
```

### 3. Run the App
```bash
npm start
# or depending on your scripts
npm run dev
```

---

## 📂 Project Structure

*   **`src/App.tsx`**: Main React UI logic.
*   **`src/services/geminiService.ts`**: Handles prompt engineering, Search Grounding, and Text-to-Speech generation.
*   **`src/services/rssService.ts`**: Contains the logic ported from Python for fetching RSS feeds, calculating "freshness" scores, and deduplicating news items.
*   **`scripts/daily-briefing.mjs`**: The headless pipeline used by the GitHub Action: fetch → curate → detect trends → write script → TTS → Telegram.
*   **`scripts/lib/sources.mjs`**: All sources (RSS feeds, Hacker News, GitHub, Hugging Face). Add or remove feeds here.
*   **`scripts/lib/curate.mjs`**: Ranking, per-section quotas, AI filtering and repeat suppression.
*   **`scripts/lib/trends.mjs`**: Entity extraction, trend history and emerging-trend detection.
*   **`scripts/lib/gemini.mjs`** / **`telegram.mjs`**: Gemini text/TTS calls; Telegram digest formatting and sending.
*   **`data/trend-history.json`**: What the trend detector has seen (updated daily by the workflow).
*   **`.github/workflows/daily-briefing.yml`**: Cron job configuration for the automation.

## 📡 Sources

| Section | Sources |
|---|---|
| World | BBC, FT, Guardian, Al Jazeera, Reuters |
| Trending models | Hugging Face (`/api/models?sort=trendingScore`) |
| Rising repos | GitHub search: repos created this week, by stars (spam filtered) |
| Top papers | Hugging Face Daily Papers (community upvotes) |
| AI discussion | Hacker News (Algolia API) |
| Labs & newsletters | OpenAI, Anthropic, DeepMind, Google AI, HF Blog, TechCrunch AI, Reuters AI, Ars Technica, MIT Tech Review, Simon Willison, Latent Space, Interconnects, Import AI, Ahead of AI |
| Tech | The Verge, Reuters |

All of these are free and need no extra API keys.

## 🛠 Tech Stack
*   **Frontend**: React, Tailwind CSS
*   **AI**: Google GenAI SDK (Gemini 3.8 Flash, Gemini 3.8 Flash TTS)
*   **Automation**: GitHub Actions, Node.js 24

## License
MIT
