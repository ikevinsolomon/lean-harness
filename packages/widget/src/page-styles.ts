import { css } from 'lit';

/** mode="page": a full-screen chat app. Below 768px it becomes the mobile layout with a drawer. */
export const pageStyles = css`
  :host([mode='page']) {
    --lc-side: #f3f3ef;
    --lc-hover: color-mix(in srgb, var(--lc-ink) 7%, transparent);
    height: 100vh;
    height: 100dvh;
  }
  :host([mode='page'][theme='dark']) {
    --lc-side: #0c0c0e;
  }
  @media (prefers-color-scheme: dark) {
    :host([mode='page']:not([theme='light'])) {
      --lc-side: #0c0c0e;
    }
  }

  .app {
    display: grid;
    grid-template-columns: 264px minmax(0, 1fr);
    height: 100%;
    background: var(--lc-bg);
    color: var(--lc-ink);
  }
  .app.collapsed {
    grid-template-columns: 0 minmax(0, 1fr);
  }

  /* ---------- sidebar ---------- */
  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    padding: 12px 10px;
    background: var(--lc-side);
    border-right: 1px solid var(--lc-border);
    overflow: hidden;
  }
  .app.collapsed .sidebar {
    visibility: hidden;
  }
  .side-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 4px 12px 6px;
  }
  .side-title {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .new-chat {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 38px;
    padding: 0 10px;
    border: 0;
    border-radius: 10px;
    background: var(--lc-hover);
    font-weight: 500;
    font-size: 14px;
    text-align: left;
  }
  .new-chat:hover {
    background: color-mix(in srgb, var(--lc-ink) 11%, transparent);
  }
  .side-label {
    padding: 16px 10px 4px;
    font-size: 12px;
    font-weight: 500;
    color: var(--lc-muted);
  }
  .history {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .history-row {
    display: flex;
    align-items: center;
    border-radius: 10px;
  }
  .history-row:hover,
  .history-row.active {
    background: var(--lc-hover);
  }
  .history-item {
    flex: 1;
    min-width: 0;
    padding: 8px 10px;
    border: 0;
    background: none;
    text-align: left;
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .history-delete {
    flex: none;
    width: 30px;
    height: 30px;
    margin-right: 4px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--lc-muted);
    display: grid;
    place-items: center;
    opacity: 0;
  }
  .history-row:hover .history-delete,
  .history-delete:focus-visible {
    opacity: 1;
  }
  .history-delete:hover {
    color: var(--lc-danger);
  }
  @media (hover: none) {
    .history-delete {
      opacity: 1;
    }
  }
  .side-empty {
    margin: 0;
    padding: 6px 10px;
    font-size: 13px;
    color: var(--lc-muted);
  }
  .side-foot {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 6px 4px;
    border-top: 1px solid var(--lc-border);
  }
  .side-memory {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
    color: var(--lc-muted);
  }
  .segmented {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 2px;
    padding: 3px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--lc-ink) 7%, transparent);
  }
  .segmented button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 32px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--lc-muted);
    font-size: 13px;
    font-weight: 500;
  }
  .segmented button[aria-pressed='true'] {
    background: var(--lc-panel);
    color: var(--lc-ink);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.12);
  }

  /* ---------- main ---------- */
  .main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 56px;
    padding: 0 12px;
    flex: none;
  }
  .topbar .spacer {
    flex: 1;
  }
  .topbar .menu,
  .topbar .top-new,
  .top-brand {
    display: none;
  }
  .app.collapsed .topbar .menu,
  .app.collapsed .topbar .top-new {
    display: grid;
  }
  .topbar .model {
    max-width: 60%;
    border: 0;
    background: transparent;
  }
  .topbar .model:hover {
    background: var(--lc-hover);
  }
  .topbar .model select,
  .topbar .model.static .name {
    font-size: 15px;
    font-weight: 600;
  }
  .topbar .model .dot {
    width: 8px;
    height: 8px;
  }

  .column {
    width: 100%;
    max-width: 768px;
    margin: 0 auto;
    padding: 0 24px;
  }
  .app .log {
    padding: 12px 0 24px;
    container-type: inline-size;
  }
  .app .thread {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .app .bubble {
    padding: 10px 16px;
    border-radius: 20px 20px 6px 20px;
  }
  .app .user {
    max-width: 80%;
  }
  .dock {
    flex: none;
  }
  .dock form {
    padding: 4px 0 14px;
  }
  .app .composer {
    border-radius: 22px;
    padding: 12px 12px 10px 16px;
    box-shadow: 0 1px 2px rgb(24 24 27 / 0.04), 0 12px 32px -16px rgb(24 24 27 / 0.18);
  }
  .app .error {
    margin: 0 0 8px;
  }
  /* The sidebar shows memory status; the empty screen needs no disclaimer. */
  .app .composer .pill,
  .hero .disclaimer {
    display: none;
  }

  .hero {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    align-items: center;
    padding-bottom: 10vh;
  }
  .hero .column {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .hero-head {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .hero-mark {
    width: 52px;
    height: 52px;
    border-radius: 15px;
    margin-bottom: 14px;
  }
  .hero h2 {
    margin: 0;
    font-size: 32px;
    font-weight: 600;
    letter-spacing: -0.025em;
    line-height: 1.2;
  }
  .hero h2 .soft {
    display: block;
    margin-top: 4px;
    color: var(--lc-muted);
  }
  .hero form {
    padding: 0;
  }
  .hero textarea {
    font-size: 15px;
    min-height: 48px;
  }
  .hero .cards {
    gap: 10px;
  }
  .hero .card {
    padding: 14px 16px;
    border-radius: 16px;
  }
  .scrim {
    display: none;
  }

  /* ---------- narrow screens: the mobile layout ---------- */
  @media (max-width: 768px) {
    .app,
    .app.collapsed {
      grid-template-columns: minmax(0, 1fr);
    }
    .sidebar,
    .app.collapsed .sidebar {
      position: fixed;
      inset: 0 auto 0 0;
      z-index: 20;
      width: min(300px, 86vw);
      visibility: visible;
      border-right: 0;
      transform: translateX(-100%);
      transition: transform 0.22s ease;
    }
    .app.drawer .sidebar {
      transform: none;
      box-shadow: 16px 0 48px -12px rgb(0 0 0 / 0.35);
    }
    .app.drawer .scrim {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 19;
      background: rgb(17 17 19 / 0.35);
    }
    .topbar {
      padding: 0 8px;
      border-bottom: 1px solid var(--lc-border);
    }
    .topbar .menu,
    .topbar .top-new {
      display: grid;
    }
    .top-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      min-width: 0;
      font-weight: 600;
    }
    .top-brand .mark {
      width: 26px;
      height: 26px;
      border-radius: 8px;
    }
    .top-brand .title {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .topbar .spacer {
      display: none;
    }
    .topbar .model {
      max-width: 42%;
      border: 1px solid var(--lc-border);
      background: var(--lc-panel);
    }
    .topbar .model select,
    .topbar .model.static .name {
      font-size: 12.5px;
      font-weight: 500;
    }
    .column {
      padding: 0 14px;
    }
    .dock form {
      padding: 4px 0 12px;
    }
    .hero {
      align-items: flex-end;
      padding: 16px 0 0;
    }
    .hero .column {
      gap: 14px;
    }
    .hero-head {
      align-items: flex-start;
      text-align: left;
    }
    .hero-mark {
      display: none;
    }
    .hero h2 {
      font-size: 26px;
    }
    /* On a phone the suggestions sit above the composer, as in the embedded widget. */
    .hero .cards {
      order: 2;
    }
    .hero form {
      order: 3;
      padding-bottom: 12px;
    }
    .hero .error {
      order: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sidebar {
      transition: none !important;
    }
  }
`;
