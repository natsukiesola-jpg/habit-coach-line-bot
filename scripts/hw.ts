import { randomInt } from "crypto";
import { createClient } from "@supabase/supabase-js";
import {
  buildHomeworkMessage,
  findItemKey,
  getJapanDate,
  HOMEWORK_ITEMS,
  STEP_NAMES,
  type HomeworkLog,
  type HomeworkStudent,
} from "../lib/homework";

// なつきさん用の管理コマンド（Mac で実行）。LINE には何も送りません。
//   npm run hw -- items [ステップ]             宿題の一覧（ステップ別）
//   npm run hw -- preview 前もも 合蹠 [--gentle]  届くメッセージの見本（通信なし）
//   npm run hw -- add Aさん 前もも 合蹠          受講生を追加して招待コードを出す
//   npm run hw -- set Aさん 猫の伸び [できたら]   宿題を変える
//   npm run hw -- pause Aさん / resume Aさん     配信を止める・再開する
//   npm run hw -- list                       受講生の一覧
//   npm run hw -- report [7]                 直近の「できた／できなかった」
//   npm run hw -- send-now [--dry]           朝7時を待たずに今日の宿題を送る（--dry は送らず確認だけ）

const USAGE = `使い方:
  npm run hw -- items [1|2|3]
  npm run hw -- preview <必須> [できたら] [--gentle]
  npm run hw -- add <呼び名> <必須> [できたら]
  npm run hw -- set <呼び名> <必須> [できたら]
  npm run hw -- pause <呼び名>
  npm run hw -- resume <呼び名>
  npm run hw -- list
  npm run hw -- report [日数]
  npm run hw -- send-now [--dry]`;

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      ".env.local に SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を入れてください",
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function itemKey(query: string | undefined): string {
  const key = query ? findItemKey(query) : null;

  if (!key) {
    throw new Error(
      `宿題「${query ?? ""}」が1つに決まりません。npm run hw -- items で名前を確認してください`,
    );
  }

  return key;
}

function optionalItemKey(query: string | undefined): string | null {
  return query ? itemKey(query) : null;
}

function newInviteCode(): string {
  const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "ESOLA";

  for (let i = 0; i < 4; i++) {
    code += characters[randomInt(characters.length)];
  }

  return code;
}

function describe(mustItem: string, optItem: string | null): string {
  return `必須: ${HOMEWORK_ITEMS[mustItem].name}${
    optItem ? ` / できたら: ${HOMEWORK_ITEMS[optItem].name}` : ""
  }`;
}

async function updateStudent(
  label: string,
  values: Partial<HomeworkStudent>,
): Promise<HomeworkStudent> {
  const { data, error } = await getSupabaseClient()
    .from("homework_students")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("label", label)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error(`「${label}」という受講生はいません`);
  }

  return data as HomeworkStudent;
}

async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args;

  if (command === "items") {
    const only = rest[0] ? Number(rest[0]) : null;

    for (const step of [1, 2, 3] as const) {
      if (only && only !== step) {
        continue;
      }

      console.log(`\n■ ステップ${step}　${STEP_NAMES[step]}`);

      for (const core of [true, false]) {
        console.log(core ? "  必須向き" : "  できたら向き");

        for (const [key, item] of Object.entries(HOMEWORK_ITEMS)) {
          if (item.step === step && item.core === core) {
            console.log(`    ${key.padEnd(12)} ${item.name}（${item.min}分）`);
          }
        }
      }
    }
    return;
  }

  if (command === "preview") {
    const gentle = rest.includes("--gentle");
    const [must, opt] = rest.filter((arg) => arg !== "--gentle");
    const message = buildHomeworkMessage(
      itemKey(must),
      optionalItemKey(opt),
      getJapanDate(),
      gentle,
    );

    console.log(message.text);
    console.log(
      `\n[ボタン] ${(message.quickReply?.items ?? [])
        .map((item) => item.action?.label)
        .join(" / ")}`,
    );
    return;
  }

  if (command === "add") {
    const [label, must, opt] = rest;

    if (!label) {
      throw new Error(USAGE);
    }

    const mustItem = itemKey(must);
    const optItem = optionalItemKey(opt);
    const inviteCode = newInviteCode();

    const { error } = await getSupabaseClient()
      .from("homework_students")
      .insert({
        label,
        invite_code: inviteCode,
        must_item: mustItem,
        opt_item: optItem,
      });

    if (error) {
      throw new Error(error.message);
    }

    console.log(`${label} を追加しました（${describe(mustItem, optItem)}）

受講生に送る文の例:
----
宿題が毎朝LINEに届くようになりました！
下のアカウントを友だち追加して、このコードを送ってください。
${inviteCode}
----`);
    return;
  }

  if (command === "set") {
    const [label, must, opt] = rest;
    const mustItem = itemKey(must);
    const optItem = optionalItemKey(opt);

    await updateStudent(label, {
      must_item: mustItem,
      opt_item: optItem,
    });
    console.log(`${label} の宿題を変えました（${describe(mustItem, optItem)}）。明日の朝から届きます`);
    return;
  }

  if (command === "pause" || command === "resume") {
    const [label] = rest;

    await updateStudent(label, { active: command === "resume" });
    console.log(
      `${label} の配信を${command === "pause" ? "止めました" : "再開しました"}`,
    );
    return;
  }

  if (command === "list") {
    const { data, error } = await getSupabaseClient()
      .from("homework_students")
      .select("*")
      .order("created_at");

    if (error) {
      throw new Error(error.message);
    }

    for (const student of (data ?? []) as HomeworkStudent[]) {
      const state = !student.line_user_id
        ? `未登録（コード ${student.invite_code}）`
        : student.active
          ? "配信中"
          : "停止中";

      console.log(
        `${student.label}　${state}　${describe(student.must_item, student.opt_item)}`,
      );
    }
    return;
  }

  if (command === "report") {
    const days = Number(rest[0] ?? 7);
    const dates = Array.from({ length: days }, (_, i) =>
      getJapanDate(i - days + 1),
    );
    const supabase = getSupabaseClient();

    const [{ data: students, error: studentError }, { data: logs, error: logError }] =
      await Promise.all([
        supabase.from("homework_students").select("*").order("created_at"),
        supabase.from("homework_logs").select("*").gte("log_date", dates[0]),
      ]);

    if (studentError || logError) {
      throw new Error((studentError ?? logError)?.message);
    }

    const marks = { both: "◎", must: "○", none: "×" };

    console.log(`${"".padEnd(8)}${dates.map((date) => date.slice(5)).join(" ")}`);
    console.log("◎両方 ○必須だけ ×できなかった ・返事なし （空白は送信なし）\n");

    for (const student of (students ?? []) as HomeworkStudent[]) {
      const row = dates.map((date) => {
        const log = ((logs ?? []) as HomeworkLog[]).find(
          (entry) =>
            entry.student_id === student.id && entry.log_date === date,
        );

        if (!log?.sent_at) {
          return "     ";
        }

        return `  ${log.result ? marks[log.result] : "・"}  `;
      });

      console.log(`${student.label.padEnd(8)}${row.join(" ")}`);
    }
    return;
  }

  if (command === "send-now") {
    const appUrl = process.env.APP_URL;
    const secret = process.env.CRON_SECRET;

    if (!appUrl || !secret) {
      throw new Error(".env.local に APP_URL と CRON_SECRET を入れてください");
    }

    const dry = rest.includes("--dry");
    const response = await fetch(
      `${appUrl.replace(/\/$/, "")}/api/send-homework${dry ? "?dry=1" : ""}`,
      { headers: { authorization: `Bearer ${secret}` } },
    );

    if (!response.ok) {
      throw new Error(`送信に失敗しました（${response.status}）`);
    }

    const body = (await response.json()) as {
      report: { label: string; status: string; text?: string }[];
    };
    const statuses: Record<string, string> = {
      sent: "送りました",
      already_sent: "今日はもう送っています",
      dry_run: "送る予定（まだ送っていません）",
      error: "エラー",
    };

    if (body.report.length === 0) {
      console.log("送る相手がいません（登録が済んで配信中の受講生がいない）");
    }

    for (const entry of body.report) {
      console.log(`${entry.label}　${statuses[entry.status] ?? entry.status}`);

      if (entry.text) {
        console.log(`${entry.text}\n`);
      }
    }
    return;
  }

  throw new Error(USAGE);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
