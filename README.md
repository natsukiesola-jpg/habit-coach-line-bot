# LINE Bot (LINE Messaging API + OpenAI API / TypeScript / Vercel)

LINE Messaging API と OpenAI API を組み合わせた、Vercel にデプロイできる LINE Bot です。

## 構成

```
line-bot/
├── api/
│   └── webhook.ts     # POST /api/webhook で LINE の Webhook を受け取るハンドラー
├── package.json
├── tsconfig.json
├── .env.example
└── .gitignore
```

Vercel の Node.js Serverless Functions は `api/` ディレクトリ配下のファイルを自動的に
エンドポイントとして公開するため、`api/webhook.ts` は `https://<your-app>.vercel.app/api/webhook`
として呼び出せます。

LINE の署名検証(`x-line-signature`)にはリクエストの生ボディが必要なため、
`export const config = { api: { bodyParser: false } }` で Vercel の自動ボディパースを無効化し、
ストリームから自前で raw body を読み取っています。

## 事前準備

1. **LINE Developers**
   - LINE Developers コンソールで Messaging API のチャネルを作成
   - 「チャネルアクセストークン(長期)」を発行 → `LINE_CHANNEL_ACCESS_TOKEN`
   - 「チャネルシークレット」を確認 → `LINE_CHANNEL_SECRET`
   - Webhook の利用を ON にする(応答メッセージは OFF 推奨)

2. **OpenAI**
   - OpenAI の API キーを発行 → `OPENAI_API_KEY`

## ローカルセットアップ

```bash
npm install
cp .env.example .env.local
# .env.local に各種キーを設定
```

型チェックのみ行う場合:

```bash
npm run build
```

ローカルで動作確認する場合は Vercel CLI を利用します。

```bash
npm i -g vercel
vercel dev
```

`vercel dev` 実行中は `ngrok` などでトンネリングし、発行された HTTPS URL + `/api/webhook` を
LINE Developers コンソールの Webhook URL に設定すると、ローカルでも動作確認できます。

## Vercel へのデプロイ

### 方法A: Vercel CLI

```bash
npm i -g vercel
vercel login
vercel
```

### 方法B: GitHub 連携

1. このプロジェクトを GitHub リポジトリに push
2. Vercel の管理画面で「Add New Project」→ 対象リポジトリを Import
3. デプロイ完了後、Vercel の Project Settings → **Environment Variables** に以下を設定して再デプロイ

| Key | Value |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE のチャネルアクセストークン |
| `LINE_CHANNEL_SECRET` | LINE のチャネルシークレット |
| `OPENAI_API_KEY` | OpenAI の API キー |

## LINE Developers 側の Webhook URL 設定

デプロイ後に発行される URL に `/api/webhook` を付けて設定します。

```
https://<your-app>.vercel.app/api/webhook
```

設定後、LINE Developers コンソールの「検証」ボタンで疎通確認ができます。

## 動作の流れ

1. ユーザーが LINE で Bot にテキストメッセージを送信
2. LINE Platform が `POST /api/webhook` を呼び出す
3. `x-line-signature` ヘッダーと生ボディから署名を検証(不正なリクエストは 401 で拒否)
4. テキストメッセージのイベントのみ処理し、OpenAI API (`gpt-4o-mini`) で返信文を生成
5. LINE Messaging API の `replyMessage` でユーザーに返信

## カスタマイズポイント

- **モデルやプロンプトの変更**: `api/webhook.ts` 内の `generateReply` 関数を編集してください。
  `model` を `gpt-4o` などに変更したり、`system` プロンプトを調整できます。
- **画像・スタンプへの対応**: `handleEvent` 関数内で `event.message.type` の分岐を追加してください。
- **会話履歴の保持**: 現状は都度単発の質問応答です。会話を継続させたい場合は、
  Vercel KV や Upstash Redis などの外部ストレージに `userId` ごとの会話履歴を保存する実装を追加してください。

## 注意事項

- LINE Platform は Webhook に対して数秒以内の応答を求めます。OpenAI の応答が遅い場合は
  タイムアウトする可能性があるため、必要に応じて `max_tokens` を減らす、より高速なモデルを使う、
  などの調整をしてください。
- 本実装は環境変数が未設定でも起動時エラーにはなりませんが、呼び出し時に LINE / OpenAI 側の
  API から認証エラーが返るため、デプロイ後は必ず環境変数を設定してください。
