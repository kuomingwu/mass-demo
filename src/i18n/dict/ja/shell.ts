import type { Dict } from '../../types';

const dict: Dict = {
  // ナビゲーション
  'nav.group.customer': 'カスタマーポータル',
  'nav.group.vendor': 'プラットフォーム運用',
  'nav.group.account': 'アカウントとチーム',
  'nav.group.help': 'ヘルプ',
  'nav.hub': 'モデルハブ',
  'nav.playground': 'Playground',
  'nav.keys': 'API キー',
  'nav.usage': '使用量と請求',
  'nav.plan': 'トライアルとプラン',
  'nav.overview': '概要',
  'nav.trials': 'トライアル申請',
  'nav.tenants': 'テナントとプロジェクト',
  'nav.models': 'モデルとデプロイ',
  'nav.clusters': '推論クラスター',
  'nav.providers': 'クラウド・パートナープロバイダー',
  'nav.routing': 'ルーティングとスピルオーバー',
  'nav.pricing': '価格設定と請求',
  'nav.iam': 'アクセス制御 (IAM)',
  'nav.audit': '監査ログ',
  'nav.settings': '設定',
  'nav.guides': '操作ガイド',
  'shell.nav.aria': 'メインナビゲーション',
  'shell.nav.expand': 'ナビゲーションを展開',
  'shell.nav.collapse': 'ナビゲーションを折りたたむ',
  'shell.nav.deniedTooltip': '{label}（権限なし）',

  // ヘッダー
  'shell.brand': 'MaaS コンソール',
  'shell.docTitle': 'MaaS コンソール（デモ）',
  'shell.tenant.aria': 'テナント選択',
  'shell.tenant.all': 'すべてのテナント',
  'shell.search.placeholder': 'モデル、キー、プリンシパルを検索…（Enter）',
  'shell.search.aria': 'グローバル検索',
  'shell.notifications.tooltip': '通知（デモ：新しい通知はありません）',
  'shell.notifications.aria': '通知',
  'shell.help': 'ヘルプ：オンボーディングツアーを再生',
  'shell.theme.tooltip': 'テーマ：{mode}',
  'shell.theme.aria': 'テーマを切り替え',
  'shell.theme.light': 'ライト',
  'shell.theme.dark': 'ダーク',
  'shell.theme.hc': 'ハイコントラスト',
  'shell.lang.label': '言語：{lang}',
  'shell.lang.menu': '表示言語',
  'shell.persona.label': 'デモ用ロール切り替え',
  'shell.persona.current': 'デモ用ロール切り替え（現在：{name}）',
  'shell.persona.menu': 'デモ用ロール',
  'shell.user.tooltip': '{name}（{email}）',
  'shell.user.aria': '現在のユーザー：{name}',
  'shell.user.notSignedIn': '未ログイン',
  'shell.balance.prepaid': '残高 {amount}',
  'shell.balance.postpaid': '月次請求 · {tier}',
  'shell.balance.prepaidTip': '{tenant}：利用可能なプリペイド残高（総額 − 今月の消費）{low}。クリックすると「トライアルとプラン」でチャージできます',
  'shell.balance.lowSuffix': '、残高わずか',
  'shell.balance.postpaidTip': '{tenant}：月次請求契約（請求書払い）。クリックすると「トライアルとプラン」を開きます',
  'shell.footer':
    '本システムはカスタムのデモアプリケーションであり、Azure RBAC の概念と Microsoft Fluent 2 デザイン言語を借用しています。公式の Azure Portal ではなく、実際の Azure リソースは一切管理しません。テナント、データセンター、GPU 指標、価格、コスト、残高、使用量はすべて架空のデモデータです。「推論クラスター」は当社（プラットフォーム事業者）が自社で保有する GPU データセンターで、お客様は 1 つのキーと 1 つの API で自社ホストおよびプロキシのモデルを利用し、当社が課金します。GMI Cloud、Inferel、Alibaba Cloud Model Studio、その他いかなるモデルプロバイダーとも無関係です。',

  // ページヘッダー
  'shell.breadcrumb.aria': 'パンくずリスト',

  // ツアーエンジン
  'shell.tour.stepOf': 'ステップ {n} / {total}',
  'shell.tour.start': 'ツアーを開始',
  'shell.tour.skipStep': 'このステップをスキップ',
  'shell.tour.hintDefault': '画面上で実際に操作してください。完了すると自動的に次へ進みます。',

  // 状態コンポーネント
  'shell.state.loadError.title': 'データを読み込めません',
  'shell.state.loadError.body': '{msg}。ネットワーク接続を確認して再試行してください。問題が続く場合は、発生時刻を添えてプラットフォーム運用チームへご連絡ください。',
  'shell.denied.title': '権限がありません（403）',
  'shell.denied.cannotAction': '現在のロールでは「{action}」を実行できません。',
  'shell.denied.cannot': '現在のロールではこの操作を実行できません。',
  'shell.denied.body': 'サーバーはこのリクエストを拒否し、監査ログに記録しました。この権限が必要な場合は、',
  'shell.denied.request': 'アクセス管理者に申請',
  'shell.denied.end': 'してください。',
  'shell.notFound.title': '{what}が見つかりません（404）',
  'shell.notFound.body': 'お探しの{what}は存在しないか、表示する権限がありません。',
  'shell.notFound.page': 'ページ',
  'shell.notFound.resource': 'リソース',

  // 通知
  'shell.notify.failed': '操作に失敗しました',
  'shell.notify.failedWith': '{context}に失敗しました',
  'shell.notify.failedStatus': '{title}（{status} {code}）',

  // エラーページ
  'shell.error.forbiddenTitle': '権限がありません',
  'shell.error.notFoundTitle': 'ページが見つかりません',
};

export default dict;
