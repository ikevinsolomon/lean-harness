import { css } from 'lit';

/**
 * Theme with CSS custom properties on the element, for example:
 *   lean-chat { --lc-accent: #0f766e; --lc-radius: 14px; --lc-font: "Inter", sans-serif; }
 */
export const styles = css`
  :host {
    --lc-accent: #2563eb;
    --lc-on-accent: #ffffff;
    --lc-bg: #fbfbf9;
    --lc-panel: #ffffff;
    --lc-surface: #f2f2ee;
    --lc-ink: #18181b;
    --lc-muted: #66666e;
    --lc-border: #e7e6e1;
    --lc-bubble: #18181b;
    --lc-on-bubble: #fafaf9;
    --lc-ok: #15803d;
    --lc-danger: #c2410c;
    --lc-radius: 20px;
    --lc-font: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    --lc-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    --lc-shadow: 0 32px 80px -24px rgb(24 24 27 / 0.35), 0 2px 8px rgb(24 24 27 / 0.08);

    display: block;
    font-family: var(--lc-font);
    font-size: 14.5px;
    line-height: 1.55;
    color: var(--lc-ink);
    -webkit-font-smoothing: antialiased;
  }
  :host([mode='inline']) {
    height: 100%;
    min-height: 460px;
  }

  :host([theme='dark']) {
    --lc-bg: #111113;
    --lc-panel: #19191c;
    --lc-surface: #232327;
    --lc-ink: #ededef;
    --lc-muted: #9d9da7;
    --lc-border: #2b2b30;
    --lc-bubble: #ededef;
    --lc-on-bubble: #111113;
    --lc-ok: #4ade80;
    --lc-danger: #fb923c;
    --lc-shadow: 0 32px 80px -24px rgb(0 0 0 / 0.7);
  }
  @media (prefers-color-scheme: dark) {
    :host(:not([theme='light'])) {
      --lc-bg: #111113;
      --lc-panel: #19191c;
      --lc-surface: #232327;
      --lc-ink: #ededef;
      --lc-muted: #9d9da7;
      --lc-border: #2b2b30;
      --lc-bubble: #ededef;
      --lc-on-bubble: #111113;
      --lc-ok: #4ade80;
      --lc-danger: #fb923c;
      --lc-shadow: 0 32px 80px -24px rgb(0 0 0 / 0.7);
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
  button:disabled {
    cursor: default;
  }
  :focus-visible {
    outline: 2px solid var(--lc-accent);
    outline-offset: 2px;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
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
    bottom: 88px;
    width: min(440px, calc(100vw - 32px));
    height: min(760px, calc(100vh - 112px));
    box-shadow: var(--lc-shadow);
    z-index: 2147483000;
    transform-origin: bottom right;
    animation: pop 0.2s cubic-bezier(0.2, 0.9, 0.3, 1.1);
  }
  @media (max-width: 520px) {
    :host([mode='floating']) .panel {
      inset: 0;
      width: auto;
      height: auto;
      border-radius: 0;
      border: 0;
    }
    :host([mode='floating'][open]) .launcher {
      display: none;
    }
  }
  .launcher {
    position: fixed;
    right: 24px;
    bottom: 24px;
    width: 52px;
    height: 52px;
    border: 0;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: var(--lc-on-bubble);
    background: var(--lc-bubble);
    box-shadow: 0 12px 28px -10px rgb(24 24 27 / 0.5);
    z-index: 2147483001;
    transition: transform 0.16s ease;
  }
  .launcher:hover {
    transform: translateY(-2px);
  }

  /* ---------- header ---------- */
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 12px 12px 16px;
    border-bottom: 1px solid var(--lc-border);
  }
  .mark {
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: 9px;
    display: grid;
    place-items: center;
    color: var(--lc-bg);
    background: var(--lc-ink);
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  .title {
    font-weight: 600;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .subtitle {
    font-size: 12px;
    color: var(--lc-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .model {
    position: relative;
    display: inline-flex;
    align-items: center;
    max-width: 48%;
    height: 32px;
    border: 1px solid var(--lc-border);
    border-radius: 999px;
    background: var(--lc-panel);
  }
  .model:focus-within {
    outline: 2px solid var(--lc-accent);
    outline-offset: 2px;
  }
  .model .dot {
    position: absolute;
    left: 11px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    pointer-events: none;
  }
  .model .chevron {
    position: absolute;
    right: 10px;
    pointer-events: none;
    color: var(--lc-muted);
  }
  .model.static .name {
    padding: 0 12px 0 24px;
    font-size: 12.5px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .model select {
    appearance: none;
    width: 100%;
    height: 100%;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--lc-ink);
    font: 500 12.5px var(--lc-font);
    padding: 0 28px 0 24px;
    border-radius: 999px;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .icon-button {
    flex: none;
    width: 36px;
    height: 36px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    display: grid;
    place-items: center;
    color: var(--lc-muted);
  }
  .icon-button:hover {
    background: var(--lc-surface);
    color: var(--lc-ink);
  }

  /* ---------- thread ---------- */
  .log {
    flex: 1;
    overflow-y: auto;
    container-type: inline-size;
    padding: 18px 18px 8px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .turn {
    display: flex;
    flex-direction: column;
    gap: 10px;
    animation: rise 0.18s ease-out;
  }
  .user {
    align-self: flex-end;
    max-width: 82%;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
  }
  .bubble {
    padding: 9px 14px;
    border-radius: 18px 18px 4px 18px;
    background: var(--lc-bubble);
    color: var(--lc-on-bubble);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .attached {
    font-size: 12px;
    color: var(--lc-muted);
    display: inline-flex;
    align-items: center;
    gap: 4px;
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
    padding-left: 20px;
  }
  .md li + li {
    margin-top: 2px;
  }
  .md strong {
    font-weight: 600;
  }
  .md a {
    color: var(--lc-accent);
  }
  .md h1,
  .md h2,
  .md h3 {
    font-size: 15px;
    font-weight: 600;
    margin: 14px 0 6px;
  }
  .md code {
    font-family: var(--lc-mono);
    font-size: 0.86em;
    background: var(--lc-surface);
    padding: 0.12em 0.38em;
    border-radius: 6px;
  }
  .md pre {
    background: var(--lc-panel);
    border: 1px solid var(--lc-border);
    border-radius: 12px;
    padding: 12px 14px;
    overflow-x: auto;
    margin: 0 0 10px;
  }
  .md pre code {
    background: none;
    padding: 0;
  }
  .md .table {
    border: 1px solid var(--lc-border);
    border-radius: 12px;
    overflow-x: auto;
    background: var(--lc-panel);
    margin: 0 0 10px;
  }
  .md table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .md th {
    background: var(--lc-surface);
    color: var(--lc-muted);
    font-weight: 500;
    text-align: left;
  }
  .md th,
  .md td {
    padding: 7px 12px;
  }
  .md tr + tr td,
  .md tbody tr:first-child td {
    border-top: 1px solid var(--lc-border);
  }
  .md blockquote {
    margin: 0 0 10px;
    padding-left: 12px;
    border-left: 2px solid var(--lc-border);
    color: var(--lc-muted);
  }
  .caret::after {
    content: '';
    display: inline-block;
    width: 2px;
    height: 16px;
    margin-left: 2px;
    vertical-align: -3px;
    background: var(--lc-ink);
    animation: blink 1s steps(2) infinite;
  }

  .thought {
    font-size: 13px;
    color: var(--lc-muted);
  }
  .thought summary {
    list-style: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    user-select: none;
  }
  .thought summary::-webkit-details-marker {
    display: none;
  }
  .thought summary svg {
    transition: transform 0.15s;
  }
  .thought[open] summary svg {
    transform: rotate(90deg);
  }
  .thought .text {
    margin-top: 6px;
    padding-left: 20px;
    white-space: pre-wrap;
  }

  /* ---------- tool activity ---------- */
  .tools {
    border: 1px solid var(--lc-border);
    border-radius: 12px;
    background: var(--lc-panel);
    font-size: 13px;
    overflow: hidden;
  }
  .tool + .tool {
    border-top: 1px solid var(--lc-border);
  }
  .tool summary {
    list-style: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    cursor: pointer;
  }
  .tool summary::-webkit-details-marker {
    display: none;
  }
  .tool summary .chevron {
    color: var(--lc-muted);
    transition: transform 0.15s;
  }
  .tool[open] summary .chevron {
    transform: rotate(180deg);
  }
  .status {
    flex: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: var(--lc-panel);
  }
  .status.ok {
    background: var(--lc-ok);
  }
  .status.error {
    background: var(--lc-danger);
  }
  .status.running {
    border: 2px solid var(--lc-border);
    border-top-color: var(--lc-ink);
    animation: spin 0.7s linear infinite;
  }
  .tool-name {
    font-family: var(--lc-mono);
    font-size: 12.5px;
    font-weight: 500;
  }
  .tool-summary {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--lc-muted);
  }
  .tool-body {
    padding: 0 12px 12px 40px;
    display: grid;
    gap: 6px;
  }
  .tool-body .label {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
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
    background: var(--lc-surface);
    border-radius: 8px;
    padding: 8px 10px;
  }

  .note {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    padding: 5px 12px 5px 9px;
    border-radius: 999px;
    background: var(--lc-surface);
    font-size: 12.5px;
    color: var(--lc-muted);
  }
  .note span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .typing {
    display: inline-flex;
    gap: 4px;
    padding: 6px 0;
  }
  .typing span {
    width: 6px;
    height: 6px;
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

  .error {
    margin: 0 12px 4px;
    padding: 9px 12px;
    border-radius: 12px;
    font-size: 13px;
    color: var(--lc-danger);
    background: color-mix(in srgb, var(--lc-danger) 10%, transparent);
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }
  .error button {
    margin-left: auto;
    border: 0;
    background: none;
    color: inherit;
    padding: 2px;
  }

  /* ---------- empty state ---------- */
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 20px;
    padding-bottom: 4px;
  }
  .empty h2 {
    margin: 0;
    font-size: 26px;
    font-weight: 600;
    letter-spacing: -0.025em;
    line-height: 1.2;
  }
  .empty h2 .soft {
    display: block;
    margin-top: 4px;
    color: var(--lc-muted);
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  @container (max-width: 340px) {
    .cards {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .card {
    text-align: left;
    padding: 12px 14px;
    border: 1px solid var(--lc-border);
    border-radius: 14px;
    background: var(--lc-panel);
    display: flex;
    flex-direction: column;
    gap: 2px;
    transition: border-color 0.15s, transform 0.15s;
  }
  .card:hover {
    border-color: color-mix(in srgb, var(--lc-ink) 25%, var(--lc-border));
  }
  .card b {
    font-weight: 500;
  }
  .card small {
    font-size: 12.5px;
    color: var(--lc-muted);
  }

  /* ---------- composer ---------- */
  form {
    padding: 8px 12px 12px;
    container-type: inline-size;
  }
  .composer {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 10px 8px 12px;
    border: 1px solid var(--lc-border);
    border-radius: 18px;
    background: var(--lc-panel);
    box-shadow: 0 1px 2px rgb(24 24 27 / 0.04), 0 8px 24px -12px rgb(24 24 27 / 0.12);
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .composer:focus-within {
    border-color: color-mix(in srgb, var(--lc-ink) 30%, var(--lc-border));
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    height: 28px;
    padding: 0 4px 0 9px;
    border: 1px solid var(--lc-border);
    border-radius: 8px;
    background: var(--lc-surface);
    font-size: 12.5px;
  }
  .chip > svg {
    flex: none;
    color: var(--lc-muted);
  }
  .chip span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chip button {
    flex: none;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--lc-muted);
    display: grid;
    place-items: center;
  }
  .chip button:hover {
    background: var(--lc-border);
    color: var(--lc-ink);
  }
  textarea {
    resize: none;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--lc-ink);
    font: inherit;
    min-height: 26px;
    max-height: 168px;
    padding: 2px;
  }
  textarea:focus-visible {
    outline: none;
  }
  textarea::placeholder {
    color: var(--lc-muted);
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tool-button {
    height: 32px;
    min-width: 32px;
    padding: 0 8px;
    border: 1px solid var(--lc-border);
    border-radius: 10px;
    background: transparent;
    color: var(--lc-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 12.5px;
  }
  .tool-button:hover {
    color: var(--lc-ink);
    background: var(--lc-surface);
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 10px;
    border-radius: 10px;
    background: var(--lc-surface);
    color: var(--lc-muted);
    font-size: 12.5px;
    white-space: nowrap;
  }
  .status-text {
    font-size: 12.5px;
    color: var(--lc-muted);
  }
  .send {
    margin-left: auto;
    flex: none;
    width: 34px;
    height: 34px;
    border: 0;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: var(--lc-on-accent);
    background: var(--lc-accent);
    transition: background 0.15s, transform 0.15s;
  }
  .send:disabled {
    background: var(--lc-surface);
    color: var(--lc-muted);
  }
  .send.stop {
    background: var(--lc-ink);
    color: var(--lc-bg);
  }
  .send:not(:disabled):hover {
    transform: translateY(-1px);
  }
  .disclaimer {
    margin: 8px 0 0;
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
      transform: translateY(-4px);
      opacity: 1;
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.96) translateY(8px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    *,
    .panel {
      animation: none !important;
      transition: none !important;
    }
  }
`;
