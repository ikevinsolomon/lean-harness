import { css } from 'lit';

/**
 * Theme with CSS custom properties on the element, for example:
 *   lean-chat { --lc-accent: #0ea5e9; --lc-radius: 12px; --lc-font: "Inter", sans-serif; }
 */
export const styles = css`
  :host {
    --lc-accent: #6d5efc;
    --lc-accent-2: #a855f7;
    --lc-on-accent: #ffffff;
    --lc-bg: #ffffff;
    --lc-surface: #f6f6f9;
    --lc-surface-2: #eeeef3;
    --lc-text: #17171c;
    --lc-muted: #6b6b78;
    --lc-border: #e4e4ea;
    --lc-danger: #d93a3a;
    --lc-success: #16a34a;
    --lc-radius: 18px;
    --lc-font: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    --lc-mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    --lc-shadow: 0 24px 64px -16px rgb(23 23 40 / 0.28), 0 2px 8px rgb(23 23 40 / 0.06);

    display: block;
    font-family: var(--lc-font);
    font-size: 15px;
    line-height: 1.55;
    color: var(--lc-text);
    -webkit-font-smoothing: antialiased;
  }
  :host([mode='inline']) {
    height: 100%;
    min-height: 420px;
  }

  :host([theme='dark']) {
    --lc-bg: #121216;
    --lc-surface: #1c1c22;
    --lc-surface-2: #26262e;
    --lc-text: #ececf1;
    --lc-muted: #9a9aa8;
    --lc-border: #2c2c35;
    --lc-shadow: 0 24px 64px -16px rgb(0 0 0 / 0.6);
  }
  @media (prefers-color-scheme: dark) {
    :host(:not([theme='light'])) {
      --lc-bg: #121216;
      --lc-surface: #1c1c22;
      --lc-surface-2: #26262e;
      --lc-text: #ececf1;
      --lc-muted: #9a9aa8;
      --lc-border: #2c2c35;
      --lc-shadow: 0 24px 64px -16px rgb(0 0 0 / 0.6);
    }
  }

  * {
    box-sizing: border-box;
  }
  button {
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  :focus-visible {
    outline: 2px solid var(--lc-accent);
    outline-offset: 2px;
  }

  /* ---------- frame ---------- */
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--lc-bg);
    border: 1px solid var(--lc-border);
    border-radius: var(--lc-radius);
    overflow: hidden;
  }
  :host([mode='floating']) .panel {
    position: fixed;
    right: 24px;
    bottom: 96px;
    width: min(420px, calc(100vw - 32px));
    height: min(640px, calc(100vh - 128px));
    box-shadow: var(--lc-shadow);
    z-index: 2147483000;
    transform-origin: bottom right;
    animation: pop 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.2);
  }
  @media (max-width: 520px) {
    :host([mode='floating']) .panel {
      inset: 0;
      width: auto;
      height: auto;
      border-radius: 0;
    }
  }
  .launcher {
    position: fixed;
    right: 24px;
    bottom: 24px;
    width: 58px;
    height: 58px;
    border: 0;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: var(--lc-on-accent);
    background: linear-gradient(135deg, var(--lc-accent), var(--lc-accent-2));
    box-shadow: 0 12px 28px -8px var(--lc-accent);
    z-index: 2147483001;
    transition: transform 0.18s ease;
  }
  .launcher:hover {
    transform: scale(1.06);
  }

  /* ---------- header ---------- */
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 14px 14px 18px;
    border-bottom: 1px solid var(--lc-border);
  }
  .avatar {
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: 11px;
    display: grid;
    place-items: center;
    color: var(--lc-on-accent);
    background: linear-gradient(135deg, var(--lc-accent), var(--lc-accent-2));
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  .title {
    font-weight: 650;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .subtitle {
    font-size: 12.5px;
    color: var(--lc-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .model {
    max-width: 46%;
    appearance: none;
    font: inherit;
    font-size: 12.5px;
    color: var(--lc-text);
    background: var(--lc-surface)
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none' stroke='%236b6b78' stroke-width='1.6'%3E%3Cpath d='M1 1l4 4 4-4'/%3E%3C/svg%3E")
      no-repeat right 10px center;
    border: 1px solid var(--lc-border);
    border-radius: 999px;
    padding: 6px 28px 6px 12px;
    text-overflow: ellipsis;
  }
  .icon-button {
    flex: none;
    width: 34px;
    height: 34px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    display: grid;
    place-items: center;
    color: var(--lc-muted);
  }
  .icon-button:hover {
    background: var(--lc-surface);
    color: var(--lc-text);
  }

  /* ---------- messages ---------- */
  .log {
    flex: 1;
    overflow-y: auto;
    padding: 20px 18px 8px;
    scroll-behavior: smooth;
  }
  .row {
    display: flex;
    margin: 0 0 16px;
    animation: rise 0.2s ease-out;
  }
  .row.user {
    justify-content: flex-end;
  }
  .bubble {
    max-width: 85%;
    padding: 10px 14px;
    border-radius: 18px 18px 6px 18px;
    background: linear-gradient(135deg, var(--lc-accent), var(--lc-accent-2));
    color: var(--lc-on-accent);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .assistant {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .md {
    overflow-wrap: anywhere;
  }
  .md > :first-child {
    margin-top: 0;
  }
  .md > :last-child {
    margin-bottom: 0;
  }
  .md p,
  .md ul,
  .md ol {
    margin: 0 0 10px;
  }
  .md ul,
  .md ol {
    padding-left: 22px;
  }
  .md a {
    color: var(--lc-accent);
  }
  .md code {
    font-family: var(--lc-mono);
    font-size: 0.88em;
    background: var(--lc-surface-2);
    padding: 0.12em 0.4em;
    border-radius: 6px;
  }
  .md pre {
    background: var(--lc-surface);
    border: 1px solid var(--lc-border);
    border-radius: 12px;
    padding: 12px 14px;
    overflow-x: auto;
  }
  .md pre code {
    background: none;
    padding: 0;
  }
  .md table {
    border-collapse: collapse;
    margin: 0 0 10px;
    font-size: 0.94em;
  }
  .md th,
  .md td {
    border: 1px solid var(--lc-border);
    padding: 6px 10px;
    text-align: left;
  }
  .md blockquote {
    margin: 0 0 10px;
    padding-left: 12px;
    border-left: 3px solid var(--lc-border);
    color: var(--lc-muted);
  }
  .cursor::after {
    content: '';
    display: inline-block;
    width: 7px;
    height: 1.05em;
    margin-left: 2px;
    vertical-align: text-bottom;
    border-radius: 2px;
    background: var(--lc-accent);
    animation: blink 1s steps(2) infinite;
  }

  details.reasoning {
    font-size: 13.5px;
    color: var(--lc-muted);
  }
  details.reasoning summary {
    cursor: pointer;
    list-style: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    user-select: none;
  }
  details.reasoning summary::-webkit-details-marker {
    display: none;
  }
  details.reasoning .thought {
    margin-top: 6px;
    padding-left: 12px;
    border-left: 2px solid var(--lc-border);
    white-space: pre-wrap;
  }

  /* ---------- tool cards ---------- */
  details.tool {
    border: 1px solid var(--lc-border);
    border-radius: 12px;
    background: var(--lc-surface);
    font-size: 13px;
  }
  details.tool summary {
    list-style: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    cursor: pointer;
  }
  details.tool summary::-webkit-details-marker {
    display: none;
  }
  .tool-name {
    font-family: var(--lc-mono);
    font-weight: 600;
  }
  .tool-status {
    margin-left: auto;
    color: var(--lc-muted);
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .tool-status.ok {
    color: var(--lc-success);
  }
  .tool-status.error {
    color: var(--lc-danger);
  }
  .tool-body {
    padding: 0 12px 10px;
    display: grid;
    gap: 6px;
  }
  .tool-body .label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--lc-muted);
  }
  .tool-body pre {
    margin: 0;
    max-height: 220px;
    overflow: auto;
    font-family: var(--lc-mono);
    font-size: 12px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: var(--lc-bg);
    border: 1px solid var(--lc-border);
    border-radius: 8px;
    padding: 8px 10px;
  }
  .spinner {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid var(--lc-border);
    border-top-color: var(--lc-accent);
    animation: spin 0.7s linear infinite;
  }

  .typing {
    display: inline-flex;
    gap: 4px;
    padding: 6px 0;
  }
  .typing span {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--lc-muted);
    animation: bounce 1.2s infinite ease-in-out;
  }
  .typing span:nth-child(2) {
    animation-delay: 0.15s;
  }
  .typing span:nth-child(3) {
    animation-delay: 0.3s;
  }

  .note {
    font-size: 12.5px;
    color: var(--lc-muted);
  }
  .error {
    margin: 0 18px 10px;
    padding: 10px 12px;
    border-radius: 12px;
    font-size: 13.5px;
    color: var(--lc-danger);
    background: color-mix(in srgb, var(--lc-danger) 10%, transparent);
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }
  .error button {
    margin-left: auto;
    border: 0;
    background: none;
    color: inherit;
    padding: 0;
  }

  /* ---------- empty state ---------- */
  .empty {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 14px;
    padding: 24px;
  }
  .empty .avatar {
    width: 52px;
    height: 52px;
    border-radius: 16px;
  }
  .empty h2 {
    margin: 0;
    font-size: 19px;
    letter-spacing: -0.02em;
  }
  .empty p {
    margin: 0;
    color: var(--lc-muted);
    max-width: 320px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin-top: 6px;
  }
  .chip {
    border: 1px solid var(--lc-border);
    background: var(--lc-bg);
    border-radius: 999px;
    padding: 7px 14px;
    font-size: 13.5px;
    transition: border-color 0.15s, background 0.15s;
  }
  .chip:hover {
    border-color: var(--lc-accent);
    background: color-mix(in srgb, var(--lc-accent) 7%, var(--lc-bg));
  }

  /* ---------- composer ---------- */
  form {
    padding: 10px 14px 14px;
  }
  .composer {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 8px 8px 8px 14px;
    border: 1px solid var(--lc-border);
    border-radius: 16px;
    background: var(--lc-surface);
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .composer:focus-within {
    border-color: var(--lc-accent);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--lc-accent) 15%, transparent);
  }
  textarea {
    flex: 1;
    resize: none;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--lc-text);
    font: inherit;
    max-height: 160px;
    padding: 6px 0;
  }
  textarea:focus-visible {
    outline: none; /* the composer shows the focus ring */
  }
  textarea::placeholder {
    color: var(--lc-muted);
  }
  .send {
    flex: none;
    width: 36px;
    height: 36px;
    border: 0;
    border-radius: 11px;
    display: grid;
    place-items: center;
    color: var(--lc-on-accent);
    background: linear-gradient(135deg, var(--lc-accent), var(--lc-accent-2));
    transition: opacity 0.15s, transform 0.15s;
  }
  .send:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .send:not(:disabled):hover {
    transform: translateY(-1px);
  }
  .footer {
    margin-top: 8px;
    text-align: center;
    font-size: 11.5px;
    color: var(--lc-muted);
  }

  @keyframes blink {
    to {
      visibility: hidden;
    }
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes bounce {
    0%,
    80%,
    100% {
      transform: translateY(0);
      opacity: 0.4;
    }
    40% {
      transform: translateY(-5px);
      opacity: 1;
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.92) translateY(12px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    *,
    .panel {
      animation: none !important;
      transition: none !important;
      scroll-behavior: auto;
    }
  }
`;
