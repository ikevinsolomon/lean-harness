/**
 * Sending email: invite links, password resets, sign-up and email confirmations.
 * Use Resend (an HTTP API, no extra packages), any SMTP server (needs `nodemailer`),
 * or the console while developing.
 */

export interface Email {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(email: Email): Promise<void>;
}

/** Resend (resend.com). `from` must be on a domain you verified with them, e.g. `Support Desk <help@acme.com>`. */
export function resendMailer(options: { apiKey: string; from: string }): Mailer {
  return {
    async send(email) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: options.from, to: [email.to], subject: email.subject, text: email.text, html: email.html }),
      });
      if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    },
  };
}

/**
 * Any SMTP server: `smtps://user:pass@smtp.example.com:465` or `smtp://...:587`.
 * Needs the `nodemailer` package (`npm install nodemailer`).
 */
export async function smtpMailer(options: { url: string; from: string }): Promise<Mailer> {
  type Transport = { sendMail(message: Record<string, unknown>): Promise<unknown> };
  const mod = (await import('nodemailer' as string).catch(() => {
    throw new Error('SMTP_URL is set: install the SMTP driver with `npm install nodemailer`');
  })) as { default?: { createTransport(url: string): Transport }; createTransport?(url: string): Transport };
  const transport = (mod.default ?? (mod as { createTransport(url: string): Transport })).createTransport(options.url);
  return {
    async send(email) {
      await transport.sendMail({ from: options.from, to: email.to, subject: email.subject, text: email.text, html: email.html });
    },
  };
}

/** Prints emails to the console instead of sending them. For trying sign-up and resets locally. */
export function consoleMailer(): Mailer {
  return {
    async send(email) {
      console.log(`\n── Email to ${email.to} ──\nSubject: ${email.subject}\n\n${email.text}\n──\n`);
    },
  };
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A short email with one button: the plain-text and HTML versions together. */
export function linkEmail(input: { to: string; subject: string; intro: string; button: string; link: string; outro?: string }): Email {
  const text = [input.intro, '', `${input.button}: ${input.link}`, ...(input.outro ? ['', input.outro] : [])].join('\n');
  const p = 'margin:0 0 16px;font:15px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#1f1e1d';
  const html = `<div style="max-width:520px;padding:24px">
<p style="${p}">${escape(input.intro)}</p>
<p style="margin:0 0 24px"><a href="${escape(input.link)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#c96442;color:#fff;text-decoration:none;font:600 15px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">${escape(input.button)}</a></p>
<p style="${p};font-size:13px;color:#6b6a68">Or open this link: <a href="${escape(input.link)}" style="color:#6b6a68">${escape(input.link)}</a></p>
${input.outro ? `<p style="${p};font-size:13px;color:#6b6a68">${escape(input.outro)}</p>` : ''}
</div>`;
  return { to: input.to, subject: input.subject, text, html };
}
