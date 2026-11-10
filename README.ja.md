# VEREQO

**PROVE WHAT MATTERS. CONTROL WHAT FOLLOWS.**

VEREQOは、機密情報の開示とAgentが提案する金融Intentについて、別途人間が承認する前に影響や根拠を確認するためのレビュー用インストゥルメントです。Requestの文脈、Policy判定、影響、Evidenceを一つの画面で確認できます。

## 製品の境界

このリポジトリには、ローカル中心のレビュー製品と金融プロトタイプが含まれます。画面には合成シナリオとInjective Testnetの読み取り専用観測が表示される場合があります。注文送信、資産保管、Agentへの署名権限付与は行いません。

- Wallet所有者認証は、短時間有効なローカルSessionにWalletを結び付けます。Intent承認や取引権限は付与しません。Sessionはプロセス内だけで保持され、現在の所有者Sessionが有効だとは主張しません。
- Agentの提案は未署名のプレビューです。ローカルモデルによる提案生成は、自律的な金融実行を意味しません。
- ローカルGroth16 Proofは単一マシンのSetupを使い、**本番で信頼できるSetupではありません**。本番用の信頼済みSetupや配備済みVerifierは主張しません。
- 最後に記録されたInjective読み取りでは、稼働中のSpot市場216件のうち、設定された10秒以内に更新された両側板はありませんでした。T5は**BLOCKED**です。過去の読み取りは現在の市場状態を示しません。
- T6のFoundry/mock検証はローカル証拠です。Gateは未配備であり、Deposit / Exchange Order / Cancel / Withdraw / Recoveryを一続きのTestnetライフサイクルとして検証していません。
- 金融実行は**NO-GO / NOT_IMPLEMENTED**です。このリリースはTestnet取引を主張しません。

境界と再現方法は `docs/SECURITY.md`、`docs/ARCHITECTURE.md`、`docs/RELEASE_VALIDATION.md` を参照してください。

## ローカル起動

必要なNode.js：`>=22.13.0 <23` または `>=24`。

```sh
npm ci
npm run dev
```

ローカルWeb UIは `http://127.0.0.1:5173`、ローカルAPIはポート `4317` で起動します。開発サーバーを信頼できないネットワークへ公開しないでください。

## 検証とビルド

```sh
npm run typecheck
npm test
npm run build
```

Viteの成果物は `dist/web` に出力されます。将来Vercelを使う場合は出力ディレクトリに `dist/web` を指定してください。このリリースではDeployやホスティング設定の変更は行いません。`.vercelignore`はローカル状態、認証情報、内部Evidence、応募資料、メディアを除外し、アプリ・ブランド・ライセンス付きフォントのビルド素材を保持します。

## 収録素材と権利

UIは `apps/web/public/brand/` の提供済みソリッド版VEREQO素材を使用します。このリリースでは素材の配布権は**未指定**です。このリポジトリは公開Deployや再配布を許可するものではありません。ローカルUIフォントのOFL通知は `apps/web/public/fonts/` にあります。

## 製品映像

メディアの権利、プライバシー、リリース審査が完了した後に、所有者承認済みの最終動画URLを追加できます。未確認のURLは掲載していません。

## リリース範囲

このリリースブランチは、非公開リポジトリの `main` を基点にした単一のサニタイズ済みスナップショットです。ローカルの89コミット履歴は含みません。Wallet映像原本、動画・音声マスター、HAR、SQLite、ローカルProof/Evidence、非公開引継ぎ資料、ブランド素材の元パッケージを除外しています。秘密情報や本番資格情報を含めない方針です。
