import net from "node:net";
import os from "node:os";
import tls from "node:tls";

export async function sendStockNotifications(result, config) {
  const message = buildStockMessage(result);
  return sendAllNotifications({ type: "stock", message, result }, config);
}

export async function sendErrorNotification(error, state, config) {
  const message = [
    "Nintendo Switch 2 stock monitor error",
    `Consecutive errors: ${state.consecutiveErrors}`,
    `Error: ${error.message}`,
    `Time: ${new Date().toISOString()}`
  ].join("\n");

  return sendAllNotifications({ type: "error", message, error: error.message, state }, config);
}

export function buildStockMessage(result) {
  return [
    "Nintendo Switch 2 stock detected",
    result.productName ? `Product: ${result.productName}` : null,
    result.price ? `Price: ${result.price}` : null,
    `Status: ${result.status}`,
    `Evidence: ${result.evidence}`,
    `Checked at: ${result.checkedAt}`,
    `URL: ${result.url}`
  ]
    .filter(Boolean)
    .join("\n");
}

async function sendAllNotifications(payload, config) {
  const jobs = [];

  if (config.discordWebhookUrl) {
    jobs.push(sendDiscord(config.discordWebhookUrl, payload.message));
  }

  if (config.genericWebhook.url) {
    jobs.push(sendGenericWebhook(config.genericWebhook, payload));
  }

  if (config.smtp.host && config.smtp.from && config.smtp.to.length > 0) {
    jobs.push(
      sendSmtpEmail(config.smtp, {
        subject:
          payload.type === "stock"
            ? "Nintendo Switch 2 stock detected"
            : "Nintendo Switch 2 monitor error",
        text: payload.message
      })
    );
  }

  if (jobs.length === 0) {
    return [{ ok: false, channel: "none", error: "No notification channel configured" }];
  }

  return Promise.allSettled(jobs).then((results) =>
    results.map((result) => {
      if (result.status === "fulfilled") {
        return result.value;
      }

      return {
        ok: false,
        channel: "unknown",
        error: result.reason?.message || String(result.reason)
      };
    })
  );
}

async function sendDiscord(webhookUrl, message) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      content: message,
      allowed_mentions: { parse: [] }
    })
  });

  if (!response.ok) {
    throw new Error(`Discord webhook failed with HTTP ${response.status}: ${await response.text()}`);
  }

  return { ok: true, channel: "discord" };
}

async function sendGenericWebhook(webhook, payload) {
  const headers = {
    "content-type": "application/json"
  };

  if (webhook.bearerToken) {
    headers.authorization = `Bearer ${webhook.bearerToken}`;
  }

  const response = await fetch(webhook.url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Generic webhook failed with HTTP ${response.status}: ${await response.text()}`);
  }

  return { ok: true, channel: "webhook" };
}

async function sendSmtpEmail(smtp, email) {
  const session = await SmtpSession.connect(smtp);

  try {
    await session.expect([220]);
    await session.command(`EHLO ${sanitizeEhloHost(os.hostname())}`, [250]);

    if (!smtp.secure && smtp.startTls) {
      await session.command("STARTTLS", [220]);
      await session.upgradeToTls(smtp.host);
      await session.command(`EHLO ${sanitizeEhloHost(os.hostname())}`, [250]);
    }

    if (smtp.user || smtp.pass) {
      const token = Buffer.from(`\0${smtp.user}\0${smtp.pass}`).toString("base64");
      await session.command(`AUTH PLAIN ${token}`, [235]);
    }

    await session.command(`MAIL FROM:<${smtp.from}>`, [250]);
    for (const recipient of smtp.to) {
      await session.command(`RCPT TO:<${recipient}>`, [250, 251]);
    }

    await session.command("DATA", [354]);
    await session.writeData(formatEmail(smtp, email));
    await session.command("QUIT", [221]);
    return { ok: true, channel: "smtp" };
  } finally {
    session.close();
  }
}

class SmtpSession {
  static connect(smtp) {
    return new Promise((resolve, reject) => {
      const socket = smtp.secure
        ? tls.connect({ host: smtp.host, port: smtp.port, servername: smtp.host })
        : net.connect({ host: smtp.host, port: smtp.port });

      const session = new SmtpSession(socket);
      socket.once("connect", () => resolve(session));
      socket.once("secureConnect", () => resolve(session));
      socket.once("error", reject);
    });
  }

  constructor(socket) {
    this.buffer = "";
    this.pending = [];
    this.attach(socket);
  }

  attach(socket) {
    this.socket = socket;
    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk) => this.receive(chunk));
    this.socket.on("error", (error) => this.rejectPending(error));
    this.socket.on("close", () => this.rejectPending(new Error("SMTP connection closed")));
  }

  async upgradeToTls(host) {
    this.socket.removeAllListeners("data");
    this.socket.removeAllListeners("error");
    this.socket.removeAllListeners("close");

    await new Promise((resolve, reject) => {
      const secureSocket = tls.connect({ socket: this.socket, servername: host }, () => {
        this.buffer = "";
        this.attach(secureSocket);
        resolve();
      });
      secureSocket.once("error", reject);
    });
  }

  async expect(expectedCodes) {
    const response = await this.readResponse();
    assertExpectedResponse(response, expectedCodes);
    return response;
  }

  async command(command, expectedCodes) {
    this.socket.write(`${command}\r\n`);
    return this.expect(expectedCodes);
  }

  async writeData(rawMessage) {
    this.socket.write(`${dotStuff(rawMessage)}\r\n.\r\n`);
    return this.expect([250]);
  }

  close() {
    this.socket.end();
  }

  readResponse() {
    const response = this.takeResponse();
    if (response) {
      return Promise.resolve(response);
    }

    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
    });
  }

  receive(chunk) {
    this.buffer += chunk;

    let response;
    while ((response = this.takeResponse())) {
      const pending = this.pending.shift();
      if (!pending) {
        continue;
      }
      pending.resolve(response);
    }
  }

  rejectPending(error) {
    while (this.pending.length > 0) {
      this.pending.shift().reject(error);
    }
  }

  takeResponse() {
    const lines = this.buffer.split(/\r?\n/);
    let consumedLineCount = 0;
    let responseCode = null;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line === "" && index === lines.length - 1) {
        return null;
      }

      const match = line.match(/^(\d{3})([ -])/);
      if (!match) {
        continue;
      }

      responseCode = Number.parseInt(match[1], 10);
      if (match[2] === " ") {
        consumedLineCount = index + 1;
        break;
      }
    }

    if (consumedLineCount === 0) {
      return null;
    }

    const responseLines = lines.slice(0, consumedLineCount);
    this.buffer = lines.slice(consumedLineCount).join("\n");

    return {
      code: responseCode,
      text: responseLines.join("\n")
    };
  }
}

function assertExpectedResponse(response, expectedCodes) {
  if (!expectedCodes.includes(response.code)) {
    throw new Error(`Unexpected SMTP response ${response.code}: ${response.text}`);
  }
}

function formatEmail(smtp, email) {
  const to = smtp.to.join(", ");
  const subject = encodeMimeHeader(email.subject);

  return [
    `From: ${smtp.from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    email.text
  ].join("\r\n");
}

function encodeMimeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function dotStuff(message) {
  return message
    .replace(/\r?\n/g, "\r\n")
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

function sanitizeEhloHost(hostname) {
  return hostname.replace(/[^A-Za-z0-9.-]/g, "") || "localhost";
}
