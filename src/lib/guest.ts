const ID_KEY = "vc.guest.id";
const NAME_KEY = "vc.guest.name";

export type Guest = { id: string; name: string };

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getGuestId(): string {
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = randomId();
    localStorage.setItem(ID_KEY, id);
  }
  return id;
}

export function loadGuest(): Guest | null {
  const name = localStorage.getItem(NAME_KEY);
  if (!name) return null;
  return { id: getGuestId(), name };
}

export function saveGuestName(name: string): Guest {
  const trimmed = name.trim().slice(0, 24);
  localStorage.setItem(NAME_KEY, trimmed);
  return { id: getGuestId(), name: trimmed };
}

export function clearGuestName(): void {
  localStorage.removeItem(NAME_KEY);
}
