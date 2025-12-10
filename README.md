# Daily Pulse | Personal AI News Assistant

Daily Pulse is a personalized news assistant that keeps you updated on the world, AI, and technology. It gathers intelligence from trusted RSS feeds, synthesizes a concise "radio-style" briefing using Google Gemini 2.5, converts it to lifelike speech, and delivers it to you via a Web UI or directly to your Telegram.

![Project Status](https://img.shields.io/badge/Status-Active-success)
![Gemini API](https://img.shields.io/badge/Powered%20by-Gemini%202.5-4285F4)

## ✨ Key Features

*   **Smart Curation**: Aggregates and ranks news from reliable sources (Reuters, BBC, OpenAI, DeepMind, arXiv, The Verge, etc.).
*   **AI Synthesis**: Uses **Gemini 2.5 Flash** with **Search Grounding** to write a professional, factual morning briefing script.
*   **High-Quality TTS**: Converts text to speech using Gemini's native audio generation (Voice: Kore).
*   **Telegram Integration**: Sends the audio voice note directly to your phone.
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

---

## 💻 Local Development (Web App)

If you want to run the interactive dashboard locally:

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
*   **`scripts/daily-briefing.mjs`**: A standalone Node.js script used by the GitHub Action. It mimics the full app logic but runs headless to generate and send the Telegram message.
*   **`.github/workflows/daily-briefing.yml`**: Cron job configuration for the automation.

## 🛠 Tech Stack
*   **Frontend**: React, Tailwind CSS
*   **AI**: Google GenAI SDK (Gemini 2.5 Flash, Gemini 1.5 Flash 8k)
*   **Automation**: GitHub Actions, Node.js

## License
MIT
