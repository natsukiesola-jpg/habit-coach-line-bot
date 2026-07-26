import type { IncomingMessage } from "http";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  messagingApi,
  validateSignature,
  type WebhookEvent,
  type MessageEvent,
  type TextEventMessage,
} from "@line/bot-sdk";
import { GoogleGenAI } from "@google/genai";

// LINE の署名検証には生ボディが必要なため、Vercel の自動ボディパースを無効化する
export const config = {
  api: {
    bodyParser: false,
  },
};

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET ?? "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

const lineClient = new messagingApi.MessagingApiClient({
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
});

const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

/**
 * Vercel の Node.js Serverless Function には req.body の代わりに
 * リクエストストリームから raw body を読み取る必要がある
 */
async function getRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", (err) => reject(err));
  });
}

function isTextMessageEvent(
  event: WebhookEvent,
): event is MessageEvent & { message: TextEventMessage } {
  return event.type === "message" && event.message.type === "text";
}

/**
 * Gemini API にユーザーのメッセージを送信し、返信文を生成する
 */
async function generateReply(userText: string): Promise<string> {
  const response = await genAI.models.generateContent({
    model: GEMINI_MODEL,
    contents: userText,
    config: {
      systemInstruction:
        "あなたは親切なアシスタントです。LINE のトーク画面で読みやすいよう、簡潔な日本語で答えてください。",
    },
  });

  const text = response.text?.trim();
  return text && text.length > 0
    ? text
    : "すみません、うまく回答を生成できませんでした。";
}

async function handleEvent(event: WebhookEvent): Promise<void> {
  if (!isTextMessageEvent(event)) {
    // テキストメッセージ以外のイベントは無視する
    return;
  }

  const userText = event.message.text;

  let replyText: string;
  try {
    replyText = await generateReply(userText);
  } catch (err) {
    console.error("Gemini API error:", err);
    replyText = "エラーが発生しました。しばらくしてからもう一度お試しください。";
  }

  await lineClient.replyMessage({
    replyToken: event.replyToken,
    messages: [
      {
        type: "text",
        text: replyText,
      },
    ],
  });
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const rawBody = await getRawBody(req);
  const signature = req.headers["x-line-signature"];

  if (
    typeof signature !== "string" ||
    !validateSignature(rawBody, LINE_CHANNEL_SECRET, signature)
  ) {
    res.status(401).send("Invalid signature");
    return;
  }

  let events: WebhookEvent[] = [];
  try {
    const body = JSON.parse(rawBody.toString("utf-8")) as {
      events?: WebhookEvent[];
    };
    events = body.events ?? [];
  } catch (err) {
    res.status(400).send("Invalid JSON");
    return;
  }

  try {
    await Promise.all(events.map((event) => handleEvent(event)));
    res.status(200).send("OK");
  } catch (err) {
    console.error("Webhook handling error:", err);
    res.status(500).send("Internal Server Error");
  }
}
