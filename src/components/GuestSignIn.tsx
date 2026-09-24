import { useState } from "react";
import { saveGuestName, type Guest } from "@/lib/guest";

export function GuestSignIn({ onDone }: { onDone: (guest: Guest) => void }) {
  const [name, setName] = useState("");
  const trimmed = name.trim();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmed) return;
          onDone(saveGuestName(trimmed));
        }}
        className="w-full max-w-sm rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg"
      >
        <p className="text-center text-[0.68rem] font-semibold uppercase tracking-[0.35em] text-muted-foreground">
          Anees Haider presents
        </p>
        <h1 className="mt-2 text-center font-serif text-3xl font-bold text-foreground">
          Vanilla Chess
        </h1>
        <p className="mt-3 text-center text-sm text-muted-foreground">
          Play as a guest — just pick a name.
        </p>

        <label htmlFor="guest-name" className="mt-6 block text-sm font-medium text-foreground">
          Your name
        </label>
        <input
          id="guest-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={24}
          autoComplete="off"
          placeholder="e.g. Anees"
          className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-foreground outline-none ring-offset-background placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
        />

        <button
          type="submit"
          disabled={!trimmed}
          className="mt-5 w-full rounded-md bg-primary px-4 py-2.5 font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          Finish
        </button>
      </form>
    </main>
  );
}
