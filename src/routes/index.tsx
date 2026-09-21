import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vanilla Chess by Anees Haider" },
      {
        name: "description",
        content: "Play Vanilla Chess by Anees Haider — a polished chess game with computer opponents, lessons, hints, and customizable boards.",
      },
      { property: "og:title", content: "Vanilla Chess by Anees Haider" },
      {
        property: "og:description",
        content: "Play a timeless game, sharpen your mind, and challenge the computer.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="h-dvh min-h-[640px] w-full overflow-hidden bg-background">
      <iframe
        className="h-full w-full border-0"
        src="/vanilla-chess.html"
        title="Vanilla Chess by Anees Haider"
      />
    </main>
  );
}
