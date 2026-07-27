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

// LINE の署名検証には生ボディが必要
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

const genAI = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
});

async function getRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    req.on("error", (err) => {
      reject(err);
    });
  });
}

function isTextMessageEvent(
  event: WebhookEvent,
): event is MessageEvent & { message: TextEventMessage } {
  return event.type === "message" && event.message.type === "text";
}

async function generateReply(userText: string): Promise<string> {
  if (!GEMINI_API_KEY) {
    return "いまAIの設定がまだ完了していません。GEMINI_API_KEY を確認してください。";
  }

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
    return;
  }

  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.error("Missing LINE_CHANNEL_ACCESS_TOKEN");
    return;
  }

  const userText = event.message.text;

  let replyText = "";
  try {
    replyText = await generateReply(userText);
  } catch (err) {
    console.error("Gemini API error:", err);
    replyText =
      "エラーが発生しました。しばらくしてからもう一度お試しください。";
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
  try {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    if (!LINE_CHANNEL_SECRET) {
      console.error("Missing LINE_CHANNEL_SECRET");
      res.status(500).send("Server misconfigured");
      return;
    }

    const rawBody = await getRawBody(req);
    const rawBodyText = rawBody.toString("utf-8");
    const signature = req.headers["x-line-signature"];

    const isValid =
      typeof signature === "string" &&
      validateSignature(rawBodyText, LINE_CHANNEL_SECRET, signature);

    if (!isValid) {
      console.error("Invalid signature", {
        hasSecret: !!LINE_CHANNEL_SECRET,
        signatureType: typeof signature,
        bodyLength: rawBody.length,
      });
      res.status(401).send("Invalid signature");
      return;
    }

    let events: WebhookEvent[] = [];

    try {
      const body = JSON.parse(rawBodyText) as { events?: WebhookEvent[] };
      events = body.events ?? [];
    } catch (err) {
      console.error("Invalid JSON:", err);
      res.status(400).send("Invalid JSON");
      return;
    }

    // Verify 時は events が空でも 200 を返せばOK
    if (events.length === 0) {
      res.status(200).send("OK");
      return;
    }

    await Promise.all(events.map((event) => handleEvent(event)));

    res.status(200).send("OK");
  } catch (err) {
    console.error("Webhook handling error:", err);
    res.status(500).send("Internal Server Error");
  }
}
