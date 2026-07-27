# Evolution API v2 — WhatsApp Integration

Reference for integrating with Evolution API v2 via REST. Evolution API runs on a self-hosted server (e.g., Contabo VPS with EasyPanel) and provides full WhatsApp control through the Baileys library.

## When to Use

Use this skill when building any automation that sends or receives WhatsApp messages, manages WhatsApp instances, or listens for incoming message events via webhooks. This is the core messaging layer for WhatsApp-based agents and bots.

## Authentication

Evolution API is self-hosted on a Contabo VPS running EasyPanel. The instance is already deployed and operational — do NOT attempt to install or redeploy Evolution API. Just connect to the existing server via its URL.

Every request requires an `apikey` header. The global API key is set on the server; per-instance keys are returned when creating an instance.

```ts
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL; // e.g. https://your-server.com
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;

const headers = {
  "Content-Type": "application/json",
  apikey: EVOLUTION_API_KEY,
};
```

**Security rules:**
- Store `EVOLUTION_API_URL` and `EVOLUTION_API_KEY` in `.env` — never hardcode
- Add both to Trigger.dev dashboard env vars for production
- Never log the API key

## Base URL Pattern

All endpoints follow: `{EVOLUTION_API_URL}/{resource}/{instance}`

Where `{instance}` is the instance name (e.g., `pratoflash-agent`).

---

## Instance Management

### Create Instance

Creates a new WhatsApp connection. Call once during setup.

```ts
// POST /instance/create
const response = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    instanceName: "pratoflash-agent",
    integration: "WHATSAPP-BAILEYS",
    qrcode: true,
    rejectCall: true,
    msgCall: "No momento não podemos atender ligações.",
    groupsIgnore: true,
    alwaysOnline: false,
    readMessages: false,
    readStatus: false,
    syncFullHistory: false,
    webhook: {
      url: "https://your-webhook-endpoint.com/api/whatsapp/webhook",
      byEvents: false,
      base64: true,
      headers: {
        authorization: "Bearer your-webhook-secret",
      },
      events: [
        "MESSAGES_UPSERT",
        "CONNECTION_UPDATE",
        "QRCODE_UPDATED",
      ],
    },
  }),
});

// Response 201:
// {
//   instance: { instanceName, instanceId, status: "created" },
//   hash: { apikey: "instance-specific-key" },
//   settings: { reject_call, groups_ignore, ... }
// }
```

**Key options for PratoFlash:**
- `rejectCall: true` — agent doesn't take calls
- `groupsIgnore: true` — only process direct messages
- `webhook.events` — subscribe only to events you need (saves processing)

### Connect Instance (Get QR Code)

After creating, scan QR to link WhatsApp number.

```ts
// GET /instance/connect/{instance}
const response = await fetch(
  `${EVOLUTION_API_URL}/instance/connect/pratoflash-agent`,
  { headers }
);
// Returns: { base64: "data:image/png;base64,...", code: "2@..." }
```

### Check Connection State

```ts
// GET /instance/connectionState/{instance}
const response = await fetch(
  `${EVOLUTION_API_URL}/instance/connectionState/pratoflash-agent`,
  { headers }
);
// Returns: { instance: "pratoflash-agent", state: "open" }
// Possible states: "open" (connected), "close" (disconnected), "connecting"
```

### Restart Instance

```ts
// PUT /instance/restart/{instance}
await fetch(`${EVOLUTION_API_URL}/instance/restart/pratoflash-agent`, {
  method: "PUT",
  headers,
});
```

---

## Sending Messages

### Send Plain Text

The primary method for outbound prospecting messages and agent replies.

```ts
// POST /message/sendText/{instance}
const response = await fetch(
  `${EVOLUTION_API_URL}/message/sendText/pratoflash-agent`,
  {
    method: "POST",
    headers,
    body: JSON.stringify({
      number: "5511999999999",      // with country code, no + or spaces
      text: "Olá, tudo bem? É do Restaurante Sabor & Arte?",
      delay: 2000,                   // typing presence in ms before sending
      linkPreview: false,
    }),
  }
);

// Response 201:
// {
//   key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: true, id: "BAE594..." },
//   message: { extendedTextMessage: { text: "..." } },
//   messageTimestamp: "1717689097",
//   status: "PENDING"
// }
```

**Important:**
- `number` format: country code + area code + number, digits only (e.g., `5511999999999`)
- `delay` adds a typing indicator before sending — makes messages feel human (use 1000-3000ms)
- Store `key.id` to reference the message later (for read receipts, etc.)

### Send Media (Images)

Used for sending before/after images of enhanced food photos.

```ts
// POST /message/sendMedia/{instance}
const response = await fetch(
  `${EVOLUTION_API_URL}/message/sendMedia/pratoflash-agent`,
  {
    method: "POST",
    headers,
    body: JSON.stringify({
      number: "5511999999999",
      mediatype: "image",
      mimetype: "image/jpeg",
      caption: "Veja como ficou o seu prato com a PratoFlash! 🍽️",
      media: "https://your-storage.com/enhanced-image.jpg",  // URL or base64
      delay: 1500,
    }),
  }
);
```

**Media options:**
- `mediatype`: `"image"`, `"video"`, `"audio"`, `"document"`
- `media`: can be a public URL or base64-encoded data
- `caption`: text shown below the image
- `fileName`: required for `document` type

---

## Checking Numbers

### Check if Number Has WhatsApp

**Always validate before sending.** Avoids wasting messages on landlines or inactive numbers.

```ts
// POST /chat/whatsappNumbers/{instance}
const response = await fetch(
  `${EVOLUTION_API_URL}/chat/whatsappNumbers/pratoflash-agent`,
  {
    method: "POST",
    headers,
    body: JSON.stringify({
      numbers: ["5511999999999", "5511988888888"],
    }),
  }
);

// Response:
// [
//   { exists: true, jid: "5511999999999@s.whatsapp.net", number: "5511999999999" },
//   { exists: false, jid: "", number: "5511988888888" }
// ]
```

**For PratoFlash prospecting:** run this check on the restaurant list before sending the first template message. Skip numbers where `exists: false`.

---

## Typing Presence

Simulates "typing..." indicator — makes the agent feel human.

```ts
// POST /chat/sendPresence/{instance}
await fetch(
  `${EVOLUTION_API_URL}/chat/sendPresence/pratoflash-agent`,
  {
    method: "POST",
    headers,
    body: JSON.stringify({
      number: "5511999999999",
      presence: "composing",  // "composing" = typing, "paused" = stopped typing
      delay: 3000,            // how long to show typing
    }),
  }
);
```

### Mark Message As Read

Show blue checkmarks on received messages — signals professionalism.

```ts
// POST /chat/markMessageAsRead/{instance}
await fetch(
  `${EVOLUTION_API_URL}/chat/markMessageAsRead/pratoflash-agent`,
  {
    method: "POST",
    headers,
    body: JSON.stringify({
      readMessages: [
        {
          remoteJid: "5511999999999@s.whatsapp.net",
          fromMe: false,
          id: "MESSAGE_ID_HERE",
        },
      ],
    }),
  }
);
```

---

## Webhooks — Receiving Messages

### Configuring Webhooks

Set during instance creation (recommended) or update later:

```ts
// POST /webhook/set/{instance}
await fetch(
  `${EVOLUTION_API_URL}/webhook/set/pratoflash-agent`,
  {
    method: "POST",
    headers,
    body: JSON.stringify({
      url: "https://your-server.com/api/whatsapp/webhook",
      webhook_by_events: false,
      webhook_base64: true,
      events: [
        "MESSAGES_UPSERT",        // new incoming/outgoing messages
        "MESSAGES_UPDATE",        // message status changes (read, delivered)
        "CONNECTION_UPDATE",      // connection state changes
      ],
    }),
  }
);
```

### Webhook Event: MESSAGES_UPSERT

This is the main event for the PratoFlash agent. Fires when any message is received.

```ts
// Webhook payload structure for incoming message:
interface WebhookPayload {
  event: "messages.upsert";
  instance: string;
  data: {
    key: {
      remoteJid: string;    // "5511999999999@s.whatsapp.net"
      fromMe: boolean;       // false = incoming message
      id: string;            // unique message ID
    };
    pushName: string;        // contact name on WhatsApp
    message: {
      conversation?: string;                    // plain text message
      extendedTextMessage?: { text: string };   // text with link preview
      imageMessage?: { /* ... */ };             // image
    };
    messageType: string;     // "conversation", "extendedTextMessage", etc.
    messageTimestamp: number;
  };
}
```

### Handling Incoming Messages (Next.js API Route Example)

```ts
// app/api/whatsapp/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const payload = await req.json();

  // Ignore outgoing messages (fromMe = true)
  if (payload.data?.key?.fromMe) {
    return NextResponse.json({ status: "ignored" });
  }

  // Ignore group messages
  if (payload.data?.key?.remoteJid?.includes("@g.us")) {
    return NextResponse.json({ status: "ignored" });
  }

  // Extract message text
  const text =
    payload.data?.message?.conversation ||
    payload.data?.message?.extendedTextMessage?.text ||
    "";

  const senderNumber = payload.data.key.remoteJid.replace("@s.whatsapp.net", "");
  const senderName = payload.data.pushName || "Cliente";
  const messageId = payload.data.key.id;

  // Process the message (trigger your agent logic here)
  // e.g., call Trigger.dev task, call LLM, etc.

  return NextResponse.json({ status: "received" });
}
```

---

## Webhook Events Reference

| Event | Description | Use in PratoFlash |
|---|---|---|
| `MESSAGES_UPSERT` | New message received/sent | **Primary** — triggers agent responses |
| `MESSAGES_UPDATE` | Message status changed (delivered, read) | Track if prospect read your message |
| `CONNECTION_UPDATE` | Instance connected/disconnected | Monitor agent health |
| `QRCODE_UPDATED` | QR code refreshed | Initial setup only |
| `CONTACTS_UPDATE` | Contact info changed | Not needed |
| `GROUPS_UPSERT` | Group events | Not needed (groups ignored) |

---

## Number Format Rules

- Always use full international format: country code + number
- Brazil format: `55` + DDD (2 digits) + number (8-9 digits)
- Examples: `5511999999999` (São Paulo mobile), `5521988888888` (Rio mobile)
- No `+`, no spaces, no dashes, no parentheses
- WhatsApp JID format: `5511999999999@s.whatsapp.net` (individual), `123456@g.us` (group)

---

## PratoFlash Agent Flow — Implementation Guide

### Timing Rules — CRITICAL

**Outbound messages (prospecting, follow-ups, upsell):**
- ONLY send between **09:00 and 19:00** in timezone `America/Sao_Paulo`
- Before sending any outbound message, check current time in São Paulo:
  ```ts
  const now = new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" });
  const hour = new Date(now).getHours();
  const isBusinessHours = hour >= 9 && hour < 19;
  ```
- If outside business hours, queue the message for the next 9am window

**Delay between prospecting messages:**
- Randomize between **7 and 18 minutes** between each outbound message
- Never send in bursts — this is the #1 cause of WhatsApp bans
  ```ts
  const minDelay = 7 * 60 * 1000;  // 7 minutes
  const maxDelay = 18 * 60 * 1000; // 18 minutes
  const delay = Math.floor(Math.random() * (maxDelay - minDelay)) + minDelay;
  await wait.for({ milliseconds: delay });
  ```

**Inbound responses (agent replying to client messages):**
- Agent responds **24 hours**, any time — if the client initiates, reply immediately
- No business hour restriction on inbound replies

### Outbound Prospecting (Scheduled Task)

```
1. Trigger.dev cron task runs at 9am BRT (America/Sao_Paulo) daily
2. Fetch next 25 restaurants from Supabase (status = "pending")
3. For each restaurant:
   a. Check current time — if past 19:00 BRT, stop sending (resume tomorrow)
   b. Check if number has WhatsApp (chat/whatsappNumbers)
   c. If yes → send template message (message/sendText) — FIXED TEMPLATE, no LLM
   d. Update restaurant status in Supabase to "contacted" with timestamp
   e. Wait 7-18 minutes (randomized) before next message
4. First message and follow-ups are templates — NO LLM cost
5. LLM is only used when a restaurant replies (inbound)
```

### Inbound Response (Webhook → Agent)

```
1. Webhook receives MESSAGES_UPSERT (runs 24h — no time restriction)
2. Ignore if fromMe = true or group message
3. Look up sender in Supabase by phone number
4. If found and status = "contacted" or "follow_up_1":
   a. Mark message as read
   b. Send typing presence (2-3 seconds)
   c. Call LLM with conversation context for sales response
   d. Send LLM response via sendText
   e. Update conversation in Supabase
5. If unknown number (client reached out organically):
   a. Respond with generic greeting + offer (can use LLM)
```

### Follow-up Logic (Scheduled Task)

```
1. Trigger.dev cron task runs at 10am BRT daily
2. Check current time — only send if between 09:00-19:00 BRT
3. Query Supabase for restaurants where:
   - status = "contacted" AND contacted_at > 24 hours ago → send follow-up 1
   - status = "follow_up_1" AND follow_up_1_at > 72 hours ago → send follow-up 2
   - status = "follow_up_2" → mark as "cold" (stop contacting)
4. Follow-ups are FIXED TEMPLATES (no LLM cost)
5. Respect 7-18 min delay between each follow-up message sent
6. If a restaurant replied at any point, skip follow-up (already in conversation)
```

### Post-Purchase Upsell (Scheduled Task)

```
1. Trigger.dev cron task runs at 11am BRT daily
2. Check current time — only send if between 09:00-19:00 BRT
3. Query Supabase for active subscribers where:
   - subscribed_at >= 3 days ago AND upsell_contacted = false
4. Send upsell template message (FIXED TEMPLATE, no LLM)
5. Mark upsell_contacted = true
```

---

## Anti-Ban Best Practices

When doing outbound prospecting via WhatsApp:

- **Start slow**: 10-15 messages/day for the first week, then scale to 25
- **Randomize delays**: **7-18 minutes** between prospecting messages (never send in bursts)
- **Business hours only**: Outbound messages ONLY between 09:00-19:00 `America/Sao_Paulo`
- **Use warm numbers**: Don't use a brand new SIM card; age the number for 1-2 weeks with organic usage first
- **Vary templates slightly**: Rotate 3-4 versions of the first message with small text differences
- **Stop on blocks**: If messages fail to deliver, pause for 24 hours
- **Monitor connection state**: If instance disconnects, don't retry immediately
- **Separate inbound/outbound logic**: Inbound replies happen 24h with no restrictions; only outbound is rate-limited

---

## Environment Variables Checklist

```env
# Evolution API
EVOLUTION_API_URL=https://your-server.com    # No trailing slash
EVOLUTION_API_KEY=your-global-api-key
EVOLUTION_INSTANCE_NAME=pratoflash-agent

# Webhook
WEBHOOK_SECRET=your-webhook-auth-secret      # Verify incoming webhooks
WEBHOOK_URL=https://your-app.com/api/whatsapp/webhook
```

## Error Handling

Common errors and how to handle them:

| Status | Meaning | Action |
|---|---|---|
| 400 | Invalid request body | Check number format and required fields |
| 401 | Invalid API key | Verify EVOLUTION_API_KEY |
| 404 | Instance not found | Check instance name, may need to recreate |
| 409 | Instance already exists | Use existing instance |
| 500 | Server error | Retry with backoff |

Always wrap Evolution API calls in try/catch with retry logic:

```ts
async function sendMessage(number: string, text: string, retries = 3): Promise<any> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(
        `${process.env.EVOLUTION_API_URL}/message/sendText/${process.env.EVOLUTION_INSTANCE_NAME}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.EVOLUTION_API_KEY!,
          },
          body: JSON.stringify({ number, text, delay: 2000 }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Evolution API ${response.status}: ${error}`);
      }

      return await response.json();
    } catch (error) {
      if (attempt === retries) throw error;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}
```

## Documentation

- Full API reference: https://doc.evolution-api.com/v2/api-reference/get-information
- Postman collection: https://www.postman.com/agenciadgcode/evolution-api
- GitHub: https://github.com/EvolutionAPI/evolution-api
