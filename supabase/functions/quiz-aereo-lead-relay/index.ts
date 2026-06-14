import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const allowedOrigins = new Set([
  "https://wwmeajuda.com.br",
  "https://www.wwmeajuda.com.br",
]);

function buildCorsHeaders(origin: string | null) {
  const safeOrigin = origin && allowedOrigins.has(origin) ? origin : "https://wwmeajuda.com.br";
  return {
    "Access-Control-Allow-Origin": safeOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

type QuizPayload = {
  answers?: {
    caseType?: string;
    whenHappened?: string;
  };
  lead?: {
    fullName?: string;
    whatsapp?: string;
    email?: string;
  };
  utm?: Record<string, string>;
  page?: {
    url?: string;
    path?: string;
    title?: string;
    referrer?: string;
  };
  timestamp?: string;
};

function digitsOnly(value = "") {
  return String(value).replace(/\D+/g, "");
}

function pickUtmLines(utm: Record<string, string> = {}) {
  const order = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"];
  return order
    .filter((key) => utm[key])
    .map((key) => `- ${key}: ${utm[key]}`);
}

function buildMessage(payload: QuizPayload) {
  const name = payload.lead?.fullName?.trim() || "Não informado";
  const whatsapp = payload.lead?.whatsapp?.trim() || "Não informado";
  const email = payload.lead?.email?.trim() || "Não informado";
  const caseType = payload.answers?.caseType?.trim() || "Não informado";
  const whenHappened = payload.answers?.whenHappened?.trim() || "Não informado";
  const timestamp = payload.timestamp || new Date().toISOString();
  const utmLines = pickUtmLines(payload.utm || {});
  const pageUrl = payload.page?.url || "";

  return [
    "🚨 *Novo lead | Quiz Aéreo*",
    "",
    `*Nome:* ${name}`,
    `*WhatsApp:* ${whatsapp}`,
    `*E-mail:* ${email}`,
    "",
    "*Respostas*",
    `- Caso: ${caseType}`,
    `- Quando aconteceu: ${whenHappened}`,
    "",
    "*Origem*",
    ...(utmLines.length ? utmLines : ["- sem UTM"]),
    pageUrl ? `- página: ${pageUrl}` : "- página: não informada",
    `- enviado em: ${timestamp}`,
  ].join("\n");
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = buildCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (origin && !allowedOrigins.has(origin)) {
    return new Response(JSON.stringify({ ok: false, error: "origin_not_allowed" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const payload = (await req.json()) as QuizPayload;

    const evolutionUrl = Deno.env.get("EVOLUTION_API_URL");
    const evolutionKey = Deno.env.get("EVOLUTION_API_KEY");
    const evolutionInstance = Deno.env.get("EVOLUTION_INSTANCE") || "jessica";
    const groupJid = Deno.env.get("EVOLUTION_GROUP_JID");

    if (!evolutionUrl || !evolutionKey || !groupJid) {
      return new Response(JSON.stringify({ ok: false, error: "missing_server_secrets" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const message = buildMessage(payload);
    const response = await fetch(`${evolutionUrl.replace(/\/$/, "")}/message/sendText/${evolutionInstance}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: evolutionKey,
      },
      body: JSON.stringify({
        number: groupJid,
        text: message,
        delay: 700,
        linkPreview: false,
      }),
    });

    const raw = await response.text();
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // keep raw text
    }

    return new Response(JSON.stringify({
      ok: response.ok,
      status: response.status,
      evolution: parsed,
      lead: {
        whatsapp_digits: digitsOnly(payload.lead?.whatsapp || ""),
        email: payload.lead?.email || "",
      },
    }), {
      status: response.ok ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : "unexpected_error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
