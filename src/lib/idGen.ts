import { nanoid } from "nanoid";

export function newId(size = 12): string {
  return nanoid(size);
}
