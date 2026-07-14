# Bot evaluation data

Run `npm run test:bot-evaluation` to simulate a five-minute 3v3 Bot Lab match. The test writes a JSON report named `bot-evaluation-<label>.json` in this directory. Set `BOT_EVALUATION_LABEL` to keep named baseline and candidate runs for comparison.

Each successful evaluation also merges its signed policy observations into `data/bot-knowledge.json`. The multiplayer service exposes the same file through `/api/bot-knowledge`, so every device loads the shared generation and contributes observations back to it after Bot Lab matches.

Generated match reports are ignored by Git; the compact shared knowledge model is intentionally tracked.
