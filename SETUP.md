# Intrival — Local Setup

## One-time setup

1. Install Node.js if you haven't: https://nodejs.org (LTS version)

2. Open a terminal in this folder and install dependencies:
   ```
   npm install
   ```

3. Create your .env file:
   ```
   copy .env.example .env
   ```
   Then open `.env` and paste your Anthropic API key.
   Get a key at: https://console.anthropic.com/

## Run locally

```
npm start
```

Then open http://localhost:3000 in your browser.

## File structure

```
Desktop/
  server.js          ← Express backend (keeps API key safe)
  package.json       ← Node dependencies
  .env               ← Your secret API key (never share this)
  .env.example       ← Template for the .env file
  public/
    index.html       ← The Intrival frontend
```

## Deploy to production (Render — free tier)

1. Push this folder to a GitHub repo
2. Go to https://render.com → New → Web Service
3. Connect your GitHub repo
4. Set environment variable: ANTHROPIC_API_KEY = your key
5. Build command: `npm install`
6. Start command: `npm start`
7. Done — Render gives you a live URL like `intrival.onrender.com`
