import { parseArgs } from "jsr:@std/cli/parse-args";

interface SmtpConfig {
  host?: string;
  port: number;
  username?: string;
  password?: string;
  secure: boolean;
}

async function sendRawEmail(
  config: SmtpConfig,
  to: string,
  emlContent: string,
): Promise<void> {
  console.log("[DEBUG] Connecting to SMTP server...");
  let conn = await connectToSmtp(config);
  console.log("[DEBUG] Connected successfully");

  try {
    // Read initial greeting
    console.log("[DEBUG] Reading server greeting...");
    await readResponse(conn, 220);
    console.log("[DEBUG] Greeting received");

    // EHLO
    console.log("[DEBUG] Sending EHLO...");
    await sendCommand(conn, `EHLO ${config.host}\r\n`, 250);
    console.log("[DEBUG] EHLO successful");

    // STARTTLS if not using SSL
    if (!config.secure) {
      console.log("[DEBUG] Starting STARTTLS...");
      await sendCommand(conn, "STARTTLS\r\n", 220);
      console.log("[DEBUG] STARTTLS accepted, upgrading connection...");
      // startTls consumes the original connection, so we just reassign
      // @ts-ignore TlsConn vs TcpConn
      conn = await Deno.startTls(conn, { hostname: config.host });
      console.log("[DEBUG] TLS upgrade complete, sending EHLO again...");
      await sendCommand(conn, `EHLO ${config.host}\r\n`, 250);
      console.log("[DEBUG] EHLO after TLS successful");
    }

    // AUTH LOGIN
    console.log("[DEBUG] Starting authentication...");
    await sendCommand(conn, "AUTH LOGIN\r\n", 334);
    console.log("[DEBUG] Sending username...");
    await sendCommand(conn, btoa(config.username ?? "") + "\r\n", 334);
    console.log("[DEBUG] Sending password...");
    await sendCommand(conn, btoa(config.password ?? "") + "\r\n", 235);
    console.log("[DEBUG] Authentication successful");

    // Extract original From address
    console.log("[DEBUG] Extracting From address...");
    const fromMatch = emlContent.match(/^From: (.+)$/m);
    const fromEmail = fromMatch ? extractEmail(fromMatch[1]) || config.username : config.username;
    console.log(`[DEBUG] From email: ${fromEmail}`);

    // MAIL FROM
    console.log("[DEBUG] Sending MAIL FROM...");
    await sendCommand(conn, `MAIL FROM:<${fromEmail}>\r\n`, 250);
    console.log("[DEBUG] MAIL FROM successful");

    // RCPT TO
    console.log(`[DEBUG] Sending RCPT TO: ${to}...`);
    await sendCommand(conn, `RCPT TO:<${to}>\r\n`, 250);
    console.log("[DEBUG] RCPT TO successful");

    // DATA
    console.log("[DEBUG] Sending DATA command...");
    await sendCommand(conn, "DATA\r\n", 354);
    console.log("[DEBUG] DATA command accepted");

    // Replace the To: header with new recipient
    console.log("[DEBUG] Preparing email content...");
    let modifiedContent = emlContent.replace(/^To: .+$/m, `To: ${to}`);

    // Ensure proper line endings
    modifiedContent = modifiedContent.replace(/\r?\n/g, "\r\n");

    // SMTP dot-stuffing: escape lines that start with a dot by adding another dot
    // This prevents premature end-of-data detection
    modifiedContent = modifiedContent.replace(/^\.(?=.)/gm, "..");

    // Make sure content ends with CRLF before the terminator
    if (!modifiedContent.endsWith("\r\n")) {
      modifiedContent += "\r\n";
    }

    // Send the email content
    console.log("[DEBUG] Sending email content...");
    console.log(`[DEBUG] Content length: ${modifiedContent.length} bytes`);

    // For large emails, write in chunks to avoid blocking
    const encoder = new TextEncoder();
    const contentBytes = encoder.encode(modifiedContent);
    const chunkSize = 65536; // 64KB chunks

    for (let i = 0; i < contentBytes.length; i += chunkSize) {
      const chunk = contentBytes.slice(i, i + chunkSize);
      await conn.write(chunk);
      if (i > 0 && i % (chunkSize * 10) === 0) {
        console.log(`[DEBUG] Sent ${i} / ${contentBytes.length} bytes...`);
      }
    }

    // Send the end-of-data marker
    await conn.write(encoder.encode(".\r\n"));
    console.log("[DEBUG] Email content sent, waiting for confirmation...");

    // Read the response
    await readResponse(conn, 250);
    console.log("[DEBUG] Email accepted by server");
    console.log("[DEBUG] Email content sent successfully");

    // QUIT
    console.log("[DEBUG] Sending QUIT...");
    await sendCommand(conn, "QUIT\r\n", 221);
    console.log("[DEBUG] QUIT successful");
  } catch (error) {
    console.error("[DEBUG] Error occurred:", error);
    throw error;
  } finally {
    console.log("[DEBUG] Closing connection...");
    try {
      conn.close();
      console.log("[DEBUG] Connection closed");
    } catch (e) {
      console.error("[DEBUG] Error closing connection:", e);
    }
  }
}

async function connectToSmtp(config: SmtpConfig): Promise<Deno.TcpConn | Deno.TlsConn> {
  if (config.secure) {
    return await Deno.connectTls({
      hostname: config.host,
      port: config.port,
    });
  } else {
    return await Deno.connect({
      hostname: config.host,
      port: config.port,
    });
  }
}

async function sendCommand(
  conn: Deno.Conn,
  command: string,
  expectedCode: number,
): Promise<string> {
  console.log(`[DEBUG] sendCommand: Sending command (expecting ${expectedCode})`);
  const encoder = new TextEncoder();
  try {
    await conn.write(encoder.encode(command));
    console.log("[DEBUG] sendCommand: Command written, reading response...");
    return await readResponse(conn, expectedCode);
  } catch (error) {
    console.error("[DEBUG] sendCommand: Error:", error);
    throw error;
  }
}

async function readResponse(
  conn: Deno.Conn,
  expectedCode: number,
): Promise<string> {
  console.log(`[DEBUG] readResponse: Reading response (expecting ${expectedCode})...`);
  const decoder = new TextDecoder();
  const buffer = new Uint8Array(4096);
  let response = "";

  try {
    // Set a timeout for reading
    const timeoutMs = 30000; // 30 seconds
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`Timeout waiting for response (expected ${expectedCode})`);
      }

      // Use AbortSignal for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), Math.min(remaining, 5000));

      try {
        const n = await conn.read(buffer);
        clearTimeout(timeoutId);

        if (n === null) {
          console.log("[DEBUG] readResponse: Connection closed by server");
          break;
        }

        const chunk = decoder.decode(buffer.subarray(0, n));
        console.log(`[DEBUG] readResponse: Received ${n} bytes: ${chunk.trim()}`);
        response += chunk;

        if (response.endsWith("\r\n")) {
          const lines = response.trim().split("\r\n");
          const lastLine = lines[lines.length - 1];
          if (!lastLine.match(/^\d{3}-/)) {
            console.log("[DEBUG] readResponse: Complete response received");
            break;
          }
        }
      } catch (err) {
        clearTimeout(timeoutId);
        if ((err as Error).name === "AbortError") {
          continue; // Timeout on this read, try again
        }
        throw err;
      }
    }

    const code = parseInt(response.substring(0, 3));
    console.log(`[DEBUG] readResponse: Response code: ${code}, expected: ${expectedCode}`);

    if (code !== expectedCode) {
      throw new Error(`SMTP Error: Expected ${expectedCode}, got ${code}: ${response}`);
    }

    return response;
  } catch (error) {
    console.error("[DEBUG] readResponse: Error:", error);
    throw error;
  }
}

function extractEmail(fromHeader: string): string | null {
  const match = fromHeader.match(/<(.+?)>/);
  if (match) return match[1];

  const emailMatch = fromHeader.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  return emailMatch ? emailMatch[1] : null;
}

async function main() {
  const args = parseArgs(Deno.args, {
    string: ["file", "dir", "to", "smtp-host", "smtp-port", "smtp-user", "smtp-pass"],
    boolean: ["help", "secure"],
    default: {
      "smtp-port": "587",
      "secure": false,
    },
  });

  if (args.help || (!args.file && !args.dir) || !args.to) {
    console.log(`
EML File Forwarder (Simple)

Usage:
  deno run --allow-read --allow-net --allow-env --env main.ts [options]

Required Options:
  --file <path>           Path to a single EML file
  --dir <path>            Path to a directory containing EML files
  --to <email>           Destination email address

Note: Use either --file or --dir, not both.

SMTP Options:
  --smtp-host <host>     SMTP server hostname (default: from env SMTP_HOST)
  --smtp-port <port>     SMTP server port (default: 587)
  --smtp-user <user>     SMTP username (default: from env SMTP_USER)
  --smtp-pass <pass>     SMTP password (default: from env SMTP_PASS)
  --secure               Use SSL/TLS (default: false, uses STARTTLS)

Examples:
  # Send a single file
  deno run --allow-read --allow-net --allow-env --env main.ts \\
    --file email.eml \\
    --to recipient@example.com

  # Send all EML files in a directory
  deno run --allow-read --allow-net --allow-env --env main.ts \\
    --dir ./emails \\
    --to recipient@example.com
    `);
    Deno.exit(args.help ? 0 : 1);
  }

  if (args.file && args.dir) {
    console.error("Error: Please specify either --file or --dir, not both.");
    Deno.exit(1);
  }

  // Get SMTP config from args or environment
  const smtpConfig: SmtpConfig = {
    host: args["smtp-host"] || Deno.env.get("SMTP_HOST"),
    port: parseInt(args["smtp-port"] || Deno.env.get("SMTP_PORT") || "587"),
    username: args["smtp-user"] || Deno.env.get("SMTP_USER"),
    password: args["smtp-pass"] || Deno.env.get("SMTP_PASS"),
    secure: args.secure,
  };

  if (!smtpConfig.host || !smtpConfig.username || !smtpConfig.password) {
    console.error("Error: SMTP configuration incomplete. Please provide:");
    console.error("  - SMTP host (--smtp-host or SMTP_HOST)");
    console.error("  - SMTP username (--smtp-user or SMTP_USER)");
    console.error("  - SMTP password (--smtp-pass or SMTP_PASS)");
    Deno.exit(1);
  }

  try {
    if (args.file) {
      // Process single file
      await processSingleFile(args.file, args.to, smtpConfig);
    } else if (args.dir) {
      // Process directory
      await processDirectory(args.dir, args.to, smtpConfig);
    }
  } catch (error) {
    console.error("\n✗ Error:", (error as Error).message);
    Deno.exit(1);
  }
}

async function processSingleFile(
  filePath: string,
  to: string,
  smtpConfig: SmtpConfig,
): Promise<void> {
  console.log(`Reading EML file: ${filePath}`);
  const emlContent = await Deno.readTextFile(filePath);

  console.log(`Forwarding email to: ${to}`);
  await sendRawEmail(smtpConfig, to, emlContent);

  console.log("\n✓ Email forwarded successfully!");
}

async function processDirectory(
  dirPath: string,
  to: string,
  smtpConfig: SmtpConfig,
): Promise<void> {
  console.log(`Scanning directory: ${dirPath}\n`);

  // Get all .eml files
  const emlFiles: string[] = [];
  for await (const entry of Deno.readDir(dirPath)) {
    if (entry.isFile && entry.name.toLowerCase().endsWith(".eml")) {
      emlFiles.push(`${dirPath}/${entry.name}`);
    }
  }

  if (emlFiles.length === 0) {
    console.log("No EML files found in directory.");
    return;
  }

  console.log(`Found ${emlFiles.length} EML file(s)\n`);

  let successful = 0;
  let failed = 0;
  const errors: Array<{ file: string; error: string }> = [];

  for (let i = 0; i < emlFiles.length; i++) {
    const filePath = emlFiles[i];
    const fileName = filePath.split("/").pop() || filePath;

    console.log(`[${i + 1}/${emlFiles.length}] Processing: ${fileName}`);

    try {
      const emlContent = await Deno.readTextFile(filePath);
      await sendRawEmail(smtpConfig, to, emlContent);
      console.log(`✓ Sent successfully\n`);
      successful++;

      // Small delay between emails to avoid rate limiting
      if (i < emlFiles.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`✗ Failed: ${(error as Error).message}\n`);
      failed++;
      errors.push({ file: fileName, error: (error as Error).message });
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log("Summary:");
  console.log(`  Total files: ${emlFiles.length}`);
  console.log(`  ✓ Successful: ${successful}`);
  console.log(`  ✗ Failed: ${failed}`);

  if (errors.length > 0) {
    console.log("\nFailed files:");
    errors.forEach(({ file, error }) => {
      console.log(`  - ${file}: ${error}`);
    });
  }

  console.log("=".repeat(50));
}

if (import.meta.main) {
  main();
}
