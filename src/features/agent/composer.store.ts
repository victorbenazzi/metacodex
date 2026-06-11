import { create } from "zustand";

import { newId } from "@/lib/idGen";
import { fsApi } from "@/features/filesystem/filesystem.service";

import {
  basename,
  isImagePath,
  isInlineableTextPath,
  isInsideRoots,
  loadImageDataUrl,
  MAX_IMAGE_BYTES,
  type PendingAttachment,
} from "./attachments";

/**
 * Pending attachments for the Agent composer. A singleton store (not composer
 * local state) because three producers feed it: the composer itself (paste +
 * "+" menu), AppShell's global drag-drop listener, and the "@" mention menu , 
 * and it must survive the hero → docked composer swap mid-conversation.
 *
 * Attachments are project-scoped and deliberately never ride the persisted
 * drafts (`agent-ui.json` stays plain strings; data URLs are megabytes):
 * `chat.store.setDirectory` clears this store on project switch.
 */

interface AgentComposerState {
  attachments: PendingAttachment[];
  /** A drag is hovering the window while the Agent view is active. */
  dragHover: boolean;

  addPaths: (paths: string[]) => void;
  addPastedImage: (blob: Blob) => void;
  addBranchContext: (root: string, branch: string) => void;
  addChatContext: (sessionId: string, title: string) => void;
  addSymbolContext: (symbol: { name: string; path: string; line: number }) => void;
  remove: (id: string) => void;
  clear: () => void;
  setDragHover: (hover: boolean) => void;
}

export const useAgentComposerStore = create<AgentComposerState>((set, get) => ({
  attachments: [],
  dragHover: false,

  addPaths: (paths) => {
    const existing = new Set(
      get()
        .attachments.map((a) => ("path" in a ? a.path : undefined))
        .filter(Boolean),
    );
    for (const path of paths) {
      if (!path || existing.has(path)) continue;
      existing.add(path);
      if (isImagePath(path)) {
        const id = newId(8);
        set((s) => ({
          attachments: [
            ...s.attachments,
            {
              id,
              kind: "image",
              source: "path",
              path,
              filename: basename(path),
              mime: "",
              dataUrl: "",
              status: "loading",
            },
          ],
        }));
        void loadImageDataUrl(path).then((res) => {
          set((s) => ({
            attachments: s.attachments.map((a) =>
              a.id === id && a.kind === "image"
                ? res.ok
                  ? { ...a, mime: res.mime, dataUrl: res.dataUrl, status: "ready" as const }
                  : { ...a, status: "error" as const, error: res.error }
                : a,
            ),
          }));
        });
      } else {
        const id = newId(8);
        const insideRoots = isInsideRoots(path);
        // Outside the roots only allowlisted text files can be inlined at send
        // time; flag anything else NOW so the chip never looks healthy and then
        // silently vanishes from the message.
        const sendable = insideRoots || isInlineableTextPath(path);
        set((s) => ({
          attachments: [
            ...s.attachments,
            {
              id,
              kind: "file",
              path,
              filename: basename(path),
              isDir: false,
              insideRoots,
              status: sendable ? "ready" : "error",
              ...(sendable ? {} : { error: "unsupported" }),
            },
          ],
        }));
        // Directory vs file is async metadata; flip the flag when stat lands.
        void fsApi
          .stat(path)
          .then((meta) => {
            if (!meta.isDir) return;
            set((s) => ({
              attachments: s.attachments.map((a) =>
                a.id === id && a.kind === "file" ? { ...a, isDir: true } : a,
              ),
            }));
          })
          .catch(() => undefined);
      }
    }
  },

  addPastedImage: (blob) => {
    const id = newId(8);
    const mime = blob.type || "image/png";
    const extension = mime.split("/")[1]?.split("+")[0] ?? "png";
    const filename = `pasted-image-${Date.now()}.${extension}`;
    // Same cap as path-loaded images; an unbounded paste would otherwise hold
    // a multi-hundred-MB base64 string in the store and POST it raw.
    if (blob.size > MAX_IMAGE_BYTES) {
      set((s) => ({
        attachments: [
          ...s.attachments,
          {
            id,
            kind: "image",
            source: "paste",
            filename,
            mime,
            dataUrl: "",
            status: "error",
            error: "too-large",
          },
        ],
      }));
      return;
    }
    set((s) => ({
      attachments: [
        ...s.attachments,
        { id, kind: "image", source: "paste", filename, mime, dataUrl: "", status: "loading" },
      ],
    }));
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      set((s) => ({
        attachments: s.attachments.map((a) =>
          a.id === id && a.kind === "image"
            ? dataUrl
              ? { ...a, dataUrl, status: "ready" as const }
              : { ...a, status: "error" as const, error: "read-failed" }
            : a,
        ),
      }));
    };
    reader.onerror = () => {
      set((s) => ({
        attachments: s.attachments.map((a) =>
          a.id === id ? { ...a, status: "error" as const, error: "read-failed" } : a,
        ),
      }));
    };
    reader.readAsDataURL(blob);
  },

  addBranchContext: (root, branch) => {
    set((s) =>
      s.attachments.some((a) => a.kind === "context-branch" && a.root === root)
        ? {}
        : {
            attachments: [
              ...s.attachments,
              { id: newId(8), kind: "context-branch", root, branch },
            ],
          },
    );
  },

  addChatContext: (sessionId, title) => {
    set((s) =>
      s.attachments.some((a) => a.kind === "context-chat" && a.sessionId === sessionId)
        ? {}
        : {
            attachments: [
              ...s.attachments,
              { id: newId(8), kind: "context-chat", sessionId, title },
            ],
          },
    );
  },

  addSymbolContext: (symbol) => {
    set((s) =>
      s.attachments.some(
        (a) => a.kind === "context-symbol" && a.path === symbol.path && a.line === symbol.line,
      )
        ? {}
        : {
            attachments: [...s.attachments, { id: newId(8), kind: "context-symbol", ...symbol }],
          },
    );
  },

  remove: (id) =>
    set((s) => ({ attachments: s.attachments.filter((a) => a.id !== id) })),

  clear: () => set({ attachments: [] }),

  setDragHover: (hover) => set({ dragHover: hover }),
}));
