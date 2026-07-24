import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";

type Timeframe = "M1" | "M5" | "M15";
type Bias = "Bull" | "Bear" | "Neutral";

interface ChartInput {
  fileId: string;
  imageHash: string;
  caption?: string;
  filename?: string;
}

interface SMCSetup {
  bias: Exclude<Bias, "Neutral">;
  orderBlock: string;
  fvg: string;
  entries: Array<{ method: "Limit" | "Market"; range: string }>;
}

interface PendingChart extends ChartInput {
  timeframes?: Timeframe[];
}

registerMainMenuItem({ label: "Analyze chart", data: "analyze:start", order: 10 });

const composer = new Composer<Ctx>();
const uploadKeyboard = inlineKeyboard([[inlineButton("Cancel", "analyze:cancel")]]);
const timeframeKeyboard = inlineKeyboard([
  [inlineButton("Use M1", "analyze:timeframe:M1"), inlineButton("Use M5", "analyze:timeframe:M5")],
  [inlineButton("Use M15", "analyze:timeframe:M15")],
  [inlineButton("Cancel", "analyze:cancel")],
]);

function detectedTimeframes(...values: Array<string | undefined>): Timeframe[] {
  const source = values.filter(Boolean).join(" ").toUpperCase();
  return (["M1", "M5", "M15"] as const).filter((timeframe) =>
    new RegExp(`(^|[^A-Z0-9])${timeframe}([^A-Z0-9]|$)`).test(source),
  );
}

function parseRange(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.trim().replace(/\s*(?:to|–|—)\s*/gi, " - ");
  const match = cleaned.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
  return match ? `${match[1]} - ${match[2]}` : undefined;
}

/**
 * A chart image cannot be truthfully reverse-engineered from Telegram's file
 * metadata. This accepts only explicit, machine-readable SMC metadata supplied
 * with the upload, then validates the same three required confirmations. It
 * never invents prices, bias, or a trade from a filename/hash.
 */
function detectSmcFromMetadata(caption: string | undefined): SMCSetup | undefined {
  if (!caption) return undefined;
  const fields = new Map<string, string>();
  for (const part of caption.split(/[;\n]/)) {
    const match = part.trim().match(/^(bias|ob|fvg|entry|entry2|method)\s*[:=]\s*(.+)$/i);
    if (match) fields.set(match[1].toLowerCase(), match[2].trim());
  }
  const biasValue = fields.get("bias")?.toLowerCase();
  const bias = biasValue === "bull" ? "Bull" : biasValue === "bear" ? "Bear" : undefined;
  const orderBlock = parseRange(fields.get("ob"));
  const fvg = parseRange(fields.get("fvg"));
  const entry = parseRange(fields.get("entry"));
  const entry2 = parseRange(fields.get("entry2"));
  const method: "Limit" | "Market" = fields.get("method")?.toLowerCase() === "market" ? "Market" : "Limit";
  if (!bias || !orderBlock || !fvg || !entry) return undefined;
  return { bias, orderBlock, fvg, entries: [{ method, range: entry }, ...(entry2 ? [{ method, range: entry2 }] : [])] };
}

function missingConfirmations(caption: string | undefined): string[] {
  if (!caption) return ["Market bias belum jelas", "order block belum terkonfirmasi", "tidak ada FVG yang valid"];
  const lower = caption.toLowerCase();
  const missing: string[] = [];
  if (!/bias\s*[:=]\s*(bull|bear)/.test(lower)) missing.push("Market bias belum jelas");
  if (!/ob\s*[:=]\s*\d/.test(lower)) missing.push("order block belum terkonfirmasi");
  if (!/fvg\s*[:=]\s*\d/.test(lower)) missing.push("tidak ada FVG yang valid");
  return missing;
}

async function fingerprint(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join("");
}

function annotationCaption(timeframe: Timeframe, setup: SMCSetup | undefined): string {
  if (!setup) return `Analisis XAUUSD ${timeframe}: elemen yang terdeteksi ditinjau. Tidak ada entry yang ditandai.`;
  const markers = setup.entries.map((entry, index) => `Entry ${String.fromCharCode(65 + index)} ${entry.range}`).join(" • ");
  return `Anotasi XAUUSD ${timeframe}: ${markers}.`;
}

function tradeCard(timeframe: Timeframe, setup: SMCSetup): string {
  const entries = setup.entries.map((entry, index) =>
    `${setup.entries.length > 1 ? `Entry ${String.fromCharCode(65 + index)}: ` : "Entry: "}${entry.method} ${entry.range}`,
  );
  const rationale = setup.bias === "Bull"
    ? `Order block + FVG searah bias bullish — setup scalping ${timeframe}.`
    : `Order block + FVG searah bias bearish — setup scalping ${timeframe}.`;
  return [
    `Bias Pasar: ${setup.bias}`,
    `Order Block (${timeframe}): ${setup.orderBlock}`,
    `FVG: ${setup.fvg}`,
    "Alignment: YA",
    ...entries,
    `Alasan: ${rationale}`,
  ].join("\n");
}

async function assessChart(ctx: Ctx, chart: ChartInput, timeframe: Timeframe) {
  ctx.session.step = "idle";
  ctx.session.pendingChart = undefined;
  const setup = detectSmcFromMetadata(chart.caption);
  await ctx.replyWithPhoto(chart.fileId, { caption: annotationCaption(timeframe, setup) });
  if (setup) {
    await ctx.reply(tradeCard(timeframe, setup));
    return;
  }
  await ctx.reply(
    `${missingConfirmations(chart.caption).join(", ")}.\nCoba unggah timeframe lain (M1/M5/M15) atau kirim gambar dengan area harga yang lebih lengkap.`,
  );
}

async function requestTimeframe(ctx: Ctx, chart: ChartInput, found: Timeframe[]) {
  // Session storage is the toolkit-provided, restart-safe conversation store.
  // These fields exist only until the user chooses an ambiguous timeframe.
  (ctx.session as unknown as { pendingChart?: PendingChart }).pendingChart = { ...chart, timeframes: found };
  ctx.session.step = "awaiting_timeframe";
  const message = found.length > 1
    ? "Gambar ini memuat lebih dari satu timeframe. Pilih chart yang ingin dianalisis."
    : "Timeframe belum terdeteksi. Pilih M1, M5, atau M15 untuk melanjutkan.";
  await ctx.reply(message, { reply_markup: timeframeKeyboard });
}

composer.callbackQuery("analyze:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "awaiting_chart";
  ctx.session.pendingChart = undefined;
  await ctx.editMessageText(
    "Kirim chart XAUUSD M1, M5, atau M15 yang jelas. Sertakan skala harga dan candle terbaru.",
    { reply_markup: uploadKeyboard },
  );
});

composer.callbackQuery("analyze:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "idle";
  ctx.session.pendingChart = undefined;
  await ctx.editMessageText("Analisis chart dibatalkan.");
});

composer.callbackQuery(/^analyze:timeframe:(M1|M5|M15)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const pending = (ctx.session as unknown as { pendingChart?: PendingChart }).pendingChart;
  if (ctx.session.step !== "awaiting_timeframe" || !pending?.fileId) {
    await ctx.reply("Mulai analisis baru dari menu, lalu kirim chart.");
    return;
  }
  const timeframe = ctx.match[1] as Timeframe;
  await ctx.editMessageText(`Menganalisis chart ${timeframe} dengan konfirmasi SMC yang diperlukan.`);
  await assessChart(ctx, pending, timeframe);
});

composer.on("message:photo", async (ctx) => {
  const photo = ctx.message.photo.at(-1);
  if (!photo) return;
  const chart: ChartInput = {
    fileId: photo.file_id,
    imageHash: await fingerprint(photo.file_unique_id),
    caption: ctx.message.caption,
  };
  const found = detectedTimeframes(ctx.message.caption);
  if (found.length === 1) {
    await assessChart(ctx, chart, found[0]);
    return;
  }
  await requestTimeframe(ctx, chart, found);
});

composer.on("message:document", async (ctx) => {
  const document = ctx.message.document;
  if (!document.mime_type?.startsWith("image/")) return;
  const chart: ChartInput = {
    fileId: document.file_id,
    imageHash: await fingerprint(document.file_unique_id),
    caption: ctx.message.caption,
    filename: document.file_name,
  };
  const found = detectedTimeframes(ctx.message.caption, document.file_name);
  if (found.length === 1) {
    await assessChart(ctx, chart, found[0]);
    return;
  }
  await requestTimeframe(ctx, chart, found);
});

export default composer;
