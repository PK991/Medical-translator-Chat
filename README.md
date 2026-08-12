# LinguaRoom MVP

This is the first functional server-backed MVP, replacing the earlier local HTML mockup.

## What works
- Create a named room
- Room ID + shareable join link
- Join request + owner approval
- Multi-user room state on the server
- Original message shown first
- Real AI translation into second and optional third language
- English, Thai, Arabic, Turkish, Bengali, Burmese, Chinese
- Translation is performed server-side; the API key is never exposed to the browser

## Run locally
1. Install Node.js 20+.
2. In this folder run: `npm install`
3. Copy `.env.example` to `.env`
4. Put your OpenAI API key in `.env`
5. Run: `npm start`
6. Open `http://localhost:3000`

Important: if you open this only on localhost, another phone cannot join. For real multi-device testing, deploy this folder to a public HTTPS host (Render/Railway/Fly.io/etc.) or expose the local server through a secure tunnel.

## Current MVP limitation
Rooms/messages are held in server memory. Restarting the server clears them. The next production step is PostgreSQL/Supabase persistence plus authentication and audit/privacy controls.
