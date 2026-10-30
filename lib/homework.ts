import type { SupabaseClient } from "@supabase/supabase-js";
import type { messagingApi } from "@line/bot-sdk";

// パーソナルレッスンで出している宿題の一覧。
// 受講生ごとに「必須 1 つ＋できたら 1 つ」をここから選びます。
export type HomeworkItem = {
  name: string;
  how: string;
  min: number;
};

export const HOMEWORK_ITEMS: Record<string, HomeworkItem> = {
  breath: { name: "腹式呼吸 5回", how: "仰向けで手をお腹に。吸ってふくらむ、吐いて薄くなるのを感じる", min: 1 },
  mizo: { name: "鳩尾腹筋 10回", how: "仰向けで膝を立て、みぞおちから肩甲骨を床から浮かせる", min: 1 },
  zenmomo: { name: "前ももストレッチ 左右30秒", how: "割り座、または仰向けで片膝を曲げて床へ。起きたらベッドで", min: 1 },
  twist: { name: "ツイスト腹筋 左右5回", how: "肘と反対の膝を近づけるように、斜めに起き上がる", min: 1 },
  gassho: { name: "合蹠のお尻上げ 10回", how: "足裏を合わせて膝を開き、尾骨を残してお尻を上げ下げ。きつければ5回", min: 2 },
  catcow: { name: "脇を締めたキャット&カウ 5往復", how: "四つばいで脇を締め、背骨を一つずつ丸める・反らす", min: 1 },
  neko: { name: "猫の伸び 30秒", how: "四つばいから手を前に歩かせ、胸を床へ。布団の中でもOK", min: 1 },
  neck: { name: "首の後ろのストレッチ 1分", how: "手を後頭部で組み、背筋を伸ばしたまま顎を引いて肘を寄せる", min: 1 },
  kata: { name: "手を組む肩のストレッチ", how: "胸の前で組んで前→上へ、後ろで組んで拳を引く", min: 2 },
  ankle: { name: "足首回し・足指ほぐし", how: "足指を1本ずつ開いて、足首を左右に10回ずつ回す", min: 2 },
  tableleg: { name: "テーブルトップの脚上げ 10回×2", how: "仰向けで膝を90度に上げ、お腹を薄くしたまま脚を下ろして戻す", min: 2 },
  hizadachi: { name: "膝立ちの股関節ストレッチ 左右30秒", how: "片膝立ちで骨盤を前へ。腰がつらいときにも", min: 1 },
  zenkyo: { name: "前鋸筋プッシュ 10秒×3", how: "四つばいで床を押し、肩甲骨を外に広げてキープ", min: 1 },
  babycobra: { name: "ベビーコブラ 3回", how: "お尻をゆるめたまま、背中の上だけで胸を起こす", min: 2 },
  side: { name: "サイドプランク 左右10秒", how: "膝をついてもOK。頭からかかとまでまっすぐ", min: 1 },
  sideelbow: { name: "サイドプランクの肘寄せ 左右5回", how: "肘つきの横向きで、頭の後ろに手。吐いて肘と肘を寄せる", min: 2 },
  plankhip: { name: "プランクで腰を左右に 6回", how: "肘つきプランクで腰を左右に倒す。慣れたら10回", min: 1 },
  halfsun: { name: "半分の太陽礼拝 3回", how: "5秒の呼吸に合わせて、前屈・半分の前屈をくり返す", min: 3 },
  sun: { name: "太陽礼拝 3回", how: "チャトランガは膝をついてOK", min: 6 },
  lunge: { name: "ローランジ → 三日月 左右", how: "後ろの膝をついて骨盤を前へ、両手を上げる", min: 2 },
  triangle: { name: "三角のポーズ 左右10秒", how: "脚を広げて、体を横に倒す。胸は正面", min: 2 },
  squat: { name: "スクワット 10回", how: "お尻を下げずに後ろへ引く。膝はつま先と同じ向き", min: 2 },
  kaeru: { name: "カエルのポーズ 30秒", how: "四つばいで膝を左右に開き、お尻を後ろへ", min: 1 },
};

export type HomeworkResult = "both" | "must" | "none";

export type HomeworkStudent = {
  id: string;
  label: string;
  invite_code: string;
  line_user_id: string | null;
  must_item: string;
  opt_item: string | null;
  active: boolean;
};

export type HomeworkLog = {
  id: number;
  student_id: string;
  log_date: string;
  must_item: string;
  opt_item: string | null;
  sent_at: string | null;
  result: HomeworkResult | null;
  answered_at: string | null;
};

// 「前もも」のような一部の名前でも、キー（zenmomo）でも探せるようにする。
export function findItemKey(query: string): string | null {
  if (HOMEWORK_ITEMS[query]) {
    return query;
  }

  const matches = Object.keys(HOMEWORK_ITEMS).filter((key) =>
    HOMEWORK_ITEMS[key].name.includes(query),
  );

  return matches.length === 1 ? matches[0] : null;
}

export function getJapanDate(offsetDays = 0): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + offsetDays * 86400000));
}

const RESULT_LABELS: Record<HomeworkResult, string> = {
  both: "両方できた",
  must: "必須だけできた",
  none: "今日はできなかった",
};

function itemText(tag: string, key: string): string {
  const item = HOMEWORK_ITEMS[key];

  return `【${tag}】${item.name}（${item.min}分）
${item.how}`;
}

// 毎朝の宿題メッセージ。前日にできなかった・返事がなかったときは、責めずに一言そえる。
export function buildHomeworkMessage(
  mustItem: string,
  optItem: string | null,
  logDate: string,
  gentle: boolean,
): messagingApi.TextMessage {
  const greeting = gentle
    ? `昨日はお疲れ様でした！
今日は必須の1つだけでも十分です🌱`
    : "おはようございます☀️";

  const parts = [
    `${greeting}
今日の宿題です。`,
    itemText("必須", mustItem),
  ];

  if (optItem) {
    parts.push(itemText("できたら", optItem));
  }

  parts.push("終わったら、下のボタンで教えてください。");

  const results: HomeworkResult[] = optItem
    ? ["both", "must", "none"]
    : ["must", "none"];

  return {
    type: "text",
    text: parts.join("\n\n"),
    quickReply: {
      items: results.map((result) => {
        const label =
          !optItem && result === "must"
            ? "できた"
            : RESULT_LABELS[result];

        return {
          type: "action",
          action: {
            type: "postback",
            label,
            displayText: label,
            data: `hw=${result}&date=${logDate}`,
          },
        };
      }),
    },
  };
}

export function buildResultReply(result: HomeworkResult): string {
  if (result === "none") {
    return "大丈夫です。週1回でも、やった分だけ体は変わります。明日また1分だけやってみましょう。";
  }

  if (result === "must") {
    return "必須ができたら100点です！";
  }

  return "すばらしいです！次のレッスンで、体の変化を一緒に確かめましょう。";
}

export function parseHomeworkPostback(
  data: string,
): { result: HomeworkResult; date: string } | null {
  const params = new URLSearchParams(data);
  const result = params.get("hw");
  const date = params.get("date");

  if (
    (result === "both" || result === "must" || result === "none") &&
    date &&
    /^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    return { result, date };
  }

  return null;
}

export function normalizeInviteCode(text: string): string | null {
  const code = text
    .trim()
    .toUpperCase()
    .replace(/[Ａ-Ｚ０-９]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 65248),
    )
    .replace(/[\s-]/g, "");

  return /^ESOLA[A-Z0-9]{4}$/.test(code) ? code : null;
}

export async function getStudentByLineUserId(
  supabase: SupabaseClient,
  lineUserId: string,
): Promise<HomeworkStudent | null> {
  const { data, error } = await supabase
    .from("homework_students")
    .select("*")
    .eq("line_user_id", lineUserId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as HomeworkStudent | null;
}

// 招待コードを送ってきた LINE アカウントを受講生に結びつける。
export async function linkStudent(
  supabase: SupabaseClient,
  inviteCode: string,
  lineUserId: string,
): Promise<HomeworkStudent | null> {
  const { data, error } = await supabase
    .from("homework_students")
    .update({
      line_user_id: lineUserId,
      updated_at: new Date().toISOString(),
    })
    .eq("invite_code", inviteCode)
    .is("line_user_id", null)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as HomeworkStudent | null;
}

export async function getLog(
  supabase: SupabaseClient,
  studentId: string,
  logDate: string,
): Promise<HomeworkLog | null> {
  const { data, error } = await supabase
    .from("homework_logs")
    .select("*")
    .eq("student_id", studentId)
    .eq("log_date", logDate)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as HomeworkLog | null;
}

export async function saveResult(
  supabase: SupabaseClient,
  studentId: string,
  logDate: string,
  result: HomeworkResult,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("homework_logs")
    .update({
      result,
      answered_at: new Date().toISOString(),
    })
    .eq("student_id", studentId)
    .eq("log_date", logDate)
    .select("id");

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).length > 0;
}
