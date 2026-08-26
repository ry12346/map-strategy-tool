# GitHub Pagesへ手動で公開する手順

1. このZIPを展開します。
2. 展開した `map-strategy-tool-pk1-v9` フォルダの**中身**をGitHubリポジトリ直下へアップロードします。
3. 少なくとも次のファイルが同じ構成で存在することを確認します。
   - `index.html`
   - `app.js`
   - `style.css`
   - `data/map.png`
   - `data/pk1_embedded_data.js`
4. GitHubのリポジトリで **Settings → Pages** を開き、公開元に既定ブランチのルートを指定します。
5. 公開URLを開き、PK1標準マップと城・関所、経路探索が表示されることを確認します。

## 更新時

既存リポジトリへ上書きする場合、旧版にだけ存在していた不要ファイルはGitHub上から削除してください。特に旧版の `data/reference`、`map-maker.*`、`sample-plan.nssmap`、`test-map.png` はv9では使用しません。

## GitHubのブラウザアップロードでエラーになる場合

`Something went really wrong, and we can’t process that file.` と表示された場合は、アップロード画面を開き直し、ファイルを数個ずつ分けてアップロードしてください。

v9の `data` フォルダは次の2ファイルだけです。

- `map.png`
- `pk1_embedded_data.js`

この2ファイルがGitHub上に存在すれば、PK1標準マップと経路探索に必要なデータは揃っています。
