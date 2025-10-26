# EML File Sender

A Deno script that reads EML files (exported from Gmail) and sends their contents to a specified email address via SMTP.

## Features

- Parse EML files with full support for:
  - Plain text and HTML bodies
  - Attachments
  - MIME multipart messages
  - Quoted-printable and Base64 encoding
  - RFC 2047 encoded headers
- Send emails via SMTP with STARTTLS support
- Command-line interface with environment variable support

## Requirements

- Deno 1.37+ (for `Deno.startTls`)

## Installation

No installation needed! Just clone or download the files:

```bash
git clone <your-repo>
cd eml-sender
```

## Usage

### Basic Usage

```bash
deno run --allow-read --allow-net --allow-env main.ts \
  --file email.eml \
  --to recipient@example.com \
  --smtp-host smtp.gmail.com \
  --smtp-user your-email@gmail.com \
  --smtp-pass "your-app-password"
```

### Using Environment Variables

Create a `.env` file (remember to add it to `.gitignore`):

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

Then run:

```bash
deno run --allow-read --allow-net --allow-env main.ts \
  --file email.eml \
  --to recipient@example.com
```

### Using Deno Tasks

```bash
deno task send --file email.eml --to recipient@example.com
```

## Command-Line Options

### Required Options

- `--file <path>` - Path to the EML file to send
- `--to <email>` - Destination email address

### SMTP Options

- `--smtp-host <host>` - SMTP server hostname (default: from `SMTP_HOST` env var)
- `--smtp-port <port>` - SMTP server port (default: 587)
- `--smtp-user <user>` - SMTP username (default: from `SMTP_USER` env var)
- `--smtp-pass <pass>` - SMTP password (default: from `SMTP_PASS` env var)
- `--secure` - Use SSL/TLS connection (default: false, uses STARTTLS)

## Gmail Setup

To use Gmail's SMTP server, you need to:

1. Enable 2-factor authentication on your Google account
2. Generate an app-specific password at https://myaccount.google.com/apppasswords
3. Use these settings:
   - Host: `smtp.gmail.com`
   - Port: `587`
   - Username: Your Gmail address
   - Password: Your app-specific password

## Project Structure

```
.
├── main.ts          # Main entry point and CLI
├── parser.ts        # EML file parser
├── sender.ts        # SMTP email sender
├── deno.json        # Deno configuration
├── deno.lock        # Dependency lockfile
└── README.md        # This file
```

## How It Works

1. **Parsing**: The `parser.ts` module reads and parses the EML file:
   - Extracts headers (From, To, Subject, Date, etc.)
   - Parses MIME multipart structure
   - Decodes content (Base64, Quoted-Printable)
   - Extracts attachments

2. **Sending**: The `sender.ts` module sends the email via SMTP:
   - Connects to SMTP server
   - Performs STARTTLS upgrade (if not using SSL)
   - Authenticates with username/password
   - Sends the email with all parts and attachments

## Supported Features

### Email Parsing
- ✅ Plain text emails
- ✅ HTML emails
- ✅ Multipart/alternative (text + HTML)
- ✅ Attachments
- ✅ Nested MIME parts
- ✅ Base64 encoding
- ✅ Quoted-Printable encoding
- ✅ RFC 2047 header encoding

### SMTP
- ✅ STARTTLS support
- ✅ SSL/TLS support
- ✅ AUTH LOGIN authentication
- ✅ Multipart message composition
- ✅ Attachment encoding

## Limitations

- Only supports AUTH LOGIN authentication method
- Does not support DKIM signing
- Does not support advanced SMTP features (PIPELINING, etc.)

## Troubleshooting

### "SMTP Error: Expected 250, got 535"
This usually means authentication failed. Check your username and password.

### "SMTP Error: Expected 250, got 554"
The SMTP server rejected the email. This could be due to:
- Invalid recipient address
- Sender reputation issues
- Email content triggers spam filters

### Connection Timeout
- Check firewall settings
- Verify the SMTP host and port are correct
- Some networks block outgoing SMTP connections

## License

MIT

## Contributing

Feel free to submit issues and pull requests!
