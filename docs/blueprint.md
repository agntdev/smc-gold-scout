# XAUUSD SMC Trade Analyzer — Bot specification

**Archetype:** custom

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

Telegram bot that analyzes uploaded XAUUSD chart images (M1/M5/M15) using Smart Money Concepts (SMC) to detect high-probability scalping setups. Returns annotated images and compact trade cards only when Market Bias + Order Block + FVG align per owner-specified rules.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- retail forex scalpers
- XAUUSD traders
- SMC strategy practitioners

## Success criteria

- Valid trade card generated with aligned SMC confirmations
- Annotated chart image returned with detected elements
- No output for low-quality setups

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open main menu with usage instructions
- **Analyze chart** (button, actor: user, callback: analyze:start) — Initiate chart analysis flow
  - inputs: chart image (M1/M5/M15)
  - outputs: annotated image, trade card, rationale text

## Flows

### Chart analysis
_Trigger:_ photo upload

1. Detect timeframe from filename or prompt user
2. Analyze SMC elements (Order Blocks, FVG, etc)
3. Validate Market Bias + Order Block + FVG alignment
4. Generate annotated image and trade card if valid

_Data touched:_ UploadedChart, SMCAnalysis, TradeSetup

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **UploadedChart** _(retention: persistent)_ — User-submitted XAUUSD chart image with detected timeframe
  - fields: image_hash, timeframe, upload_timestamp
- **SMCAnalysis** _(retention: persistent)_ — Detected SMC features and market bias
  - fields: market_bias, order_blocks, fvg, liquidity_zones
- **TradeSetup** _(retention: persistent)_ — Validated trade card with SMC confirmation
  - fields: side, entry_price, stop_loss, take_profits, risk_reward, confidence_score

## Integrations

- **Telegram** (required) — Bot API messaging
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Configure required SMC confirmations (default: Market Bias + Order Block + FVG)
- Set data retention period (default: 30 days)

## Notifications

- Annotated chart image with SMC annotations
- Compact trade card with entry/SL/TPs/R:R
- Short SMC rationale text

## Permissions & privacy

- Only store analysis records for audit/dispute purposes
- No PII collected beyond image hashes

## Edge cases

- Multiple timeframes in single image
- Ambiguous SMC pattern alignment
- Low-confidence setups that don't meet confirmation criteria

## Required tests

- End-to-end analysis flow with valid M15 chart
- No output for unconfirmed setup
- Correct retention of analysis records

## Assumptions

- Users provide clean chart screenshots
- Timeframe detection works via filename or prompt
- SMC confirmation rules are sufficient to prevent overtrading
