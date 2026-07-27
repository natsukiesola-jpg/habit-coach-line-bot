import type { IncomingMessage } from "http";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  messagingApi,
  validateSignature,
  type WebhookEvent,
  type MessageEvent,
  type TextEventMessage,
} from "@line/bot-sdk";

export const config = {
  api: {
    bodyParser: false,
  },
};

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET ?? "";

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

async function handleEvent(event: WebhookEvent): Promise<void> {
  console.log("handleEvent start:", JSON.stringify(event));

  if (!isTextMessageEvent(event)) {
    console.log("not text event");
    return;
  }

  const lineClient = getLineClient();
  console.log("replying to text:", event.message.text);

  try {
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [
        {
          type: "text",
          text: `受け取りました: ${event.message.text}`,
        },
      ],
    });
    console.log("reply sent");
  } catch (err) {
    console.error("replyMessage error:", err);
    throw err;
  }
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
    const rawText = rawBody.toString("utf-8");
    const signature = req.headers["x-line-signature"];

    const isValid =
      typeof signature === "string" &&
      validateSignature(rawText, LINE_CHANNEL_SECRET, signature);

    if (!isValid) {
      console.error("Invalid signature");
      res.status(401).send("Invalid signature");
      return;
    }

    let events: WebhookEvent[] = [];

    try {
      const body = JSON.parse(rawText) as { events?: WebhookEvent[] };
      events = body.events ?? [];
      console.log("events length:", events.length);
    } catch (err) {
      console.error("Invalid JSON", err);
      res.status(400).send("Invalid JSON");
      return;
    }

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
