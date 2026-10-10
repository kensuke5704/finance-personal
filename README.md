# Finance Personal

資産・計画・設定を使う個人向けの月次資産管理サイトです。
K/M切り替え、口座間の連動、モメンタム、運用機能は含みません。

## 保存

Googleログインすると `personalFinance/{GoogleユーザーUID}` に本人の記録を保存します。
既存サイトの `shared/finance` を読み書きしません。
未ログイン時は端末内に保存し、ログインした人はそれぞれ空の台帳から開始します。
月の選択、金額の表示・非表示、S/L/LLの表示範囲は端末ごとの設定です。

## 開発と公開

`npm ci`、`npm run dev` でローカル開発できます。
`npm run pages:build` で GitHub Pages 用の静的サイトを生成します。
`npm run deploy` でビルドし、`gh-pages` ブランチへ公開用ファイルを送信します。
公開先は https://kensuke5704.github.io/finance-personal/ です。
投資信託の公開基準価額は既存サイトの公開キャッシュから取得します。
台帳データを読み書きすることはなく、価格ファイルの平日更新だけを利用します。
