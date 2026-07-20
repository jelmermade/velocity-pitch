# Bot learning archive v1

This folder contains bot evaluation reports and policy knowledge generated before the movement, contact-jump, aerial, randomized-team, and kickoff-formation changes introduced in July 2026.

- `bot-knowledge.json` is the final shared generation-500 model.
- `bot-knowledge-bundled.json` is the former generation-2 bundled fallback.
- `bot-evaluation-*.json` files are the historical match reports and remain ignored by Git.

Active learning starts from generation zero in `data/bot-knowledge.json` and the bundled fallback at `src/gameplay/bots/BotKnowledgeData.json`.
