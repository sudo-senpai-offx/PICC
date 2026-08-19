# PICC — Privacy Policy

**Last updated:** August 2026

## Overview

PICC (Personal Income Command Center) is a browser extension and dashboard application that helps users manage their trading, affiliate, and income-generating activities. This privacy policy explains how PICC handles data.

## Data Storage

- **All data is stored locally** on your device. PICC does not transmit your personal data to any external servers.
- Trading data, journal entries, alerts, watchlists, and settings are stored in local JSON files on your machine.
- The PICC server runs entirely on `localhost` (127.0.0.1) and never communicates with external services unless you explicitly configure API keys.

## Browser Extension

- The PICC browser extension accesses **only localhost** (`http://localhost:*` and `http://127.0.0.1:*`) for server communication.
- The extension does **not** collect, transmit, or sell any browsing data.
- Site detection (recognizing trading platforms, affiliate sites, etc.) happens entirely locally within the extension.
- No analytics, tracking, or telemetry is collected.

## External API Usage

- **Yahoo Finance**: PICC fetches publicly available market data (prices, historical candles) from Yahoo Finance's public API. No personal data is sent.
- **Financial Modeling Prep**: Used for economic calendar data (public endpoints only).
- No user-identifiable information is sent to any external API.

## AI Features

- AI signal generation and market analysis run using your own configured API keys (OpenAI, Anthropic, Google Gemini).
- Your API keys are stored locally and are never transmitted to PICC servers or any third party.
- Conversation data with AI providers is subject to those providers' respective privacy policies.

## Data We Do NOT Collect

- Browsing history
- Personal identification information
- Financial account credentials
- Payment information
- Location data
- Usage analytics or telemetry

## Data Retention

All data remains on your local machine. You can delete any data at any time by removing the files in the PICC data directory or uninstalling the extension.

## Changes to This Policy

We may update this privacy policy occasionally. Changes will be reflected in the repository with an updated date.

## Contact

For questions about this privacy policy, open an issue at https://github.com/sudo-senpai-offx/PICC/issues
