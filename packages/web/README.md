# Brain Claw — Muse 2 EEG

Live EEG streaming from Muse 2 via Web Bluetooth. No drivers, no dongles — just Chrome.

## Setup

```bash
npm install
npm start
```

Open the URL Vite prints (usually `http://localhost:5173`) **in Chrome**.

Click **Connect Muse 2**, pick your headband from the Bluetooth dialog, and you're streaming.

## Requirements

- **Chrome** (Web Bluetooth is not supported in Firefox/Safari)
- Muse 2 powered on and not connected to another app
- Bluetooth enabled on your Mac

## Channels

| Electrode | Position |
|-----------|----------|
| TP9       | Left ear |
| AF7       | Left forehead |
| AF8       | Right forehead |
| TP10      | Right ear |
