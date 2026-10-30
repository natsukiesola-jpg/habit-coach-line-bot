# パーソナル受講生への宿題 自動配信 — はじめ方

毎朝7時ごろ、受講生ごとの宿題（必須1つ＋できたら1つ）を LINE で送ります。
受講生は「両方できた／必須だけできた／今日はできなかった」のボタンで返事をします。
前の日にできなかった・返事がなかった受講生には、「昨日はお疲れ様でした！ 今日は必須の1つだけでも十分です」と始まる、やさしい文面で届きます。

## 1. Supabase に表を作る（1回だけ）

Supabase の管理画面 → SQL Editor に `supabase/homework.sql` の中身を貼り付けて Run。

受講生の本名・体の悩みは入れません。入れるのは呼び名（例: Aさん）と宿題の種類だけです。

## 2. Vercel に設定を足す（1回だけ）

Project Settings → Environment Variables に次を追加します（値はご自身で入力してください）。

| Key | 中身 |
|---|---|
| `CRON_SECRET` | 長いランダムな文字列（パスワード生成などで作る） |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | すでに設定済みならそのまま |
| `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET` | すでに設定済みならそのまま |

`vercel.json` に「毎日 22:00 UTC（日本時間 7:00）に `/api/send-homework` を呼ぶ」設定が入っています。
無料の Hobby プランでは 7:00〜7:59 のどこかで届きます。

## 3. Mac 側の準備（1回だけ）

`.env.local`（この Mac の中だけのファイル）を開いて、空欄を埋めます。

- `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY`：Supabase の Project Settings → API からコピー
- `APP_URL`：Vercel のアプリの URL
- `CRON_SECRET`：自動で入っています。同じ値を手順 2 で Vercel に貼ります

## 4. まず自分で試す

```
npm run hw -- add 自分 前もも 合蹠
```

1. 出てきた招待コードを、自分の LINE からボットに送る → 「登録できました」が返る
2. `npm run hw -- send-now --dry` で、自分あてに送る予定の文面を確認（まだ送りません）
3. `npm run hw -- send-now` で今すぐ送る → LINE に宿題が届く
4. ボタンを押す → 返事が返る。「宿題」と送る → もう一度見られる
5. `npm run hw -- report` で ◎○× が記録されているか確認
6. 翌朝 7 時台に自動で届くか確認。前日にボタンを押さなかった場合は、やさしい文面になります

同じ日にもう一度 send-now しても、二重には届きません（翌日にまた試せます）。

## 5. 友だちに使ってもらう

```
npm run hw -- add Aさん 猫の伸び 首の後ろ
```

出てきた「受講生に送る文の例」と、ボットの友だち追加リンクを友だちに送ります。

## ふだん使うコマンド

```
npm run hw -- items                    宿題の一覧（名前の一部で指定できます）
npm run hw -- preview 前もも 合蹠       届くメッセージの見本（何も送りません）
npm run hw -- set Aさん 猫の伸び 首の後ろ  宿題を変える（翌朝から）
npm run hw -- pause Aさん               配信を止める（resume で再開）
npm run hw -- list                     受講生の一覧
npm run hw -- report 14                直近14日の ◎○×
npm run hw -- send-now [--dry]         朝を待たずに今日の分を送る
```

## 送る前の確認

デプロイ後、次のように `?dry=1` を付けて呼ぶと、送らずに「誰に何を送る予定か」だけ返ります。

```
curl -H "Authorization: Bearer <CRON_SECRET>" "https://<your-app>.vercel.app/api/send-homework?dry=1"
```

## 知っておくこと

- LINE の無料プランは月200通。1人1日1通なので、無料で送れるのは6人くらいまでです。ボタンへの返事は数に入りません。
- 受講生がボットに普通のメッセージを送ると、「このアカウントは宿題の自動配信専用です」と返します。「宿題」と送ると今日の宿題をもう一度見られます。
- このボットは、AI習慣コーチの登録（目標などの質問）と同じ LINE アカウントです。受講生として登録した人には、その質問は出ません。
