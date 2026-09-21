# Vanilla Chess

**ANEES HAIDER PRESENTS — Vanilla Chess**

A polished, fully playable chess game: two players, player vs. computer, and
computer vs. computer, with legal-move highlighting, castling, en passant,
promotion, check/checkmate and draw detection, move sounds, and optional tips.

## Features

- Three modes: two-player, player vs. computer, computer vs. computer
- Legal move highlighting and last-move tracking
- Full rules: castling, en passant, promotion, check, checkmate, stalemate and draws
- Optional move tips and a "best move" hint
- Pause, new game, and appearance settings
- Dark tournament theme, responsive on phones and desktops

## Tech stack

- TanStack Start (React 19) with Vite
- TypeScript
- Tailwind CSS

## Getting started

Requires Node.js 20+ (or Bun).

```sh
npm install
npm run dev
```

The app runs at http://localhost:8080.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run preview` — preview the production build
- `npm run lint` — lint the codebase

## Project layout

```
public/vanilla-chess.html   the complete chess game (engine, board, UI)
src/routes/                 app routes and page metadata
src/styles.css              design tokens and global styles
```

## License

Copyright © Anees Haider. All rights reserved.
