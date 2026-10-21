import { get, set } from "idb-keyval";

export async function renderNotes(root: HTMLElement) {
  const notes: string[] = (await get("notes")) ?? [];
  root.innerHTML = `<h1>Fieldnotes</h1><ul>${notes.map((n) => `<li>${n}</li>`).join("")}</ul>`;
}

export async function addNote(text: string) {
  const notes: string[] = (await get("notes")) ?? [];
  await set("notes", [...notes, text]);
}
