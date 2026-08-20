export interface Project {
  id: string;
  name: string;
  path: string;
  /** Hex assigned by the Rust registry at creation. Persisted for backwards
   *  compatibility; the UI no longer tints anything with it. */
  color: string;
  createdAt: string;
  lastOpenedAt: string;
}
