import { StreamLanguage, type StreamParser } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

/**
 * Minimal Astro grammar.
 *
 * Astro files have two regions:
 *   1. An optional frontmatter block delimited by `---` on the first non-empty
 *      line; its contents are plain TypeScript.
 *   2. The template, which is HTML-like but uses JSX-style expressions
 *      (`<Comp attr={expr}>{expr}</Comp>`) and component PascalCase tag names.
 *
 * No first-party CodeMirror parser covers this combo (lang-html ignores the
 * frontmatter and the expression braces; lang-javascript chokes on the leading
 * `---` and on bare template markup). This StreamLanguage is small but covers
 * the things readers actually look at: keywords, strings, comments, numbers,
 * tag names, attribute names, expression braces, and the `---` fences.
 *
 * Tokens are emitted using CodeMirror's "highlightTags" string identifiers —
 * StreamLanguage maps them to Lezer tags automatically, so they flow through
 * the same HighlightStyle as everything else and pick up the active theme.
 */

interface AstroState {
  /** Inside the leading `---` … `---` frontmatter block. */
  inFrontmatter: boolean;
  /** Once we've closed (or skipped) the frontmatter, never re-enter it. */
  frontmatterDone: boolean;
  /** Open string delimiter, or false. */
  inString: false | "'" | '"' | "`";
  /** Inside a /* … *​/ block comment. */
  inBlockComment: boolean;
  /** Inside a <!-- … --> html comment. */
  inHtmlComment: boolean;
  /** Inside a tag definition (between `<` and `>`). */
  inTag: false | "open" | "close";
  /** Nesting depth of `{` expressions inside template/attribute. */
  exprDepth: number;
}

const TS_KEYWORDS = /^(?:import|export|from|as|const|let|var|function|async|await|return|if|else|for|while|do|switch|case|break|continue|class|extends|implements|interface|type|enum|new|this|super|null|undefined|true|false|in|of|typeof|instanceof|void|delete|public|private|protected|readonly|static|abstract|default|yield|throw|try|catch|finally)\b/;

const tokens: StreamParser<AstroState> = {
  startState() {
    return {
      inFrontmatter: false,
      frontmatterDone: false,
      inString: false,
      inBlockComment: false,
      inHtmlComment: false,
      inTag: false,
      exprDepth: 0,
    };
  },

  token(stream, state) {
    // Open frontmatter on the very first non-empty line.
    if (!state.frontmatterDone && !state.inFrontmatter && stream.sol()) {
      if (stream.match(/^---\s*$/)) {
        state.inFrontmatter = true;
        return "meta";
      }
      // Any non-blank non-fence line locks frontmatter out for the rest of
      // the file (Astro requires `---` on line one).
      const peek = stream.peek();
      if (peek != null && peek.trim().length > 0) state.frontmatterDone = true;
    }

    // Close frontmatter when we hit `---` on its own line.
    if (state.inFrontmatter && stream.sol() && stream.match(/^---\s*$/)) {
      state.inFrontmatter = false;
      state.frontmatterDone = true;
      return "meta";
    }

    // --- Block comment (works in both regions) ---
    if (state.inBlockComment) {
      if (stream.skipTo("*/")) {
        stream.next();
        stream.next();
        state.inBlockComment = false;
      } else {
        stream.skipToEnd();
      }
      return "blockComment";
    }
    if (state.inHtmlComment) {
      if (stream.skipTo("-->")) {
        stream.next();
        stream.next();
        stream.next();
        state.inHtmlComment = false;
      } else {
        stream.skipToEnd();
      }
      return "comment";
    }

    // --- String continuation (multi-line strings/templates) ---
    if (state.inString) {
      const quote = state.inString;
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === "\\") {
          stream.next();
          continue;
        }
        if (ch === quote) {
          state.inString = false;
          return "string";
        }
      }
      return "string";
    }

    // ============================================================
    // Region 1 — frontmatter (TypeScript-like)
    // ============================================================
    if (state.inFrontmatter) {
      if (stream.eatSpace()) return null;
      // Line comment
      if (stream.match("//")) {
        stream.skipToEnd();
        return "lineComment";
      }
      // Block comment open
      if (stream.match("/*")) {
        state.inBlockComment = true;
        return "blockComment";
      }
      // String open
      const ch = stream.peek();
      if (ch === "'" || ch === '"' || ch === "`") {
        state.inString = ch as "'" | '"' | "`";
        stream.next();
        return "string";
      }
      // Number
      if (stream.match(/^0x[\da-fA-F]+|^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)) return "number";
      // Keyword
      if (stream.match(TS_KEYWORDS)) return "keyword";
      // PascalCase identifier (likely a type/class)
      if (stream.match(/^[A-Z][\w$]*/)) return "typeName";
      // camelCase / snake_case identifier
      if (stream.match(/^[a-zA-Z_$][\w$]*/)) return "variableName";
      // Operator / punctuation
      if (stream.match(/^[+\-*/%=<>!&|^~?]+/)) return "operator";
      if (stream.match(/^[{}[\]()]/)) return "bracket";
      if (stream.match(/^[,;:.]/)) return "punctuation";
      stream.next();
      return null;
    }

    // ============================================================
    // Region 2 — template (HTML-ish with JSX expressions)
    // ============================================================

    // Expression braces — same lexing as frontmatter inside.
    if (state.exprDepth > 0) {
      if (stream.eatSpace()) return null;
      if (stream.match("//")) {
        stream.skipToEnd();
        return "lineComment";
      }
      const ch = stream.peek();
      if (ch === "'" || ch === '"' || ch === "`") {
        state.inString = ch as "'" | '"' | "`";
        stream.next();
        return "string";
      }
      if (stream.match(/^\d+(?:\.\d+)?/)) return "number";
      if (stream.match(TS_KEYWORDS)) return "keyword";
      if (stream.match(/^[A-Z][\w$]*/)) return "typeName";
      if (stream.match(/^[a-zA-Z_$][\w$]*/)) return "variableName";
      if (stream.eat("{")) {
        state.exprDepth++;
        return "bracket";
      }
      if (stream.eat("}")) {
        state.exprDepth--;
        return "bracket";
      }
      if (stream.match(/^[+\-*/%=<>!&|^~?]+/)) return "operator";
      if (stream.match(/^[(),;:.[\]]/)) return "punctuation";
      stream.next();
      return null;
    }

    // Inside a tag — attribute names, `=`, values, `>`.
    if (state.inTag) {
      if (stream.eatSpace()) return null;
      // Self-close or close
      if (stream.match("/>") || stream.eat(">")) {
        state.inTag = false;
        return "angleBracket";
      }
      // Open an expression value (Astro: title={expr})
      if (stream.eat("{")) {
        state.exprDepth = 1;
        return "bracket";
      }
      // Quoted attribute value
      const ch = stream.peek();
      if (ch === '"' || ch === "'") {
        state.inString = ch as '"' | "'";
        stream.next();
        return "string";
      }
      if (stream.eat("=")) return "operator";
      // Attribute name
      if (stream.match(/^[A-Za-z_:@][\w:.\-]*/)) return "attributeName";
      stream.next();
      return null;
    }

    // Start a new tag
    if (stream.peek() === "<") {
      stream.next(); // consume '<'
      // HTML comment
      if (stream.match("!--")) {
        state.inHtmlComment = true;
        return "comment";
      }
      // DOCTYPE / processing instr — emit as meta and skip to '>'
      if (stream.eat("!") || stream.eat("?")) {
        stream.skipTo(">");
        stream.next();
        return "meta";
      }
      // Close tag
      if (stream.eat("/")) {
        state.inTag = "close";
        if (stream.match(/^[A-Za-z][\w.-]*/)) return "tagName";
        return "angleBracket";
      }
      // Open tag
      state.inTag = "open";
      if (stream.match(/^[A-Za-z][\w.-]*/)) return "tagName";
      return "angleBracket";
    }

    // Bare `{...}` expression in template content
    if (stream.eat("{")) {
      state.exprDepth = 1;
      return "bracket";
    }

    // Plain text — eat until the next interesting char
    if (stream.match(/^[^<{]+/)) return null;
    stream.next();
    return null;
  },

  languageData: {
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
    indentOnInput: /^\s*[}\]]$/,
  },
};

export function astroLanguage(): Extension {
  return StreamLanguage.define(tokens);
}
