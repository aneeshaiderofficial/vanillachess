# Vanilla Chess

**Anees Haider presents — Vanilla Chess.** A timeless game. A sharper mind.

## Features
- Full chess rules: legal-move validation, check, double check, checkmate, stalemate, castling, en passant, promotion (Q/R/B/N)
- Draws: agreement, threefold (claim) and fivefold (automatic) repetition, 50-move (claim) and 75-move (automatic) rules, insufficient material
- Resignation and optional chess clock (3 / 5 / 10 min) with flag-fall rules
- Two players, play vs computer, computer vs computer lessons, move tips
- Guest sign-in, online matchmaking with real players and live in-game chat

## Getting started
```bash
bun install
cp .env.example .env   # fill in your Supabase project values
bun run dev
```
Apply the SQL files in `supabase/migrations` to your Supabase project.

## Build
```bash
bun run build
```

© Anees Haider
