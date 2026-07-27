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

export const config = {
  api: {
    bodyParser: false,
  },
};

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET ?? "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

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

function getLineClient() {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    throw new Error("Missing LINE_CHANNEL_ACCESS_TOKEN");
  }

  return new messagingApi.MessagingApiClient({
    channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
  });
}

function getGenAI() {
  if (!GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  // 公式の最小形に合わせる
  return new GoogleGenAI({});
}

async function generateReply(userText: string): Promise<string> {
  const genAI = getGenAI();

  const response = await genAI.models.generateContent({
    model: GEMINI_MODEL,
    contents: userText,
  });

  const text = response.text?.trim();

  return text && text.length > 0
    ? text
    : "うまく回答を生成できませんでした。";
}

async function handleEvent(event: WebhookEvent): Promise<void> {
  if (!isTextMessageEvent(event)) {
    return;
  }

  const lineClient = getLineClient();
  const userText = event.message.text;

  let replyText = "";
  try {
    replyText = await generateReply(userText);
  } catch (err) {
    console.error("Gemini API error:", err);
    replyText =
      "AIの返答生成でエラーが発生しました。GEMINI_API_KEY を確認してください。";
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

    // LINE Developers の Verify 用
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
