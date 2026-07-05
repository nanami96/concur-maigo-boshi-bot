# Concur迷子防止Bot

SAP Concur初心者向けの経費タイプ選択支援ツールです。

## 機能

- 経費タイプ判定
- 入力時のポイント表示
- コメント例表示
- 領収書要否表示

## 使用技術

- React
- Vite
- GitHub

# AI Development Rules

## Architecture

Excel
↓
generate-config.js
↓
config.json
↓
QuestionEngine
↓
React UI

Business rules must be stored in Excel/config.json.

Never hardcode company-specific logic in React.

## Coding Rules

- Keep QuestionEngine generic.
- React is only responsible for rendering.
- generate-config.js converts Excel to config.json.
- Do not break existing features.
- Keep changes as small as possible.