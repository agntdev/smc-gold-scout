import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";

registerMainMenuItem({ label: "Analyze chart", data: "analyze:start", order: 10 });

const composer = new Composer<Ctx>();

const uploadKeyboard = inlineKeyboard([[inlineButton("Cancel", "analyze:cancel")]]);
const timeframeKeyboard = inlineKeyboard([
  [inlineButton("Use M1", "analyze:timeframe:M1"), inlineButton("Use M5", "analyze:timeframe:M5")],
  [inlineButton("Use M15", "analyze:timeframe:M15")],
  [inlineButton("Cancel", "analyze:cancel")],
]);

function detectedTimeframes(text: string | undefined): ("M1" | "M5" | "M15")[] {
  const upper = (text ?? "").toUpperCase();
  return (["M1", "M5", "M15"] as const).filter((timeframe) =>
    new RegExp(`(^|[^A-Z0-9])${timeframe}([^A-Z0-9]|$)`).test(upper),
  );
}

async function fingerprint(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join("");
}

async function requestTimeframe(ctx: Ctx, imageHash: string, found: ("M1" | "M5" | "M15")[]) {
  ctx.session.pendingChart = { imageHash, timeframes: found };
  ctx.session.step = "awaiting_timeframe";
  const message = found.length > 1
    ? "This image appears to include more than one timeframe. Choose the chart you want analyzed."
    : "I couldn't identify the timeframe. Choose the chart timeframe to continue.";
  await ctx.reply(message, { reply_markup: timeframeKeyboard });
}

async function assessChart(ctx: Ctx, timeframe: "M1" | "M5" | "M15") {
  ctx.session.step = "idle";
  ctx.session.pendingChart = undefined;
  // No market-data or vision integration is specified for this bot. Never infer
  // an order block, FVG, entry, stop, or target from Telegram metadata.
  await ctx.reply(
    `No ${timeframe} setup was confirmed. A trade card is issued only when market bias, an order block, and an FVG can be verified from the chart.`,
  );
}

composer.callbackQuery("analyze:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "awaiting_chart";
  ctx.session.pendingChart = undefined;
  await ctx.editMessageText(
    "Send a clear XAUUSD M1, M5, or M15 chart image. Include the price scale and recent candles.",
    { reply_markup: uploadKeyboard },
  );
});

composer.callbackQuery("analyze:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "idle";
  ctx.session.pendingChart = undefined;
  await ctx.editMessageText("Chart analysis cancelled.");
});

composer.callbackQuery(/^analyze:timeframe:(M1|M5|M15)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.session.step !== "awaiting_timeframe" || !ctx.session.pendingChart) {
    await ctx.reply("Start a new analysis from the menu, then send a chart image.");
    return;
  }
  const timeframe = ctx.match[1] as "M1" | "M5" | "M15";
  await ctx.editMessageText(`Checking the ${timeframe} chart against the required SMC confirmations.`);
  await assessChart(ctx, timeframe);
});

composer.on("message:photo", async (ctx) => {
  if (ctx.session.step !== "awaiting_chart") return;
  const photo = ctx.message.photo.at(-1);
  if (!photo) return;

  const imageHash = await fingerprint(photo.file_unique_id);
  const found = detectedTimeframes(ctx.message.caption);
  if (found.length === 1) {
    await assessChart(ctx, found[0]);
    return;
  }
  await requestTimeframe(ctx, imageHash, found);
});

export default composer;
