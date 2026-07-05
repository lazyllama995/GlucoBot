# GlucoBot

Smart glucose decisions.

GlucoBot is a modular medical-tech web app scaffold prepared to evolve into web, iOS, Android, and watch companion experiences.

## Run locally

```bash
npm start
```

Then open `http://localhost:4173`.

## AI Carb Vision

Carb Vision uses a private backend endpoint so the OpenAI API key is never exposed in the browser.

```bash
OPENAI_API_KEY=your_key npm start
```

Without `OPENAI_API_KEY`, the app still runs, but Carb Vision will show a setup message instead of analyzing photos.

## Deploy

This project includes `render.yaml` for a permanent Render web service.

1. Push this repository to GitHub.
2. In Render, create a new Blueprint from the repository.
3. Add `OPENAI_API_KEY` as an environment variable.
4. Deploy the `glucobot` service.

## Architecture

- `src/core`: shared domain logic that can move into mobile/watch clients.
- `src/features`: feature modules for dashboard, dose, memory, insights, and integrations.
- `src/platform`: browser-specific persistence and shell code.
- `src/styles`: brand system and responsive app styling.

## Future integrations

Integration adapters are stubbed for Apple Health, Dexcom, Abbott LibreLinkUp, Garmin, and Oura under `src/features/integrations`.

## Data namespace

Browser persistence uses the `glucobot_` key prefix.
