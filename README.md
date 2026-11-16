# RRT BJJ AI Coach — instructor trial

This repository hosts the instructor evaluation version of the RRT BJJ AI coach.

## Security
Do not commit `.env`, Gemini API keys, passwords, member data, or paid course content. The public-facing service requires a strong access code configured as an environment variable on Render. This is a trial, not production membership authentication.

## Deploy
Node.js 22+; start `node server.js`. Render sets `PORT` and `RENDER_EXTERNAL_URL`. Configure `DEMO_ACCESS_CODE` and `GEMINI_API_KEY` in the Render environment.
