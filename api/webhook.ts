import type { IncomingMessage } from "http";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
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

const LINE_CHANNEL_ACCESS_TOKEN =
  process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";

const LINE_CHANNEL_SECRET =
  process.env.LINE_CHANNEL_SECRET ?? "";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

type UserRecord = {
  id: string;
  line_user_id: string;
  goal: string | null;
  exercise_level: string | null;
  twenty_min_feeling: string | null;
  notify_time: string | null;
};

function getSupabaseClient() {
  if (!SUPABASE_URL) {
    throw new Error("Missing SUPABASE_URL");
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

function getLineClient() {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    throw new Error("Missing LINE_CHANNEL_ACCESS_TOKEN");
  }

  return new messagingApi.MessagingApiClient({
    channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
  });
}

async function getRawBody(
  req: IncomingMessage,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk) => {
      chunks.push(
        Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk),
      );
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    req.on("error", reject);
  });
}

function isTextMessageEvent(
  event: WebhookEvent,
): event is MessageEvent & {
  message: TextEventMessage;
} {
  return (
    event.type === "message" &&
    event.message.type === "text"
  );
}

function getLineUserId(
  event: WebhookEvent,
): string | null {
  if (
    event.source.type === "user" &&
    event.source.userId
  ) {
    return event.source.userId;
  }

  return null;
}

function normalizeText(text: string): string {
  return text
    .trim()
    .replace(/[０-９]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 65248),
    );
}

const GOAL_MESSAGE = `はじめまして！
AI習慣コーチです🌱

まず、あなたの目標を教えてください。

1. ダイエット
2. 姿勢改善
3. 健康維持
4. きれいな体づくり
5. 運動を習慣化したい

数字で回答してください。`;

const EXERCISE_LEVEL_MESSAGE = `現在の運動習慣を教えてください。

1. ほとんど運動していない
2. 週1〜2回運動している
3. 週3回以上運動している

数字で回答してください。`;

const TWENTY_MIN_MESSAGE = `「毎日20分運動する」と聞いて、どう感じますか？

1. 無理なくできそう
2. 少し長く感じる
3. かなり大変に感じる

数字で回答してください。`;

const NOTIFY_TIME_MESSAGE = `毎日の運動メッセージを何時に受け取りたいですか？

1. 7:00
2. 12:00
3. 18:00
4. 21:00

または「8:30」のように、5:00〜22:00の間で入力してください。`;

function parseGoal(text: string): string | null {
  const choices: Record<string, string> = {
    "1": "ダイエット",
    "2": "姿勢改善",
    "3": "健康維持",
    "4": "きれいな体づくり",
    "5": "運動を習慣化したい",
  };

  return choices[normalizeText(text)] ?? null;
}

function parseExerciseLevel(
  text: string,
): string | null {
  const choices: Record<string, string> = {
    "1": "ほとんど運動していない",
    "2": "週1〜2回運動している",
    "3": "週3回以上運動している",
  };

  return choices[normalizeText(text)] ?? null;
}

function parseTwentyMinFeeling(
  text: string,
): string | null {
  const choices: Record<string, string> = {
    "1": "無理なくできそう",
    "2": "少し長く感じる",
    "3": "かなり大変に感じる",
  };

  return choices[normalizeText(text)] ?? null;
}

function parseNotifyTime(
  text: string,
): string | null {
  const normalizedText = normalizeText(text);

  const choices: Record<string, string> = {
    "1": "07:00",
    "2": "12:00",
    "3": "18:00",
    "4": "21:00",
  };

  if (choices[normalizedText]) {
    return choices[normalizedText];
  }

  const match = normalizedText.match(
    /^(\d{1,2}):(\d{2})$/,
  );

  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (
    hour < 5 ||
    hour > 22 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return `${String(hour).padStart(2, "0")}:${String(
    minute,
  ).padStart(2, "0")}`;
}

async function getOrCreateUser(
  lineUserId: string,
): Promise<UserRecord> {
  const supabase = getSupabaseClient();

  const { data: existingUser, error: selectError } =
    await supabase
      .from("users")
      .select("*")
      .eq("line_user_id", lineUserId)
      .maybeSingle();

  if (selectError) {
    throw new Error(
      `Failed to get LINE user: ${selectError.message}`,
    );
  }

  if (existingUser) {
    return existingUser as UserRecord;
  }

  const { data: newUser, error: insertError } =
    await supabase
      .from("users")
      .insert({
        line_user_id: lineUserId,
      })
      .select("*")
      .single();

  if (insertError || !newUser) {
    throw new Error(
      `Failed to create LINE user: ${
        insertError?.message ?? "Unknown error"
      }`,
    );
  }

  return newUser as UserRecord;
}

async function updateUser(
  lineUserId: string,
  values: Partial<UserRecord>,
): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from("users")
    .update(values)
    .eq("line_user_id", lineUserId);

  if (error) {
    throw new Error(
      `Failed to update LINE user: ${error.message}`,
    );
  }
}

async function createQuestionnaireReply(
  user: UserRecord,
  receivedText: string,
): Promise<string> {
  if (!user.goal) {
    const goal = parseGoal(receivedText);

    if (!goal) {
      return GOAL_MESSAGE;
    }

    await updateUser(user.line_user_id, {
      goal,
    });

    return `「${goal}」ですね！✨

${EXERCISE_LEVEL_MESSAGE}`;
  }

  if (!user.exercise_level) {
    const exerciseLevel =
      parseExerciseLevel(receivedText);

    if (!exerciseLevel) {
      return `1〜3の数字で回答してください。

${EXERCISE_LEVEL_MESSAGE}`;
    }

    await updateUser(user.line_user_id, {
      exercise_level: exerciseLevel,
    });

    return `ありがとうございます！

${TWENTY_MIN_MESSAGE}`;
  }

  if (!user.twenty_min_feeling) {
    const twentyMinFeeling =
      parseTwentyMinFeeling(receivedText);

    if (!twentyMinFeeling) {
      return `1〜3の数字で回答してください。

${TWENTY_MIN_MESSAGE}`;
    }

    await updateUser(user.line_user_id, {
      twenty_min_feeling: twentyMinFeeling,
    });

    return `あなたに合った運動量を考える参考にします😊

${NOTIFY_TIME_MESSAGE}`;
  }

  if (!user.notify_time) {
    const notifyTime =
      parseNotifyTime(receivedText);

    if (!notifyTime) {
      return `時間を正しく入力してください。

例：7:00、18:30

${NOTIFY_TIME_MESSAGE}`;
    }

    await updateUser(user.line_user_id, {
      notify_time: notifyTime,
    });

    return `登録が完了しました！🎉

毎日${notifyTime}ごろに、あなたに合った運動を提案します。

まずは無理なく、一緒に続けていきましょう🌱`;
  }

  return `登録は完了しています😊

現在の設定
・目標：${user.goal}
・運動習慣：${user.exercise_level}
・20分運動への気持ち：${user.twenty_min_feeling}
・通知時間：${user.notify_time}

次は、今日の体調に合わせた運動提案機能を準備します。`;
}

async function replyText(
  replyToken: string,
  text: string,
): Promise<void> {
  const lineClient = getLineClient();

  await lineClient.replyMessage({
    replyToken,
    messages: [
      {
        type: "text",
        text,
      },
    ],
  });
}

async function handleEvent(
  event: WebhookEvent,
): Promise<void> {
  if (!isTextMessageEvent(event)) {
    return;
  }

  const lineUserId = getLineUserId(event);

  if (!lineUserId) {
    await replyText(
      event.replyToken,
      "ユーザー情報を取得できませんでした。",
    );
    return;
  }

  try {
    const user = await getOrCreateUser(lineUserId);

    const replyMessage =
      await createQuestionnaireReply(
        user,
        event.message.text,
      );

    await replyText(
      event.replyToken,
      replyMessage,
    );

    console.log(
      "Questionnaire reply sent:",
      lineUserId,
    );
  } catch (error) {
    console.error(
      "Questionnaire handling error:",
      error,
    );

    await replyText(
      event.replyToken,
      "申し訳ありません。登録処理でエラーが発生しました。少し時間をおいて、もう一度お試しください。",
    );
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  try {
    if (req.method !== "POST") {
      res
        .status(405)
        .send("Method Not Allowed");
      return;
    }

    if (!LINE_CHANNEL_SECRET) {
      res
        .status(500)
        .send("Server misconfigured");
      return;
    }

    const rawBody = await getRawBody(req);
    const rawText = rawBody.toString("utf-8");

    const signature =
      req.headers["x-line-signature"];

    const isValid =
      typeof signature === "string" &&
      validateSignature(
        rawText,
        LINE_CHANNEL_SECRET,
        signature,
      );

    if (!isValid) {
      res
        .status(401)
        .send("Invalid signature");
      return;
    }

    let events: WebhookEvent[];

    try {
      const body = JSON.parse(rawText) as {
        events?: WebhookEvent[];
      };

      events = body.events ?? [];
    } catch {
      res.status(400).send("Invalid JSON");
      return;
    }

    if (events.length === 0) {
      res.status(200).send("OK");
      return;
    }

    await Promise.all(
      events.map(handleEvent),
    );

    res.status(200).send("OK");
  } catch (error) {
    console.error(
      "Webhook handling error:",
      error,
    );

    res
      .status(500)
      .send("Internal Server Error");
  }
}