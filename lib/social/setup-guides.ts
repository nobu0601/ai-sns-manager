import type { Platform } from "@prisma/client";

// SNS ごとの「キーの取得方法」。画面の「SNSアカウント」に表示する。
// 手順は各 SNS の公式ドキュメントで確認した内容（確認日 2026-10-31）。
// SNS 側の画面名は変わることがあるため、変わったらここを直す。

// 画面のイメージ図（実際の画面の見た目ではなく、どこを押すかを示す簡単な図）
export interface ScreenMock {
  kind: "browser" | "phone";
  site: string; // 例：developers.facebook.com
  sidebar?: { label: string; active?: boolean }[];
  heading?: string;
  rows: { label: string; action?: string; highlight?: boolean; note?: string }[];
}

export interface GuideStep {
  title: string;
  body: string[];
  screen?: ScreenMock;
}

export interface SetupGuide {
  summary: string;
  before: string[]; // 始める前に
  steps: GuideStep[];
  after: string[]; // 連携したあとの注意
  sources: { label: string; url: string }[];
}

export const SETUP_GUIDES: Record<Platform, SetupGuide> = {
  THREADS: {
    summary: "Meta の開発者サイトでアプリを作り、自分の Threads アカウントで「アクセストークン」を発行します（約15分・無料）。",
    before: ["Threads のアカウント（Instagram のアカウントで作ったもの）", "パソコンのブラウザ（作業は Meta の開発者サイトで行います）"],
    steps: [
      {
        title: "Meta の開発者サイトでアプリを作る",
        body: [
          "https://developers.facebook.com/apps を開き、Facebook のアカウントでログインします（初めての場合は開発者登録の案内が出るので、画面に沿って進めます）。",
          "右上の「アプリを作成」を押します。",
          "ユースケースで「Threads API にアクセス」を選び、アプリ名（例：Lounge+ SNS）を入れて作成します。",
        ],
        screen: {
          kind: "browser",
          site: "developers.facebook.com/apps",
          heading: "マイアプリ",
          rows: [{ label: "（まだアプリがありません）" }, { label: "", action: "アプリを作成", highlight: true }],
        },
      },
      {
        title: "投稿と分析の権限を追加する",
        body: [
          "左メニューの「ユースケース」を開き、「Threads API にアクセス」の「カスタマイズ」を押します。",
          "「権限」の一覧で、次の3つの「追加」を押します：threads_basic（基本）、threads_content_publish（投稿）、threads_manage_insights（分析の数値）。",
        ],
        screen: {
          kind: "browser",
          site: "developers.facebook.com",
          sidebar: [{ label: "ダッシュボード" }, { label: "ユースケース", active: true }, { label: "アプリの役割" }, { label: "アプリの設定" }],
          heading: "Threads API にアクセス ＞ 権限",
          rows: [
            { label: "threads_basic", action: "追加", highlight: true },
            { label: "threads_content_publish", action: "追加", highlight: true },
            { label: "threads_manage_insights", action: "追加", highlight: true },
            { label: "threads_read_replies", action: "追加", note: "今回は不要" },
          ],
        },
      },
      {
        title: "自分の Threads アカウントを「テスター」に追加する",
        body: [
          "左メニューの「アプリの役割」→「役割」を開きます。",
          "「メンバーを追加」を押し、種類で「Threads Tester」を選びます。",
          "自分の Threads のユーザー名（@ の後ろ）を入れて送信します。",
        ],
        screen: {
          kind: "browser",
          site: "developers.facebook.com",
          sidebar: [{ label: "ダッシュボード" }, { label: "ユースケース" }, { label: "アプリの役割", active: true }, { label: "アプリの設定" }],
          heading: "アプリの役割 ＞ 役割",
          rows: [
            { label: "管理者：あなた" },
            { label: "", action: "メンバーを追加", highlight: true },
            { label: "種類：Threads Tester", highlight: true, note: "これを選ぶ" },
          ],
        },
      },
      {
        title: "Threads アプリで招待を承認する",
        body: [
          "スマホの Threads アプリで、自分のプロフィール → 右上のメニュー（≡）→「設定」を開きます。",
          "「アカウント」→「ウェブサイトのアクセス許可」→「招待」に届いている、作ったアプリの招待を「承認」します。",
        ],
        screen: {
          kind: "phone",
          site: "Threads アプリ",
          heading: "設定 ＞ アカウント ＞ ウェブサイトのアクセス許可",
          rows: [
            { label: "招待", highlight: true },
            { label: "Lounge+ SNS", action: "承認", highlight: true },
          ],
        },
      },
      {
        title: "アクセストークンを発行してコピーする",
        body: [
          "開発者サイトに戻り、「ユースケース」→「Threads API にアクセス」→「設定」を開いて、一番下までスクロールします。",
          "「ユーザートークン生成ツール」に自分のアカウントが表示されるので、「アクセストークンを生成」を押します。",
          "Threads の許可画面で「許可」を押すと、長い英数字のトークンが表示されます。全部コピーします。",
        ],
        screen: {
          kind: "browser",
          site: "developers.facebook.com",
          sidebar: [{ label: "ダッシュボード" }, { label: "ユースケース", active: true }, { label: "アプリの役割" }, { label: "アプリの設定" }],
          heading: "Threads API にアクセス ＞ 設定（一番下）",
          rows: [
            { label: "ユーザートークン生成ツール" },
            { label: "@あなたのアカウント", action: "アクセストークンを生成", highlight: true },
          ],
        },
      },
      {
        title: "このアプリに貼り付ける",
        body: ["この画面の Threads の「＋ アカウントを追加」を押し、「アクセストークン」にコピーしたトークンを貼って「連携する」を押します。"],
      },
    ],
    after: [
      "トークンには有効期限があります（多くの場合60日）。「接続が切れています」と出たら、手順5でもう一度発行し、「キーを更新」で入れ直してください。",
      "「ユーザートークン生成ツール」は Meta の公式ドキュメントには載っていない画面です（利用者向けの解説記事で確認）。見つからないときは画面の文言を管理者に伝えてください。",
    ],
    sources: [
      { label: "Meta 公式：Threads API Get started", url: "https://developers.facebook.com/docs/threads/get-started" },
      { label: "解説記事：Threads API アクセストークン取得ガイド", url: "https://note.com/kazu_t/n/n6d1df495dde8" },
    ],
  },

  INSTAGRAM: {
    summary: "Meta の開発者サイトでアプリを作り、Instagram の「Generate token」でアクセストークンを発行します（約10分・無料）。",
    before: [
      "Instagram の「プロアカウント」（ビジネス／クリエイター。Instagram の設定から無料で切り替えられます）",
      "アカウントが公開になっていること（非公開アカウントは使えません）",
      "Threads 用とは別のアプリを作ります",
    ],
    steps: [
      {
        title: "Meta の開発者サイトでアプリを作る",
        body: [
          "https://developers.facebook.com/apps を開き、右上の「アプリを作成」を押します。",
          "ビジネスの接続は今はスキップして「次へ」。",
          "ユースケースは「その他」、アプリの種類は「ビジネス」を選びます（「ビジネス」でないと Instagram を追加できません）。",
          "アプリ名と連絡先メールを入れて作成します。",
        ],
        screen: {
          kind: "browser",
          site: "developers.facebook.com/apps",
          heading: "アプリを作成 ＞ アプリタイプ",
          rows: [
            { label: "ユースケース：その他", highlight: true, note: "これを選ぶ" },
            { label: "アプリの種類：ビジネス", highlight: true, note: "これを選ぶ" },
            { label: "", action: "次へ" },
          ],
        },
      },
      {
        title: "Instagram を追加する",
        body: ["アプリの画面に並んでいる製品の中から「Instagram」を探し、「設定」を押します。"],
        screen: {
          kind: "browser",
          site: "developers.facebook.com",
          heading: "アプリに製品を追加",
          rows: [
            { label: "Facebook ログイン", action: "設定" },
            { label: "Instagram", action: "設定", highlight: true },
            { label: "Webhooks", action: "設定" },
          ],
        },
      },
      {
        title: "自分の Instagram アカウントを追加する",
        body: [
          "左メニューの「Instagram」→「API setup with Instagram business login」を開きます。",
          "「アクセストークンを生成」（Generate access tokens）の欄で「アカウントを追加」を押し、Instagram にログインして許可します。",
        ],
        screen: {
          kind: "browser",
          site: "developers.facebook.com",
          sidebar: [{ label: "ダッシュボード" }, { label: "Instagram", active: true }, { label: "└ API setup with Instagram business login", active: true }, { label: "アプリの役割" }],
          heading: "1. Generate access tokens",
          rows: [{ label: "", action: "アカウントを追加", highlight: true }],
        },
      },
      {
        title: "トークンを発行してコピーする",
        body: [
          "追加したアカウントの横の「Generate token」を押し、表示されたトークンを全部コピーします。",
          "正しいトークンは、ふつう「IG」で始まります。「EAA」で始まるものは Facebook ログイン用なので使えません。",
        ],
        screen: {
          kind: "browser",
          site: "developers.facebook.com",
          sidebar: [{ label: "ダッシュボード" }, { label: "Instagram", active: true }, { label: "└ API setup with Instagram business login", active: true }, { label: "アプリの役割" }],
          heading: "1. Generate access tokens",
          rows: [{ label: "@あなたのアカウント", action: "Generate token", highlight: true }],
        },
      },
      {
        title: "このアプリに貼り付ける",
        body: ["この画面の Instagram の「＋ アカウントを追加」を押し、「アクセストークン」に貼って「連携する」を押します。"],
      },
    ],
    after: [
      "このトークンは60日有効です（Meta 公式ドキュメント）。期限が切れたら手順4でもう一度発行し、「キーを更新」で入れ直してください。",
      "Instagram は画像か動画が無いと投稿できません。投稿作成画面で画像を付けてください。",
    ],
    sources: [
      { label: "Meta 公式：Instagram 用の Meta アプリの作成", url: "https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/create-a-meta-app-with-instagram" },
      { label: "Meta 公式：Get started（トークンの発行）", url: "https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started" },
    ],
  },

  X: {
    summary: "X の開発者コンソールでアプリを作り、4つのキーを発行します（約20分）。X の API は使った分だけの有料です。",
    before: [
      "投稿したい X アカウント",
      "クレジットカード（API の利用は前払いのクレジット制。投稿1件 約0.015ドル、自分の投稿の数値の読み取り1件 0.001ドル。最新の料金は開発者コンソールで確認してください）",
    ],
    steps: [
      {
        title: "開発者コンソールにログインする",
        body: [
          "https://console.x.com を開き、投稿したい X アカウントでログインします。",
          "初めての場合は開発者登録の案内が出るので、利用目的を入れて規約に同意します。",
        ],
      },
      {
        title: "アプリを作る",
        body: [
          "「Create App」を押し、アプリ名・説明・用途（例：自分の店のアカウントの投稿管理）を入れて作成します。",
          "作成直後に表示される「API Key」と「API Key Secret」を、すぐにメモ帳などに控えます（一度しか表示されません）。",
        ],
        screen: {
          kind: "browser",
          site: "console.x.com",
          heading: "Apps",
          rows: [
            { label: "", action: "Create App", highlight: true },
            { label: "API Key：xxxxxxxx", note: "すぐに控える" },
            { label: "API Key Secret：xxxxxxxx", note: "すぐに控える" },
          ],
        },
      },
      {
        title: "権限を「Read and write」にする（トークンを作る前に）",
        body: [
          "アプリの認証の設定で、権限（App permissions）を「Read and write」にして保存します。",
          "「Read only」のままだと投稿できません。先にトークンを作ってしまった場合は、権限を変えたあとに作り直してください。",
        ],
        screen: {
          kind: "browser",
          site: "console.x.com",
          heading: "App permissions",
          rows: [
            { label: "○ Read only" },
            { label: "● Read and write", highlight: true, note: "これを選ぶ" },
            { label: "○ Read, write, and DMs" },
            { label: "", action: "Save" },
          ],
        },
      },
      {
        title: "Access Token を発行する",
        body: ["同じアプリの画面で「Access Token」と「Access Token Secret」を生成し、すぐに控えます。"],
        screen: {
          kind: "browser",
          site: "console.x.com",
          heading: "Access Token and Secret",
          rows: [{ label: "For @あなたのアカウント", action: "Generate", highlight: true }],
        },
      },
      {
        title: "クレジットを買う",
        body: [
          "開発者コンソールで支払い方法を登録し、クレジットを購入します。",
          "使いすぎを防ぐため、上限（spending limit）も設定しておくと安心です。",
        ],
      },
      {
        title: "このアプリに貼り付ける",
        body: ["この画面の X の「＋ アカウントを追加」を押し、控えた4つ（API Key・API Key Secret・Access Token・Access Token Secret）を貼って「連携する」を押します。"],
      },
    ],
    after: [
      "X のキーに有効期限はありませんが、開発者コンソールで作り直すと古いキーは使えなくなります。作り直したら「キーを更新」で入れ直してください。",
      "分析の数値は6時間ごとに自動で読み取るため、そのぶんのクレジットも使います。",
    ],
    sources: [
      { label: "X 公式：Developer Apps", url: "https://docs.x.com/fundamentals/developer-apps" },
      { label: "X 公式：料金", url: "https://docs.x.com/x-api/getting-started/pricing" },
    ],
  },
};
