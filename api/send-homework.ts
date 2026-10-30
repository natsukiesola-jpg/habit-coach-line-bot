import { createHash } from "crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { messagingApi } from "@line/bot-sdk";
import {
  buildHomeworkMessage,
  getJapanDate,
  getLog,
  type HomeworkStudent,
} from "../lib/homework";

// Vercel Cron から毎朝呼ばれ、パーソナル受講生に今日の宿題を送る。
// ?dry=1 を付けると、送らずに「送る予定の内容」だけを返す。

const LINE_CHANNEL_ACCESS_TOKEN =
  process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const CRON_SECRET =
  process.env.CRON_SECRET ?? "";

function getSupabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase settings");
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// 同じ日に 2 回呼ばれても LINE 側で二重送信にならないよう、受講生と日付から決まる ID を付ける。
function retryKey(studentId: string, logDate: string): string {
  const hex = createHash("sha256")
    .update(`${studentId}:${logDate}`)
    .digest("hex");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (
    !CRON_SECRET ||
    req.headers.authorization !== `Bearer ${CRON_SECRET}`
  ) {
    res.status(401).send("Unauthorized");
    return;
  }

  const dryRun = req.query.dry === "1";

  try {
    const supabase = getSupabaseClient();
    const today = getJapanDate();
    const yesterday = getJapanDate(-1);

    const { data, error } = await supabase
      .from("homework_students")
      .select("*")
      .eq("active", true)
      .not("line_user_id", "is", null);

    if (error) {
      throw new Error(error.message);
    }

    const students = (data ?? []) as HomeworkStudent[];
    const report: Record<string, unknown>[] = [];

    for (const student of students) {
      const todayLog = await getLog(supabase, student.id, today);

      if (todayLog?.sent_at) {
        report.push({ label: student.label, status: "already_sent" });
        continue;
      }

      const yesterdayLog = await getLog(
        supabase,
        student.id,
        yesterday,
      );

      const gentle =
        !!yesterdayLog?.sent_at &&
        (yesterdayLog.result === null ||
          yesterdayLog.result === "none");

      const message = buildHomeworkMessage(
        student.must_item,
        student.opt_item,
        today,
        gentle,
      );

      if (dryRun) {
        report.push({
          label: student.label,
          status: "dry_run",
          text: message.text,
        });
        continue;
      }

      try {
        try {
          await new messagingApi.MessagingApiClient({
            channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
          }).pushMessage(
            {
              to: student.line_user_id as string,
              messages: [message],
            },
            retryKey(student.id, today),
          );
        } catch (pushError) {
          // 409 は「同じ retry key で送信済み」。記録だけ残す。
          if ((pushError as { status?: number }).status !== 409) {
            throw pushError;
          }
        }

        const { error: logError } = await supabase
          .from("homework_logs")
          .upsert(
            {
              student_id: student.id,
              log_date: today,
              must_item: student.must_item,
              opt_item: student.opt_item,
              sent_at: new Date().toISOString(),
            },
            { onConflict: "student_id,log_date" },
          );

        if (logError) {
          throw new Error(logError.message);
        }

        report.push({ label: student.label, status: "sent" });
      } catch (sendError) {
        console.error("Homework send error:", student.label, sendError);
        report.push({ label: student.label, status: "error" });
      }
    }

    res.status(200).json({ date: today, dryRun, report });
  } catch (error) {
    console.error("Send homework error:", error);
    res.status(500).send("Internal Server Error");
  }
}
