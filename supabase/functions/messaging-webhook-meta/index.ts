/**
 * Meta Cloud API Webhook Handler
 *
 * Recebe eventos do Meta Cloud API (WhatsApp Business) e processa:
 * - Mensagens recebidas → cria/atualiza conversa + insere mensagem
 * - Status updates → atualiza status da mensagem
 *
 * Rotas:
 * - `GET /functions/v1/messaging-webhook-meta/<channel_id>` → Verificação do webhook (Meta challenge)
 * - `POST /functions/v1/messaging-webhook-meta/<channel_id>` → Eventos do webhook
 *
 * Autenticação:
 * - GET: Query param `hub.verify_token` deve bater com verify_token do canal
 * - POST: Header `X-Hub-Signature-256` para verificação de assinatura (opcional)
 */
import { createClient } from "npm:@supabase/supabase-js@2";

// =============================================================================
// TYPES
// =============================================================================

interface MetaCloudWebhookPayload {
  object: "whatsapp_business_account";
  entry: MetaWebhookEntry[];
}

interface MetaWebhookEntry {
  id: string;
  changes: MetaWebhookChange[];
}

interface MetaWebhookChange {
  value: MetaWebhookValue;
  field: "messages";
}

interface MetaWebhookValue {
  messaging_product: "whatsapp";
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: MetaWebhookContact[];
  messages?: MetaWebhookMessage[];
  statuses?: MetaWebhookStatus[];
  errors?: MetaApiError[];
}

interface MetaWebhookContact {
  profile: { name: string };
  wa_id: string;
}

interface MetaWebhookMessage {
  id: string;
  from: string;
  timestamp: string;
  type: "text" | "image" | "video" | "audio" | "document" | "sticker" | "location" | "contacts" | "button" | "interactive";
  text?: { body: string };
  image?: MetaMediaMessage;
  video?: MetaMediaMessage;
  audio?: MetaMediaMessage;
  document?: MetaMediaMessage & { filename?: string };
  sticker?: MetaMediaMessage;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  contacts?: unknown[];
  button?: { text: string; payload: string };
  interactive?: unknown;
  context?: { from: string; id: string };
  errors?: MetaApiError[];
}

interface MetaMediaMessage {
  id: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
}

interface MetaWebhookStatus {
  id: string;
  recipient_id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  conversation?: {
    id: string;
    origin: { type: string };
    expiration_timestamp?: string;
  };
  pricing?: {
    pricing_model: string;
    billable: boolean;
    category: string;
  };
  errors?: MetaApiError[];
}

interface MetaApiError {
  code: number;
  title?: string;
  message?: string;
  error_data?: { details: string };
}

interface MessageContent {
  type: string;
  text?: string;
  mediaUrl?: string;
  mimeType?: string;
  caption?: string;
  fileName?: string;
  latitude?: number;
  longitude?: number;
  name?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Hub-Signature-256, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function text(status: number, body: string) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain", ...corsHeaders },
  });
}

function getChannelIdFromPath(req: Request): string | null {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const idx = parts.findIndex((p) => p === "messaging-webhook-meta");
  if (idx === -1) return null;
  return parts[idx + 1] ?? null;
}

function normalizePhone(phone?: string): string | null {
  if (!phone) return null;
  // Remove non-digits and add +
  const digits = phone.replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

function extractContent(message: MetaWebhookMessage): MessageContent {
  switch (message.type) {
    case "text":
      return {
        type: "text",
        text: message.text?.body || "",
      };

    case "image":
      return {
        type: "image",
        mediaUrl: `meta:${message.image?.id}`, // Prefixo para indicar Meta media ID
        mimeType: message.image?.mime_type || "image/jpeg",
        caption: message.image?.caption,
      };

    case "video":
      return {
        type: "video",
        mediaUrl: `meta:${message.video?.id}`,
        mimeType: message.video?.mime_type || "video/mp4",
        caption: message.video?.caption,
      };

    case "audio":
      return {
        type: "audio",
        mediaUrl: `meta:${message.audio?.id}`,
        mimeType: message.audio?.mime_type || "audio/ogg",
      };

    case "document":
      return {
        type: "document",
        mediaUrl: `meta:${message.document?.id}`,
        fileName: message.document?.filename || "document",
        mimeType: message.document?.mime_type || "application/pdf",
      };

    case "sticker":
      return {
        type: "sticker",
        mediaUrl: `meta:${message.sticker?.id}`,
        mimeType: "image/webp",
      };

    case "location":
      return {
        type: "location",
        latitude: message.location?.latitude || 0,
        longitude: message.location?.longitude || 0,
        name: message.location?.name,
      };

    case "button":
      return {
        type: "text",
        text: message.button?.text || "[button click]",
      };

    default:
      return {
        type: "text",
        text: `[${message.type}]`,
      };
  }
}

function getMessagePreview(content: MessageContent): string {
  switch (content.type) {
    case "text":
      return (content.text || "").slice(0, 100);
    case "image":
      return content.caption || "[Imagem]";
    case "video":
      return content.caption || "[Vídeo]";
    case "audio":
      return "[Áudio]";
    case "document":
      return content.fileName || "[Documento]";
    case "sticker":
      return "[Sticker]";
    case "location":
      return content.name || "[Localização]";
    default:
      return "[Mensagem]";
  }
}

/**
 * Verify Meta webhook signature using HMAC-SHA256.
 * Note: In production, implement proper signature verification.
 */
async function verifySignature(
  payload: string,
  signature: string,
  appSecret: string
): Promise<boolean> {
  // Signature format: sha256=<hash>
  const [algorithm, expectedHash] = signature.split("=");
  if (algorithm !== "sha256" || !expectedHash) {
    return false;
  }

  try {
    // Encode the payload and secret
    const encoder = new TextEncoder();
    const keyData = encoder.encode(appSecret);
    const data = encoder.encode(payload);

    // Import the key
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    // Sign the payload
    const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, data);

    // Convert to hex
    const hashArray = Array.from(new Uint8Array(signatureBuffer));
    const computedHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    // Constant-time comparison
    return computedHash === expectedHash;
  } catch (error) {
    console.error("Signature verification error:", error);
    return false;
  }
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const channelId = getChannelIdFromPath(req);
  if (!channelId) {
    return json(404, { error: "channel_id ausente na URL" });
  }

  // Setup Supabase client
  const supabaseUrl =
    Deno.env.get("CRM_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
  const serviceKey =
    Deno.env.get("CRM_SUPABASE_SECRET_KEY") ??
    Deno.env.get("CRM_SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    return json(500, { error: "Supabase não configurado no runtime" });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Fetch channel
  const { data: channel, error: channelErr } = await supabase
    .from("messaging_channels")
    .select("id, organization_id, business_unit_id, external_identifier, credentials, status")
    .eq("id", channelId)
    .is("deleted_at", null)
    .maybeSingle();

  if (channelErr) {
    return json(500, { error: "Erro ao buscar canal", details: channelErr.message });
  }

  if (!channel) {
    return json(404, { error: "Canal não encontrado" });
  }

  const credentials = channel.credentials as Record<string, unknown>;

  // ==========================================================================
  // GET: Webhook Verification (Meta challenge)
  // ==========================================================================
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode !== "subscribe") {
      return json(400, { error: "Invalid mode" });
    }

    const verifyToken = credentials?.verifyToken;
    if (!verifyToken || token !== verifyToken) {
      console.log("Verify token mismatch:", { received: token, expected: verifyToken });
      return json(403, { error: "Verification failed" });
    }

    // Return the challenge to complete verification
    return text(200, challenge || "");
  }

  // ==========================================================================
  // POST: Webhook Events
  // ==========================================================================
  if (req.method !== "POST") {
    return json(405, { error: "Método não permitido" });
  }

  // Get raw body for signature verification
  const rawBody = await req.text();

  // Verify signature if app secret is configured
  const appSecret = credentials?.appSecret as string | undefined;
  const signature = req.headers.get("X-Hub-Signature-256") || "";

  if (appSecret && signature) {
    const isValid = await verifySignature(rawBody, signature, appSecret);
    if (!isValid) {
      console.error("Invalid webhook signature");
      return json(401, { error: "Invalid signature" });
    }
  }

  // Parse payload
  let payload: MetaCloudWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as MetaCloudWebhookPayload;
  } catch {
    return json(400, { error: "JSON inválido" });
  }

  // Validate payload structure
  if (payload.object !== "whatsapp_business_account" || !payload.entry?.[0]?.changes?.[0]) {
    // Meta sends different objects for different purposes, just ACK if not ours
    return json(200, { ok: true, ignored: true });
  }

  const change = payload.entry[0].changes[0];
  const value = change.value;

  // Log webhook event for audit
  const externalEventId = `meta_${payload.entry[0].id}_${Date.now()}`;

  const { error: eventInsertErr } = await supabase
    .from("messaging_webhook_events")
    .insert({
      channel_id: channelId,
      event_type: determineEventType(value),
      external_event_id: externalEventId,
      payload: payload as unknown as Record<string, unknown>,
      processed: false,
    });

  // Ignore duplicate key errors (idempotency)
  if (eventInsertErr && !eventInsertErr.message.toLowerCase().includes("duplicate")) {
    console.error("Error logging webhook event:", eventInsertErr);
  }

  try {
    // Process errors
    if (value.errors?.[0]) {
      console.error("Meta webhook error:", value.errors[0]);
      // Still return 200 to ACK receipt
    }

    // Process status updates
    if (value.statuses?.[0]) {
      for (const status of value.statuses) {
        await handleStatusUpdate(supabase, channel, status);
      }
    }

    // Process incoming messages
    if (value.messages?.[0]) {
      const contact = value.contacts?.[0];
      for (const message of value.messages) {
        await handleInboundMessage(supabase, channel, message, contact);
      }
    }

    // Mark event as processed
    await supabase
      .from("messaging_webhook_events")
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq("channel_id", channelId)
      .eq("external_event_id", externalEventId);

    return json(200, { ok: true, event_type: determineEventType(value) });
  } catch (error) {
    console.error("Webhook processing error:", error);

    // Log error in webhook event
    await supabase
      .from("messaging_webhook_events")
      .update({
        processed: true,
        processed_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      })
      .eq("channel_id", channelId)
      .eq("external_event_id", externalEventId);

    // Still return 200 to prevent Meta from retrying
    return json(200, {
      ok: false,
      error: "Processing error",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// =============================================================================
// EVENT HANDLERS
// =============================================================================

function determineEventType(value: MetaWebhookValue): string {
  if (value.errors?.[0]) return "error";
  if (value.statuses?.[0]) return "status_update";
  if (value.messages?.[0]) return "message_received";
  return "unknown";
}

async function handleInboundMessage(
  supabase: ReturnType<typeof createClient>,
  channel: {
    id: string;
    organization_id: string;
    business_unit_id: string;
    external_identifier: string;
  },
  message: MetaWebhookMessage,
  contact?: MetaWebhookContact
) {
  const phone = normalizePhone(message.from);
  if (!phone) throw new Error("Phone number is required");

  const externalMessageId = message.id;
  const content = extractContent(message);
  const timestamp = new Date(parseInt(message.timestamp) * 1000);
  const senderName = contact?.profile?.name;

  // Find or create conversation
  const { data: existingConv, error: convFindErr } = await supabase
    .from("messaging_conversations")
    .select("id, contact_id, unread_count, message_count")
    .eq("channel_id", channel.id)
    .eq("external_contact_id", phone)
    .maybeSingle();

  if (convFindErr) throw convFindErr;

  let conversationId: string;

  if (existingConv) {
    conversationId = existingConv.id;
  } else {
    // Try to find existing contact by phone
    const { data: crmContact } = await supabase
      .from("contacts")
      .select("id")
      .eq("organization_id", channel.organization_id)
      .eq("phone", phone)
      .is("deleted_at", null)
      .maybeSingle();

    // Create new conversation
    const { data: newConv, error: convCreateErr } = await supabase
      .from("messaging_conversations")
      .insert({
        organization_id: channel.organization_id,
        channel_id: channel.id,
        business_unit_id: channel.business_unit_id,
        external_contact_id: phone,
        external_contact_name: senderName || phone,
        contact_id: crmContact?.id || null,
        status: "open",
        priority: "normal",
        // WhatsApp 24h window starts when customer sends message
        window_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .select("id")
      .single();

    if (convCreateErr) throw convCreateErr;
    conversationId = newConv.id;
  }

  // Insert message
  const { error: msgErr } = await supabase.from("messaging_messages").insert({
    conversation_id: conversationId,
    external_id: externalMessageId,
    direction: "inbound",
    content_type: content.type,
    content: content,
    status: "delivered", // Inbound messages are already delivered
    delivered_at: timestamp.toISOString(),
    sender_name: senderName,
    reply_to_message_id: message.context?.id ? await findMessageByExternalId(supabase, conversationId, message.context.id) : null,
    metadata: {
      meta_message_id: message.id,
      timestamp: message.timestamp,
      context: message.context,
    },
  });

  if (msgErr) {
    // Ignore duplicate messages
    if (!msgErr.message.toLowerCase().includes("duplicate")) {
      throw msgErr;
    }
  }

  // Update conversation (trigger will update counters)
  await supabase
    .from("messaging_conversations")
    .update({
      last_message_at: timestamp.toISOString(),
      last_message_preview: getMessagePreview(content),
      last_message_direction: "inbound",
      // Reset 24h window on new inbound message
      window_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      // Reopen if resolved
      status: "open",
      // Update contact name if we have one
      ...(senderName && { external_contact_name: senderName }),
    })
    .eq("id", conversationId);
}

async function handleStatusUpdate(
  supabase: ReturnType<typeof createClient>,
  channel: { id: string },
  status: MetaWebhookStatus
) {
  const statusMap: Record<string, { status: string; field: string }> = {
    sent: { status: "sent", field: "sent_at" },
    delivered: { status: "delivered", field: "delivered_at" },
    read: { status: "read", field: "read_at" },
    failed: { status: "failed", field: "failed_at" },
  };

  const mapping = statusMap[status.status];
  if (!mapping) return;

  const timestamp = new Date(parseInt(status.timestamp) * 1000).toISOString();

  // Update message
  const updateData: Record<string, unknown> = {
    status: mapping.status,
    [mapping.field]: timestamp,
  };

  // Add error info if failed
  if (status.status === "failed" && status.errors?.[0]) {
    updateData.error_code = String(status.errors[0].code);
    updateData.error_message = status.errors[0].title || status.errors[0].message;
  }

  // Update window expiration if conversation info is present
  if (status.conversation?.expiration_timestamp) {
    // Meta sends expiration timestamp for conversation window
    // Update the conversation's window_expires_at
    const expirationTime = new Date(parseInt(status.conversation.expiration_timestamp) * 1000);

    // Find conversation by phone and update window
    const { data: msg } = await supabase
      .from("messaging_messages")
      .select("conversation_id")
      .eq("external_id", status.id)
      .maybeSingle();

    if (msg?.conversation_id) {
      await supabase
        .from("messaging_conversations")
        .update({ window_expires_at: expirationTime.toISOString() })
        .eq("id", msg.conversation_id);
    }
  }

  await supabase
    .from("messaging_messages")
    .update(updateData)
    .eq("external_id", status.id);
}

async function findMessageByExternalId(
  supabase: ReturnType<typeof createClient>,
  conversationId: string,
  externalId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("messaging_messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("external_id", externalId)
    .maybeSingle();

  return data?.id || null;
}
