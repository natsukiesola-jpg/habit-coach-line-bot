import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { IncomingMessage } from 'http';
import crypto from 'crypto';
import { Client, WebhookEvent, TextMessage } from '@line/bot-sdk';
import OpenAI from 'openai';

// Vercel にリクエストボディを自動パースさせず、生の Buffer を受け取る
// (LINE の署名検証には生のリクエストボディが必要なため)
export const config = {
  api: {
    bodyParser: false,
  },
};

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? '';
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET ?? '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';

const lineClient = new Client({
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: LINE_CHANNEL_SECRET,
});

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

/**
 * リクエストストリームから生の Buffer を読み取る
 */
function getRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * LINE Platform からのリクエストであることを署名で検証する
 */
function validateSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const hash = crypto
    .createHmac('sha256', LINE_CHANNEL_SECRET)
    .update(rawBody)
    .digest('base64');
  // タイミング攻撃対策のため timingSafeEqual を使用
  const a = Buffer.from(hash);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * OpenAI API を使ってテキストへの返信を生成する
 */
async function generateReply(userText: string): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'あなたはLINEで会話するフレンドリーなアシスタントです。簡潔で分かりやすい日本語で返信してください。',
        },
        { role: 'user', content: userText },
      ],
      max_tokens: 500,
    });

    return (
      completion.choices[0]?.message?.content?.trim() ??
      'すみません、うまく返答を生成できませんでした。'
    );
  } catch (error) {
    console.error('OpenAI API error:', error);
    return 'すみません、只今エラーが発生しています。しばらくしてからもう一度お試しください。';
  }
}

/**
 * 1件のイベントを処理する
 */
async function handleEvent(event: WebhookEvent): Promise<void> {
  // テキストメッセージ以外(スタンプ・画像等)は無視する
  if (event.type !== 'message' || event.message.type !== 'text') {
    return;
  }

  const userText = event.message.text;
  const replyText = await generateReply(userText);

  const message: TextMessage = {
    type: 'text',
    text: replyText,
  };

  await lineClient.replyMessage(event.replyToken, message);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  let rawBody: Buffer;
  try {
    rawBody = await getRawBody(req);
  } catch (error) {
    console.error('Failed to read request body:', error);
    res.status(400).send('Bad Request');
    return;
  }

  const signature = req.headers['x-line-signature'] as string | undefined;

  if (!validateSignature(rawBody, signature)) {
    console.warn('Invalid signature');
    res.status(401).send('Invalid signature');
    return;
  }

  let body: { events: WebhookEvent[] };
  try {
    body = JSON.parse(rawBody.toString('utf-8'));
  } catch (error) {
    console.error('Failed to parse JSON body:', error);
    res.status(400).send('Bad Request');
    return;
  }

  const events = body.events ?? [];

  // LINE Platform には素早く 200 を返す必要があるため、
  // イベント処理の完了を待たずにレスポンスを返してもよいが、
  // ここでは確実性を優先し処理完了後にレスポンスする。
  try {
    await Promise.all(events.map((event) => handleEvent(event)));
  } catch (error) {
    console.error('Error while handling events:', error);
    // LINE 側の再送を防ぐため、内部エラーでも 200 を返す
  }

  res.status(200).json({ status: 'ok' });
}
