import { createClient } from "npm:@supabase/supabase-js@2";
import { getAuthenticatedUserId, userOwnsPlayer } from "../_shared/authorization.ts";
import { corsHeaders } from "../_shared/cors.ts";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof TypeError) {
        return jsonResponse({ error: "Invalid JSON body" }, 400);
      }
      throw error;
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse({ error: "JSON body must be an object" }, 400);
    }
    const requestBody = body as Record<string, unknown>;
    const playerId = requestBody.player_id;
    const action = requestBody.action;
    if (typeof playerId !== "string" || !playerId || typeof action !== "string") {
      return jsonResponse({ error: "player_id and action are required" }, 400);
    }

    const userId = await getAuthenticatedUserId(req);
    if (!userId) return jsonResponse({ error: "Authentication required" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    if (!await userOwnsPlayer(supabase, userId, playerId)) {
      return jsonResponse({ error: "Not authorized for this player" }, 403);
    }

    if (action === "remove") {
      const queueId = requestBody.queue_id;
      if (typeof queueId !== "string" || !queueId) {
        return jsonResponse({ error: "queue_id is required for remove" }, 400);
      }
      const { data: queueItem, error: queueItemError } = await supabase
        .from("queue")
        .select("id")
        .eq("id", queueId)
        .eq("player_id", playerId)
        .is("played_at", null)
        .maybeSingle();
      if (queueItemError) throw queueItemError;
      if (!queueItem) return jsonResponse({ error: "Queue item not found" }, 404);

      const { error } = await supabase.rpc("queue_remove", { p_queue_id: queueId });
      if (error) throw error;
    } else if (action === "reorder") {
      const queueIds = requestBody.queue_ids;
      const type = requestBody.type === undefined ? "normal" : requestBody.type;
      if (!Array.isArray(queueIds)
        || queueIds.some((id) => typeof id !== "string")
        || (type !== "normal" && type !== "priority")) {
        return jsonResponse({ error: "Valid queue_ids and type are required for reorder" }, 400);
      }
      const { error } = await supabase.rpc("queue_reorder", {
        p_player_id: playerId,
        p_queue_ids: queueIds,
        p_type: type,
      });
      if (error) throw error;
    } else {
      return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }

    return jsonResponse({ success: true });
  } catch (error) {
    console.error("Queue manager admin bypass error:", error);
    return jsonResponse({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
