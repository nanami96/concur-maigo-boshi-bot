# Concur迷子防止Bot Roadmap

## プロジェクト概要

SAP Concur初心者が迷わず経費申請できるようにするためのWebアプリです。

設計方針

- Reactには業務ルールを書かない
- Excel → JSON → React の構成
- 会社別ルールを簡単に差し替えられる設計
- 将来的にConcur APIと連携

---

# Phase1 基盤設計

- [x] Issue #1：経費タイプ判定ルールExcelを作成する
- [ ] Issue #1.5：ExcelをJSON化する設計
- [ ] Issue #2：会社別ルール設定に対応する

---

# Phase2 データ化

- [ ] ExcelからJSONを生成する
- [ ] sample-company用JSON作成
- [ ] company-a用JSON作成
- [ ] company-b用JSON作成

---

# Phase3 React

- [ ] JSONを読み込む
- [ ] 質問画面をJSONで生成
- [ ] 判定ルールをJSONから取得
- [ ] 結果画面表示

---

# Phase4 AI

- [ ] 自由入力
- [ ] AIによる経費タイプ提案
- [ ] AIとルール判定の組み合わせ

---

# Phase5 Concur API

- [ ] API連携設計
- [ ] API接続
- [ ] Concurとの連携
