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

// 実際の画面のスクリーンショット（public/guides/ 以下。個人情報はぼかし、押す場所に赤枠を付けたもの）
export interface GuideImage {
  src: string;
  alt: string;
}

export interface GuideStep {
  title: string;
  body: string[];
  // 実際の画面があればそれを表示し、無ければイメージ図を表示する
  images?: GuideImage[];
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
    before: [
      "Threads のアカウント（Instagram のアカウントで作ったもの）",
      "Threads のアカウントが公開になっていること（トークンは公開アカウントでのみ発行できます）",
      "パソコンのブラウザ（作業は Meta の開発者サイトで行います）",
    ],
    steps: [
      {
        title: "Meta の開発者サイトでアプリを作る",
        body: [
          "https://developers.facebook.com/apps を開き、Facebook のアカウントでログインします（初めての場合は開発者登録の案内が出るので、画面に沿って進めます）。",
          "① 右上の「アプリを作成」を押します。",
          "② 「アプリ名」に好きな名前（例：Lounge+ SNS）を入れて「次へ」。連絡先メールアドレスは最初から入っています。",
          "③ ユースケースで「Threads APIにアクセス」にチェックを入れて「次へ」。",
          "④ ビジネスは「現時点ではビジネスポートフォリオをリンクしない。」を選んで⑤「次へ」。",
          "⑥ 要件の画面は「次へ」。最後の概要の画面で作成を確定します。",
        ],
        images: [
          { src: "/guides/threads/01-apps.webp", alt: "アプリの一覧。右上の「アプリを作成」を押す" },
          { src: "/guides/threads/02-details.webp", alt: "アプリの詳細。アプリ名を入力して「次へ」" },
          { src: "/guides/threads/03-usecase.webp", alt: "ユースケース。「Threads APIにアクセス」にチェック" },
          { src: "/guides/threads/04-business.webp", alt: "ビジネス。「現時点ではビジネスポートフォリオをリンクしない。」を選んで「次へ」" },
          { src: "/guides/threads/05-requirements.webp", alt: "要件。「次へ」を押す" },
        ],
      },
      {
        title: "投稿と分析の権限を追加する",
        body: [
          "左メニューの「ユースケース」を開き、「Threads APIにアクセス」の「カスタマイズ」を押します。",
          "① 左の「アクセス許可と機能」を開きます。",
          "次の3つを使えるようにします：threads_basic（基本）、threads_content_publish（投稿）、threads_manage_insights（分析の数値）。",
          "② ステータスが「テスト準備完了」になっているものは追加済みです。③ まだのものは右の「追加」を押します。",
        ],
        images: [{ src: "/guides/threads/02-permissions.webp", alt: "「アクセス許可と機能」の一覧。ステータスが「テスト準備完了」なら追加済み。まだのものは「追加」を押す" }],
        screen: {
          kind: "browser",
          site: "developers.facebook.com",
          sidebar: [{ label: "ダッシュボード" }, { label: "ユースケース", active: true }, { label: "アプリの役割" }, { label: "アプリの設定" }],
          heading: "Threads APIにアクセス ＞ 権限",
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
          "左メニューの「アプリの役割」→「役割」を開き、右上の「メンバーを追加」を押します。",
          "「アプリに人を追加」の画面で、下の「このアプリの追加の役割」にある「Threadsテスター」を選びます。",
          "下の入力欄に自分の Threads のユーザーネーム（@ の後ろ）を入れて、「追加」を押します。",
        ],
        images: [{ src: "/guides/threads/03-tester.webp", alt: "「アプリに人を追加」の画面。「Threadsテスター」を選び、ユーザーネームを入れて「追加」" }],
        screen: {
          kind: "browser",
          site: "developers.facebook.com",
          sidebar: [{ label: "ダッシュボード" }, { label: "ユースケース" }, { label: "アプリの役割", active: true }, { label: "アプリの設定" }],
          heading: "アプリの役割 ＞ 役割",
          rows: [
            { label: "管理者：あなた" },
            { label: "", action: "メンバーを追加", highlight: true },
            { label: "○ Threadsテスター", highlight: true, note: "これを選ぶ" },
          ],
        },
      },
      {
        title: "Threads アプリで招待を承認する",
        body: [
          "パソコンなら threads.com の左上のメニュー（＝）→「設定」、スマホなら Threads アプリのプロフィール → 右上のメニュー →「設定」を開きます。",
          "「その他の設定」→「ウェブサイトのアクセス許可」を開き、「招待」タブに届いている、作ったアプリの招待を承認します。",
          "承認すると「アクティブ」タブにアプリ名が表示されます。",
          "あわせて「プライバシー」→「非公開プロフィール」が「公開」になっていることも確認してください（非公開だとトークンを発行できません）。",
        ],
        images: [{ src: "/guides/threads/04-invite.webp", alt: "Threads の設定 →「その他の設定」→「ウェブサイトのアクセス許可」の「招待」タブ" }],
        screen: {
          kind: "phone",
          site: "threads.com/settings",
          heading: "設定 ＞ その他の設定 ＞ ウェブサイトのアクセス許可",
          rows: [
            { label: "アクティブ ／ 期限切れ ／ 削除済み ／ 招待", highlight: true, note: "「招待」タブ" },
            { label: "Lounge+ SNS", action: "承認", highlight: true },
          ],
        },
      },
      {
        title: "アクセストークンを発行してコピーする",
        body: [
          "開発者サイトに戻り、「ユースケース」→「Threads APIにアクセス」→「設定」を開いて、一番下までスクロールします。",
          "「ユーザートークン生成ツール」に自分のアカウントが表示されるので、「アクセストークンを生成」を押します。",
          "Threads の許可画面で「許可」を押すと、長い英数字のトークン（長期間アクセストークン）が表示されます。全部コピーします。",
          "自分のアカウントが出てこないときは、同じ欄の「Threadsテスターを追加または削除」からテスターに追加し、手順4の承認を済ませてください。",
        ],
        images: [{ src: "/guides/threads/06-token.webp", alt: "設定の一番下の「ユーザートークン生成ツール」。自分のアカウントの「アクセストークンを生成」を押す" }],
        screen: {
          kind: "browser",
          site: "developers.facebook.com",
          sidebar: [{ label: "ダッシュボード" }, { label: "ユースケース", active: true }, { label: "アプリの役割" }, { label: "アプリの設定" }],
          heading: "Threads APIにアクセス ＞ 設定（一番下）",
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
      "ここで発行されるのは長期間アクセストークンです（画面の説明より。Meta の公式ドキュメントでは長期トークンは60日有効）。「接続が切れています」と出たら、手順5でもう一度発行し、「キーを更新」で入れ直してください。",
    ],
    sources: [
      { label: "Meta 公式：Threads API Get started", url: "https://developers.facebook.com/docs/threads/get-started" },
      { label: "解説記事：Threads API アクセストークン取得ガイド", url: "https://note.com/kazu_t/n/n6d1df495dde8" },
    ],
  },

  INSTAGRAM: {
    summary: "Threads と同じ Meta のアプリに Instagram のユースケースを追加し、「トークンを生成」でアクセストークンを発行します（約10分・無料）。",
    before: [
      "Instagram の「プロアカウント」（ビジネス／クリエイター。Instagram の設定から無料で切り替えられます）",
      "アカウントが公開になっていること（非公開アカウントは使えません）",
      "Threads の手順で作った Meta のアプリ（まだなら Threads の手順1で作ります）",
    ],
    steps: [
      {
        title: "アプリに Instagram のユースケースを追加する",
        body: [
          "https://developers.facebook.com/apps で、Threads 用に作ったアプリを開きます。",
          "左メニューの「ユースケース」を開き、右上の「ユースケースを追加」から「Instagramでメッセージとコンテンツを管理」を追加します。",
          "これから新しくアプリを作る場合は、作成時のユースケースで「Threads APIにアクセス」と一緒にこれにもチェックを入れておけば、この手順は不要です。",
        ],
      },
      {
        title: "自分の Instagram アカウントを「Instagramテスター」に追加する",
        body: [
          "左メニューの「アプリの役割」→「役割」を開き、右上の「メンバーを追加」を押します。",
          "「アプリに人を追加」の画面で「Instagramテスター」を選び、入力欄に自分の Instagram のユーザーネームを入れて「追加」を押します。",
          "Instagram の「アプリとウェブサイト」の設定画面に届く招待を承認します。",
        ],
        images: [
          {
            src: "/guides/instagram/02-tester.webp",
            alt: "「アプリに人を追加」の画面。「Instagramテスター」を選び、ユーザーネームを入れて「追加」（画面の例では Threadsテスターが選ばれていますが、Instagram の場合は Instagramテスターを選びます）",
          },
        ],
      },
      {
        title: "アカウントを追加して、トークンを生成する",
        body: [
          "左メニューの「ユースケース」→ Instagram のユースケースの「カスタマイズ」を押します。",
          "① 左の「API setup with Unified login」を開きます。",
          "② 「2. アクセストークンを生成する」の「アカウントを追加」を押し、Instagram にログインして許可します。",
          "③ 追加した自分のアカウントの行の「トークンを生成」を押し、表示されたトークンを全部コピーします。",
          "正しいトークンは、ふつう「IG」で始まります。「EAA」で始まるものは Facebook ログイン用なので使えません。",
        ],
        images: [
          {
            src: "/guides/instagram/03-token.webp",
            alt: "Instagram API のカスタマイズ。「API setup with Unified login」→「アカウントを追加」→ 自分のアカウントの「トークンを生成」",
          },
        ],
      },
      {
        title: "このアプリに貼り付ける",
        body: ["この画面の Instagram の「＋ アカウントを追加」を押し、「アクセストークン」に貼って「連携する」を押します。"],
      },
    ],
    after: [
      "ダッシュボードで生成したトークンは60日有効です（Meta 公式ドキュメント）。期限が切れたら手順3でもう一度生成し、「キーを更新」で入れ直してください。",
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
